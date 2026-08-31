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
  [item.name].concat(item.replaceNames || []).forEach(function(name) {
    const previous = folder.getFilesByName(name);
    while (previous.hasNext()) previous.next().setTrashed(true);
  });
  if (item.nativeType === 'document') {
    const source = Utilities.newBlob(bytes).getDataAsString('UTF-8');
    const text = source
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(h1|h2|h3|p|article|div)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    const document = DocumentApp.create(item.name);
    document.getBody().setText(text);
    document.saveAndClose();
    const file = DriveApp.getFileById(document.getId());
    file.moveTo(folder);
    return { id: file.getId(), name: file.getName(), url: file.getUrl(), mimeType: file.getMimeType() };
  }
  if (item.nativeType === 'spreadsheet') {
    const source = Utilities.newBlob(bytes).getDataAsString('UTF-8').replace(/^\uFEFF/, '');
    const values = Utilities.parseCsv(source, ';');
    const spreadsheet = SpreadsheetApp.create(item.name);
    const sheet = spreadsheet.getSheets()[0];
    if (values.length && values[0].length) sheet.getRange(1, 1, values.length, values[0].length).setValues(values);
    sheet.setFrozenRows(Math.min(7, values.length));
    if (values[0] && values[0].length) sheet.autoResizeColumns(1, values[0].length);
    SpreadsheetApp.flush();
    const file = DriveApp.getFileById(spreadsheet.getId());
    file.moveTo(folder);
    return { id: file.getId(), name: file.getName(), url: file.getUrl(), mimeType: file.getMimeType() };
  }
  const blob = Utilities.newBlob(bytes, item.mimeType || 'application/octet-stream', item.name);
  const file = folder.createFile(blob);
  return { id: file.getId(), name: file.getName(), url: file.getUrl(), mimeType: file.getMimeType() };
}

function authorizeNativeFiles() {
  const document = DocumentApp.create('Проверка разрешения Академии Стратег');
  DriveApp.getFileById(document.getId()).setTrashed(true);
  const spreadsheet = SpreadsheetApp.create('Проверка разрешения Академии Стратег');
  DriveApp.getFileById(spreadsheet.getId()).setTrashed(true);
}

// 047: approved template; never replace or clear an existing interview file.
function saveInterview047_(folder, item) {
  if (!item || item.version !== 47 || !item.candidateId) throw new Error('Invalid interview payload');
  const templateId = '1BqxBeDOmNBzil3IECT-DRXGPhF4mbQDUQgZmnLCfzrs';
  if (item.templateId !== templateId) throw new Error('Unknown interview template');
  const matches = [], files = folder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    if (file.getMimeType() === MimeType.GOOGLE_SHEETS && file.getName().indexOf('Интервью на продуктивность — ') === 0) matches.push(file);
  }
  if (matches.length > 1) throw new Error('В папке несколько бланков интервью — автоматическая перезапись запрещена');
  const file = matches[0] || DriveApp.getFileById(templateId).makeCopy(item.name, folder);
  const book = SpreadsheetApp.openById(file.getId());
  if (matches.length && book.getSheetByName('Итог').getRange('B48').getValue() !== 'Дополнительные сведения кандидата • Анкета 2') {
    return {id:file.getId(),name:file.getName(),url:file.getUrl(),mimeType:file.getMimeType(),legacyTemplatePreserved:true};
  }
  const allowed = {
    'Начало': {F6:1,F7:1,F13:1,B14:2,B35:2,B38:3,F76:1},
    'Итог': {B14:2,F16:1,F49:3,F52:3,F55:2,F57:1,F58:1,F59:1,F60:5},
    'Работа 1': {F7:1,F8:1,F9:1,F10:1,F11:1,F12:1,F13:1},
    'Работа 2': {F7:1,F8:1,F9:1,F10:1,F11:1,F12:1,F13:1},
    'Работа 3': {F7:1,F8:1,F9:1,F10:1,F11:1,F12:1,F13:1}
  };
  const cells = (item.cells || []).concat([{sheet:'Начало',cell:'F13',text:folderUrl_(folder),rows:1,source:'Google Drive'}]);
  const preserved = [];
  cells.forEach(function(input) {
    if (!allowed[input.sheet] || allowed[input.sheet][input.cell] !== input.rows) throw new Error('Unapproved interview cell');
    const sheet = book.getSheetByName(input.sheet);
    if (!sheet) throw new Error('Interview template sheet missing: ' + input.sheet);
    const cell = sheet.getRange(input.cell);
    // Empty-only writes preserve notes, formulas, interviewer answers and previous imports.
    if (cell.getFormula() || cell.getValue() !== '') { preserved.push(input.sheet + '!' + input.cell); return; }
    const value = String(input.text == null ? '' : input.text);
    if (!value) return;
    cell.setRichTextValue(SpreadsheetApp.newRichTextValue().setText(value).build());
    cell.setNote('Источник: ' + input.source + '; кандидат ID ' + item.candidateId + '. Автозаполнение 047. Ручные ответы не перезаписываются.');
    cell.setWrap(true);
    const width = input.cell.charAt(0) === 'B' ? 95 : 60;
    const lines = value.split('\n').reduce(function(total, line) { return total + Math.max(1, Math.ceil(line.length / width)); }, 0);
    const height = Math.max(30, Math.ceil((lines * 18 + 16) / input.rows));
    for (let row = cell.getRow(); row < cell.getRow() + input.rows; row++) {
      if (sheet.getRowHeight(row) < height) sheet.setRowHeight(row, height);
    }
  });
  SpreadsheetApp.flush();
  return {id:file.getId(),name:file.getName(),url:file.getUrl(),mimeType:file.getMimeType(),preservedCells:preserved};
}

function doPost(event) {
  let lock = null;
  try {
    const payload = JSON.parse(event.postData && event.postData.contents || '{}');
    const expected = PropertiesService.getScriptProperties().getProperty('BRIDGE_SECRET');
    if (!expected || payload.secret !== expected) return json_({ ok: false, error: 'Unauthorized' });
    if (payload.action === 'capabilities') return json_({ok:true,interviewSheet047:true});
    if (!payload.parentFolderId || !payload.folderName) return json_({ ok: false, error: 'Folder is not specified' });
    lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) throw new Error('Drive занят другим сохранением; повторите это событие');
    const folder = payload.existingFolderId ? DriveApp.getFolderById(payload.existingFolderId) : getFolder_(payload.parentFolderId, payload.folderName);
    const interview = payload.interview ? saveInterview047_(folder, payload.interview) : null;
    const files = (payload.files || []).map(item => saveFile_(folder, item));
    if (interview) files.push(interview);
    return json_({ ok: true, folder: { id: folder.getId(), name: folder.getName(), url: folderUrl_(folder) }, files, interview });
  } catch (error) {
    return json_({ ok: false, error: String(error && error.message || error) });
  } finally {
    if (lock) lock.releaseLock();
  }
}
