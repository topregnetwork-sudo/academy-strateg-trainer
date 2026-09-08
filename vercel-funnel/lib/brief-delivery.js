const RETRY_AFTER_MS = 5 * 60 * 1000;

export const BRIEF_DELIVERY_STATES = Object.freeze(['queued', 'sending', 'sent', 'attention', 'uncertain']);

async function installBriefDeliveryStore(db) {
  await db`ALTER TABLE interview_brief_deliveries ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'queued'`;
  await db`ALTER TABLE interview_brief_deliveries ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0`;
  await db`ALTER TABLE interview_brief_deliveries ADD COLUMN IF NOT EXISTS queued_at TIMESTAMPTZ`;
  await db`ALTER TABLE interview_brief_deliveries ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ`;
  await db`ALTER TABLE interview_brief_deliveries ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ`;
  await db`ALTER TABLE interview_brief_deliveries ADD COLUMN IF NOT EXISTS last_error TEXT`;
  await db`ALTER TABLE interview_brief_deliveries ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`;
  await db`UPDATE interview_brief_deliveries SET state=CASE WHEN telegram_message_id IS NOT NULL THEN 'sent' WHEN state IS NULL OR state='' OR state='queued' THEN 'queued' ELSE state END, sent_at=COALESCE(sent_at,CASE WHEN telegram_message_id IS NOT NULL THEN delivered_at ELSE NULL END), updated_at=COALESCE(updated_at,delivered_at,NOW())`;
  await db`CREATE INDEX IF NOT EXISTS interview_brief_deliveries_state_idx ON interview_brief_deliveries(state,updated_at)`;

  await db`ALTER TABLE hr_brief_deliveries ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'queued'`;
  await db`ALTER TABLE hr_brief_deliveries ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0`;
  await db`ALTER TABLE hr_brief_deliveries ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ`;
  await db`ALTER TABLE hr_brief_deliveries ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ`;
  await db`ALTER TABLE hr_brief_deliveries ADD COLUMN IF NOT EXISTS last_error TEXT`;
  await db`ALTER TABLE hr_brief_deliveries ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`;
  await db`UPDATE hr_brief_deliveries SET state=CASE WHEN telegram_message_id IS NOT NULL THEN 'sent' WHEN state IS NULL OR state='' THEN 'queued' ELSE state END, sent_at=COALESCE(sent_at,CASE WHEN telegram_message_id IS NOT NULL THEN delivered_at ELSE NULL END), updated_at=COALESCE(updated_at,delivered_at,NOW())`;
  await db`CREATE INDEX IF NOT EXISTS hr_brief_deliveries_state_idx ON hr_brief_deliveries(state,updated_at)`;
}

let storeReady;
export async function ensureBriefDeliveryStore(db) {
  if (!storeReady) storeReady = installBriefDeliveryStore(db).catch(error => { storeReady = null; throw error; });
  return storeReady;
}

export async function claimInterviewBrief(db, { interviewAt, slotId, chatId, threadId }) {
  const result = await db`
    INSERT INTO interview_brief_deliveries(
      interview_at,slot_id,chat_id,thread_id,state,attempt_count,queued_at,last_attempt_at,updated_at
    ) VALUES(${interviewAt},${slotId},${chatId},${threadId},'sending',1,NOW(),NOW(),NOW())
    ON CONFLICT(interview_at,chat_id,thread_id) DO UPDATE SET
      state='sending',
      attempt_count=interview_brief_deliveries.attempt_count+1,
      last_attempt_at=NOW(),
      last_error=NULL,
      updated_at=NOW()
    WHERE interview_brief_deliveries.state IN ('queued','attention')
      AND (interview_brief_deliveries.last_attempt_at IS NULL OR interview_brief_deliveries.last_attempt_at < NOW() - INTERVAL '5 minutes')
    RETURNING interview_at,slot_id,chat_id,thread_id,attempt_count
  `;
  return result.rows[0] || null;
}

export async function markInterviewBriefSent(db, { interviewAt, chatId, threadId, messageId }) {
  await db`UPDATE interview_brief_deliveries SET state='sent',telegram_message_id=${String(messageId || '')},sent_at=NOW(),last_error=NULL,updated_at=NOW() WHERE interview_at=${interviewAt} AND chat_id=${chatId} AND thread_id=${threadId}`;
}

export async function markInterviewBriefFailure(db, { interviewAt, chatId, threadId, error, uncertain = false }) {
  const state = uncertain ? 'uncertain' : 'attention';
  const message = String(error?.message || error || 'Неизвестная ошибка').slice(0, 500);
  await db`UPDATE interview_brief_deliveries SET state=${state},last_error=${message},updated_at=NOW() WHERE interview_at=${interviewAt} AND chat_id=${chatId} AND thread_id=${threadId}`;
}

export function summarizeDeliveryStates(rows, now = new Date()) {
  const counts = Object.fromEntries([...BRIEF_DELIVERY_STATES, 'queued', 'stale_sending', 'other'].map(state => [state, 0]));
  let errorCount = 0;
  for (const row of rows || []) {
    const state = BRIEF_DELIVERY_STATES.includes(String(row.state)) ? String(row.state) : (row.state ? 'other' : 'queued');
    const stale = state === 'sending' && row.last_attempt_at && now.getTime() - new Date(row.last_attempt_at).getTime() > RETRY_AFTER_MS;
    counts[stale ? 'stale_sending' : state] += 1;
    if (row.last_error) errorCount += 1;
  }
  return { counts, errorCount, total: (rows || []).length };
}

export function sanitizeWebhookInfo(info) {
  return {
    api: 'ok',
    hasWebhook: Boolean(info?.url),
    pendingUpdateCount: Number(info?.pending_update_count || 0),
    hasLastError: Boolean(info?.last_error_message),
    lastErrorDate: info?.last_error_date ? new Date(Number(info.last_error_date) * 1000).toISOString() : null
  };
}
