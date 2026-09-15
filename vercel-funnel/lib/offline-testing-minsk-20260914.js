import { sql, telegram, telegramApi, transaction } from '../api/_core.js';

const CAMPAIGN = 'offline_testing_minsk_20260914';
const EVENT_DATE = '14 сентября 2026 года';
const ADDRESS = 'Площадь Свободы, 8';
const ROUTE_URL = 'https://drive.google.com/drive/folders/1SwBmFviGh5MaS81T_89iARM5_Hjygd9-?usp=drive_link';
const LOG_CHAT_ID = '-1004397133749';
const MINSK_LOG_THREAD_ID = 619;
const RECIPIENT_IDS = [191, 252, 232, 159, 131, 94];

const esc = value => String(value ?? '').replace(/[&<>"']/g, symbol => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[symbol]);
const nameOf = candidate => candidate.full_name || [candidate.first_name, candidate.last_name].filter(Boolean).join(' ') || candidate.username || `Кандидат ${candidate.id}`;

export const OFFLINE_TESTING_MINSK_20260914 = {
  campaign: CAMPAIGN,
  date: EVENT_DATE,
  time: '16:45',
  address: ADDRESS,
  routeUrl: ROUTE_URL,
  recipientIds: RECIPIENT_IDS,
};

export async function ensureOfflineTestingMinsk20260914() {
  await sql`CREATE TABLE IF NOT EXISTS offline_testing_minsk_20260914 (
    candidate_id BIGINT PRIMARY KEY,
    state TEXT NOT NULL DEFAULT 'pending',
    telegram_message_id TEXT,
    sent_at TIMESTAMPTZ,
    response TEXT,
    response_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_error TEXT
  )`;
}

async function selectedCandidates() {
  return (await sql`
    SELECT c.id,c.chat_id,c.username,c.first_name,c.last_name,c.city,c.status,c.consent,
      COALESCE(NULLIF(TRIM(a.full_name),''),NULLIF(TRIM(CONCAT_WS(' ',c.first_name,c.last_name)),''),c.username,'Кандидат ' || c.id::text) AS full_name,
      i.state,i.telegram_message_id,i.sent_at,i.response,i.response_at,i.last_error
    FROM candidates c
    LEFT JOIN LATERAL (SELECT full_name FROM applications WHERE candidate_id=c.id ORDER BY created_at DESC,id DESC LIMIT 1) a ON TRUE
    LEFT JOIN offline_testing_minsk_20260914 i ON i.candidate_id=c.id
    WHERE c.id IN (191,252,232,159,131,94)
    ORDER BY array_position(ARRAY[191,252,232,159,131,94]::bigint[],c.id)
  `).rows;
}

function eligible(candidate) {
  if (candidate.status !== 'productivity_passed') return `статус «${candidate.status || 'не указан'}»`;
  if (candidate.city !== 'Минск') return `город «${candidate.city || 'не указан'}»`;
  if (candidate.consent !== true) return 'нет согласия на сообщения';
  if (!candidate.chat_id) return 'нет Telegram';
  return null;
}

function invitationText(candidate) {
  const greeting = candidate.first_name ? `Здравствуйте, ${esc(candidate.first_name)}!` : 'Здравствуйте!';
  return `${greeting}\n\nПриглашаем вас на следующий этап отбора Академии Стратег — офлайн-тестирование в Минске.\n\n<b>Дата:</b> ${EVENT_DATE}\n<b>Время сбора:</b> 16:45\n<b>Адрес:</b> ${ADDRESS}\n\nПеред встречей, пожалуйста, изучите материалы по схеме прохода и подготовке: <a href="${ROUTE_URL}">открыть папку с материалами</a>.\n\nПодтвердите, пожалуйста, участие кнопкой ниже.`;
}

function keyboard() {
  return { inline_keyboard: [[
    { text: 'Приду', callback_data: 'offline_test_minsk_20260914_attend' },
    { text: 'Не приду', callback_data: 'offline_test_minsk_20260914_decline' },
  ]] };
}

function previewKeyboard() {
  return { inline_keyboard: [[
    { text: 'Приду', callback_data: 'offline_test_minsk_20260914_preview_attend' },
    { text: 'Не приду', callback_data: 'offline_test_minsk_20260914_preview_decline' },
  ]] };
}

export async function sendOfflineTestingMinsk20260914Preview() {
  const text = `🧪 <b>ТЕСТОВАЯ КОПИЯ — данные кандидатов не меняются</b>\n\n${invitationText({ first_name: 'Имя кандидата' })}`;
  const messageId = await telegram(LOG_CHAT_ID, text, { message_thread_id: MINSK_LOG_THREAD_ID, disable_web_page_preview: true, reply_markup: previewKeyboard() });
  return { messageId: String(messageId || ''), threadId: MINSK_LOG_THREAD_ID };
}

export async function handleOfflineTestingMinsk20260914PreviewChoice(callback) {
  if (!/^offline_test_minsk_20260914_preview_(attend|decline)$/.test(String(callback.data || ''))) return false;
  await telegramApi('answerCallbackQuery', { callback_query_id: callback.id, text: 'Это тестовая копия: данные кандидатов не меняются.' });
  return true;
}

export async function previewOfflineTestingMinsk20260914() {
  await ensureOfflineTestingMinsk20260914();
  const rows = await selectedCandidates();
  const found = new Set(rows.map(row => Number(row.id)));
  const missing = RECIPIENT_IDS.filter(id => !found.has(id)).map(id => ({ id, reason: 'Кандидат не найден' }));
  const recipients = rows.filter(row => !eligible(row)).map(row => ({
    id: Number(row.id), name: nameOf(row), username: row.username || null, city: row.city, status: row.status,
    state: row.state || 'pending', response: row.response || null, text: invitationText(row),
  }));
  const excluded = rows.filter(row => eligible(row)).map(row => ({ id: Number(row.id), name: nameOf(row), reason: eligible(row) })).concat(missing);
  return { campaign: CAMPAIGN, event: OFFLINE_TESTING_MINSK_20260914, recipients, excluded };
}

async function claimCandidate(candidateId) {
  return transaction(async tx => {
    const inserted = (await tx`INSERT INTO offline_testing_minsk_20260914(candidate_id,state) VALUES(${candidateId},'sending') ON CONFLICT(candidate_id) DO NOTHING RETURNING candidate_id`).rows[0];
    if (inserted) return true;
    const retried = (await tx`UPDATE offline_testing_minsk_20260914 SET state='sending',last_error=NULL,updated_at=NOW() WHERE candidate_id=${candidateId} AND state='attention' AND telegram_message_id IS NULL RETURNING candidate_id`).rows[0];
    return Boolean(retried);
  });
}

export async function sendOfflineTestingMinsk20260914() {
  const preview = await previewOfflineTestingMinsk20260914();
  // The preview intentionally omits private chat IDs. Retrieve the same fixed audience
  // again for delivery so a public preview can never accidentally become the send payload.
  const audience = (await selectedCandidates()).filter(candidate => !eligible(candidate));
  const results = [];
  for (const candidate of audience) {
    if (!(await claimCandidate(candidate.id))) {
      results.push({ id: candidate.id, name: nameOf(candidate), state: 'skipped', reason: 'Приглашение уже создано ранее' });
      continue;
    }
    try {
      const text = invitationText(candidate);
      const messageId = await telegram(candidate.chat_id, text, { disable_web_page_preview: true, reply_markup: keyboard() });
      await sql`UPDATE offline_testing_minsk_20260914 SET state='sent',telegram_message_id=${String(messageId || '')},sent_at=NOW(),last_error=NULL,updated_at=NOW() WHERE candidate_id=${candidate.id}`;
      await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) VALUES(${candidate.id},'out','offline_testing_minsk_20260914_invite',${text},'delivered',${String(messageId || '')})`;
      results.push({ id: candidate.id, name: nameOf(candidate), username: candidate.username || null, state: 'sent', telegramMessageId: String(messageId || '') });
    } catch (error) {
      const message = String(error?.message || error).slice(0,500);
      await sql`UPDATE offline_testing_minsk_20260914 SET state='attention',last_error=${message},updated_at=NOW() WHERE candidate_id=${candidate.id}`;
      results.push({ id: candidate.id, name: nameOf(candidate), state: 'attention', error: message });
    }
  }
  const sent = results.filter(result => result.state === 'sent');
  const attention = results.filter(result => result.state === 'attention');
  await telegram(LOG_CHAT_ID,
    `📋 <b>Офлайн-тестирование — Минск</b>\n\nДата: ${EVENT_DATE}\nСбор: 16:45\nАдрес: ${ADDRESS}\n\nОтправлено: <b>${sent.length}</b>\n${sent.map(item => `• ${esc(item.name)}${item.username ? ` · @${esc(item.username)}` : ''}`).join('\n') || '—'}${attention.length ? `\n\nТребует внимания: <b>${attention.length}</b>\n${attention.map(item => `• ${esc(item.name)} — ${esc(item.error)}`).join('\n')}` : ''}`,
    { message_thread_id: MINSK_LOG_THREAD_ID, disable_web_page_preview: true }
  );
  return { ...preview, results, sent: sent.length, attention: attention.length };
}

export async function handleOfflineTestingMinsk20260914Choice(callback) {
  const match = String(callback.data || '').match(/^offline_test_minsk_20260914_(attend|decline)$/);
  if (!match) return false;
  const response = match[1] === 'attend' ? 'attend' : 'decline';
  const chatId = String(callback.message?.chat?.id || callback.from?.id || '');
  await ensureOfflineTestingMinsk20260914();
  const candidate = (await sql`SELECT c.id,c.chat_id,c.username,c.first_name,c.last_name,c.status,
    COALESCE(NULLIF(TRIM(a.full_name),''),NULLIF(TRIM(CONCAT_WS(' ',c.first_name,c.last_name)),''),c.username,'Кандидат ' || c.id::text) AS full_name
    FROM candidates c LEFT JOIN LATERAL (SELECT full_name FROM applications WHERE candidate_id=c.id ORDER BY created_at DESC,id DESC LIMIT 1) a ON TRUE
    WHERE c.chat_id=${chatId} AND c.id IN (191,252,232,159,131,94) LIMIT 1`).rows[0];
  if (!candidate) {
    await telegramApi('answerCallbackQuery', { callback_query_id: callback.id, text: 'Это приглашение недоступно.', show_alert: true });
    return true;
  }
  const claimed = (await sql`UPDATE offline_testing_minsk_20260914 SET response=${response},response_at=NOW(),updated_at=NOW() WHERE candidate_id=${candidate.id} AND state='sent' AND response IS NULL RETURNING candidate_id`).rows[0];
  if (!claimed) {
    const existing = (await sql`SELECT response FROM offline_testing_minsk_20260914 WHERE candidate_id=${candidate.id} LIMIT 1`).rows[0];
    await telegramApi('answerCallbackQuery', { callback_query_id: callback.id, text: existing?.response === 'attend' ? 'Ваш ответ «Приду» уже сохранён.' : existing?.response === 'decline' ? 'Ваш ответ «Не приду» уже сохранён.' : 'Это приглашение недоступно.', show_alert: true });
    return true;
  }
  if (response === 'attend') {
    const changed = (await sql`UPDATE candidates SET status='offline_testing',updated_at=NOW() WHERE id=${candidate.id} AND status='productivity_passed' RETURNING id`).rows[0];
    if (changed) await sql`INSERT INTO funnel_stage_events(candidate_id,project_id,from_status,to_status,trigger,actor) SELECT ${candidate.id},id,'productivity_passed','offline_testing','offline_testing_minsk_20260914_attend','candidate' FROM funnel_projects WHERE project_key='academy-trainer'`;
  }
  const choiceText = response === 'attend' ? 'Приду' : 'Не приду';
  const reply = response === 'attend'
    ? `Спасибо! Мы ждём вас ${EVENT_DATE} к 16:45 по адресу: ${ADDRESS}.`
    : 'Спасибо, что сообщили. Мы сохраним ваш ответ и сможем пригласить вас на следующее офлайн-тестирование.';
  const messageId = await telegram(candidate.chat_id, reply);
  await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) VALUES(${candidate.id},'in','offline_testing_minsk_20260914_choice',${choiceText},'received',${String(callback.message?.message_id || '')})`;
  await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) VALUES(${candidate.id},'out','offline_testing_minsk_20260914_confirmation',${reply},'delivered',${String(messageId || '')})`;
  await telegram(LOG_CHAT_ID, `📌 <b>Ответ на офлайн-тестирование — Минск</b>\n\nКандидат: <b>${esc(nameOf(candidate))}</b>\nTelegram: ${candidate.username ? '@' + esc(candidate.username) : 'не указан'}\nОтвет: <b>${choiceText}</b>`, { message_thread_id: MINSK_LOG_THREAD_ID, disable_web_page_preview: true });
  await telegramApi('answerCallbackQuery', { callback_query_id: callback.id, text: 'Спасибо! Ответ сохранён.' });
  return true;
}
