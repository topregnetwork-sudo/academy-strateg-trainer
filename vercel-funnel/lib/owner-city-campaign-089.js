const OWNER_USERNAME = 'topregstrateg';
const BATMAN_BOT = 'https://t.me/batman_strateg_bot';

const CAMPAIGNS = {
  minsk: { city: 'Минск', campaignId: 'trainer_owner_minsk_20260923_089', zoomSessionId: 'trainer_batman_minsk_morning_20260923_089', batmanStart: 'trainer_minsk_089' },
  chelyabinsk: { city: 'Челябинск', campaignId: 'trainer_owner_chelyabinsk_20260923_089', zoomSessionId: 'trainer_batman_chelyabinsk_morning_20260923_089', batmanStart: 'trainer_chelyabinsk_089' },
};

let initialized;
async function ensureStore(sql) {
  if (!initialized) initialized = (async () => {
    await sql`CREATE TABLE IF NOT EXISTS owner_city_campaign_entries089(
      chat_id TEXT NOT NULL, campaign_id TEXT NOT NULL, city TEXT NOT NULL, zoom_session_id TEXT NOT NULL,
      questionnaire_state TEXT NOT NULL DEFAULT 'intro', answer_invite_owners BOOLEAN, answer_responsible BOOLEAN,
      intro_message_id TEXT, question_one_message_id TEXT, question_two_message_id TEXT, completion_message_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(chat_id,campaign_id)
    )`;
    await sql`ALTER TABLE owner_city_campaign_entries089 ENABLE ROW LEVEL SECURITY`;
  })().catch(error => { initialized = null; throw error; });
  return initialized;
}

function ownerAllowed(actor) { return String(actor?.username || '').toLowerCase() === OWNER_USERNAME; }
async function zoomUrl(sql) {
  const setting = (await sql`SELECT value FROM app_settings WHERE key='zoom_meeting_url' LIMIT 1`).rows[0];
  return setting?.value || process.env.ZOOM_MEETING_URL || null;
}
function campaignByStart(text) {
  const match = String(text || '').match(/^\/start\s+owner_city_089_(minsk|chelyabinsk)$/i);
  return match ? CAMPAIGNS[match[1].toLowerCase()] : null;
}

export async function handleOwnerCityCampaignStart(message, { sql, telegram }) {
  const campaign = campaignByStart(message?.text);
  if (!campaign) return false;
  const chatId = String(message.chat?.id || '');
  if (!ownerAllowed(message.from)) {
    await telegram(chatId, 'Этот тестовый вход доступен только владельцу проекта.');
    return true;
  }
  await ensureStore(sql);
  const existing = (await sql`SELECT intro_message_id FROM owner_city_campaign_entries089 WHERE chat_id=${chatId} AND campaign_id=${campaign.campaignId} LIMIT 1`).rows[0];
  if (existing?.intro_message_id) return true;
  const zoom = await zoomUrl(sql);
  if (!zoom) throw new Error(`owner_city_campaign_zoom_missing:${campaign.campaignId}`);
  await sql`INSERT INTO owner_city_campaign_entries089(chat_id,campaign_id,city,zoom_session_id)
    VALUES(${chatId},${campaign.campaignId},${campaign.city},${campaign.zoomSessionId})
    ON CONFLICT(chat_id,campaign_id) DO NOTHING`;
  const key = campaign.city === 'Минск' ? 'minsk' : 'chelyabinsk';
  const text = `🧪 <b>Тестовый маршрут · ${campaign.city}</b>\n\nЭто отдельная городская кампания знакомства с ролью Batman. Здесь только маршрут «${campaign.city}»: своё Zoom-собеседование, свой журнал и последующий переход в Batman.\n\nСтатус Trainer не меняется. Массовая отправка не выполняется.`;
  const messageId = await telegram(chatId, text, { reply_markup: { inline_keyboard: [
    [{ text: `Подключиться к Zoom · ${campaign.city}`, url: zoom }],
    [{ text: 'Ответить на 2 коротких вопроса', callback_data: `owner_city_089_q1_${key}` }],
  ] } });
  await sql`UPDATE owner_city_campaign_entries089 SET intro_message_id=${String(messageId)},updated_at=NOW() WHERE chat_id=${chatId} AND campaign_id=${campaign.campaignId}`;
  return true;
}

function callbackMatch(data) {
  const match = String(data || '').match(/^owner_city_089_(q1|invite_yes|invite_no|responsible_yes|responsible_no)_(minsk|chelyabinsk)$/);
  return match ? { action: match[1], key: match[2], campaign: CAMPAIGNS[match[2]] } : null;
}

export async function handleOwnerCityCampaignCallback(callback, { sql, telegram, telegramApi }) {
  const parsed = callbackMatch(callback?.data);
  if (!parsed) return false;
  const chatId = String(callback.message?.chat?.id || callback.from?.id || '');
  if (!ownerAllowed(callback.from)) {
    await telegramApi('answerCallbackQuery', { callback_query_id: callback.id, text: 'Кнопка доступна только владельцу проекта.', show_alert: true });
    return true;
  }
  await ensureStore(sql);
  const row = (await sql`SELECT * FROM owner_city_campaign_entries089 WHERE chat_id=${chatId} AND campaign_id=${parsed.campaign.campaignId} LIMIT 1`).rows[0];
  if (!row) {
    await telegramApi('answerCallbackQuery', { callback_query_id: callback.id, text: 'Сначала откройте персональный вход этой кампании.', show_alert: true });
    return true;
  }
  if (parsed.action === 'q1') {
    if (!row.question_one_message_id) {
      const text = `<b>${parsed.campaign.city} · вопрос 1 из 2</b>\n\nГотовы ли вы приглашать именно предпринимателей и собственников бизнеса на подтверждённые мероприятия Академии — без массового спама и обещаний результата?`;
      const messageId = await telegram(chatId, text, { reply_markup: { inline_keyboard: [
        [{ text: 'Да, готов', callback_data: `owner_city_089_invite_yes_${parsed.key}` }],
        [{ text: 'Нет', callback_data: `owner_city_089_invite_no_${parsed.key}` }],
      ] } });
      await sql`UPDATE owner_city_campaign_entries089 SET questionnaire_state='question_one',question_one_message_id=${String(messageId)},updated_at=NOW() WHERE chat_id=${chatId} AND campaign_id=${parsed.campaign.campaignId}`;
    }
    await telegramApi('answerCallbackQuery', { callback_query_id: callback.id });
    return true;
  }
  if (parsed.action === 'invite_no') {
    await sql`UPDATE owner_city_campaign_entries089 SET questionnaire_state='declined',answer_invite_owners=false,updated_at=NOW() WHERE chat_id=${chatId} AND campaign_id=${parsed.campaign.campaignId}`;
    await telegramApi('answerCallbackQuery', { callback_query_id: callback.id, text: 'Ответ сохранён. Trainer-статус не изменён.', show_alert: true });
    return true;
  }
  if (parsed.action === 'invite_yes') {
    if (!row.question_two_message_id) {
      const text = `<b>${parsed.campaign.city} · вопрос 2 из 2</b>\n\nГотовы ли вы сначала разобраться в предложении, говорить с людьми уважительно и фиксировать реальный следующий шаг, не считая клик или просмотр результатом?`;
      const messageId = await telegram(chatId, text, { reply_markup: { inline_keyboard: [
        [{ text: 'Да, согласен', callback_data: `owner_city_089_responsible_yes_${parsed.key}` }],
        [{ text: 'Нет', callback_data: `owner_city_089_responsible_no_${parsed.key}` }],
      ] } });
      await sql`UPDATE owner_city_campaign_entries089 SET questionnaire_state='question_two',answer_invite_owners=true,question_two_message_id=${String(messageId)},updated_at=NOW() WHERE chat_id=${chatId} AND campaign_id=${parsed.campaign.campaignId}`;
    }
    await telegramApi('answerCallbackQuery', { callback_query_id: callback.id });
    return true;
  }
  if (parsed.action === 'responsible_no') {
    await sql`UPDATE owner_city_campaign_entries089 SET questionnaire_state='declined',answer_responsible=false,updated_at=NOW() WHERE chat_id=${chatId} AND campaign_id=${parsed.campaign.campaignId}`;
    await telegramApi('answerCallbackQuery', { callback_query_id: callback.id, text: 'Ответ сохранён. Trainer-статус не изменён.', show_alert: true });
    return true;
  }
  if (row.completion_message_id) {
    await telegramApi('answerCallbackQuery', { callback_query_id: callback.id, text: 'Анкета уже сохранена. Переход в Batman находится в сообщении ниже.', show_alert: true });
    return true;
  }
  const text = `✅ <b>${parsed.campaign.city}: короткая анкета сохранена</b>\n\nЭто тестовая фиксация готовности познакомиться с ролью. Она не активирует Batman, не присваивает btm_id и не меняет ваш Trainer-статус.\n\nСледующий отдельный шаг — открыть Batman-бот.`;
  const messageId = await telegram(chatId, text, { reply_markup: { inline_keyboard: [[
    { text: 'Перейти в Batman-бот', url: `${BATMAN_BOT}?start=${parsed.campaign.batmanStart}` },
  ]] } });
  await sql`UPDATE owner_city_campaign_entries089 SET questionnaire_state='completed',answer_responsible=true,completion_message_id=${String(messageId)},updated_at=NOW() WHERE chat_id=${chatId} AND campaign_id=${parsed.campaign.campaignId}`;
  await telegramApi('answerCallbackQuery', { callback_query_id: callback.id, text: 'Ответы сохранены.' });
  return true;
}

export { CAMPAIGNS };
