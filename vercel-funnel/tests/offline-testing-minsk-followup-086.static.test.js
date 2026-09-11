import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../lib/offline-testing-minsk-20260914-followup.js', import.meta.url), 'utf8');

test('Minsk follow-up is a two-person dated campaign with idempotent response routes', () => {
  assert.match(source, /RECIPIENT_IDS = Object\.freeze\(\[216, 242\]\)/);
  assert.match(source, /14 сентября 2026 года/);
  assert.match(source, /Время сбора:<\/b> \$\{ASSEMBLY_TIME\}/);
  assert.match(source, /offline_test_minsk_20260914_followup_attend/);
  assert.match(source, /offline_test_minsk_20260914_followup_decline/);
  assert.match(source, /AND state='sent' AND response IS NULL/);
  assert.match(source, /status='offline_testing'.*status='productivity_passed'/s);
  assert.doesNotMatch(source, /RECIPIENT_IDS = Object\.freeze\([^\)]*45/);
  assert.doesNotMatch(source, /RECIPIENT_IDS = Object\.freeze\([^\)]*Max/);
});
