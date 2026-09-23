const OWNER_USERNAME = 'topregstrateg';
const KEYWORD = '28 сентября';
const FLOW_VERSION = 'zoom_keyword_v2';
const CAMPAIGNS = {
  minsk: { city: 'Минск', campaignId: 'trainer_owner_minsk_20260923_089', zoomSessionId: 'trainer_batman_minsk_morning_20260923_089', invitedOwnerPrice: '20 рублей' },
  chelyabinsk: { city: 'Челябинск', campaignId: 'trainer_owner_chelyabinsk_20260923_089', zoomSessionId: 'trainer_batman_chelyabinsk_morning_20260923_089', invitedOwnerPrice: 'PENDING_OWNER' },
};
let initialized;
async function ensureStore(sql) {
  if (!initialized) initialized = (async () => {
    await sql`CREATE TABLE IF NOT EXISTS owner_city_campaign_entries089(
      chat_id TEXT NOT NULL, campaign_id TEXT NOT NULL, city TEXT NOT NULL, zoom_session_id TEXT NOT NULL,
      questionnaire_state TEXT NOT NULL DEFAULT 'intro', answer_invite_owners BOOLEAN, answer_responsible BOOLEAN,
      intro_message_id TEXT, question_one_message_id TEXT, question_two_message_id TEXT, completion_message_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(chat_id,campaign_id))`;
    await sql`ALTER TABLE owner_city_campaign_entries089
      ADD COLUMN IF NOT EXISTS flow_version TEXT,
      ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS corrected_message_id TEXT,
      ADD COLUMN IF NOT EXISTS keyword_received_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS announcement_message_id TEXT,
      ADD COLUMN IF NOT EXISTS invited_owner_price TEXT`;
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
const isKeyword = text => String(text || '').trim().toLowerCase() === KEYWORD;
const inviteText = campaign => `🧪 <b>Тест · Zoom-приглашение · ${campaign.city}</b>\n\nПриглашаем вас на Zoom-знакомство с направлением Batman Академии Стратег. Это отдельная городская кампания «${campaign.city}».\n\nПосле фактического участия в Zoom или просмотра записи самостоятельно напишите в этот чат точное кодовое слово: <b>28 сентября</b>. Тогда бот покажет анонс мероприятия только вашего города.\n\nСтатус Trainer не меняется. Массовая отправка не выполняется.`;
function announcementText(campaign) {
  const price = campaign.invitedOwnerPrice === 'PENDING_OWNER' ? 'Стоимость для приглашённых собственников бизнеса пока не подтверждена владельцем.' : `Стоимость для приглашённых собственников бизнеса: <b>${campaign.invitedOwnerPrice}</b>.`;
  return `📅 <b>Мероприятие Академии Стратег · ${campaign.city}</b>\n\nДата: <b>28 сентября</b>.\n\nДля участника Zoom или посмотревшего запись посещение мероприятия — <b>бесплатно</b>.\n${price}\n\nЭто анонс только кампании «${campaign.city}».`;
}
async function disableOldKeyboard(chatId, messageId, telegramApi) {
  if (!messageId) return;
  try { await telegramApi('editMessageReplyMarkup', { chat_id: chatId, message_id: Number(messageId), reply_markup: { inline_keyboard: [] } }); }
  catch (error) { if (!/message is not modified|message to edit not found/i.test(String(error?.message || error))) throw error; }
}
export async function handleOwnerCityCampaignStart(message, { sql, telegram, telegramApi }) {
  const campaign = campaignByStart(message?.text);
  if (!campaign) return false;
  const chatId = String(message.chat?.id || '');
  if (!ownerAllowed(message.from)) { await telegram(chatId, 'Этот тестовый вход доступен только владельцу проекта.'); return true; }
  await ensureStore(sql);
  const zoom = await zoomUrl(sql);
  if (!zoom) throw new Error(`owner_city_campaign_zoom_missing:${campaign.campaignId}`);
  await sql`UPDATE owner_city_campaign_entries089 SET active=FALSE,updated_at=NOW() WHERE chat_id=${chatId} AND active=TRUE`;
  const row = (await sql`INSERT INTO owner_city_campaign_entries089(chat_id,campaign_id,city,zoom_session_id,questionnaire_state,flow_version,active,invited_owner_price)
    VALUES(${chatId},${campaign.campaignId},${campaign.city},${campaign.zoomSessionId},'zoom_invited',${FLOW_VERSION},TRUE,${campaign.invitedOwnerPrice})
    ON CONFLICT(chat_id,campaign_id) DO UPDATE SET questionnaire_state='zoom_invited',flow_version=${FLOW_VERSION},active=TRUE,invited_owner_price=${campaign.invitedOwnerPrice},updated_at=NOW()
    RETURNING intro_message_id,corrected_message_id`).rows[0];
  await disableOldKeyboard(chatId, row?.intro_message_id, telegramApi);
  if (row?.corrected_message_id) return true;
  const messageId = await telegram(chatId, inviteText(campaign), { reply_markup: { inline_keyboard: [[{ text: `Подключиться к Zoom · ${campaign.city}`, url: zoom }]] } });
  await sql`UPDATE owner_city_campaign_entries089 SET corrected_message_id=${String(messageId)},updated_at=NOW() WHERE chat_id=${chatId} AND campaign_id=${campaign.campaignId}`;
  return true;
}
function oldCallback(data) {
  const match = String(data || '').match(/^owner_city_089_(?:q1|invite_yes|invite_no|responsible_yes|responsible_no)_(minsk|chelyabinsk)$/);
  return match ? CAMPAIGNS[match[1]] : null;
}
export async function handleOwnerCityCampaignCallback(callback, { sql, telegramApi }) {
  const campaign = oldCallback(callback?.data);
  if (!campaign) return false;
  const chatId = String(callback.message?.chat?.id || callback.from?.id || '');
  if (!ownerAllowed(callback.from)) { await telegramApi('answerCallbackQuery', { callback_query_id: callback.id, text: 'Кнопка доступна только владельцу проекта.', show_alert: true }); return true; }
  await ensureStore(sql);
  await disableOldKeyboard(chatId, callback.message?.message_id, telegramApi);
  await sql`UPDATE owner_city_campaign_entries089 SET questionnaire_state='superseded_no_questionnaire',flow_version=${FLOW_VERSION},updated_at=NOW() WHERE chat_id=${chatId} AND campaign_id=${campaign.campaignId}`;
  await telegramApi('answerCallbackQuery', { callback_query_id: callback.id, text: 'Анкета отменена. После Zoom или просмотра записи напишите: 28 сентября', show_alert: true });
  return true;
}
export async function handleOwnerCityKeyword(message, { sql, telegram }) {
  if (!isKeyword(message?.text) || !ownerAllowed(message.from)) return false;
  const chatId = String(message.chat?.id || '');
  await ensureStore(sql);
  const row = (await sql`SELECT campaign_id,announcement_message_id FROM owner_city_campaign_entries089 WHERE chat_id=${chatId} AND active=TRUE AND flow_version=${FLOW_VERSION} ORDER BY updated_at DESC LIMIT 1`).rows[0];
  if (!row) return false;
  const campaign = Object.values(CAMPAIGNS).find(item => item.campaignId === row.campaign_id);
  if (!campaign) throw new Error(`owner_city_campaign_unknown:${row.campaign_id}`);
  if (row.announcement_message_id) return true;
  const messageId = await telegram(chatId, announcementText(campaign));
  await sql`UPDATE owner_city_campaign_entries089 SET questionnaire_state='event_announced',keyword_received_at=COALESCE(keyword_received_at,NOW()),announcement_message_id=${String(messageId)},updated_at=NOW() WHERE chat_id=${chatId} AND campaign_id=${campaign.campaignId} AND announcement_message_id IS NULL`;
  return true;
}
export { CAMPAIGNS, FLOW_VERSION, KEYWORD };
