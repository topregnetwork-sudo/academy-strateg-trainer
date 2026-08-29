import { init, json, operator, sql, telegram, telegramApi } from './_core.js';
import { syncDriveCandidate } from './drive.js';
import crypto from 'node:crypto';

const EVENT_DATE = '2026-09-01';
const EVENT_DATE_TEXT = '1 сентября 2026 года';
const ADDRESS = 'Площадь Свободы, 8';
const GOALS_URL = 'https://academy-strateg-trainer.vercel.app/goals.html';
const PDF_URL = 'https://academy-strateg-trainer.vercel.app/academy-strateg-goals.pdf';
const ROUTE_URL = 'https://drive.google.com/drive/folders/1SwBmFviGh5MaS81T_89iARM5_Hjygd9-?usp=drive_link';
const COORDINATION_CHAT_ID = '-1004397133749';
const COORDINATION_THREAD_ID = 30;
const CAPACITY = 1;
const SLOTS = { '1100':'11:00','1115':'11:15','1130':'11:30','1145':'11:45','1200':'12:00','1215':'12:15','1230':'12:30','1245':'12:45','1300':'13:00','1315':'13:15','1330':'13:30' };
const BATCH_KEY_HASH = '1c509736d2caa55aa6c37e45e2ffa9e5a4ab369676e3e934d8781aea63d6baaf';

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, symbol => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[symbol]);
}

async function slotSummary({ ensureDrive = false } = {}) {
  let rows = (await sql`
    SELECT b.candidate_id,b.slot_time,b.slot_position,
           COALESCE(NULLIF(TRIM(a.full_name),''),NULLIF(TRIM(CONCAT_WS(' ',c.first_name,c.last_name)),''),c.username,'Кандидат ' || c.id::text) AS full_name,
           d.folder_url
    FROM offline_interview_bookings b
    JOIN candidates c ON c.id=b.candidate_id
    LEFT JOIN LATERAL (SELECT full_name FROM applications WHERE candidate_id=c.id ORDER BY created_at DESC LIMIT 1) a ON TRUE
    LEFT JOIN candidate_drive d ON d.candidate_id=c.id
    WHERE b.event_date=${EVENT_DATE}::date AND b.status='booked'
    ORDER BY b.slot_time,b.slot_position
  `).rows;
  if (ensureDrive) {
    for (const row of rows.filter(item => !item.folder_url)) {
      try { await syncDriveCandidate(row.candidate_id); }
      catch (error) { console.error('[offline] Drive sync failed for summary', { candidateId: row.candidate_id, message: String(error) }); }
    }
    rows = (await sql`
      SELECT b.candidate_id,b.slot_time,b.slot_position,
             COALESCE(NULLIF(TRIM(a.full_name),''),NULLIF(TRIM(CONCAT_WS(' ',c.first_name,c.last_name)),''),c.username,'Кандидат ' || c.id::text) AS full_name,
             d.folder_url
      FROM offline_interview_bookings b
      JOIN candidates c ON c.id=b.candidate_id
      LEFT JOIN LATERAL (SELECT full_name FROM applications WHERE candidate_id=c.id ORDER BY created_at DESC LIMIT 1) a ON TRUE
      LEFT JOIN candidate_drive d ON d.candidate_id=c.id
      WHERE b.event_date=${EVENT_DATE}::date AND b.status='booked'
      ORDER BY b.slot_time,b.slot_position
    `).rows;
  }
  const grouped = Object.fromEntries(Object.keys(SLOTS).map(slot => [slot, rows.filter(row => row.slot_time === slot)]));
  const total = rows.length;
  const lines = Object.entries(SLOTS).map(([slot, label]) => {
    const candidates = grouped[slot];
    const list = candidates.length ? candidates.map((candidate, index) => {
      const name = esc(candidate.full_name);
      return `${index + 1}. ${candidate.folder_url ? `<a href="${esc(candidate.folder_url)}">${name}</a>` : `${name} — папка создаётся`}`;
    }).join('\n') : '— записей нет';
    return `<b>${label} — ${candidates.length} из ${CAPACITY}</b> · свободно ${CAPACITY - candidates.length}\n${list}`;
  });
  return {
    counts: Object.fromEntries(Object.entries(grouped).map(([slot, candidates]) => [slot, candidates.length])),
    total,
    text: `📊 <b>Общая сводка на 1 сентября</b>\n\n${lines.join('\n\n')}\n\nВсего: <b>${total} из ${CAPACITY * Object.keys(SLOTS).length}</b> · свободно ${CAPACITY * Object.keys(SLOTS).length - total}`
  };
}

export async function sendOfflineSlotSummary() {
  await init();
  const summary = await slotSummary({ ensureDrive: true });
  const messageId = await telegram(COORDINATION_CHAT_ID, summary.text, { message_thread_id: COORDINATION_THREAD_ID, disable_web_page_preview: true });
  return { messageId, counts: summary.counts, total: summary.total };
}

async function sendCoordinationTest() {
  const slotLines=Object.values(SLOTS).map(time=>`• ${time}`).join('\n');
  const text=`🧪 <b>ТЕСТ — офлайн-собеседование 1 сентября</b>\n\nПри каждой новой записи здесь появится бриф: имя, город, Telegram, телефон, выбранное время, ссылка на папку Google Drive и общая сводка.\n\n<b>Доступные слоты:</b>\n${slotLines}\n\nКаждый слот — один кандидат. Это тестовое сообщение, место не занято.`;
  const messageId=await telegram(COORDINATION_CHAT_ID,text,{message_thread_id:COORDINATION_THREAD_ID,disable_web_page_preview:true});
  return {messageId};
}

function deadlines(now = new Date()) {
  return { stopAll: new Date('2026-09-01T13:30:00+03:00'), now };
}

function availableSlots(now = new Date()) {
  const d = deadlines(now);
  if (d.now >= d.stopAll) return [];
  return Object.keys(SLOTS).filter(slot => {
    const hour=Number(slot.slice(0,2)),minute=Number(slot.slice(2));
    const starts=new Date(Date.UTC(2026,8,1,hour-3,minute));
    return d.now < new Date(starts.getTime()-60*60*1000);
  });
}

async function bookableSlots(now = new Date()) {
  const timed = availableSlots(now);
  if (!timed.length) return [];
  const counts = (await sql`SELECT slot_time,count(*)::int AS count FROM offline_interview_bookings WHERE event_date=${EVENT_DATE}::date AND status='booked' GROUP BY slot_time`).rows;
  const bySlot = Object.fromEntries(counts.map(row => [row.slot_time, row.count]));
  return timed.filter(slot => (bySlot[slot] || 0) < CAPACITY);
}

async function inviteKeyboard(now = new Date()) {
  const rows = [[{ text: 'Изучить Цели Академии', url: GOALS_URL }, { text: 'Скачать PDF', url: PDF_URL }]];
  const available = await bookableSlots(now);
  for(let index=0;index<available.length;index+=2) rows.push(available.slice(index,index+2).map(slot => ({ text: SLOTS[slot], callback_data: `offline_minsk_${EVENT_DATE.replaceAll('-', '')}_${slot}` })));
  return { inline_keyboard: rows };
}

function invitationText() {
  return `Спасибо, что заполнили анкету и завершили Тест 1.\n\nПриглашаем вас на следующий этап — дальнейшее тестирование и личное собеседование в Академии Стратег.\n\nДата: <b>${EVENT_DATE_TEXT}</b>\nАдрес: <b>${ADDRESS}</b>\n\nВыберите одно доступное время по кнопке ниже. Каждый слот предназначен для одного кандидата.\n\nДо собеседования ознакомьтесь и изучите Цели Академии Стратег.\n\n<a href="${ROUTE_URL}">Фото и видео — как пройти</a>`;
}

export async function sendOfflineInvites() {
  await init();
  if (!(await bookableSlots()).length) return { stopped: true, sent: 0, failed: 0, recipients: [] };
  const recipients = (await sql`
    SELECT c.id,c.chat_id,c.username,c.first_name,c.last_name,c.city,
           COALESCE(NULLIF(TRIM(a.full_name),''),NULLIF(TRIM(CONCAT_WS(' ',c.first_name,c.last_name)),''),c.username,'Кандидат ' || c.id::text) AS full_name
    FROM candidates c
    JOIN candidate_tests t ON t.candidate_id=c.id AND t.submitted_at IS NOT NULL
    LEFT JOIN LATERAL (SELECT full_name,city FROM applications WHERE candidate_id=c.id ORDER BY created_at DESC LIMIT 1) a ON TRUE
    LEFT JOIN offline_interview_invites i ON i.candidate_id=c.id AND i.event_date=${EVENT_DATE}::date
    WHERE c.consent=true
      AND LOWER(TRIM(COALESCE(NULLIF(a.city,''),c.city,'')))='минск'
      AND c.status NOT IN ('test_1_passed','training','internship','hired','rejected','cancelled')
      AND NOT EXISTS (SELECT 1 FROM offline_interview_bookings previous WHERE previous.candidate_id=c.id AND previous.event_date<${EVENT_DATE}::date AND previous.status='booked')
      AND (i.candidate_id IS NULL OR i.status='failed')
    ORDER BY t.submitted_at ASC
  `).rows;
  let sent = 0, failed = 0;
  const delivered = [];
  for (const candidate of recipients) {
    if (!(await bookableSlots()).length) break;
    const reserved = (await sql`INSERT INTO offline_interview_invites(candidate_id,event_date,status,updated_at) VALUES(${candidate.id},${EVENT_DATE}::date,'pending',NOW()) ON CONFLICT(candidate_id,event_date) DO UPDATE SET status='pending',updated_at=NOW() WHERE offline_interview_invites.status='failed' RETURNING candidate_id`).rows[0];
    if (!reserved) continue;
    const text = invitationText();
    try {
      const messageId = await telegram(candidate.chat_id, text, { disable_web_page_preview: true, reply_markup: await inviteKeyboard() });
      await sql`UPDATE offline_interview_invites SET status='sent',telegram_message_id=${String(messageId || '')},sent_at=NOW(),updated_at=NOW() WHERE candidate_id=${candidate.id} AND event_date=${EVENT_DATE}::date`;
      await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) VALUES(${candidate.id},'out','offline_interview_invite',${text},'delivered',${String(messageId || '')})`;
      sent++;
      delivered.push({ id: candidate.id, full_name: candidate.full_name, username: candidate.username || null, city: candidate.city });
    } catch (error) {
      failed++;
      await sql`UPDATE offline_interview_invites SET status='failed',updated_at=NOW() WHERE candidate_id=${candidate.id} AND event_date=${EVENT_DATE}::date`;
      console.error('[offline] invitation failed', { candidateId: candidate.id, message: String(error) });
    }
  }
  return { stopped: false, sent, failed, recipients: delivered };
}

export async function refreshInvitationKeyboards() {
  const replyMarkup = await inviteKeyboard();
  const rows = (await sql`SELECT c.chat_id,i.telegram_message_id FROM offline_interview_invites i JOIN candidates c ON c.id=i.candidate_id WHERE i.event_date=${EVENT_DATE}::date AND i.telegram_message_id IS NOT NULL AND i.status IN ('sent','booked')`).rows;
  for (const row of rows) {
    try { await telegramApi('editMessageReplyMarkup', { chat_id: row.chat_id, message_id: Number(row.telegram_message_id), reply_markup: replyMarkup }); }
    catch (error) { console.error('[offline] keyboard refresh failed', { chatId: row.chat_id, messageId: row.telegram_message_id, message: String(error) }); }
  }
}

async function allocate(candidateId, slot) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const row = (await sql`
      INSERT INTO offline_interview_bookings(candidate_id,event_date,slot_time,slot_position,status)
      SELECT ${candidateId},${EVENT_DATE}::date,${slot},position,'booked'
      FROM generate_series(1,${CAPACITY}) position
      WHERE NOT EXISTS (SELECT 1 FROM offline_interview_bookings b WHERE b.event_date=${EVENT_DATE}::date AND b.slot_time=${slot} AND b.slot_position=position AND b.status='booked')
      ORDER BY position LIMIT 1
      ON CONFLICT DO NOTHING
      RETURNING candidate_id,slot_position
    `).rows[0];
    if (row) return row;
  }
  return null;
}

export async function handleOfflineInterviewChoice(callback) {
  const preview = callback.data?.match(/^offline_preview_(\d{4})$/);
  if (preview) {
    await telegramApi('answerCallbackQuery', { callback_query_id: callback.id, text: `Тест кнопки ${SLOTS[preview[1]]}: работает. Место не занято.`, show_alert: true });
    return true;
  }
  const match = callback.data?.match(/^offline_minsk_20260901_(\d{4})$/);
  if(match&&!SLOTS[match[1]])return false;
  if (!match) return false;
  const slot = match[1], chatId = String(callback.message?.chat?.id || callback.from?.id || '');
  const available = availableSlots();
  if (!available.includes(slot)) {
    await telegramApi('answerCallbackQuery', { callback_query_id: callback.id, text: 'Запись на это время уже закрыта.', show_alert: true });
    return true;
  }
  const candidate = (await sql`
    SELECT c.id,c.chat_id,c.username,c.first_name,c.last_name,c.phone,c.city,
           COALESCE(NULLIF(TRIM(a.full_name),''),NULLIF(TRIM(CONCAT_WS(' ',c.first_name,c.last_name)),''),c.username,'Кандидат ' || c.id::text) AS full_name
    FROM candidates c
    JOIN candidate_tests t ON t.candidate_id=c.id AND t.submitted_at IS NOT NULL
    LEFT JOIN LATERAL (SELECT full_name,city FROM applications WHERE candidate_id=c.id ORDER BY created_at DESC LIMIT 1) a ON TRUE
    WHERE c.chat_id=${chatId} AND LOWER(TRIM(COALESCE(NULLIF(a.city,''),c.city,'')))='минск' LIMIT 1
  `).rows[0];
  if (!candidate) {
    await telegramApi('answerCallbackQuery', { callback_query_id: callback.id, text: 'Эта запись доступна только приглашённым кандидатам из Минска.', show_alert: true });
    return true;
  }
  const existing = (await sql`SELECT slot_time,slot_position FROM offline_interview_bookings WHERE candidate_id=${candidate.id} AND event_date=${EVENT_DATE}::date AND status='booked' LIMIT 1`).rows[0];
  if (existing) {
    await telegramApi('answerCallbackQuery', { callback_query_id: callback.id, text: `Вы уже записаны на ${SLOTS[existing.slot_time]}.`, show_alert: true });
    return true;
  }
  const booking = await allocate(candidate.id, slot);
  if (!booking) {
    await telegramApi('answerCallbackQuery', { callback_query_id: callback.id, text: `На ${SLOTS[slot]} свободных мест уже нет. Выберите другое время.`, show_alert: true });
    return true;
  }
  await sql`UPDATE offline_interview_invites SET status='booked',updated_at=NOW() WHERE candidate_id=${candidate.id} AND event_date=${EVENT_DATE}::date`;
  try { await syncDriveCandidate(candidate.id); }
  catch (error) { console.error('[offline] Drive sync failed after booking', { candidateId: candidate.id, message: String(error) }); }
  const summary = await slotSummary();
  const confirmation = `✅ <b>Вы записаны на дальнейшее тестирование и личное собеседование</b>\n\nДата: <b>${EVENT_DATE_TEXT}</b>\nВремя: <b>${SLOTS[slot]}</b>\nАдрес: <b>${ADDRESS}</b>\n\nДо встречи ознакомьтесь и изучите Цели Академии Стратег.\n\n<a href="${GOALS_URL}">Изучить Цели Академии</a>\n<a href="${PDF_URL}">Скачать Цели в PDF</a>\n<a href="${ROUTE_URL}">Фото и видео — как пройти</a>`;
  const confirmationId = await telegram(chatId, confirmation, { disable_web_page_preview: true });
  await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) VALUES(${candidate.id},'out','offline_interview_confirmation',${confirmation},'delivered',${String(confirmationId || '')})`;
  const username = candidate.username ? `@${candidate.username}` : 'не указан';
  const drive = (await sql`SELECT folder_url FROM candidate_drive WHERE candidate_id=${candidate.id} LIMIT 1`).rows[0];
  const driveLine = drive?.folder_url ? `<a href="${esc(drive.folder_url)}">Папка кандидата в Google Drive</a>` : 'Папка кандидата в Google Drive создаётся';
  const notice = `✅ <b>Новая запись на офлайн-собеседование</b>\n\nКандидат: <b>${esc(candidate.full_name)}</b>\nГород: Минск\nTelegram: ${esc(username)}\nТелефон: ${esc(candidate.phone || 'не указан')}\nДата: ${EVENT_DATE_TEXT}\nВремя: <b>${SLOTS[slot]}</b>\n${driveLine}\n\n${summary.text}\n\n<a href="https://academy-strateg-trainer.vercel.app/operator.html">Открыть операторскую панель</a>`;
  await telegram(COORDINATION_CHAT_ID, notice, { message_thread_id: COORDINATION_THREAD_ID, disable_web_page_preview: true });
  if (summary.counts[slot] >= CAPACITY) await refreshInvitationKeyboards();
  await telegramApi('answerCallbackQuery', { callback_query_id: callback.id, text: `Запись на ${SLOTS[slot]} сохранена.` });
  return true;
}

export async function sendOfflinePreview() {
  await init();
  const candidate = (await sql`SELECT id,chat_id FROM candidates WHERE LOWER(username)='hracademystrateg' LIMIT 1`).rows[0];
  if (!candidate) throw new Error('Тестовый аккаунт @HRAcademyStrateg не найден');
  const keyboard = { inline_keyboard: [
    [{ text: 'Изучить Цели Академии', url: GOALS_URL }, { text: 'Скачать PDF', url: PDF_URL }],
    [{ text: 'Записаться на 13:30', callback_data: 'offline_preview_1330' }, { text: 'Записаться на 14:30', callback_data: 'offline_preview_1430' }]
  ] };
  const messageId = await telegram(candidate.chat_id, `🧪 <b>Тестовый вариант сообщения</b>\n\n${invitationText()}\n\nНажатие временных кнопок в этом тесте не занимает места.`, { disable_web_page_preview: true, reply_markup: keyboard });
  return { candidateId: candidate.id, messageId };
}

export default async function handler(req, res) {
  const supplied=String(req.query?.batch_key||'');
  const batchAuthorized=supplied&&crypto.createHash('sha256').update(supplied).digest('hex')===BATCH_KEY_HASH;
  if (!operator(req)&&!batchAuthorized) return json(res, 401, { error: 'Неверный код доступа' });
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  try {
    await init();
    if(req.query?.preview==='1'){
      const rows=(await sql`SELECT c.id FROM candidates c JOIN candidate_tests t ON t.candidate_id=c.id AND t.submitted_at IS NOT NULL LEFT JOIN LATERAL (SELECT city FROM applications WHERE candidate_id=c.id ORDER BY created_at DESC LIMIT 1) a ON TRUE LEFT JOIN offline_interview_invites i ON i.candidate_id=c.id AND i.event_date=${EVENT_DATE}::date WHERE c.consent=true AND LOWER(TRIM(COALESCE(NULLIF(a.city,''),c.city,'')))='минск' AND c.status NOT IN ('test_1_passed','training','internship','hired','rejected','cancelled') AND NOT EXISTS (SELECT 1 FROM offline_interview_bookings previous WHERE previous.candidate_id=c.id AND previous.event_date<${EVENT_DATE}::date AND previous.status='booked') AND (i.candidate_id IS NULL OR i.status='failed')`).rows;
      return json(res,200,{ok:true,preview:true,recipientCount:rows.length,slots:Object.values(SLOTS),capacity:CAPACITY});
    }
    if(req.query?.coordination_test==='1') return json(res,200,{ok:true,test:true,...(await sendCoordinationTest())});
    return json(res, 200, { ok: true, ...(await sendOfflineInvites()) });
  }
  catch (error) { console.error('[offline] batch failed', error); return json(res, 500, { error: String(error?.message || error) }); }
}
