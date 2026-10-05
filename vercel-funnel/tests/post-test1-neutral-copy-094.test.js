import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const progressionSource = fs.readFileSync(new URL('../api/progression.js', import.meta.url), 'utf8');
const rollingSource = fs.readFileSync(new URL('../lib/rolling-productivity-057.js', import.meta.url), 'utf8');

function candidateBody(source, pattern, label) {
  const match = source.match(pattern);
  assert.ok(match, `${label} candidate-facing body not found`);
  return match[1];
}

test('both candidate-facing post-Test1 bodies use neutral interview wording', () => {
  const completion = candidateBody(progressionSource, /const TEST_COMPLETED = '([^']+)'/, 'completion');
  const invitation = candidateBody(rollingSource, /const config=\{action:'invite',[\s\S]*?text:'([^']+)'/, 'invitation');

  assert.match(completion, /Следующий этап — ещё одно интервью\./);
  assert.match(invitation, /Приглашаем вас на следующее интервью в Академии Стратег\./);
  for (const body of [completion, invitation]) assert.doesNotMatch(body, /продуктивност/i);
});

test('internal productivity terminology remains available', () => {
  assert.match(rollingSource, /Кандидат не готов к интервью на продуктивност/);
});
