import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isPrimarySlotAllowed, nextInterview, slots } from '../lib/primary-schedule.js';
import { handleRescheduleChoice, handleSlotChoice } from '../api/telegram.js';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const expectedSlots = {
  'mon-0800': 'Понедельник, 08:00 МСК',
  'tue-0800': 'Вторник, 08:00 МСК',
  'wed-0800': 'Среда, 08:00 МСК',
  'thu-1800': 'Четверг, 18:00 МСК',
  'fri-1800': 'Пятница, 18:00 МСК',
};

test('090 exposes only the approved Monday-Friday primary schedule', () => {
  assert.deepEqual(slots, expectedSlots);
  for (const slotId of Object.keys(expectedSlots)) assert.equal(isPrimarySlotAllowed(slotId), true);
  assert.equal(isPrimarySlotAllowed('sat-0600'), false);
});

test('090 preserves the approved MSK weekday and hour calculation', () => {
  const sunday = new Date('2026-10-04T00:00:00.000Z');
  assert.equal(nextInterview('mon-0800', sunday), '2026-10-05T05:00:00.000Z');
  assert.equal(nextInterview('tue-0800', sunday), '2026-10-06T05:00:00.000Z');
  assert.equal(nextInterview('wed-0800', sunday), '2026-10-07T05:00:00.000Z');
  assert.equal(nextInterview('thu-1800', sunday), '2026-10-08T15:00:00.000Z');
  assert.equal(nextInterview('fri-1800', sunday), '2026-10-09T15:00:00.000Z');
});

test('090 rejects removed callbacks and uses one slot registry for follow-ups', () => {
  const telegram = read('../api/telegram.js');
  const followups = read('../lib/stale-funnel-followups-081.js');
  assert.equal((telegram.match(/!isPrimarySlotAllowed\(match\[[12]\]\)/g) || []).length, 2);
  for (const handler of ['handleSlotChoice', 'handleRescheduleChoice']) {
    const start = telegram.indexOf(`async function ${handler}`);
    const end = telegram.indexOf('\nasync function ', start + 1);
    const source = telegram.slice(start, end < 0 ? undefined : end);
    assert.ok(source.indexOf('!isPrimarySlotAllowed') < source.indexOf('const chatId'));
  }
  assert.match(followups, /Object\.entries\(slots\)/);
  assert.doesNotMatch(followups, /sat-0600|Суббота, 06:00/);
});

test('090 explicitly rejects stale Saturday callbacks without SQL or candidate messages', async () => {
  for (const [handler, data] of [
    [handleSlotChoice, 'trainer_slot_abcdefghijklmnopqrst_sat-0600'],
    [handleRescheduleChoice, 'trainer_rebook_sat-0600'],
  ]) {
    const effects = { sql: 0, telegram: 0, telegramApi: [] };
    const handled = await handler({ id: `callback-${effects.telegramApi.length}`, data }, {
      sql() { effects.sql += 1; throw new Error('SQL must not run'); },
      telegram() { effects.telegram += 1; throw new Error('candidate message must not be sent'); },
      async telegramApi(method, payload) { effects.telegramApi.push({ method, payload }); },
    });
    assert.equal(handled, true);
    assert.equal(effects.sql, 0);
    assert.equal(effects.telegram, 0);
    assert.equal(effects.telegramApi.length, 1);
    assert.equal(effects.telegramApi[0].method, 'answerCallbackQuery');
    assert.equal(effects.telegramApi[0].payload.show_alert, true);
    assert.match(effects.telegramApi[0].payload.text, /недоступно/i);
  }
});

test('090 keeps every maintained operator surface synchronized', () => {
  for (const path of ['../../operator.js', '../../cloudflare-worker/public/operator.js', '../public/operator.js']) {
    const source = read(path);
    assert.doesNotMatch(source, /sat-0600|Сб 06:00/);
    for (const [slotId, label] of Object.entries({
      'mon-0800':'Пн 08:00','tue-0800':'Вт 08:00','wed-0800':'Ср 08:00','thu-1800':'Чт 18:00','fri-1800':'Пт 18:00',
    })) {
      assert.match(source, new RegExp(`${slotId}.*${label}`));
    }
  }
});
