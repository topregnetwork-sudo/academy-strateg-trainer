import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../lib/owner-city-campaign-089.js', import.meta.url), 'utf8');
const telegram = fs.readFileSync(new URL('../api/telegram.js', import.meta.url), 'utf8');
test('uses two independent city campaigns without a chooser', () => {
  assert.match(source, /trainer_owner_minsk_20260923_089/);
  assert.match(source, /trainer_owner_chelyabinsk_20260923_089/);
  assert.match(source, /trainer_batman_minsk_morning_20260923_089/);
  assert.match(source, /trainer_batman_chelyabinsk_morning_20260923_089/);
  assert.doesNotMatch(source, /Выберите город/);
});
test('owner route is isolated and does not update candidate status', () => {
  assert.match(source, /topregstrateg/);
  assert.match(source, /owner_city_campaign_entries089/);
  assert.doesNotMatch(source, /UPDATE candidates/i);
  assert.doesNotMatch(source, /INSERT INTO candidates/i);
});
test('keeps legacy start fallback and dispatches isolated handlers', () => {
  assert.match(telegram, /Вернитесь на страницу вакансии Академии Стратег/);
  assert.match(telegram, /handleOwnerCityCampaignStart/);
  assert.match(telegram, /handleOwnerCityCampaignCallback/);
});
