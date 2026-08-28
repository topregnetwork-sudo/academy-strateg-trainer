/**
 * Академия Стратег — защищённый мост Vercel → Google Drive.
 *
 * Развернуть как веб-приложение от имени владельца Drive.
 * Секрет задаётся в Script Properties:
 *   BRIDGE_SECRET = тот же секрет, что GOOGLE_DRIVE_BRIDGE_SECRET в Vercel.
 */
const MAX_FILE_BYTES = 8 * 1024 * 1024;

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function folderUrl_(folder) {
  return 'https://drive.google.com/drive/folders/' + folder.getId();
}

function getFolder_(parentId, name) {
  const parent = DriveApp.getFolderById(parentId);
  const matches = parent.getFoldersByName(name);
  return matches.hasNext() ? matches.next() : parent.createFolder(name);
}

function saveFile_(folder, item) {
  if (!item || !item.name || !item.data) throw new Error('Некорректный файл');
  const bytes = Utilities.base64Decode(String(item.data));
  if (bytes.length > MAX_FILE_BYTES) throw new Error('Файл больше 8 МБ');
  const previous = folder.getFilesByName(item.name);
  while (previous.hasNext()) previous.next().setTrashed(true);
  const blob = Utilities.newBlob(bytes, item.mimeType || 'application/octet-stream', item.name);
  const file = folder.createFile(blob);
  return { id: file.getId(), name: file.getName(), url: file.getUrl(), mimeType: file.getMimeType() };
}

function doPost(event) {
  try {
    const payload = JSON.parse(event.postData && event.postData.contents || '{}');
    const expected = PropertiesService.getScriptProperties().getProperty('BRIDGE_SECRET');
    if (!expected || payload.secret !== expected) return json_({ ok: false, error: 'Unauthorized' });
    if (!payload.parentFolderId || !payload.folderName) return json_({ ok: false, error: 'Folder is not specified' });

    const folder = getFolder_(payload.parentFolderId, payload.folderName);
    const files = (payload.files || []).map(item => saveFile_(folder, item));
    return json_({ ok: true, folder: { id: folder.getId(), name: folder.getName(), url: folderUrl_(folder) }, files });
  } catch (error) {
    return json_({ ok: false, error: String(error && error.message || error) });
  }
}
