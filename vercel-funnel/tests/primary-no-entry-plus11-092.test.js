import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { PRIMARY_ENTRY_CUTOFF_AFTER_MINUTES, PRIMARY_NO_ENTRY_AFTER_MINUTES, PRIMARY_REMINDER_BEFORE_MINUTES, primaryTaskDueAt } from '../lib/primary-timing.js';

const created = [], armed = [];
let migrationTask = null;
let armFailures = 0;

const sql = async (strings, ...values) => {
  const text = strings.join('?');
  if (text.startsWith('SELECT id,payload,due_at,state,error FROM funnel_tasks')) return { rows: migrationTask ? [migrationTask] : [] };
  if (text.startsWith("UPDATE funnel_tasks SET due_at=?,state='pending'")) {
    migrationTask = { ...migrationTask, due_at: values[0], state: 'pending', error: null };
    return { rows: [{ id: migrationTask.id, due_at: migrationTask.due_at, state: migrationTask.state }] };
  }
  if (text.startsWith('UPDATE funnel_tasks SET due_at=?,state=?,error=?')) {
    migrationTask = { ...migrationTask, due_at: values[0], state: values[1], error: values[2] };
    return { rows: [] };
  }
  throw new Error(`Unexpected SQL in 092 test: ${text}`);
};

await mock.module('../lib/funnel-store.js', { namedExports: {
  initFunnel: async () => {},
  sql,
  createTask: async (kind, payload, dueAt, id) => { created.push({ kind, payload, dueAt, id }); return id; },
  armTask: async id => { armed.push(id); if (armFailures > 0) { armFailures -= 1; throw new Error('scheduler unavailable'); } },
} });

const { schedulePrimary, migrateNoEntryTimers } = await import('../lib/funnel-primary.js');

test('092 central timing keeps T-30, accepts entry through +10 and follows up at +11', () => {
  const at = '2030-01-07T05:00:00.000Z';
  assert.equal(PRIMARY_REMINDER_BEFORE_MINUTES, 30);
  assert.equal(PRIMARY_ENTRY_CUTOFF_AFTER_MINUTES, 10);
  assert.equal(PRIMARY_NO_ENTRY_AFTER_MINUTES, 11);
  assert.equal(primaryTaskDueAt(at, 'reminder').toISOString(), '2030-01-07T04:30:00.000Z');
  assert.equal(primaryTaskDueAt(at, 'no_show').toISOString(), '2030-01-07T05:11:00.000Z');
});

test('092 schedules exactly one T-30 task and one +11 task without changing the appointment', async () => {
  created.length = 0;
  const session = { interview_at: '2030-01-07T05:00:00.000Z', slot_id: 'mon-0800' };
  await schedulePrimary(session);
  assert.equal(created.length, 2);
  assert.deepEqual(created.map(item => item.dueAt.toISOString()), ['2030-01-07T04:30:00.000Z', '2030-01-07T05:11:00.000Z']);
  assert.ok(created.every(item => item.kind === 'primary_session'));
  assert.ok(created.every(item => item.payload.at === session.interview_at && item.payload.slot === session.slot_id));
  assert.equal(new Set(created.map(item => item.id)).size, 2);
});

test('092 exact maintenance rearms only the existing no-entry task with the same id and payload', async () => {
  const noShow = created[1];
  migrationTask = {
    id: noShow.id,
    payload: noShow.payload,
    due_at: new Date('2030-01-07T06:00:00.000Z'),
    state: 'pending',
    error: null,
  };
  armed.length = 0;
  const result = await migrateNoEntryTimers({ at: noShow.payload.at, slot: noShow.payload.slot });
  assert.equal(result.updated.length, 1);
  assert.equal(result.updated[0].id, noShow.id);
  assert.equal(result.updated[0].dueAt, '2030-01-07T05:11:00.000Z');
  assert.equal(migrationTask.id, noShow.id);
  assert.deepEqual(migrationTask.payload, noShow.payload);
  assert.deepEqual(armed, [noShow.id]);
});

test('092 exact maintenance rejects an incomplete or removed appointment scope', async () => {
  await assert.rejects(migrateNoEntryTimers({}), /Exact primary appointment/);
  await assert.rejects(migrateNoEntryTimers({ at: '2030-01-07T05:00:00.000Z', slot: 'sat-0600' }), /Exact primary appointment/);
});

test('092 restores and rearms the previous task when the new scheduler arm fails', async () => {
  const noShow = created[1], oldDue = new Date('2030-01-07T06:00:00.000Z');
  migrationTask = { id: noShow.id, payload: noShow.payload, due_at: oldDue, state: 'attention', error: 'old marker' };
  armed.length = 0;
  armFailures = 1;
  await assert.rejects(migrateNoEntryTimers({ at: noShow.payload.at, slot: noShow.payload.slot }), /scheduler unavailable/);
  assert.equal(new Date(migrationTask.due_at).toISOString(), oldDue.toISOString());
  assert.equal(migrationTask.state, 'attention');
  assert.equal(migrationTask.error, 'old marker');
  assert.deepEqual(armed, [noShow.id, noShow.id]);
});
