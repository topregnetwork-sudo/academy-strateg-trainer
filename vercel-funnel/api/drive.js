import { body, init, json, operator, sql } from './_core.js';

const parentFolderId = () => process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID || '1fpKRJQZIdFeqYCVQ6aWfN_4_xuLyMX4D';
const bridgeUrl = () => process.env.GOOGLE_DRIVE_BRIDGE_URL || 'https://script.google.com/macros/s/AKfycbyUI5L871jnAwoExsqOTFbcBL5K37UYv_Z0RzpA3ZuTaE_Ovp69jpgNbZGkK_vkosa6Xg/exec';

function bridgeConfig() {
  const url = bridgeUrl();
  const secret = process.env.GOOGLE_DRIVE_BRIDGE_SECRET || process.env.OPERATOR_ACCESS_KEY;
  if (!url || !secret) throw new Error('Канал Google Drive ещё не подключён');
  return { url, secret };
}

function clean(value, fallback = '') {
  return String(value ?? fallback).replace(/[<>]/g, '').trim();
}

function html(value) {
  return clean(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function base64(text) {
  return Buffer.from(String(text), 'utf8').toString('base64');
}

function answerSymbol(value) {
  return value === 'M' ? 'М' : clean(value);
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function callBridge(folderName, files) {
  const config = bridgeConfig();
  const response = await fetch(config.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ secret: config.secret, parentFolderId: parentFolderId(), folderName, files })
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) throw new Error(result?.error || 'Google Drive не принял файл');
  return result;
}

function candidateFolderName(candidate, createdAt = candidate.created_at) {
  const name = clean(candidate.full_name || [candidate.first_name, candidate.last_name].filter(Boolean).join(' ') || candidate.username || `Кандидат ${candidate.id}`);
  const created = new Date(createdAt || Date.now());
  const date = Number.isNaN(created.getTime()) ? 'дата не указана' : new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric' }).format(created);
  return `${name} — ${date}`.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
}

function printableCard({ candidate, application, questionnaireTwo, test }) {
  const question = (label, value) => `<article class="answer"><h3>${html(label)}</h3><p>${html(value || 'Не указано')}</p></article>`;
  const q1 = [
    ['Имя кандидата', application?.full_name || candidate.full_name || ''],
    ['Город', application?.city || candidate.city || ''],
    ['Telegram', candidate.username ? `@${candidate.username}` : ''],
    ['Телефон', candidate.phone || application?.phone || ''],
    ['Возраст', application?.age || ''],
    ['Почему хотите стать бизнес-тренером?', application?.motivation || ''],
    ['Опыт бизнес-тренера', application?.trainer_experience_level || candidate.trainer_experience_level || ''],
    ['Источник кандидата', candidate.source_id || application?.source_id || ''],
    ['Статус', candidate.status || '']
  ].map(([label, value]) => question(label, value)).join('');
  const labels = { work_history: 'Три последних места работы', achievements: 'Три главных достижения', strengths: 'Сильные навыки', development: 'Что развивать', family: 'Семья', children: 'Дети', hobbies: 'Увлечения', goals: 'Цели на пять лет', readiness: 'Готовность работать по шкале 0–10', income: 'Ожидаемый доход' };
  const q2 = questionnaireTwo?.answers ? Object.entries(questionnaireTwo.answers).map(([key, value]) => question(labels[key] || key, value)).join('') : '<p class="muted">Анкета 2 ещё не заполнена.</p>';
  const t1 = test?.answers ? `<p>Тест 1: ${test.submitted_at ? 'заполнен' : 'ожидает ответа'}; ответов: ${Array.isArray(test.answers) ? test.answers.length : 0}.</p>` : '<p>Тест 1: ещё не отправлен.</p>';
  return `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Карточка кандидата</title><style>body{font:16px/1.5 Arial,sans-serif;max-width:820px;margin:28px auto;padding:0 18px;color:#172034;background:#f8fafc}h1{font-size:30px;margin:0 0 4px}h2{margin:28px 0 12px;padding-bottom:7px;border-bottom:2px solid #0b728d;color:#0b526b}.answer{background:#fff;border:1px solid #d8e1e8;border-radius:10px;margin:10px 0;padding:12px 16px}.answer h3{font-size:15px;margin:0 0 6px;color:#0b526b}.answer p{white-space:pre-wrap;margin:0}.muted{color:#64748b}</style><h1>Карточка кандидата в тренеры</h1><p class="muted">Сформировано: ${html(new Date().toLocaleString('ru-RU'))}</p><h2>Данные кандидата и ответы Анкеты 1</h2>${q1}<h2>Ответы Анкеты 2</h2>${q2}<h2>Тестирование</h2>${t1}<p>Тест 2 — IQ: ожидает подключения.</p><p>Тест 3 — воспроизведение: ожидает подключения.</p></html>`;
}

function textFile(name, content, mimeType = 'text/html') {
  return { name, mimeType, data: base64(content) };
}

function testAnswersCsv({ candidate, application, test }) {
  const name = application?.full_name || candidate.full_name || [candidate.first_name, candidate.last_name].filter(Boolean).join(' ') || candidate.username || `Кандидат ${candidate.id}`;
  const telegram = candidate.username ? `@${candidate.username}` : 'не указан';
  const submitted = test.submitted_at ? new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'short' }).format(new Date(test.submitted_at)) : '';
  const answers = Array.isArray(test.answers) ? test.answers.map(answerSymbol) : [];
  const rows = [['Кандидат', name], ['Telegram', telegram], ['Город', candidate.city || application?.city || ''], ['Телефон', candidate.phone || application?.phone || ''], ['Дата заполнения', submitted], [], ['№', '+', 'М', '−', '№', '+', 'М', '−', '№', '+', 'М', '−', '№', '+', 'М', '−', '№', '+', 'М', '−']];
  for (let row = 0; row < 40; row += 1) {
    const line = [];
    for (let block = 0; block < 5; block += 1) {
      const index = block * 40 + row, answer = answers[index] || '';
      line.push(index + 1, answer === '+' ? '✓' : '', answer === 'М' ? '✓' : '', answer === '-' ? '✓' : '');
    }
    rows.push(line);
  }
  const cell = value => { const text = String(value ?? ''); return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
  return `\uFEFF${rows.map(row => row.map(cell).join(';')).join('\r\n')}`;
}

export async function syncDriveCandidate(candidateId) {
  await init();
  const candidate = (await sql`SELECT c.*,a.full_name,a.age,a.motivation,a.phone AS application_phone,a.source_id AS application_source_id,a.trainer_experience_level FROM candidates c LEFT JOIN applications a ON a.candidate_id=c.id WHERE c.id=${Number(candidateId)} LIMIT 1`).rows[0];
  if (!candidate) throw new Error('Кандидат не найден');
  const application = (await sql`SELECT * FROM applications WHERE candidate_id=${candidate.id} ORDER BY created_at DESC LIMIT 1`).rows[0] || null;
  const questionnaireTwo = (await sql`SELECT * FROM candidate_questionnaire_two WHERE candidate_id=${candidate.id} LIMIT 1`).rows[0] || null;
  const test = (await sql`SELECT * FROM candidate_tests WHERE candidate_id=${candidate.id} ORDER BY created_at DESC LIMIT 1`).rows[0] || null;
  if (!questionnaireTwo?.submitted_at || !test?.submitted_at) return { pending: true, message: 'Папка кандидата появится после заполнения Теста 1' };
  const folderName = candidateFolderName(candidate, test.submitted_at);
  const files = [
    textFile('00 — Карточка кандидата.html', printableCard({ candidate, application, questionnaireTwo, test })),
    textFile('03 — Тест 1 — ответы.csv', testAnswersCsv({ candidate, application, test }), 'text/csv;charset=utf-8')
  ];
  const result = await callBridge(folderName, files);
  await sql`DELETE FROM candidate_drive_files WHERE candidate_id=${candidate.id} AND (file_name LIKE '01 — Анкета 1%' OR file_name LIKE '02 — Анкета 2%')`;
  const folder = result.folder;
  await sql`INSERT INTO candidate_drive(candidate_id,folder_id,folder_url,folder_name,synced_at,updated_at) VALUES(${candidate.id},${folder.id},${folder.url},${folder.name},NOW(),NOW()) ON CONFLICT(candidate_id) DO UPDATE SET folder_id=EXCLUDED.folder_id,folder_url=EXCLUDED.folder_url,folder_name=EXCLUDED.folder_name,synced_at=NOW(),updated_at=NOW()`;
  for (const file of result.files || []) await sql`INSERT INTO candidate_drive_files(candidate_id,file_kind,file_name,file_url,drive_file_id,mime_type,updated_at) VALUES(${candidate.id},${file.name},${file.name},${file.url},${file.id},${file.mimeType || 'application/octet-stream'},NOW()) ON CONFLICT(candidate_id,file_kind) DO UPDATE SET file_name=EXCLUDED.file_name,file_url=EXCLUDED.file_url,drive_file_id=EXCLUDED.drive_file_id,mime_type=EXCLUDED.mime_type,updated_at=NOW()`;
  return { folder, files: result.files || [] };
}

export async function uploadDriveFile(candidateId, item) {
  await init();
  const candidate = (await sql`SELECT c.*,a.full_name FROM candidates c LEFT JOIN applications a ON a.candidate_id=c.id WHERE c.id=${Number(candidateId)} LIMIT 1`).rows[0];
  if (!candidate) throw new Error('Кандидат не найден');
  const questionnaireTwo = (await sql`SELECT submitted_at FROM candidate_questionnaire_two WHERE candidate_id=${candidate.id} LIMIT 1`).rows[0] || null;
  const test = (await sql`SELECT submitted_at FROM candidate_tests WHERE candidate_id=${candidate.id} ORDER BY created_at DESC LIMIT 1`).rows[0] || null;
  if (!questionnaireTwo?.submitted_at || !test?.submitted_at) throw new Error('Папка доступна после заполнения Теста 1');
  if (!item?.fileName || !item?.fileData) throw new Error('Файл не передан');
  const result = await callBridge(candidateFolderName(candidate, test.submitted_at), [{ name: clean(item.fileName), mimeType: clean(item.mimeType || 'application/octet-stream'), data: String(item.fileData) }]);
  const file = result.files?.[0];
  if (file) await sql`INSERT INTO candidate_drive_files(candidate_id,file_kind,file_name,file_url,drive_file_id,mime_type,updated_at) VALUES(${candidate.id},${clean(item.fileKind || item.fileName)},${file.name},${file.url},${file.id},${file.mimeType || item.mimeType || 'application/octet-stream'},NOW()) ON CONFLICT(candidate_id,file_kind) DO UPDATE SET file_name=EXCLUDED.file_name,file_url=EXCLUDED.file_url,drive_file_id=EXCLUDED.drive_file_id,mime_type=EXCLUDED.mime_type,updated_at=NOW()`;
  await sql`INSERT INTO candidate_drive(candidate_id,folder_id,folder_url,folder_name,synced_at,updated_at) VALUES(${candidate.id},${result.folder.id},${result.folder.url},${result.folder.name},NOW(),NOW()) ON CONFLICT(candidate_id) DO UPDATE SET folder_id=EXCLUDED.folder_id,folder_url=EXCLUDED.folder_url,folder_name=EXCLUDED.folder_name,synced_at=NOW(),updated_at=NOW()`;
  return result;
}

export default async function handler(req, res) {
  if (!operator(req)) return json(res, 401, { error: 'Неверный код доступа' });
  try {
    const v = await body(req);
    if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
    if (v.action === 'sync_candidate') return json(res, 200, { ok: true, ...(await syncDriveCandidate(v.candidateId)) });
    if (v.action === 'upload_file') return json(res, 200, { ok: true, ...(await uploadDriveFile(v.candidateId, v)) });
    return json(res, 400, { error: 'Неизвестное действие Google Drive' });
  } catch (error) {
    console.error('[drive] failed', error);
    return json(res, 500, { error: String(error?.message || 'Не удалось сохранить в Google Drive') });
  }
}
