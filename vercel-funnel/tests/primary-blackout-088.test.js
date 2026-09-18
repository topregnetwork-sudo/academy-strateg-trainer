import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateBlackoutMessage,renderPrimaryBlackoutPreview} from '../lib/primary-blackout-088.js';

const candidate = {
  id: 77,
  first_name: 'Анна',
  last_name: 'Иванова',
  username: 'anna',
  status: 'interview_booked',
  slot_id: 'fri-1800',
  interview_at: '2026-09-18T15:00:00.000Z',
  reminded_30m: false,
  no_show_followup_sent: false,
};

test('renders the exact candidate message with Moscow time and preserved-history wording', () => {
  assert.equal(candidateBlackoutMessage(candidate), 'Здравствуйте, Анна! Первичные собеседования 18 и 19 сентября проводиться не будут. Ваша прежняя запись на 18.09.2026 в 18:00 МСК сохранена в истории, но встреча в это время не состоится. Пожалуйста, выберите другое доступное время начиная с понедельника, 21 сентября.');
});

test('preview is explicitly read-only and includes stable identifiers', () => {
  const text = renderPrimaryBlackoutPreview({candidates:[candidate],tasks:[{id:'task-1'}],readAt:'2026-09-18T08:00:00.000Z'});
  assert.match(text,/ID 77/);
  assert.match(text,/fri-1800/);
  assert.match(text,/Кандидатов: <b>1<\/b>/);
  assert.match(text,/только чтение/);
  assert.match(text,/не изменены/);
});
