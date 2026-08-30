import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanupRemovalService } from '../api/_removal-service.js';
const message = { chat: { id: -1001 }, message_id: 42, date: 1000, from: { id: 7, is_bot: true }, left_chat_member: { id: 9 } };
function setup(error) {
  const calls = [];
  return { calls, deps: { groupId: '-1001', now: () => 1001000, api: async (method, args) => {
    calls.push([method, args]);
    if (method === 'getMe') return { id: 7 };
    if (error) throw new Error(error);
    return true;
  } } };
}
test('deletes only exact service message from this bot in configured group', async () => {
  const { calls, deps } = setup();
  assert.equal(await cleanupRemovalService(message, deps), true);
  assert.deepEqual(calls[1], ['deleteMessage', { chat_id: -1001, message_id: 42 }]);
});
test('preserves ordinary messages, exits, other admins, groups, bot removal and old events', async () => {
  for (const patch of [ { left_chat_member: undefined }, { chat: { id: -2002 } }, { from: { id: 9 } }, { from: { id: 8, is_bot: true } }, { left_chat_member: { id: 7 } }, { date: -200000 } ]) {
    const { calls, deps } = setup();
    assert.equal(await cleanupRemovalService({ ...message, ...patch }, deps), false);
    assert.equal(calls.some(([m]) => m === 'deleteMessage'), false);
  }
});
test('already deleted is idempotent; permission and network failures remain visible for redelivery', async () => {
  assert.equal(await cleanupRemovalService(message, setup('Bad Request: message to delete not found').deps), true);
  for (const error of ['not enough rights', 'network error']) await assert.rejects(cleanupRemovalService(message, setup(error).deps), new RegExp(error));
});
