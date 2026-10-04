import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {claimTrainerApplication} from '../lib/trainer-application-single-bind.js';

class MemoryClaimStore {
  constructor(applications = []) {
    this.applications = new Map(applications.map(app => [app.code, {...app}]));
    this.candidates = new Map();
    this.candidateByChat = new Map();
    this.nextCandidateId = 1;
    this.candidateWrites = 0;
    this.bindWrites = 0;
    this.tails = new Map();
  }

  async withApplicationLock(code, work) {
    const previous = this.tails.get(code) || Promise.resolve();
    let release;
    const ticket = new Promise(resolve => { release = resolve; });
    this.tails.set(code, previous.then(() => ticket));
    await previous;
    try {
      const app = this.applications.get(code);
      return await work({
        app,
        getCandidate: async id => this.candidates.get(id),
        upsertCandidate: async (lockedApp, input) => {
          this.candidateWrites += 1;
          let candidate = this.candidateByChat.get(input.chatId);
          if (!candidate) {
            candidate = {id:this.nextCandidateId++,chat_id:input.chatId,status:'new',source_id:lockedApp.source_id,interview_at:null};
            this.candidates.set(candidate.id, candidate);
            this.candidateByChat.set(input.chatId, candidate);
          } else {
            candidate.source_id = lockedApp.source_id;
          }
          return candidate;
        },
        bindApplication: async (applicationId, candidateId) => {
          const current = [...this.applications.values()].find(item => item.id === applicationId);
          if (!current || current.candidate_id) return false;
          current.candidate_id = candidateId;
          this.bindWrites += 1;
          return true;
        },
      });
    } finally {
      release();
    }
  }
}

const application = (code = 'abcdefghijklmnopqrst') => ({
  id: 91,
  code,
  candidate_id: null,
  source_id: 'owner_test_run04',
  full_name: 'Owner Test',
  city: 'Челябинск',
  trainer_experience_level: 'none',
});

const input = (chatId, code = 'abcdefghijklmnopqrst') => ({code,chatId,username:`owner_${chatId}`,firstName:'Owner'});

test('091 first valid chat binds once and same-chat replay preserves the current stage', async () => {
  const store = new MemoryClaimStore([application()]);
  const first = await claimTrainerApplication(input('chat-a'), store);
  assert.equal(first.kind, 'first_bind');
  assert.equal(store.applications.get(first.app.code).candidate_id, first.candidate.id);
  assert.equal(store.candidateWrites, 1);
  assert.equal(store.bindWrites, 1);

  first.candidate.status = 'interview_booked';
  first.candidate.interview_at = '2026-10-05T05:00:00.000Z';
  const replay = await claimTrainerApplication(input('chat-a'), store);
  assert.equal(replay.kind, 'same_chat');
  assert.equal(replay.candidate.id, first.candidate.id);
  assert.equal(replay.candidate.status, 'interview_booked');
  assert.equal(replay.candidate.interview_at, '2026-10-05T05:00:00.000Z');
  assert.equal(store.candidateWrites, 1);
  assert.equal(store.bindWrites, 1);
});

test('091 different-chat replay cannot change application, winner, source or status', async () => {
  const store = new MemoryClaimStore([application()]);
  const winner = await claimTrainerApplication(input('chat-a'), store);
  const loserProfile = {id:99,chat_id:'chat-b',status:'reserve_no_response',source_id:'legacy',interview_at:null};
  store.candidates.set(loserProfile.id, loserProfile);
  store.candidateByChat.set(loserProfile.chat_id, loserProfile);
  const before = structuredClone(loserProfile);
  const replay = await claimTrainerApplication(input('chat-b'), store);
  assert.equal(replay.kind, 'claimed_elsewhere');
  assert.equal(store.applications.get(winner.app.code).candidate_id, winner.candidate.id);
  assert.deepEqual(loserProfile, before);
  assert.equal(store.candidateWrites, 1);
  assert.equal(store.bindWrites, 1);
});

test('091 simultaneous two-chat claim has exactly one winner and no loser profile write', async () => {
  const store = new MemoryClaimStore([application()]);
  const results = await Promise.all([
    claimTrainerApplication(input('chat-a'), store),
    claimTrainerApplication(input('chat-b'), store),
  ]);
  assert.deepEqual(results.map(result => result.kind).sort(), ['claimed_elsewhere','first_bind']);
  const winner = results.find(result => result.kind === 'first_bind');
  assert.equal(store.applications.get(winner.app.code).candidate_id, winner.candidate.id);
  assert.equal(store.candidates.size, 1);
  assert.equal(store.candidateWrites, 1);
  assert.equal(store.bindWrites, 1);
});

test('091 runtime uses a row lock, guarded bind and a clear cross-chat response', () => {
  const source = fs.readFileSync(new URL('../api/telegram.js', import.meta.url), 'utf8');
  assert.match(source, /SELECT \* FROM applications WHERE code=\$\{code\} FOR UPDATE/);
  assert.match(source, /UPDATE applications SET candidate_id=\$\{candidateId\} WHERE id=\$\{applicationId\} AND candidate_id IS NULL RETURNING id/);
  assert.match(source, /Эта персональная ссылка уже использована в другом Telegram-аккаунте/);
  assert.match(source, /WHERE id=\$\{app\.candidate_id\} AND chat_id=\$\{chatId\} LIMIT 1/);
  assert.doesNotMatch(source, /UPDATE applications SET candidate_id=\$\{row\.id\} WHERE id=\$\{app\.id\}/);
});
