import { init, json, operator, sql, telegram, telegramApi } from './_core.js';
import { syncDriveCandidate } from './drive.js';

const EVENT_DATE = '2026-09-01';
const EVENT_DATE_TEXT = '1 сентября 2026 года';
export const MINSK_ZOOM = 'https://us06web.zoom.us/j/8954571284?pwd=G7yvsAdaV7ZrPUFnXDIf4tfKR3f9fX.1';
const GOALS_URL = 'https://academy-strateg-trainer.vercel.app/goals.html';
const PDF_URL = 'https://academy-strateg-trainer.vercel.app/academy-strateg-goals.pdf';
const ROUTE_URL = 'https://drive.google.com/drive/folders/1SwBmFviGh5MaS81T_89iARM5_Hjygd9-?usp=drive_link';
const COORDINATION_CHAT_ID = '-1004397133749';
const COORDINATION_THREAD_ID = 30;
const CAPACITY = 1;
const SLOTS = { '1100':'11:00','1115':'11:15','1130':'11:30','1145':'11:45','1200':'12:00','1215':'12:15','1230':'12:30','1245':'12:45','1300':'13:00','1315':'13:15','1330':'13:30' };

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, symbol => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[symbol]);
}

export async function slotSummary({ ensureDrive = false } = {}) {
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

export async function inviteKeyboard(now = new Date()) {
  const rows = [[{ text: 'Изучить Цели Академии', url: GOALS_URL }, { text: 'Скачать PDF', url: PDF_URL }]];
  const available = await bookableSlots(now);
  for(let index=0;index<available.length;index+=2) rows.push(available.slice(index,index+2).map(slot => ({ text: `Записаться на ${SLOTS[slot]}`, callback_data: `offline_minsk_${EVENT_DATE.replaceAll('-', '')}_${slot}` })));
  return { inline_keyboard: rows };
}

export function bookingKeyboard() {
  return { inline_keyboard: [[{ text: 'Подключиться к Zoom', url: MINSK_ZOOM }]] };
}

async function changeTimeKeyboard(currentSlot, now = new Date()) {
  const available = (await bookableSlots(now)).filter(slot => slot !== currentSlot);
  const rows = [];
  for (let index = 0; index < available.length; index += 2) {
    rows.push(available.slice(index, index + 2).map(slot => ({
      text: SLOTS[slot],
      callback_data: `offline_move_${EVENT_DATE.replaceAll('-', '')}_${slot}`
    })));
  }
  rows.push([{ text: `Оставить ${SLOTS[currentSlot]}`, callback_data: `offline_keep_${EVENT_DATE.replaceAll('-', '')}` }]);
  return { inline_keyboard: rows };
}

export function invitationText() {
  return `Спасибо, что заполнили анкету и завершили Тест 1.\n\nПриглашаем вас на первичный разбор в Академии Стратег. Встреча пройдёт онлайн в Zoom. Приезжать в офис не нужно.\n\nДата: <b>${EVENT_DATE_TEXT}</b>\n\nВыберите доступное время по кнопке ниже. Время — по Минску. Каждый слот предназначен для одного кандидата. После записи выбранное время закрепляется без переноса.\n\nДо собеседования ознакомьтесь и изучите Цели Академии Стратег. Ссылку Zoom получите в подтверждении записи.`;
}

export async function pendingMinskInvites(candidateId = null) {
  return (await sql`
    SELECT c.id,c.chat_id,c.username,c.first_name,c.last_name,c.city,
           COALESCE(NULLIF(TRIM(a.full_name),''),NULLIF(TRIM(CONCAT_WS(' ',c.first_name,c.last_name)),''),c.username,'Кандидат ' || c.id::text) AS full_name
    FROM candidates c
    JOIN candidate_tests t ON t.candidate_id=c.id AND t.submitted_at IS NOT NULL
    LEFT JOIN LATERAL (SELECT full_name,city FROM applications WHERE candidate_id=c.id ORDER BY created_at DESC LIMIT 1) a ON TRUE
    LEFT JOIN offline_interview_invites i ON i.candidate_id=c.id AND i.event_date=${EVENT_DATE}::date
    WHERE c.consent=true
      AND (${candidateId}::bigint IS NULL OR c.id=${candidateId})
      AND LOWER(TRIM(COALESCE(NULLIF(a.city,''),c.city,'')))='минск'
      AND c.id<>45
      AND c.status NOT IN ('test_1_passed','productivity_passed','productivity_failed','finalist','selection_closed','academy_contact','training','internship','hired','rejected','cancelled')
      AND NOT EXISTS (SELECT 1 FROM offline_interview_bookings booked WHERE booked.candidate_id=c.id AND booked.event_date=${EVENT_DATE}::date AND booked.status='booked')
      AND NOT EXISTS (SELECT 1 FROM offline_interview_bookings previous WHERE previous.candidate_id=c.id AND previous.event_date<${EVENT_DATE}::date AND previous.status='booked')
      AND (i.candidate_id IS NULL OR i.status='failed')
    ORDER BY t.submitted_at ASC
  `).rows;
}

export async function sendOfflineInvites(candidateId = null) {
  await init();
  if (!(await bookableSlots()).length) return { stopped: true, sent: 0, failed: 0, recipients: [] };
  const recipients = await pendingMinskInvites(candidateId);
  let sent = 0, failed = 0;
  const delivered = [];
  for (const candidate of recipients) {
    if (!(await bookableSlots()).length) break;
    const reserved = (await sql`INSERT INTO offline_interview_invites(candidate_id,event_date,status,updated_at) VALUES(${candidate.id},${EVENT_DATE}::date,'pending',NOW()) ON CONFLICT(candidate_id,event_date) DO UPDATE SET status='pending',updated_at=NOW() WHERE offline_interview_invites.status='failed' RETURNING candidate_id`).rows[0];
    if (!reserved) continue;
    const text = invitationText();
    let messageId;
    try {
      messageId = await telegram(candidate.chat_id, text, { disable_web_page_preview: true, reply_markup: await inviteKeyboard() });
      await sql`UPDATE offline_interview_invites SET status='sent',telegram_message_id=${String(messageId || '')},sent_at=NOW(),updated_at=NOW() WHERE candidate_id=${candidate.id} AND event_date=${EVENT_DATE}::date`;
      await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) VALUES(${candidate.id},'out','offline_interview_invite',${text},'delivered',${String(messageId || '')})`;
      sent++;
      delivered.push({ id: candidate.id, full_name: candidate.full_name, username: candidate.username || null, city: candidate.city });
    } catch (error) {
      failed++;
      // A timeout may have delivered; never automatically resend an uncertain send.
      await sql`UPDATE offline_interview_invites SET status=${messageId?'sent':'attention'},telegram_message_id=COALESCE(${messageId?String(messageId):null},telegram_message_id),updated_at=NOW() WHERE candidate_id=${candidate.id} AND event_date=${EVENT_DATE}::date`;
      console.error('[offline] invitation failed', { candidateId: candidate.id, message: String(error) });
    }
  }
  return { stopped: false, sent, failed, recipients: delivered };
}

export async function refreshInvitationKeyboards({onlyUnbooked=false,strict=false}={}) {
  const replyMarkup = await inviteKeyboard();
  const rows = (await sql`SELECT c.chat_id,i.telegram_message_id,i.status FROM offline_interview_invites i JOIN candidates c ON c.id=i.candidate_id WHERE i.event_date=${EVENT_DATE}::date AND i.telegram_message_id IS NOT NULL AND i.status IN ('sent','booked') AND (${onlyUnbooked}::boolean=false OR (i.status='sent' AND c.consent=true AND c.status IN ('test_1_completed','productivity_invited') AND NOT EXISTS(SELECT 1 FROM offline_interview_bookings b WHERE b.candidate_id=c.id AND b.event_date=i.event_date AND b.status='booked')))` ).rows;
  let failed=0,edited=0;
  for (const row of rows) {
    try { await telegramApi('editMessageReplyMarkup', { chat_id: row.chat_id, message_id: Number(row.telegram_message_id), reply_markup: row.status === 'booked' ? bookingKeyboard() : replyMarkup });edited++; }
    catch (error) { if(!/message is not modified/i.test(error.message)){failed++;console.error('[offline] keyboard refresh failed', { chatId: row.chat_id, messageId: row.telegram_message_id, message: String(error) });} }
  }
  if(strict&&failed)throw Error(`Не обновлены кнопки ${failed} приглашений`);
  return {edited,failed};
}

export async function enableRescheduleControlsForBookedCandidates() {
  await init();
  const rows = (await sql`
    SELECT DISTINCT ON (b.candidate_id) b.candidate_id,c.chat_id,m.telegram_message_id
    FROM offline_interview_bookings b
    JOIN candidates c ON c.id=b.candidate_id
    JOIN messages m ON m.candidate_id=b.candidate_id
      AND m.direction='out'
      AND m.kind IN ('offline_interview_confirmation','offline_interview_rescheduled')
      AND m.delivery_status='delivered'
      AND m.telegram_message_id IS NOT NULL
    WHERE b.event_date=${EVENT_DATE}::date AND b.status='booked'
    ORDER BY b.candidate_id,m.created_at DESC
  `).rows;
  let edited = 0, failed = 0;
  for (const row of rows) {
    try {
      await telegramApi('editMessageReplyMarkup', { chat_id: row.chat_id, message_id: Number(row.telegram_message_id), reply_markup: bookingKeyboard() });
      edited++;
    } catch (error) {
      failed++;
      console.error('[offline] reschedule control edit failed', { candidateId: row.candidate_id, message: String(error) });
    }
  }
  return { bookedWithConfirmation: rows.length, edited, failed };
}

async function allocate(candidateId, slot) {
  const {transaction}=await import('./_core.js');
  return transaction(async tx=>{
  const c=(await tx`SELECT id FROM candidates WHERE id=${candidateId} AND consent=true AND status IN ('test_1_completed','productivity_invited','productivity_booked') FOR UPDATE`).rows[0];if(!c)return null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const row = (await tx`
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
  });
}

async function candidateForChat(chatId) {
  return (await sql`
    SELECT c.id,c.chat_id,c.username,c.first_name,c.last_name,c.phone,c.city,
           COALESCE(NULLIF(TRIM(a.full_name),''),NULLIF(TRIM(CONCAT_WS(' ',c.first_name,c.last_name)),''),c.username,'Кандидат ' || c.id::text) AS full_name
    FROM candidates c
    JOIN candidate_tests t ON t.candidate_id=c.id AND t.submitted_at IS NOT NULL
    LEFT JOIN LATERAL (SELECT full_name,city FROM applications WHERE candidate_id=c.id ORDER BY created_at DESC LIMIT 1) a ON TRUE
    WHERE c.chat_id=${chatId} AND c.consent=true AND c.status IN ('test_1_completed','productivity_invited','productivity_booked') AND LOWER(TRIM(COALESCE(NULLIF(a.city,''),c.city,'')))='минск' LIMIT 1
  `).rows[0];
}

async function existingBooking(candidateId) {
  return (await sql`SELECT slot_time,slot_position FROM offline_interview_bookings WHERE candidate_id=${candidateId} AND event_date=${EVENT_DATE}::date AND status='booked' LIMIT 1`).rows[0];
}

export function confirmationText(slot, changed = false) {
  return `✅ <b>Вы записаны на первичный разбор в Zoom</b>\n\nДата: <b>${EVENT_DATE_TEXT}</b>\nВремя: <b>${SLOTS[slot]} — по Минску</b>\n\nПриезжать в офис не нужно. Подключитесь в назначенное время по кнопке ниже.\n\nДо встречи ознакомьтесь и изучите Цели Академии Стратег.\n\n<a href="${GOALS_URL}">Изучить Цели Академии</a>\n<a href="${PDF_URL}">Скачать Цели в PDF</a>`;
}

async function sendBookingConfirmation(candidate, slot, changed = false) {
  const text = confirmationText(slot, changed);
  const messageId = await telegram(candidate.chat_id, text, { disable_web_page_preview: true, reply_markup: bookingKeyboard() });
  await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) VALUES(${candidate.id},'out',${changed ? 'offline_interview_rescheduled' : 'offline_interview_confirmation'},${text},'delivered',${String(messageId || '')})`;
  return messageId;
}

async function sendCoordinationChange(candidate, previousSlot, slot) {
  try { await syncDriveCandidate(candidate.id); }
  catch (error) { console.error('[offline] Drive sync failed after reschedule', { candidateId: candidate.id, message: String(error) }); }
  const summary = await slotSummary({ ensureDrive: true });
  const username = candidate.username ? `@${candidate.username}` : 'не указан';
  const drive = (await sql`SELECT folder_url FROM candidate_drive WHERE candidate_id=${candidate.id} LIMIT 1`).rows[0];
  const driveLine = drive?.folder_url ? `<a href="${esc(drive.folder_url)}">Папка кандидата в Google Drive</a>` : 'Папка кандидата в Google Drive создаётся';
  const notice = `🔄 <b>Кандидат изменил время</b>\n\nКандидат: <b>${esc(candidate.full_name)}</b>\nГород: Минск\nTelegram: ${esc(username)}\nТелефон: ${esc(candidate.phone || 'не указан')}\nДата: ${EVENT_DATE_TEXT}\nБыло: <b>${SLOTS[previousSlot]}</b>\nСтало: <b>${SLOTS[slot]}</b>\n${driveLine}\n\n${summary.text}\n\n<a href="https://academy-strateg-trainer.vercel.app/operator.html">Открыть операторскую панель</a>`;
  await telegram(COORDINATION_CHAT_ID, notice, { message_thread_id: COORDINATION_THREAD_ID, disable_web_page_preview: true });
  return summary;
}

export async function handleOfflineInterviewChoice(callback) {
  if (/^offline_(change_20260901|keep_20260901|move_20260901_\d{4}|preview_change|preview_move_\d{4})$/.test(callback.data || '')) {
    await telegramApi('answerCallbackQuery', {callback_query_id:callback.id,text:'Встреча проходит в Zoom. Выбранное время сохраняется, перенос закрыт.',show_alert:true});
    return true;
  }
  const previewChange = callback.data === 'offline_preview_change';
  const previewMove = callback.data?.match(/^offline_preview_move_(\d{4})$/);
  if (previewChange || previewMove) {
    const text = previewChange ? 'Кнопка «Изменить время» работает. Реальная запись не изменена.' : `Тест переноса на ${SLOTS[previewMove[1]]}: работает. Запись не изменена.`;
    await telegramApi('answerCallbackQuery', { callback_query_id: callback.id, text, show_alert: true });
    return true;
  }
  const preview = callback.data?.match(/^offline_preview_(\d{4})$/);
  if (preview) {
    await telegramApi('answerCallbackQuery', { callback_query_id: callback.id, text: `Тест кнопки ${SLOTS[preview[1]]}: работает. Место не занято.`, show_alert: true });
    return true;
  }
  const change = callback.data === 'offline_change_20260901';
  const keep = callback.data === 'offline_keep_20260901';
  const move = callback.data?.match(/^offline_move_20260901_(\d{4})$/);
  const match = callback.data?.match(/^offline_minsk_20260901_(\d{4})$/);
  if (change || keep || move) {
    const chatId = String(callback.message?.chat?.id || callback.from?.id || '');
    const candidate = await candidateForChat(chatId);
    const existing = candidate ? await existingBooking(candidate.id) : null;
    if (!candidate || !existing) {
      await telegramApi('answerCallbackQuery', { callback_query_id: callback.id, text: 'Активная запись не найдена.', show_alert: true });
      return true;
    }
    if (keep) {
      await telegramApi('answerCallbackQuery', { callback_query_id: callback.id, text: `Запись на ${SLOTS[existing.slot_time]} сохранена.` });
      return true;
    }
    if (change) {
      const keyboard = await changeTimeKeyboard(existing.slot_time);
      if (keyboard.inline_keyboard.length === 1) {
        await telegramApi('answerCallbackQuery', { callback_query_id: callback.id, text: 'Других свободных времён сейчас нет. Ваша запись сохранена.', show_alert: true });
        return true;
      }
      await telegram(chatId, `🔄 <b>Изменение времени</b>\n\nСейчас вы записаны на <b>${SLOTS[existing.slot_time]}</b>.\nВыберите другое свободное время. Текущее место сохранится, пока новое не будет успешно занято.`, { reply_markup: keyboard });
      await telegramApi('answerCallbackQuery', { callback_query_id: callback.id });
      return true;
    }
    const slot = move[1];
    if (!SLOTS[slot] || !availableSlots().includes(slot)) {
      await telegramApi('answerCallbackQuery', { callback_query_id: callback.id, text: 'Запись на это время уже закрыта. Старая запись сохранена.', show_alert: true });
      return true;
    }
    let moved;
    try {
      moved = (await sql`
        UPDATE offline_interview_bookings booking
        SET slot_time=${slot},slot_position=1,updated_at=NOW()
        WHERE booking.candidate_id=${candidate.id} AND booking.event_date=${EVENT_DATE}::date AND booking.status='booked'
          AND NOT EXISTS (SELECT 1 FROM offline_interview_bookings occupied WHERE occupied.event_date=${EVENT_DATE}::date AND occupied.slot_time=${slot} AND occupied.status='booked' AND occupied.candidate_id<>${candidate.id})
        RETURNING booking.slot_time
      `).rows[0];
    } catch (error) {
      console.error('[offline] atomic reschedule conflict', { candidateId: candidate.id, slot, message: String(error) });
    }
    if (!moved) {
      await telegramApi('answerCallbackQuery', { callback_query_id: callback.id, text: `Время ${SLOTS[slot]} уже заняли. Ваша запись на ${SLOTS[existing.slot_time]} сохранена.`, show_alert: true });
      return true;
    }
    await sendBookingConfirmation(candidate, slot, true);
    await sendCoordinationChange(candidate, existing.slot_time, slot);
    await refreshInvitationKeyboards();
    await telegramApi('answerCallbackQuery', { callback_query_id: callback.id, text: `Время изменено на ${SLOTS[slot]}.` });
    return true;
  }
  if(match&&!SLOTS[match[1]])return false;
  if (!match) return false;
  const slot = match[1], chatId = String(callback.message?.chat?.id || callback.from?.id || '');
  const available = availableSlots();
  if (!available.includes(slot)) {
    await telegramApi('answerCallbackQuery', { callback_query_id: callback.id, text: 'Запись на это время уже закрыта.', show_alert: true });
    return true;
  }
  const candidate = await candidateForChat(chatId);
  if (!candidate) {
    await telegramApi('answerCallbackQuery', { callback_query_id: callback.id, text: 'Эта запись доступна только приглашённым кандидатам из Минска.', show_alert: true });
    return true;
  }
  const existing = await existingBooking(candidate.id);
  if (existing) {
    const {scheduleMinskReminder}=await import('../lib/review-reminders.js');
    await scheduleMinskReminder(existing.slot_time);
    await telegramApi('answerCallbackQuery', { callback_query_id: callback.id, text: `Вы уже записаны на ${SLOTS[existing.slot_time]}.`, show_alert: true });
    return true;
  }
  const booking = await allocate(candidate.id, slot);
  if (!booking) {
    await telegramApi('answerCallbackQuery', { callback_query_id: callback.id, text: `На ${SLOTS[slot]} свободных мест уже нет. Выберите другое время.`, show_alert: true });
    return true;
  }
  await sql`UPDATE offline_interview_invites SET status='booked',updated_at=NOW() WHERE candidate_id=${candidate.id} AND event_date=${EVENT_DATE}::date`;
  const {scheduleMinskReminder}=await import('../lib/review-reminders.js');
  try{await scheduleMinskReminder(slot);}catch(e){console.error('[review-timer]',candidate.id,e.message);}
  try { await syncDriveCandidate(candidate.id); }
  catch (error) { console.error('[offline] Drive sync failed after booking', { candidateId: candidate.id, message: String(error) }); }
  const summary = await slotSummary();
  await sendBookingConfirmation(candidate, slot);
  const username = candidate.username ? `@${candidate.username}` : 'не указан';
  const drive = (await sql`SELECT folder_url FROM candidate_drive WHERE candidate_id=${candidate.id} LIMIT 1`).rows[0];
  const driveLine = drive?.folder_url ? `<a href="${esc(drive.folder_url)}">Папка кандидата в Google Drive</a>` : 'Папка кандидата в Google Drive создаётся';
  const notice = `✅ <b>Новая запись на интервью в Zoom</b>\n\nКандидат: <b>${esc(candidate.full_name)}</b>\nГород: Минск\nTelegram: ${esc(username)}\nТелефон: ${esc(candidate.phone || 'не указан')}\nДата: ${EVENT_DATE_TEXT}\nВремя: <b>${SLOTS[slot]}</b>\n${driveLine}\n\n${summary.text}\n\n<a href="https://academy-strateg-trainer.vercel.app/operator.html">Открыть операторскую панель</a>`;
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

export async function sendOfflineReschedulePreviewToCoordination() {
  return {disabled:true,reason:'Перенос времени встречи 1 сентября отключён пользователем'};
  /* Historical preview retained below; never sent after the online switch.
  await init();
  const keyboard = { inline_keyboard: [
    [{ text: 'Изменить время', callback_data: 'offline_preview_change' }],
    [{ text: 'Перенести на 13:15', callback_data: 'offline_preview_move_1315' }, { text: 'Перенести на 13:30', callback_data: 'offline_preview_move_1330' }]
  ] };
  const text = `🧪 <b>ТЕСТ — изменение времени</b>\n\nПосле записи кандидат видит кнопку «Изменить время».\n\nСтарое место не отменяется, пока новое не занято. Если новое время уже забрали, прежняя запись сохраняется.\n\nПосле успешного переноса в этой теме придёт карточка «Было / Стало» и обновлённая общая сводка.\n\nКнопки ниже тестовые: они не меняют реальные записи.`;
  const messageId = await telegram(COORDINATION_CHAT_ID, text, { message_thread_id: COORDINATION_THREAD_ID, disable_web_page_preview: true, reply_markup: keyboard });
  return { messageId };
  */
}

export default async function handler(req, res) {
  if(req.query?.action==='incomplete042'){
    const {createHash}=await import('node:crypto');
    if(Date.now()>1788154701351||createHash('sha256').update(String(req.headers['x-maintenance-token']||'')).digest('hex')!=='727e9f27da30da58c8e233acd2edb331a37664a7ee4fd4e4057c27e6fe0b5848')return json(res,404,{error:'Not found'});
    try{await init();const op=await import('../lib/test-incomplete-042.js');
      if(req.method==='GET')return json(res,200,req.query.mode==='summary'?await op.summary():await op.audit(Math.max(0,Number(req.query.offset)||0)));
      if(req.method==='POST'&&req.query.mode==='summary')return json(res,200,await op.summary(true));
      if(req.method==='POST'&&/^\d+$/.test(req.query.id||''))return json(res,200,await op.execute(Number(req.query.id)));
      return json(res,400,{error:'Invalid operation'});
    }catch(e){return json(res,500,{error:String(e.message)});}
  }
  if(req.query?.action==='decline041')return json(res,404,{error:'Operation completed'});
  if(req.query?.action==='review040')return json(res,404,{error:'Operation completed'});
  if(req.query?.action==='followup039')return json(res,404,{error:'Operation completed'});
  if(req.query?.action==='evidence038')return json(res,404,{error:'Operation completed'});
  if(req.query?.action==='auto037')return json(res,404,{error:'Operation completed'});
  if(req.query?.action==='zoom036')return json(res,404,{error:'Operation completed'});
  if (!operator(req)) return json(res, 401, { error: 'Неверный код доступа' });
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  try {
    await init();
    if (req.query?.action === 'reschedule-preview') return json(res, 200, { ok: true, ...(await sendOfflineReschedulePreviewToCoordination()) });
    if (req.query?.action === 'enable-reschedule') return json(res, 200, { ok: true, ...(await enableRescheduleControlsForBookedCandidates()) });
    return json(res, 200, { ok: true, ...(await sendOfflineInvites()) });
  }
  catch (error) { console.error('[offline] batch failed', error); return json(res, 500, { error: String(error?.message || error) }); }
}
