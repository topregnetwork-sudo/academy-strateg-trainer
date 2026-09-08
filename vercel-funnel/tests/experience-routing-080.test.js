import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const telegram = fs.readFileSync(new URL('../api/telegram.js', import.meta.url), 'utf8');
const outcomes = fs.readFileSync(new URL('../lib/productivity-outcomes-064.js', import.meta.url), 'utf8');
const store = fs.readFileSync(new URL('../lib/funnel-store.js', import.meta.url), 'utf8');
const board = fs.readFileSync(new URL('../public/operator-board.js', import.meta.url), 'utf8');

test('experienced candidates receive one personal collaboration offer and their answer routes them correctly', () => {
  assert.match(telegram, /experienced_collaboration_offer/);
  assert.match(telegram, /experienced_collaboration_\(yes\|no\)/);
  assert.match(telegram, /const nextStatus = choice === 'yes' \? 'talent_pool' : 'rejected'/);
  assert.match(telegram, /SELECT id FROM messages WHERE candidate_id=\$\{candidate\.id\} AND direction='out' AND kind='experienced_collaboration_offer'/);
});

test('reserve candidates leave the reserve after three days without an answer', () => {
  assert.match(outcomes, /scheduleReserveTask\(candidate\.id, 'close', dueAt\)/);
  assert.match(outcomes, /step === 'reminder' \|\| step === 'close'/);
  assert.match(outcomes, /SET status='reserve_no_response'/);
});

test('the board keeps only waiting or agreed candidates in reserve and provides the next two stages', () => {
  assert.match(store, /key: 'offline_testing'/);
  assert.match(store, /key: 'final'/);
  assert.match(board, /reserve\.statuses=\['productivity_failed','talent_pool','collaboration','academy_contact'\]/);
  assert.match(board, /status==='productivity_failed'\)return'Ожидаем ответ'/);
  assert.match(board, /status==='talent_pool'\)return'Согласились на сотрудничество'/);
  assert.doesNotMatch(board, /reserve\.statuses=\[[^\]]*'rejected'/);
});
