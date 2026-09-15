const CHAT_ID = '-1004397133749';
const THREAD_ID = '1071';
const STAGING_FOLDER_ID = '1KCuonU8y5T1CG9dgwS0ev2-I2KSKRL5n';
const TRAINER_ROOT_ID = '1fpKRJQZIdFeqYCVQ6aWfN_4_xuLyMX4D';
const BRIDGE_URL = 'https://script.google.com/macros/s/AKfycbyUI5L871jnAwoExsqOTFbcBL5K37UYv_Z0RzpA3ZuTaE_Ovp69jpgNbZGkK_vkosa6Xg/exec';
const MAX_BRIDGE_BYTES = 8 * 1024 * 1024;

export function isOfflinePhotoMessage(message) {
  return String(message?.chat?.id) === CHAT_ID &&
    String(message?.message_thread_id) === THREAD_ID &&
    Array.isArray(message?.photo) && message.photo.length > 0;
}

export function selectOfflinePhoto(message) {
  const sizes = [...message.photo].filter(photo => photo?.file_id && (!photo.file_size || photo.file_size <= MAX_BRIDGE_BYTES));
  return sizes.sort((a, b) => (b.file_size || b.width * b.height || 0) - (a.file_size || a.width * a.height || 0))[0] || null;
}

export async function stageOfflinePhoto(message, { sql, telegramApi, fetchImpl = fetch, env = process.env }) {
  if (!isOfflinePhotoMessage(message)) return false;
  const photo = selectOfflinePhoto(message);
  if (!photo) throw new Error('No photo size is supported by the 8 MB Drive bridge');
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error('Telegram bot is not configured');
  const secret = env.GOOGLE_DRIVE_BRIDGE_SECRET || env.OPERATOR_ACCESS_KEY;
  if (!secret) throw new Error('Google Drive bridge is not configured');
  const chatId = String(message.chat.id), threadId = String(message.message_thread_id), messageId = String(message.message_id);
  await sql`CREATE TABLE IF NOT EXISTS offline_photo_intake_001 (
    chat_id TEXT NOT NULL, thread_id TEXT NOT NULL, message_id TEXT NOT NULL,
    sender_id TEXT, media_group_id TEXT, file_id TEXT NOT NULL, file_unique_id TEXT,
    state TEXT NOT NULL DEFAULT 'pending', drive_file_id TEXT, drive_file_url TEXT,
    error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(chat_id,message_id))`;
  await sql`ALTER TABLE offline_photo_intake_001 ENABLE ROW LEVEL SECURITY`;
  await sql`INSERT INTO offline_photo_intake_001(chat_id,thread_id,message_id,sender_id,media_group_id,file_id,file_unique_id)
    VALUES(${chatId},${threadId},${messageId},${String(message.from?.id || '')},${String(message.media_group_id || '')},${photo.file_id},${photo.file_unique_id || ''})
    ON CONFLICT(chat_id,message_id) DO NOTHING`;
  const existing = (await sql`SELECT state FROM offline_photo_intake_001 WHERE chat_id=${chatId} AND message_id=${messageId}`).rows[0];
  if (existing?.state === 'staged') return true;
  try {
    const file = await telegramApi('getFile', { file_id: photo.file_id });
    if (!file?.file_path) throw new Error('Telegram did not return a file path');
    const source = await fetchImpl(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`, { signal: AbortSignal.timeout(20000) });
    if (!source.ok) throw new Error(`Telegram file download failed (${source.status})`);
    const bytes = Buffer.from(await source.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_BRIDGE_BYTES) throw new Error('Photo size is outside the 8 MB Drive bridge limit');
    const name = `telegram-${chatId.replace(/[^0-9]/g, '')}-${messageId}.jpg`;
    const bridge = await fetchImpl(env.GOOGLE_DRIVE_BRIDGE_URL || BRIDGE_URL, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(25000),
      body: JSON.stringify({ secret, parentFolderId: TRAINER_ROOT_ID, folderName: 'offline test',
        existingFolderId: STAGING_FOLDER_ID, files: [{ name, mimeType: 'image/jpeg', data: bytes.toString('base64') }] })
    });
    const result = await bridge.json().catch(() => null);
    if (!bridge.ok || !result?.ok || !result.files?.[0]?.id) throw new Error(result?.error || 'Google Drive did not confirm the staged photo');
    await sql`UPDATE offline_photo_intake_001 SET state='staged',drive_file_id=${String(result.files[0].id)},
      drive_file_url=${String(result.files[0].url || '')},error=NULL,updated_at=NOW()
      WHERE chat_id=${chatId} AND message_id=${messageId}`;
    return true;
  } catch (error) {
    await sql`UPDATE offline_photo_intake_001 SET state='attention',error=${String(error.message || error).slice(0,300)},updated_at=NOW()
      WHERE chat_id=${chatId} AND message_id=${messageId}`;
    throw error;
  }
}
