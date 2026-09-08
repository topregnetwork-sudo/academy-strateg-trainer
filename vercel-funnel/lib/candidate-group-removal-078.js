import { sql, telegramApi } from '../api/_core.js';

export async function removeFromCandidateGroup(candidate) {
  const groupChatId = (await sql`SELECT value FROM app_settings WHERE key='candidate_group_chat_id' LIMIT 1`).rows[0]?.value;
  if (!groupChatId) return { removed: false, reason: 'group_not_configured' };
  const member = await telegramApi('getChatMember', { chat_id: groupChatId, user_id: Number(candidate.chat_id) });
  if (['left', 'kicked'].includes(member.status)) return { removed: false, reason: 'already_outside' };
  if (!['member', 'restricted'].includes(member.status)) return { removed: false, reason: `protected_${member.status}` };
  await telegramApi('banChatMember', { chat_id: groupChatId, user_id: Number(candidate.chat_id), revoke_messages: false });
  await telegramApi('unbanChatMember', { chat_id: groupChatId, user_id: Number(candidate.chat_id), only_if_banned: false });
  const after = await telegramApi('getChatMember', { chat_id: groupChatId, user_id: Number(candidate.chat_id) });
  return { removed: after.status === 'left', reason: after.status };
}
