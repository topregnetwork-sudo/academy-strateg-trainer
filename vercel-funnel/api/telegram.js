import { body, init, json, nextInterview, slots, telegram, telegramApi, sql } from './_core.js';

const TOPIC_COMMAND = /^\/trainer_topic(?:@stazherskaya_bot)?(?:\s|$)/i;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function candidateName(candidate) {
  return [candidate.first_name, candidate.last_name].filter(Boolean).join(' ') || candidate.username || `Кандидат ${candidate.id}`;
}

function interviewDate(value) {
  if (!value) return 'дата не указана';
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(new Date(value));
}

function hrBrief(candidate, restored = false) {
  const title = restored ? 'Восстановленная запись на собеседование' : 'Новая запись на собеседование';
  return `🎯 <b>${title}</b>\n\nКандидат: <b>${escapeHtml(candidateName(candidate))}</b>\nГород: ${escapeHtml(candidate.city || 'не указан')}\nТелефон: ${escapeHtml(candidate.phone || 'не указан')}\nИсточник: ${escapeHtml(candidate.source_id || 'direct')}\nДата: <b>${escapeHtml(interviewDate(candidate.interview_at))}</b>\nВремя: <b>${escapeHtml(slots[candidate.slot_id] || 'не указано')}</b>\nTelegram: ${candidate.username ? '@' + escapeHtml(candidate.username) : 'без username'}\n\nСтатус: ${escapeHtml(candidate.status || 'записан')}.`;
}

async function getHrDestination() {
  const settings = await sql`SELECT key,value FROM app_settings WHERE key IN ('hr_brief_chat_id','hr_brief_thread_id')`;
  const values = Object.fromEntries(settings.rows.map(row => [row.key, row.value]));
  const chatId = values.hr_brief_chat_id || process.env.HR_BRIEF_CHAT_ID;
  if (!chatId) return null;
  return { chatId: String(chatId), threadId: values.hr_brief_thread_id ? String(values.hr_brief_thread_id) : '' };
}

async function getZoomMeetingUrl() {
  try {
    const setting = await sql`SELECT value FROM app_settings WHERE key='zoom_meeting_url' LIMIT 1`;
    if (setting.rows[0]?.value) return setting.rows[0].value;
  } catch (error) {
    console.error('[telegram] Zoom setting lookup failed; using environment fallback', { message: String(error) });
  }
  return process.env.ZOOM_MEETING_URL || '';
}

async function wasDelivered(candidate, destination) {
  const existing = await sql`SELECT 1 FROM hr_brief_deliveries WHERE candidate_id=${candidate.id} AND interview_at=${candidate.interview_at} AND chat_id=${destination.chatId} AND thread_id=${destination.threadId} LIMIT 1`;
  return existing.rows.length > 0;
}

async function deliverHrBrief(candidate, destination, restored = false) {
  if (!destination || await wasDelivered(candidate, destination)) return false;
  const extra = destination.threadId ? { message_thread_id: Number(destination.threadId) } : {};
  const messageId = await telegram(destination.chatId, hrBrief(candidate, restored), extra);
  await sql`INSERT INTO hr_brief_deliveries(candidate_id,interview_at,chat_id,thread_id,telegram_message_id) VALUES(${candidate.id},${candidate.interview_at},${destination.chatId},${destination.threadId},${String(messageId || '')}) ON CONFLICT DO NOTHING`;
  return true;
}

async function backfillTrainerTopic(destination) {
  const candidates = await sql`SELECT id,first_name,last_name,username,phone,city,slot_id,interview_at,source_id,status FROM candidates WHERE interview_at IS NOT NULL ORDER BY interview_at,id`;
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const candidate of candidates.rows) {
    try {
      if (await deliverHrBrief(candidate, destination, true)) sent += 1;
      else skipped += 1;
    } catch (error) {
      failed += 1;
      console.error('[telegram] HR brief backfill failed', { candidateId: candidate.id, message: String(error) });
    }
  }
  return { sent, skipped, failed, total: candidates.rows.length };
}

async function sendTrainerTopicSummary(destination, result) {
  const extra = destination.threadId ? { message_thread_id: Number(destination.threadId) } : {};
  await telegram(destination.chatId, `✅ <b>Тема «Тренеры собеседования» подключена.</b>\n\nПеренесено сейчас: <b>${result.sent}</b>\nУже были перенесены: <b>${result.skipped}</b>\nОшибок: <b>${result.failed}</b>\nВсего записей проверено: <b>${result.total}</b>\n\nВсе новые записи кандидатов будут приходить в эту тему.`, extra);
}

export async function resumeTrainerTopic() {
  await init();
  const destination = await getHrDestination();
  if (!destination?.threadId) throw new Error('Trainer topic destination is not configured');
  const result = await backfillTrainerTopic(destination);
  await sendTrainerTopicSummary(destination, result);
  return result;
}

async function configureTrainerTopic(message) {
  const chatId = String(message.chat.id);
  const allowedChatId = process.env.HR_BRIEF_CHAT_ID && String(process.env.HR_BRIEF_CHAT_ID);
  if (!TOPIC_COMMAND.test(message.text || '')) return false;

  const threadId = message.message_thread_id ? String(message.message_thread_id) : '';
  const replyExtra = threadId ? { message_thread_id: Number(threadId) } : {};
  if (!threadId) {
    await telegram(chatId, 'Откройте тему «Тренеры собеседования» и отправьте команду /trainer_topic именно внутри неё.');
    return true;
  }

  let isAdministrator = false;
  try {
    const member = await telegramApi('getChatMember', { chat_id: chatId, user_id: message.from?.id });
    isAdministrator = member?.status === 'creator' || member?.status === 'administrator';
  } catch (error) {
    console.error('[telegram] admin verification failed', { chatId, userId: message.from?.id, message: String(error) });
  }
  if (chatId !== allowedChatId && !isAdministrator) {
    await telegram(chatId, '⚠️ Настроить тему может только администратор этой группы. Если вы администратор, временно выдайте боту право видеть администраторов и повторите команду.', replyExtra);
    return true;
  }

  await telegram(chatId, '⏳ Подключаю тему и переношу предыдущие уведомления. Пожалуйста, дождитесь итогового сообщения.', replyExtra);

  await sql`INSERT INTO app_settings(key,value,updated_at) VALUES('hr_brief_chat_id',${chatId},NOW()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`;
  await sql`INSERT INTO app_settings(key,value,updated_at) VALUES('hr_brief_thread_id',${threadId},NOW()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`;

  const destination = { chatId, threadId };
  const result = await backfillTrainerTopic(destination);
  await sendTrainerTopicSummary(destination, result);
  return true;
}

async function handlePrivateStart(message) {
  const chatId = String(message.chat.id);
  const match = message.text?.match(/^\/start\s+trainer_app_([a-zA-Z0-9]{20})$/);
  const app = match ? (await sql`SELECT * FROM applications WHERE code=${match[1]}`).rows[0] : null;
  if (!app) {
    await telegram(chatId, 'Здравствуйте! Вернитесь на страницу вакансии Академии Стратег и сначала заполните анкету.');
    return;
  }

  const at = nextInterview(app.slot_id);
  const date = interviewDate(at);
  const row = (await sql`INSERT INTO candidates(chat_id,username,first_name,last_name,phone,city,slot_id,interview_at,source_id,status) VALUES(${chatId},${message.from?.username || null},${message.from?.first_name || app.full_name},${message.from?.last_name || null},${app.phone || null},${app.city},${app.slot_id},${at},${app.source_id},'interview_booked') ON CONFLICT(chat_id) DO UPDATE SET username=EXCLUDED.username,first_name=EXCLUDED.first_name,last_name=EXCLUDED.last_name,phone=COALESCE(EXCLUDED.phone,candidates.phone),city=EXCLUDED.city,slot_id=EXCLUDED.slot_id,interview_at=EXCLUDED.interview_at,source_id=EXCLUDED.source_id,status='interview_booked',reminded_30m=false,updated_at=NOW() RETURNING id,first_name,last_name,username,phone,city,slot_id,interview_at,source_id,status`).rows[0];
  await sql`UPDATE applications SET candidate_id=${row.id} WHERE id=${app.id}`;

  const zoom = await getZoomMeetingUrl();
  const reply = `✅ <b>Вы записаны на собеседование</b>\n\nДата: <b>${date}</b>\nВремя: <b>${slots[app.slot_id]}</b>\n\n${zoom ? 'Ссылка Zoom — по кнопке ниже.' : 'Координатор пришлёт ссылку Zoom в этот чат.'}\n\nЗа 30 минут до встречи придёт напоминание.`;
  const messageId = await telegram(chatId, reply, zoom ? { reply_markup: { inline_keyboard: [[{ text: 'Открыть Zoom', url: zoom }]] } } : {});
  await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) VALUES(${row.id},'out','text',${reply},'delivered',${String(messageId || '')})`;

  try {
    await deliverHrBrief(row, await getHrDestination());
  } catch (error) {
    console.error('[telegram] HR brief delivery failed', { candidateId: row.id, message: String(error) });
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false });
  if (process.env.TELEGRAM_WEBHOOK_SECRET && req.headers['x-telegram-bot-api-secret-token'] !== process.env.TELEGRAM_WEBHOOK_SECRET) return json(res, 401, { ok: false });

  let update;
  try {
    update = await body(req);
    const message = update.message;
    if (!message) return json(res, 200, { ok: true });

    if (message.chat?.type && message.chat.type !== 'private') {
      if (!TOPIC_COMMAND.test(message.text || '')) return json(res, 200, { ok: true });
      try {
        await init();
        await configureTrainerTopic(message);
      } catch (error) {
        console.error('[telegram] trainer topic setup failed', { chatId: String(message.chat.id), threadId: message.message_thread_id, message: String(error), stack: error?.stack });
        const extra = message.message_thread_id ? { message_thread_id: Number(message.message_thread_id) } : {};
        try {
          await telegram(String(message.chat.id), '❌ Не удалось подключить тему. Ошибка сохранена в журнале; повторять команду сейчас не нужно.', extra);
        } catch (notifyError) {
          console.error('[telegram] trainer topic error response failed', { message: String(notifyError) });
        }
      }
      return json(res, 200, { ok: true });
    }

    await init();
    await handlePrivateStart(message);
    return json(res, 200, { ok: true });
  } catch (error) {
    console.error('[telegram] webhook failed', { message: String(error), stack: error?.stack });
    return json(res, 200, { ok: true });
  }
}
