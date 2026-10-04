import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

const state = {
  candidate: null,
  evidence: false,
  messages: [],
  sent: [],
  acknowledgements: [],
  effects: new Map(),
  effectKeys: [],
};

let rowLockOwner = null;
const rowWaiters = [];
let queuedResolve = null;
let pauseEntryResolve = null;
let releaseEntry = null;

const normalized = strings => strings.join('?').replace(/\s+/g, ' ').trim();

async function acquireCandidateRow(owner) {
  if (!owner) throw new Error('FOR UPDATE requires a transaction owner');
  if (rowLockOwner && rowLockOwner !== owner) {
    queuedResolve?.();
    queuedResolve = null;
    await new Promise(resolve => rowWaiters.push({ owner, resolve }));
  }
  rowLockOwner = owner;
}

function releaseCandidateRow(owner) {
  if (rowLockOwner !== owner) return;
  rowLockOwner = null;
  const next = rowWaiters.shift();
  if (next) next.resolve();
}

async function query(owner, strings, ...values) {
  const text = normalized(strings);
  if (/^(CREATE|ALTER|INSERT INTO app_settings)/.test(text)) return { rows: [] };
  if (text.startsWith('SELECT c.id FROM candidates c WHERE')) {
    return { rows: !state.candidate.no_show_followup_sent && !state.evidence ? [{ id: state.candidate.id }] : [] };
  }
  if (text.startsWith('SELECT * FROM candidates WHERE chat_id=')) {
    await acquireCandidateRow(owner);
    if (pauseEntryResolve) {
      pauseEntryResolve();
      pauseEntryResolve = null;
      await new Promise(resolve => { releaseEntry = resolve; });
    }
    return { rows: state.candidate.consent ? [{ ...state.candidate }] : [] };
  }
  if (text.startsWith("SELECT value FROM app_settings WHERE key='zoom_meeting_url'")) return { rows: [{ value: 'https://zoom.invalid/owner-test' }] };
  if (text.startsWith('INSERT INTO candidate_zoom_session_entries')) {
    state.evidence = true;
    return { rows: [{ clicked_at: values.at(-1) }] };
  }
  if (text.startsWith('INSERT INTO candidate_zoom_entries')) return { rows: [] };
  if (text.startsWith('SELECT c.id,c.chat_id FROM candidates c WHERE')) {
    await acquireCandidateRow(owner);
    return { rows: !state.candidate.no_show_followup_sent ? [{ id: state.candidate.id, chat_id: state.candidate.chat_id }] : [] };
  }
  if (text.startsWith('SELECT 1 AS eligible WHERE')) {
    return { rows: state.evidence || state.messages.includes('primary_zoom_link') ? [] : [{ eligible: 1 }] };
  }
  if (text.startsWith('UPDATE candidates SET no_show_followup_sent=true')) {
    if (state.candidate.no_show_followup_sent) return { rows: [] };
    state.candidate.no_show_followup_sent = true;
    return { rows: [{ id: state.candidate.id, chat_id: state.candidate.chat_id }] };
  }
  if (text.startsWith('INSERT INTO messages')) {
    state.messages.push(text.includes("'no_show_followup'") ? 'no_show_followup' : 'primary_zoom_link');
    return { rows: [] };
  }
  if (text.startsWith('SELECT id FROM candidates WHERE id=')) return { rows: [{ id: state.candidate.id }] };
  if (text.startsWith('UPDATE candidates SET no_show_followup_sent=false')) {
    state.candidate.no_show_followup_sent = false;
    return { rows: [] };
  }
  throw new Error(`Unexpected SQL in 092 concurrency test: ${text}`);
}

async function transaction(work) {
  const owner = Symbol('tx');
  try { return await work((strings, ...values) => query(owner, strings, ...values)); }
  finally { releaseCandidateRow(owner); }
}

const sql = (strings, ...values) => query(null, strings, ...values);

const telegram = async (_chatId, text) => {
  state.sent.push(text);
  return state.sent.length;
};

await mock.module('../api/_core.js', { namedExports: {
  sql,
  transaction,
  telegram,
  telegramApi: async (method, payload) => { state.acknowledgements.push({ method, payload }); return true; },
  slots: { 'mon-0800': 'Пн 08:00' },
} });

await mock.module('../lib/funnel-store.js', { namedExports: {
  initFunnel: async () => {},
  createTask: async () => 'entry-report',
  effect: async (key, send) => {
    if (state.effects.has(key)) return state.effects.get(key);
    state.effectKeys.push(key);
    const result = await send();
    state.effects.set(key, result);
    return result;
  },
} });

const { handlePrimaryEntry } = await import('../lib/primary-evidence.js');
const { runPrimaryFollowup, followupText } = await import('../lib/primary-followup.js');

function reset(minutesAfterStart) {
  state.candidate = {
    id: 92,
    chat_id: 'owner-92',
    status: 'interview_booked',
    consent: true,
    no_show_followup_sent: false,
    interview_at: new Date(Date.now() - minutesAfterStart * 60000).toISOString(),
    slot_id: 'mon-0800',
  };
  state.evidence = false;
  state.messages.length = 0;
  state.sent.length = 0;
  state.acknowledgements.length = 0;
  state.effects.clear();
  state.effectKeys.length = 0;
}

const callback = () => ({
  id: 'owner-boundary-click',
  data: 'primary_zoom_enter',
  from: { id: 'owner-92' },
  message: { chat: { id: 'owner-92', type: 'private' } },
});

test('092 a qualified +10-boundary click committed under the appointment lock suppresses the concurrent +11 follow-up', async () => {
  reset(10);
  const exactCutoff = new Date(Date.parse(state.candidate.interview_at) + 10 * 60000);
  const entrySelected = new Promise(resolve => { pauseEntryResolve = resolve; });
  const secondQueued = new Promise(resolve => { queuedResolve = resolve; });
  const entry = handlePrimaryEntry(callback(), { now: () => exactCutoff });
  await entrySelected;
  const followup = runPrimaryFollowup({ at: state.candidate.interview_at, slot: state.candidate.slot_id });
  await secondQueued;
  releaseEntry();
  const [entryResult, followupResult] = await Promise.all([entry, followup]);

  assert.equal(entryResult, true);
  assert.deepEqual(followupResult, { due: 1, sent: 0, failed: 0 });
  assert.equal(state.evidence, true);
  assert.equal(state.candidate.no_show_followup_sent, false);
  assert.equal(state.sent.includes(followupText), false);
  assert.equal(state.effectKeys.some(key => key.startsWith('primary-no-entry:')), false);
  assert.equal(state.messages.includes('no_show_followup'), false);
  assert.deepEqual(state.messages, ['primary_zoom_link']);
});

test('092 without a qualified click +11 sends once, replay does not duplicate, and candidate stage is unchanged', async () => {
  reset(11);
  const originalStatus = state.candidate.status;
  const first = await runPrimaryFollowup({ at: state.candidate.interview_at, slot: state.candidate.slot_id });
  const replay = await runPrimaryFollowup({ at: state.candidate.interview_at, slot: state.candidate.slot_id });

  assert.deepEqual(first, { due: 1, sent: 1, failed: 0 });
  assert.deepEqual(replay, { due: 0, sent: 0, failed: 0 });
  assert.equal(state.sent.filter(text => text === followupText).length, 1);
  assert.equal(state.messages.filter(kind => kind === 'no_show_followup').length, 1);
  assert.equal(state.candidate.status, originalStatus);
  assert.equal(state.candidate.no_show_followup_sent, true);
});
