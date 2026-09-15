import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOfflineTestDate, resolveOfflineEvent, matchOfflineCandidate, shouldPublishOfflineBrief, renderOfflineBrief } from '../lib/offline-photo-batching.js';

test('late uploads retain the handwritten test date and separate cities', () => {
  assert.equal(parseOfflineTestDate('14.09.2026'), '2026-09-14');
  assert.equal(parseOfflineTestDate('31.02.2026'), null);
  const minsk = resolveOfflineEvent({ photoDate: '14.09.2026', photoCity: 'Минск', candidateEventDate: '2026-09-14', candidateEventCity: 'Минск' });
  const chelyabinsk = resolveOfflineEvent({ photoDate: '14.09.2026', photoCity: 'Челябинск' });
  assert.equal(minsk.key, '2026-09-14|Минск');
  assert.equal(chelyabinsk.key, '2026-09-14|Челябинск');
  assert.equal(resolveOfflineEvent({ photoDate: '14.09.2026', candidateEventDate: '15.09.2026', photoCity: 'Минск' }), null);
});

test('phone and handwritten full name identify only one matching candidate', () => {
  const candidates = [
    { id: 1, fullName: 'Петькова Алеся Александровна', phone: '+375 (29) 123-45-67' },
    { id: 2, fullName: 'Петькова Алёна Сергеевна', phone: '+375 (29) 555-44-33' }
  ];
  assert.equal(matchOfflineCandidate({ handwrittenName: 'Петькова Алеся Александровна', handwrittenPhone: '375291234567', candidates }).id, 1);
  assert.equal(matchOfflineCandidate({ handwrittenName: 'Петькова Алеся', candidates }), null);
  assert.equal(matchOfflineCandidate({ handwrittenName: 'Петькова Алеся Александровна', handwrittenPhone: '375295554433', candidates }), null);
});

test('quiet window closes a batch without waiting for confirmed no-shows', () => {
  assert.equal(shouldPublishOfflineBrief({ latestPhotoAt: '2026-09-15T16:00:00+03:00', now: '2026-09-15T16:45:00+03:00' }), false);
  assert.equal(shouldPublishOfflineBrief({ latestPhotoAt: '2026-09-15T16:00:00+03:00', now: '2026-09-15T17:01:00+03:00' }), true);
  assert.equal(shouldPublishOfflineBrief({ latestPhotoAt: '2026-09-15T20:50:00+03:00', now: '2026-09-15T21:05:00+03:00' }), true);
});

test('forwardable brief uses direct folder links and one spacer between name/link pairs', () => {
  const text = renderOfflineBrief({ date: '2026-09-14', city: 'Минск', candidates: [
    { name: 'Лось Алексей', folderUrl: 'https://drive.google.com/drive/folders/1PN6WTy6xlWg_qLIvlV7wquDFco8QbogH' },
    { name: 'Афанасенко Екатерина', folderUrl: 'https://drive.google.com/drive/folders/1hAzcIEWkZm1bAhvEvZonSJIqDw7ujTuZ' }
  ] });
  assert.match(text, /14\.09\.2026, Минск/);
  assert.match(text, /Афанасенко Екатерина\nhttps:\/\/drive\.google\.com\/drive\/folders\/[^\n]+\n\u00a0\nЛось Алексей\nhttps:/);
});
