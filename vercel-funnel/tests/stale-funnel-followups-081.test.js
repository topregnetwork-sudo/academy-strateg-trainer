import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('081 stores exactly one two-step follow-up per candidate and funnel step', () => {
  const source = read('../lib/stale-funnel-followups-081.js');
  assert.match(source, /candidate_followups081/);
  assert.match(source, /THREE_DAYS/);
  assert.match(source, /phase: 'remind'/);
  assert.match(source, /phase: 'close'/);
  assert.match(source, /PRIMARY KEY\(candidate_id,step\)/);
});

test('081 respects human replies before either reminder or closure', () => {
  const source = read('../lib/stale-funnel-followups-081.js');
  assert.match(source, /Кандидат ответил до напоминания/);
  assert.match(source, /Кандидат ответил после напоминания/);
  assert.match(source, /direction='in' AND kind<>'link_open'/);
  assert.match(source, /deliveryFailed: true/);
  assert.match(source, /state='attention'/);
});

test('081 closes unanswered primary and group stages into existing inactive statuses', () => {
  const source = read('../lib/stale-funnel-followups-081.js');
  assert.match(source, /reserve_no_response/);
  assert.match(source, /test_1_incomplete_removed/);
  assert.match(source, /removeFromCandidateGroup/);
  assert.match(source, /bot was blocked by the user/i);
  assert.match(source, /bot_blocked_081/);
  assert.match(source, /closeBlockedReserve/);
  assert.match(source, /row\.state === 'attention' && botBlocked\(row\.error\)/);
  assert.match(source, /unreachableClosed/);
  assert.match(source, /f\.error ILIKE '%bot was blocked by the user%'/);
});

test('081 operator audit is read-only until apply is explicitly true', () => {
  const source = read('../lib/stale-funnel-followups-081.js');
  assert.match(source, /if \(apply\) \{\s*await scheduleFollowup081/);
  const operator = read('../api/operator.js');
  assert.match(operator, /action==='reconcile_stale_funnel_081'/);
  assert.match(operator, /reconcileStaleFunnel081\(v\.apply===true\)/);
  assert.match(source, /followupStates/);
});

test('081 board has no waiting-productivity column and joins it to booked productivity', () => {
  const board = read('../public/operator-board.js');
  assert.match(board, /productivity_booked',name:'Записан на продуктивность',statuses:\['test_1_passed','productivity_invited','productivity_booked'\]/);
  assert.match(board, /\['decision','collaboration','reserve_answer','productivity_wait'\]/);
});

test('081 legacy stage tasks delegate to the gentle follow-up handler', () => {
  const source = read('../lib/stage-deadlines-043.js');
  assert.match(source, /return scheduleFollowup081\(id,step\)/);
  assert.match(source, /return runFollowup081\(id,step,'remind'\)/);
});
