import test from 'node:test';
import assert from 'node:assert/strict';
import { latestOutgoingMessage083 } from '../lib/unprocessed-backlog-query-083.js';

function recorder(rows = []) {
  const calls = [];
  const sql = async (strings, ...values) => {
    const text = strings.reduce((result, part, index) => result + part + (index < values.length ? `$${index + 1}` : ''), '');
    calls.push({ text, values });
    return { rows };
  };
  return { sql, calls };
}

test('083 latest outgoing query binds a single message kind as JSON, not a SQL fragment', async () => {
  const { sql, calls } = recorder([{ kind: 'reminder', text: 'old' }]);
  const found = await latestOutgoingMessage083(sql, '7', ['reminder']);
  assert.deepEqual(found, { kind: 'reminder', text: 'old' });
  assert.match(calls[0].text, /kind IN \(SELECT jsonb_array_elements_text\(\$2::jsonb\)\)/);
  assert.deepEqual(calls[0].values, [7, '["reminder"]']);
});

test('083 latest outgoing query supports several kinds and returns null when there are no matches', async () => {
  const { sql, calls } = recorder([]);
  assert.equal(await latestOutgoingMessage083(sql, 7, ['reminder', 'attention']), null);
  assert.deepEqual(calls[0].values, [7, '["reminder","attention"]']);
});

test('083 rejects non-string kind values before issuing SQL', async () => {
  const { sql, calls } = recorder();
  await assert.rejects(latestOutgoingMessage083(sql, 7, ['reminder', 2]), TypeError);
  assert.equal(calls.length, 0);
});
