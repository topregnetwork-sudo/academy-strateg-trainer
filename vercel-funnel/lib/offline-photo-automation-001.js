import crypto from 'node:crypto';
import { sql, telegramApi } from '../api/_core.js';
import { createTask } from './funnel-store.js';
import { identifyOfflineCandidate, offlineCityCandidates, offlineCityEvidence, offlineDateCandidates, offlineDateEvidence } from './offline-photo-recognition.js';
import { normalizeOfflineCity, renderOfflineBrief, resolveOfflineEvent, shouldPublishOfflineBrief } from './offline-photo-batching.js';
import {offlineTaskId} from './offline-photo-task-id.js';

const CHAT_ID = '-1004397133749';
const THREAD_ID = '1071';
const BRIDGE_URL = 'https://script.google.com/macros/s/AKfycbyUI5L871jnAwoExsqOTFbcBL5K37UYv_Z0RzpA3ZuTaE_Ovp69jpgNbZGkK_vkosa6Xg/exec';
const dbDate = value => value instanceof Date ? value.toISOString().slice(0,10) : String(value || '').slice(0,10);

async function bridgeAction(action, payload) {
  const secret = process.env.GOOGLE_DRIVE_BRIDGE_SECRET || process.env.OPERATOR_ACCESS_KEY;
  if (!secret) throw new Error('Google Drive bridge is not configured');
  const response = await fetch(process.env.GOOGLE_DRIVE_BRIDGE_URL || BRIDGE_URL, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(40000),
    body: JSON.stringify({secret, action, ...payload})
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) throw new Error(result?.error || `Drive ${action} failed`);
  return result;
}

export async function ensureOfflineAutomationStore() {
  await sql`ALTER TABLE offline_photo_intake_001 ADD COLUMN IF NOT EXISTS candidate_id BIGINT`;
  await sql`ALTER TABLE offline_photo_intake_001 ADD COLUMN IF NOT EXISTS test_date DATE`;
  await sql`ALTER TABLE offline_photo_intake_001 ADD COLUMN IF NOT EXISTS test_city TEXT`;
  await sql`ALTER TABLE offline_photo_intake_001 ADD COLUMN IF NOT EXISTS ocr_date DATE`;
  await sql`ALTER TABLE offline_photo_intake_001 ADD COLUMN IF NOT EXISTS ocr_city TEXT`;
  await sql`ALTER TABLE offline_photo_intake_001 ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ`;
  await sql`CREATE TABLE IF NOT EXISTS offline_photo_briefs_001 (
    test_date DATE NOT NULL, city TEXT NOT NULL, telegram_message_id TEXT,
    state TEXT NOT NULL DEFAULT 'pending', text_hash TEXT, error TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(test_date,city))`;
  await sql`ALTER TABLE offline_photo_briefs_001 ENABLE ROW LEVEL SECURITY`;
}

async function roster() {
  return (await sql`SELECT c.id,c.city,c.status,COALESCE(NULLIF(a.full_name,''),NULLIF(CONCAT_WS(' ',c.first_name,c.last_name),'')) AS full_name,
    COALESCE(NULLIF(a.phone,''),c.phone) AS phone,d.folder_id,d.folder_url
    FROM candidates c
    LEFT JOIN LATERAL(SELECT full_name,phone FROM applications WHERE candidate_id=c.id ORDER BY created_at DESC,id DESC LIMIT 1) a ON TRUE
    LEFT JOIN candidate_drive d ON d.candidate_id=c.id
    WHERE c.consent=true AND d.folder_id IS NOT NULL`).rows.map(row => ({
      id: row.id, city: row.city, status: row.status, fullName: row.full_name,
      phone: row.phone, folderId: row.folder_id, folderUrl: row.folder_url
    }));
}

async function scheduleBrief(messageId, event) {
  const dueAt = new Date(Date.now() + 60 * 60000);
  await createTask('offline_photo_brief_001', {date:event.date,city:event.city}, dueAt,
    offlineTaskId('brief', messageId));
}

async function finishAssignment(row, candidate, event) {
  if (!candidate.folderId || !candidate.folderUrl) throw new Error('Verified candidate folder is missing');
  await sql`UPDATE offline_photo_intake_001 SET state='assignment_pending',candidate_id=${candidate.id},
    test_date=${event.date}::date,test_city=${event.city},error=NULL,updated_at=NOW()
    WHERE chat_id=${CHAT_ID} AND message_id=${row.message_id}`;
  const result = await bridgeAction('assign_offline_photo_001', {
    fileId: row.drive_file_id, destinationFolderId: candidate.folderId
  });
  if (result.folderId !== candidate.folderId || result.fileId !== row.drive_file_id)
    throw new Error('Drive assignment readback did not match the verified candidate folder');
  await sql`UPDATE offline_photo_intake_001 SET state='assigned',assigned_at=NOW(),error=NULL,updated_at=NOW()
    WHERE chat_id=${CHAT_ID} AND message_id=${row.message_id}`;
  await scheduleBrief(row.message_id, event);
  return {done:true,assigned:true};
}

export async function runOfflinePhotoProcess001(messageId) {
  await ensureOfflineAutomationStore();
  const row = (await sql`SELECT * FROM offline_photo_intake_001 WHERE chat_id=${CHAT_ID} AND thread_id=${THREAD_ID}
    AND message_id=${String(messageId)} LIMIT 1`).rows[0];
  if (!row) return {done:true};
  if (row.state === 'assigned') {
    const event = resolveOfflineEvent({photoDate:dbDate(row.test_date),photoCity:row.test_city});
    if (event) await scheduleBrief(row.message_id,event);
    return {done:true};
  }
  if (!row.drive_file_id) throw new Error('Staged Drive photo is not available');
  const candidates = await roster();
  if (row.state === 'assignment_pending') {
    const candidate = candidates.find(item => String(item.id) === String(row.candidate_id));
    const event = resolveOfflineEvent({photoDate:dbDate(row.test_date),photoCity:row.test_city,candidateEventCity:candidate?.city});
    if (!candidate || !event) throw new Error('Pending assignment lost verified candidate or event');
    return finishAssignment(row, candidate, event);
  }
  const claimed = (await sql`UPDATE offline_photo_intake_001 SET state='recognizing',updated_at=NOW()
    WHERE chat_id=${CHAT_ID} AND message_id=${String(messageId)}
    AND (state='staged' OR (state='recognizing' AND updated_at<NOW()-INTERVAL '2 minutes')) RETURNING message_id`).rows[0];
  if (!claimed) return {done:true};
  try {
    const result = await bridgeAction('ocr_offline_photo_001', {fileId:row.drive_file_id});
    const text = String(result.text || '');
    const date = offlineDateEvidence(text), city = offlineCityEvidence(text);
    const candidate = identifyOfflineCandidate(text, candidates);
    await sql`UPDATE offline_photo_intake_001 SET ocr_date=${date}::date,ocr_city=${city},updated_at=NOW()
      WHERE chat_id=${CHAT_ID} AND message_id=${String(messageId)}`;
    if (offlineDateCandidates(text).length > 1 || offlineCityCandidates(text).length > 1) {
      await sql`UPDATE offline_photo_intake_001 SET state='attention',error='Conflicting handwritten date or city',updated_at=NOW()
        WHERE chat_id=${CHAT_ID} AND message_id=${String(messageId)}`;
      return {done:true,unmatched:true};
    }
    if (!candidate || !date) {
      await sql`UPDATE offline_photo_intake_001 SET state='recognized_unmatched',error=${!candidate?'No unique handwritten candidate match':'No unique actual test date'},updated_at=NOW()
        WHERE chat_id=${CHAT_ID} AND message_id=${String(messageId)}`;
      return {done:true,unmatched:true};
    }
    const event = resolveOfflineEvent({photoDate:date,photoCity:city,candidateEventCity:candidate.city});
    if (!event) {
      await sql`UPDATE offline_photo_intake_001 SET state='recognized_unmatched',error='City evidence conflicts with candidate record',updated_at=NOW()
        WHERE chat_id=${CHAT_ID} AND message_id=${String(messageId)}`;
      return {done:true,unmatched:true};
    }
    return finishAssignment(row, candidate, event);
  } catch (error) {
    await sql`UPDATE offline_photo_intake_001 SET state='staged',error=${String(error.message || error).slice(0,300)},updated_at=NOW()
      WHERE chat_id=${CHAT_ID} AND message_id=${String(messageId)} AND state='recognizing'`;
    throw error;
  }
}

export async function runOfflinePhotoAlbum001(mediaGroupId, senderId) {
  if (!mediaGroupId) return {done:true};
  await ensureOfflineAutomationStore();
  const rows = (await sql`SELECT message_id,drive_file_id,state,candidate_id,test_date,test_city,ocr_date,ocr_city
    FROM offline_photo_intake_001 WHERE chat_id=${CHAT_ID} AND thread_id=${THREAD_ID}
    AND media_group_id=${String(mediaGroupId)} AND sender_id=${String(senderId)} ORDER BY message_id`).rows;
  const anchors = rows.filter(row => row.state === 'assigned' || row.state === 'assignment_pending');
  const candidateIds = [...new Set(anchors.map(row => String(row.candidate_id)))];
  const eventKeys = [...new Set(anchors.map(row => `${dbDate(row.test_date)}|${row.test_city}`))];
  if (candidateIds.length !== 1 || eventKeys.length !== 1) return {done:true,unmatched:true};
  const candidates = await roster(), candidate = candidates.find(item => String(item.id) === candidateIds[0]);
  const anchor = anchors[0], event = resolveOfflineEvent({photoDate:dbDate(anchor.test_date),photoCity:anchor.test_city,candidateEventCity:candidate?.city});
  if (!candidate || !event) return {done:true,unmatched:true};
  let assigned = 0;
  for (const row of rows.filter(item => item.state === 'recognized_unmatched')) {
    if ((row.ocr_date && dbDate(row.ocr_date) !== event.date) ||
      (row.ocr_city && normalizeOfflineCity(row.ocr_city) !== event.city)) continue;
    await finishAssignment(row, candidate, event);
    assigned++;
  }
  return {done:true,assigned};
}

export async function runOfflinePhotoBrief001(date, city) {
  await ensureOfflineAutomationStore();
  const event = resolveOfflineEvent({photoDate:date,photoCity:city});
  if (!event) return {done:true};
  const latest = (await sql`SELECT MAX(created_at) AS latest FROM offline_photo_intake_001
    WHERE chat_id=${CHAT_ID} AND test_date=${event.date}::date AND test_city=${event.city}`).rows[0]?.latest;
  if (!shouldPublishOfflineBrief({latestPhotoAt:latest})) return {done:true,quietWindow:true};
  const rows = (await sql`SELECT DISTINCT p.candidate_id,d.folder_url,
    COALESCE(NULLIF(a.full_name,''),NULLIF(CONCAT_WS(' ',c.first_name,c.last_name),'')) AS name
    FROM offline_photo_intake_001 p JOIN candidates c ON c.id=p.candidate_id
    JOIN candidate_drive d ON d.candidate_id=c.id
    LEFT JOIN LATERAL(SELECT full_name FROM applications WHERE candidate_id=c.id ORDER BY created_at DESC,id DESC LIMIT 1) a ON TRUE
    WHERE p.chat_id=${CHAT_ID} AND p.test_date=${event.date}::date AND p.test_city=${event.city}
    AND p.state='assigned' AND d.folder_url IS NOT NULL`).rows;
  if (!rows.length) return {done:true};
  const text = renderOfflineBrief({date:event.date,city:event.city,candidates:rows.map(row => ({name:row.name,folderUrl:row.folder_url}))});
  const hash = crypto.createHash('sha256').update(text).digest('hex');
  await sql`INSERT INTO offline_photo_briefs_001(test_date,city) VALUES(${event.date}::date,${event.city}) ON CONFLICT DO NOTHING`;
  const brief = (await sql`SELECT * FROM offline_photo_briefs_001 WHERE test_date=${event.date}::date AND city=${event.city}`).rows[0];
  if (brief?.text_hash === hash && brief?.telegram_message_id) return {done:true,unchanged:true};
  if (brief?.telegram_message_id) {
    try {
      await telegramApi('editMessageText', {chat_id:CHAT_ID,message_id:Number(brief.telegram_message_id),text,
        disable_web_page_preview:true});
    } catch (error) { if (!/message is not modified/i.test(error.message || '')) throw error; }
    await sql`UPDATE offline_photo_briefs_001 SET state='published',text_hash=${hash},error=NULL,updated_at=NOW()
      WHERE test_date=${event.date}::date AND city=${event.city}`;
    return {done:true,edited:true,messageId:brief.telegram_message_id};
  }
  const claim = (await sql`UPDATE offline_photo_briefs_001 SET state='sending',updated_at=NOW()
    WHERE test_date=${event.date}::date AND city=${event.city} AND state='pending' AND telegram_message_id IS NULL
    RETURNING test_date`).rows[0];
  if (!claim) return {done:true,attention:true};
  try {
    const sent = await telegramApi('sendMessage', {chat_id:CHAT_ID,message_thread_id:Number(THREAD_ID),text,
      disable_web_page_preview:true});
    if (!sent?.message_id) throw new Error('Telegram did not return a message ID');
    await sql`UPDATE offline_photo_briefs_001 SET state='published',telegram_message_id=${String(sent.message_id)},
      text_hash=${hash},error=NULL,updated_at=NOW() WHERE test_date=${event.date}::date AND city=${event.city}`;
    return {done:true,sent:true,messageId:String(sent.message_id)};
  } catch (error) {
    await sql`UPDATE offline_photo_briefs_001 SET state='attention',error=${String(error.message || error).slice(0,300)},updated_at=NOW()
      WHERE test_date=${event.date}::date AND city=${event.city}`;
    throw error;
  }
}
