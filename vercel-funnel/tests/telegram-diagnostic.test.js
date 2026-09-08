import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeWebhookInfo, summarizeDeliveryStates } from '../lib/brief-delivery.js';

test('brief delivery summary distinguishes sent, attention, uncertain and stale sending', () => {
  const now = new Date('2026-09-08T12:00:00.000Z');
  const summary = summarizeDeliveryStates([
    { state: 'sent', telegram_message_id: '1' },
    { state: 'attention', last_error: '403' },
    { state: 'uncertain', last_error: 'timeout' },
    { state: 'sending', last_attempt_at: '2026-09-08T11:00:00.000Z' },
    { state: 'queued' }
  ], now);
  assert.deepEqual(summary.counts, { sending: 0, sent: 1, attention: 1, uncertain: 1, queued: 1, stale_sending: 1, other: 0 });
  assert.equal(summary.errorCount, 2);
  assert.equal(summary.total, 5);
});

test('webhook diagnostic removes sensitive Telegram fields', () => {
  const result = sanitizeWebhookInfo({ url: 'https://example.invalid/api/telegram', pending_update_count: 3, last_error_message: 'bad token', last_error_date: 1788868800, secret_token: 'never-return' });
  assert.deepEqual(result, {
    api: 'ok',
    hasWebhook: true,
    pendingUpdateCount: 3,
    hasLastError: true,
    lastErrorDate: '2026-09-08T12:00:00.000Z'
  });
  assert.equal('secret_token' in result, false);
});
