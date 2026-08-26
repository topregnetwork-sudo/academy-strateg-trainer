import { body, init, json, operator, sql } from './_core.js';

const parentFolderId = () => process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID || '1fpKRJQZIdFeqYCVQ6aWfN_4_xuLyMX4D';

function bridgeConfig() {
  const url = process.env.GOOGLE_DRIVE_BRIDGE_URL;
  const secret = process.env.GOOGLE_DRIVE_BRIDGE_SECRET;
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
  const q1 = [
    ['Имя', application?.full_name || candidate.full_name || ''],
    ['Город', application?.city || candidate.city || ''],
    ['Телефон', candidate.phone || application?.phone || ''],
    ['Возраст', application?.age || ''],
    ['Мотивация', application?.motivation || ''],
    ['Опыт бизнес-тренера', application?.trainer_experience_level || candidate.trainer_experience_level || ''],
    ['Источник', candidate.source_id || application?.source_id || ''],
    ['Статус', candidate.status || '']
  ].map(([label, value]) => `<tr><th>${html(label)}</th><td>${html(value)}</td></tr>`).join('');
  const q2 = questionnaireTwo?.answers ? Object.entries(questionnaireTwo.answers).map(([key, value]) => `<tr><th>${html(key)}</th><td>${html(value)}</td></tr>`).join('') : '<tr><td colspan="2">Анкета 2 ещё не заполнена</td></tr>';
  const t1 = test?.answers ? `<p>Тест 1: ${test.submitted_at ? 'заполнен' : 'ожидает ответа'}; ответов: ${Array.isArray(test.answers) ? test.answers.length : 0}.</p>` : '<p>Тест 1: ещё не отправлен.</p>';
  return `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Карточка кандидата</title><style>body{font:14px Arial;max-width:900px;margin:32px auto;color:#172034}h1{margin-bottom:4px}h2{margin-top:28px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #cbd5e1;padding:8px;text-align:left;vertical-align:top}th{width:30%;background:#f1f5f9}</style><h1>Карточка кандидата в тренеры</h1><p>Сформировано: ${html(new Date().toLocaleString('ru-RU'))}</p><h2>Анкета 1</h2><table>${q1}</table><h2>Анкета 2</h2><table>${q2}</table><h2>Тестирование</h2>${t1}<p>Тест 2 — IQ: ожидает подключения.</p><p>Тест 3 — воспроизведение: ожидает подключения.</p></html>`;
}

function textFile(name, content, mimeType = 'text/html') {
  return { name, mimeType, data: base64(content) };
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
    textFile('01 — Анкета 1.html', printableCard({ candidate, application, questionnaireTwo: null, test }).replace('<h2>Анкета 2</h2><table><tr><td colspan="2">Анкета 2 ещё не заполнена</td></tr></table>', '')),
    textFile('02 — Анкета 2.html', printableCard({ candidate, application: null, questionnaireTwo, test }).match(/<h2>Анкета 2<\/h2>[\s\S]*?<h2>Тестирование<\/h2>/)?.[0] || '<p>Анкета 2 заполнена</p>')
  ];
  files.push(textFile('03 — Тест 1 — ответы.json', JSON.stringify({ candidate_id: candidate.id, questionnaire_version: test.questionnaire_version || null, status: test.status || 'completed', submitted_at: test.submitted_at, answers: test.answers || [] }, null, 2), 'application/json'));
  const result = await callBridge(folderName, files);
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
