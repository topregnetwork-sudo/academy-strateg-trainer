// Event-only cleanup: never delete participant conversations or other admins' actions.
export async function cleanupRemovalService(message, { groupId, api, now = Date.now }) {
  if (!message?.left_chat_member || !groupId || String(message.chat?.id) !== String(groupId)) return false;
  if (!Number.isInteger(message.message_id) || !message.from?.is_bot) return false;
  const me = await api('getMe', {});
  if (String(message.from.id) !== String(me.id)) return false;
  if (String(message.left_chat_member.id) === String(me.id)) return false;
  if (!message.date || now() / 1000 - message.date >= 48 * 3600) return false;
  try {
    await api('deleteMessage', { chat_id: message.chat.id, message_id: message.message_id });
  } catch (error) {
    // Telegram redelivery after a successful deletion is safe.
    if (!/message to delete not found/i.test(String(error?.message || error))) throw error;
  }
  return true;
}
