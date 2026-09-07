import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const board = fs.readFileSync(new URL('../public/operator-board.js', import.meta.url), 'utf8');
const store = fs.readFileSync(new URL('../lib/funnel-store.js', import.meta.url), 'utf8');
const telegram = fs.readFileSync(new URL('../api/telegram.js', import.meta.url), 'utf8');

test('board separates passed productivity, pending reserve response, and accepted reserve', () => {
  assert.match(board, /Прошёл продуктивность/iu);
  assert.match(board, /Кадровый резерв — ожидается ответ/iu);
  assert.match(board, /Кадровый резерв/iu);
  assert.match(board, /reserve_no_response/iu);
  assert.match(store, /productivity_passed_stage/);
  assert.match(store, /reserve_answer/);
});

test('reserve consent removes only the agreeing candidate from the active candidate group', () => {
  assert.match(telegram, /banChatMember/);
  assert.match(telegram, /unbanChatMember/);
  assert.match(telegram, /reserve_group_removal_state/);
});
