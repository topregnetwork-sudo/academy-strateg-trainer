import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const board = fs.readFileSync(new URL('../public/operator-board.js', import.meta.url), 'utf8');
const store = fs.readFileSync(new URL('../lib/funnel-store.js', import.meta.url), 'utf8');
const telegram = fs.readFileSync(new URL('../api/telegram.js', import.meta.url), 'utf8');
const outcomes = fs.readFileSync(new URL('../lib/productivity-outcomes-064.js', import.meta.url), 'utf8');
const removal = fs.readFileSync(new URL('../lib/candidate-group-removal-078.js', import.meta.url), 'utf8');
const operator = fs.readFileSync(new URL('../api/operator.js', import.meta.url), 'utf8');
const progress = fs.readFileSync(new URL('../public/operator-progress.js', import.meta.url), 'utf8');

test('board separates passed productivity, pending reserve response, and merged reserve-collaboration', () => {
  assert.match(board, /Прошёл продуктивность/iu);
  assert.match(board, /Кадровый резерв — ожидается ответ/iu);
  assert.match(board, /Кадровый резерв — сотрудничество/iu);
  assert.match(board, /reserve_no_response/iu);
  assert.match(store, /productivity_passed_stage/);
  assert.match(store, /reserve_answer/);
  assert.match(store, /"talent_pool","collaboration","academy_contact"/);
});

test('reserve consent removes only the agreeing candidate from the active candidate group', () => {
  assert.match(removal, /banChatMember/);
  assert.match(removal, /unbanChatMember/);
  assert.match(telegram, /reserve_group_removal_state/);
});

test('failed productivity outcome removes the candidate immediately and exposes the result in the operator card', () => {
  assert.match(outcomes, /ensureActiveGroupRemoval/);
  assert.match(outcomes, /result === 'productivity_failed'[\s\S]*ensureActiveGroupRemoval/);
  assert.match(telegram, /chosen === 'not_relevant'\) await ensureActiveGroupRemoval/);
  assert.match(outcomes, /active_group_removal_state/);
  assert.match(operator, /active_group_removal_state/);
  assert.match(operator, /reconcile_productivity_failed_group_removal_078/);
  assert.match(operator, /status='productivity_failed'/);
  assert.match(progress, /Исключён из группы текущего отбора/);
  assert.match(progress, /Требует проверки/);
});
