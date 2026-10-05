import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { PGlite } from '@electric-sql/pglite';

const operatorSource = fs.readFileSync(new URL('../api/operator.js', import.meta.url), 'utf8');
const coreSource = fs.readFileSync(new URL('../api/_core.js', import.meta.url), 'utf8');
const boardSource = fs.readFileSync(new URL('../public/operator-board.js', import.meta.url), 'utf8');
const operatorUiSource = fs.readFileSync(new URL('../public/operator.js', import.meta.url), 'utf8');
const funnelStoreSource = fs.readFileSync(new URL('../lib/funnel-store.js', import.meta.url), 'utf8');
const helperSource = boardSource.split('\n').find(line => line.startsWith('function primaryBoardGroupName'));
const primaryBoardGroupName = vm.runInNewContext(`(${helperSource})`);
const dataHelperSource = boardSource.split('\n').find(line => line.startsWith('function dataBoardGroupName'));
const dataBoardGroupName = vm.runInNewContext(`(${dataHelperSource})`);

test('operator list derives one qualified click for the exact current primary appointment', () => {
  assert.match(operatorSource, /MIN\(e\.clicked_at\) AS primary_zoom_clicked_at/);
  assert.match(operatorSource, /candidate_zoom_entries[\s\S]*UNION ALL[\s\S]*candidate_zoom_session_entries/);
  assert.match(operatorSource, /e\.candidate_id=c\.id/);
  assert.match(operatorSource, /e\.interview_at=c\.interview_at/);
  assert.match(operatorSource, /e\.slot_id=c\.slot_id/);
  assert.match(operatorSource, /PRIMARY_ENTRY_BEFORE_MINUTES/);
  assert.match(operatorSource, /PRIMARY_ENTRY_CUTOFF_AFTER_MINUTES/);
  assert.match(operatorSource, /submitted_at AS questionnaire_two_submitted_at/);
  assert.match(operatorSource, /FROM candidate_questionnaire_two[\s\S]*WHERE candidate_id=c\.id/);
});

test('data board distinguishes a submitted Form 2 from a form still waiting', () => {
  assert.equal(dataBoardGroupName({ status: 'questionnaire', questionnaire_two_submitted_at: '2026-10-05T06:00:00Z' }), 'Анкета 2 получена · ожидает Тест 1');
  assert.equal(dataBoardGroupName({ status: 'questionnaire', questionnaire_two_submitted_at: null }), 'Ожидают Анкету 2');
  assert.equal(dataBoardGroupName({ status: 'test_1_completed', questionnaire_two_submitted_at: '2026-10-05T06:00:00Z' }), 'Тест 1 заполнен');
});

test('every list refresh also refreshes the currently open candidate detail', () => {
  assert.match(operatorUiSource, /async function refreshSelectedCandidate\(\)/);
  assert.match(operatorUiSource, /if\(selected&&all\.some\([\s\S]*?\)\)await refreshSelectedCandidate\(\)/);
  assert.match(operatorUiSource, /applyCandidateData\(d\);renderDetail\(\)/);
});

test('first successful Form 2 submit appends one future-only event even when status is already questionnaire', async () => {
  const functionSql = coreSource.match(/await sql`(CREATE OR REPLACE FUNCTION submit_candidate_questionnaire_two[\s\S]*?END \$\$)`;/)?.[1];
  assert.ok(functionSql, 'submit_candidate_questionnaire_two SQL not found');
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE candidates(id bigint PRIMARY KEY,status text,consent boolean,updated_at timestamptz);
    CREATE TABLE candidate_questionnaire_two(id bigint PRIMARY KEY,candidate_id bigint,token text,status text,answers jsonb,submitted_at timestamptz,updated_at timestamptz);
    CREATE TABLE funnel_projects(id bigint PRIMARY KEY,project_key text);
    CREATE TABLE funnel_stage_events(id bigserial PRIMARY KEY,candidate_id bigint,project_id bigint,from_status text,to_status text,trigger text,actor text);
    INSERT INTO candidates VALUES(1555,'questionnaire',true,NOW());
    INSERT INTO candidate_questionnaire_two VALUES(1,1555,'run04','sent',NULL,NULL,NOW());
    INSERT INTO funnel_projects VALUES(30,'academy-trainer');
    ${functionSql};
  `);
  const answers = JSON.stringify({work_history:'w',achievements:'a',strengths:'s',development:'d',hobbies:'h',goals:'g',readiness:'10',income:'i'});
  const first = await db.query(`SELECT submit_candidate_questionnaire_two('run04',$1::jsonb) AS result`, [answers]);
  const replay = await db.query(`SELECT submit_candidate_questionnaire_two('run04',$1::jsonb) AS result`, [answers]);
  const events = await db.query(`SELECT from_status,to_status,trigger,actor FROM funnel_stage_events WHERE candidate_id=1555`);
  assert.equal(first.rows[0].result.ok, true);
  assert.equal(replay.rows[0].result.ok, false);
  assert.deepEqual(events.rows, [{ from_status:'questionnaire', to_status:'questionnaire', trigger:'questionnaire_two_submitted', actor:'candidate' }]);
  await db.close();
});

test('primary board distinguishes future, qualified click, and true no-click without inferring attendance', () => {
  const now = new Date('2026-10-05T05:30:00.000Z');
  assert.equal(primaryBoardGroupName({ interview_at: '2026-10-05T06:00:00.000Z', primary_zoom_clicked_at: '2026-10-05T05:15:00.000Z' }, now), '⏳ Ожидают назначенного времени');
  assert.equal(primaryBoardGroupName({ interview_at: '2026-10-05T05:00:00.000Z', primary_zoom_clicked_at: '2026-10-05T04:45:00.000Z' }, now), '✓ Zoom нажат · присутствие подтверждается отдельно');
  assert.equal(primaryBoardGroupName({ interview_at: '2026-10-05T05:00:00.000Z', primary_zoom_clicked_at: null }, now), '⚠ Zoom не нажат');
});

test('board uses the server-derived field and keeps clicked candidates in the primary stage', () => {
  assert.match(boardSource, /if\(candidate\.status==='interview_booked'\)return primaryBoardGroupName\(candidate\)/);
  assert.doesNotMatch(boardSource, /primary_zoom_clicked_at[\s\S]*status='interviewed'/);
});

test('productivity column is factual and invited candidates are not labelled as booked', () => {
  assert.match(boardSource, /id:'productivity_booked',name:'Интервью на продуктивность',statuses:\['test_1_passed','productivity_invited','productivity_booked'\]/);
  assert.match(boardSource, /productivity\.name='Интервью на продуктивность'/);
  assert.match(funnelStoreSource, /key: 'productivity_booked', name: 'Интервью на продуктивность'[^\n]+statuses: \['test_1_passed', 'productivity_invited', 'productivity_booked'\]/);
  assert.match(boardSource, /candidate\.status==='productivity_invited'\)return'Ожидают выбора времени'/);
  assert.match(boardSource, /candidate\.status==='test_1_passed'\)return'Ожидают приглашения'/);
  assert.doesNotMatch(boardSource, /id:'productivity_booked',name:'Записан на продуктивность'/);
});
