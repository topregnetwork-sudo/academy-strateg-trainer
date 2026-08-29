import { init, json, sql, telegram, telegramApi } from './_core.js';

const SETUP_KEY = 'f94b0b7f76c64809a5a775f13c79e12c';
const TEST_USERNAME = 'hracademystrateg';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (req.headers['x-setup-key'] !== SETUP_KEY) return json(res, 404, { error: 'Not found' });
  try {
    await init();
    const candidate = (await sql`SELECT id,chat_id,username FROM candidates WHERE LOWER(username)=${TEST_USERNAME} LIMIT 1`).rows[0];
    if (!candidate || LOWER(candidate.username) !== TEST_USERNAME) throw new Error('Test account not found');
    const settings = (await sql`SELECT key,value FROM app_settings WHERE key IN ('candidate_group_chat_id','candidate_group_invite_url')`).rows;
    const values = Object.fromEntries(settings.map(item => [item.key, item.value]));
    if (!values.candidate_group_chat_id || !values.candidate_group_invite_url) throw new Error('Candidate group settings are incomplete');
    const bot = await telegramApi('getMe');
    const botMember = await telegramApi('getChatMember', { chat_id: values.candidate_group_chat_id, user_id: bot.id });
    if (!['administrator','creator'].includes(botMember.status) || (botMember.status === 'administrator' && !botMember.can_restrict_members)) {
      throw new Error('Bot cannot remove members from candidate group');
    }
    const before = await telegramApi('getChatMember', { chat_id: values.candidate_group_chat_id, user_id: Number(candidate.chat_id) });
    if (!['member','administrator','creator','restricted'].includes(before.status)) throw new Error(`Test account is not a group member: ${before.status}`);
    if (['administrator','creator'].includes(before.status)) throw new Error('Test account is an administrator; refusing removal');
    await telegramApi('unbanChatMember', { chat_id: values.candidate_group_chat_id, user_id: Number(candidate.chat_id), only_if_banned: false });
    const after = await telegramApi('getChatMember', { chat_id: values.candidate_group_chat_id, user_id: Number(candidate.chat_id) });
    const messageId = await telegram(candidate.chat_id, '🧪 <b>Тест исключения завершён</b>\n\nТестовый аккаунт был мягко исключён из группы кандидатов. Нажмите кнопку, чтобы вернуться.', {
      reply_markup: { inline_keyboard: [[{ text: 'Вернуться в группу', url: values.candidate_group_invite_url }]] }
    });
    return json(res, 200, {
      ok: true,
      candidateId: candidate.id,
      username: candidate.username,
      beforeStatus: before.status,
      afterStatus: after.status,
      returnMessageId: messageId
    });
  } catch (error) {
    console.error('[candidate-removal-test]', error);
    return json(res, 500, { error: String(error?.message || error) });
  }
}

function LOWER(value) {
  return String(value || '').toLowerCase();
}
