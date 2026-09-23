import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../lib/owner-city-campaign-089.js', import.meta.url), 'utf8');
const telegram = fs.readFileSync(new URL('../api/telegram.js', import.meta.url), 'utf8');
test('two city campaigns contain no chooser or questionnaire', () => {
  assert.match(source, /trainer_owner_minsk_20260923_089/);
  assert.match(source, /trainer_owner_chelyabinsk_20260923_089/);
  assert.doesNotMatch(source, /Ответить на 2 коротких вопроса|вопрос 1 из 2|вопрос 2 из 2/);
});
test('exact keyword and city prices are preserved', () => {
  assert.match(source, /const KEYWORD = '28 сентября'/);
  assert.match(source, /invitedOwnerPrice: '20 рублей'/);
  assert.match(source, /invitedOwnerPrice: 'PENDING_OWNER'/);
});
test('old questions are stopped and candidate statuses untouched', () => {
  assert.match(source, /superseded_no_questionnaire/);
  assert.match(source, /editMessageReplyMarkup/);
  assert.doesNotMatch(source, /UPDATE candidates|INSERT INTO candidates/i);
  assert.match(telegram, /handleOwnerCityKeyword/);
  assert.match(telegram, /Вернитесь на страницу вакансии Академии Стратег/);
});
