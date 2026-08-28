import { init, json, operator, sql, telegram, telegramApi } from './_core.js';

const EVENT_DATE = '2026-08-28';
const ADDRESS = 'Площадь Свободы, 8';
const GOALS_URL = 'https://academy-strateg-trainer.vercel.app/goals.html';
const PDF_URL = 'https://academy-strateg-trainer.vercel.app/academy-strateg-goals.pdf';
const ROUTE_URL = 'https://drive.google.com/drive/folders/1SwBmFviGh5MaS81T_89iARM5_Hjygd9-?usp=drive_link';
const COORDINATION_CHAT_ID = '-1004397133749';
const COORDINATION_THREAD_ID = 30;
const CAPACITY = 6;
const SLOTS = { '1330': '13:30', '1430': '14:30' };

function deadlines(now = new Date()) {
  return {
    stop1330: new Date('2026-08-28T12:30:00+03:00'),
    stopAll: new Date('2026-08-28T13:30:00+03:00'),
    now
  };
}

function availableSlots(now = new Date()) {
  const d = deadlines(now);
  if (d.now >= d.stopAll) return [];
  return d.now >= d.stop1330 ? ['1430'] : ['1330', '1430'];
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
  if (available.length) rows.push(available.map(slot => ({ text: `Записаться на ${SLOTS[slot]}`, callback_data: `offline_minsk_${EVENT_DATE.replaceAll('-', '')}_${slot}` })));
  return { inline_keyboard: rows };
}

function invitationText() {
  return `Спасибо, что заполнили анкету и завершили Тест 1.\n\nПриглашаем вас на следующий этап — дальнейшее тестирование и личное собеседование в Академии Стратег.\n\nДата: <b>28 августа 2026 года</b>\nАдрес: <b>${ADDRESS}</b>\n\nВыберите доступное время по кнопке ниже. На каждое время предусмотрено 6 мест.\n\nДо собеседования ознакомьтесь и изучите Цели Академии Стратег.\n\n<a href="${ROUTE_URL}">Фото и видео — как пройти</a>`;
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
  const preview = callback.data?.match(/^offline_preview_(1330|1430)$/);
  if (preview) {
    await telegramApi('answerCallbackQuery', { callback_query_id: callback.id, text: `Тест кнопки ${SLOTS[preview[1]]}: работает. Место не занято.`, show_alert: true });
    return true;
  }
  const match = callback.data?.match(/^offline_minsk_20260828_(1330|1430)$/);
  if (!match) return false;
  const slot = match[1], chatId = String(callback.message?.chat?.id || callback.from?.id || '');
  const available = availableSlots();
  if (!available.includes(slot)) {
    await telegramApi('answerCallbackQuery', { callback_query_id: callback.id, text: slot === '1330' ? 'Запись на 13:30 уже закрыта.' : 'Запись на сегодня уже закрыта.', show_alert: true });
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
  const count = (await sql`SELECT count(*)::int AS count FROM offline_interview_bookings WHERE event_date=${EVENT_DATE}::date AND slot_time=${slot} AND status='booked'`).rows[0].count;
  const confirmation = `✅ <b>Вы записаны на дальнейшее тестирование и личное собеседование</b>\n\nДата: <b>28 августа 2026 года</b>\nВремя: <b>${SLOTS[slot]}</b>\nАдрес: <b>${ADDRESS}</b>\n\nДо встречи ознакомьтесь и изучите Цели Академии Стратег.\n\n<a href="${GOALS_URL}">Изучить Цели Академии</a>\n<a href="${PDF_URL}">Скачать Цели в PDF</a>\n<a href="${ROUTE_URL}">Фото и видео — как пройти</a>`;
  const confirmationId = await telegram(chatId, confirmation, { disable_web_page_preview: true });
  await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) VALUES(${candidate.id},'out','offline_interview_confirmation',${confirmation},'delivered',${String(confirmationId || '')})`;
  const username = candidate.username ? `@${candidate.username}` : 'не указан';
  const notice = `✅ <b>Новая запись на офлайн-собеседование</b>\n\nКандидат: <b>${candidate.full_name}</b>\nГород: Минск\nTelegram: ${username}\nТелефон: ${candidate.phone || 'не указан'}\nДата: 28 августа 2026 года\nВремя: <b>${SLOTS[slot]}</b>\n\nЗаписано на ${SLOTS[slot]}: <b>${count} из ${CAPACITY}</b>\nОсталось мест: <b>${CAPACITY - count}</b>\n\n<a href="https://academy-strateg-trainer.vercel.app/operator.html">Открыть операторскую панель</a>`;
  await telegram(COORDINATION_CHAT_ID, notice, { message_thread_id: COORDINATION_THREAD_ID, disable_web_page_preview: true });
  if (count >= CAPACITY) await refreshInvitationKeyboards();
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
  if (!operator(req)) return json(res, 401, { error: 'Неверный код доступа' });
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  try { return json(res, 200, { ok: true, ...(await sendOfflineInvites()) }); }
  catch (error) { console.error('[offline] batch failed', error); return json(res, 500, { error: String(error?.message || error) }); }
}
