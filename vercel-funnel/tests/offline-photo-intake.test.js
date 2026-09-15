import test from 'node:test';
import assert from 'node:assert/strict';
import { isOfflinePhotoMessage, selectOfflinePhoto, stageOfflinePhoto } from '../lib/offline-photo-intake.js';

const base = { chat: { id: -1004397133749, type: 'supergroup' }, message_thread_id: 1071,
  message_id: 1400, from: { id: 1234 }, photo: [{ file_id: 'small', file_unique_id: 'u1', file_size: 20 },
    { file_id: 'large', file_unique_id: 'u2', file_size: 100 }] };

test('accepts photo from any human sender in only the target topic', () => {
  assert.equal(isOfflinePhotoMessage(base), true);
  assert.equal(isOfflinePhotoMessage({ ...base, from: { id: 9876 } }), true);
  assert.equal(isOfflinePhotoMessage({ ...base, message_thread_id: 619 }), false);
  assert.equal(isOfflinePhotoMessage({ ...base, chat: { id: -1004482521303 } }), false);
  assert.equal(isOfflinePhotoMessage({ ...base, photo: undefined }), false);
  assert.equal(selectOfflinePhoto(base).file_id, 'large');
});

test('stages once through the existing Drive bridge and keeps sender provenance', async () => {
  const queries = [], calls = [];
  let state = 'pending';
  const sql = async (strings, ...values) => {
    const query = strings.join('?'); queries.push({ query, values });
    if (query.startsWith('SELECT state')) return { rows: [{ state }] };
    if (query.startsWith('UPDATE offline_photo_intake_001 SET state')) state = 'staged';
    return { rows: [] };
  };
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/file/bot')) return { ok: true, arrayBuffer: async () => Uint8Array.from(Buffer.from('photo')).buffer };
    return { ok: true, json: async () => ({ ok: true, files: [{ id: 'drive-id', url: 'https://drive.google.com/file/d/drive-id' }] }) };
  };
  const telegramApi = async (method, payload) => { assert.equal(method, 'getFile'); assert.equal(payload.file_id, 'large'); return { file_path: 'photos/x.jpg' }; };
  const deps = { sql, telegramApi, fetchImpl, env: { TELEGRAM_BOT_TOKEN: 'test-token', GOOGLE_DRIVE_BRIDGE_SECRET: 'test-secret' } };
  assert.equal(await stageOfflinePhoto(base, deps), true);
  assert.equal(calls.length, 2);
  const payload = JSON.parse(calls[1].options.body);
  assert.equal(payload.existingFolderId, '1KCuonU8y5T1CG9dgwS0ev2-I2KSKRL5n');
  assert.equal(payload.files[0].name, 'telegram-1004397133749-1400.jpg');
  assert.ok(queries.some(q => q.query.startsWith('INSERT INTO offline_photo_intake_001') && q.values.includes('1234')));
  assert.equal(await stageOfflinePhoto(base, deps), true);
  assert.equal(calls.length, 2);
});
