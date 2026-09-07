import { syncDriveCandidate } from '../api/drive.js';
import { createTask, sql, stableId } from './funnel-store.js';

export const DRIVE_SYNC_TASK_067 = 'candidate_drive_sync_067';
const RETRY_DELAYS_MINUTES = [2, 5, 10, 20, 40, 60];

export async function initDriveSync067() {
  await sql`CREATE TABLE IF NOT EXISTS candidate_drive_sync_067(
    candidate_id BIGINT PRIMARY KEY,
    state TEXT NOT NULL DEFAULT 'pending',
    attempts INT NOT NULL DEFAULT 0,
    last_error TEXT,
    next_retry_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
}

function taskId(candidateId, attempt) {
  return stableId(`candidate-drive-sync-067:${Number(candidateId)}:${Number(attempt)}`);
}

async function queue(candidateId, attempt, dueAt, error = null) {
  await initDriveSync067();
  await sql`INSERT INTO candidate_drive_sync_067(candidate_id,state,attempts,last_error,next_retry_at,completed_at,updated_at)
    VALUES(${Number(candidateId)},'pending',${Number(attempt)},${error},${dueAt},NULL,NOW())
    ON CONFLICT(candidate_id) DO UPDATE SET state='pending',attempts=EXCLUDED.attempts,last_error=EXCLUDED.last_error,next_retry_at=EXCLUDED.next_retry_at,completed_at=NULL,updated_at=NOW()`;
  await createTask(DRIVE_SYNC_TASK_067, { candidateId: Number(candidateId), attempt: Number(attempt) }, dueAt, taskId(candidateId, attempt));
  return { attempt, dueAt };
}

export async function queueDriveSync067(candidateId) {
  return queue(candidateId, 1, new Date(Date.now() + 5000));
}

export async function runDriveSync067(candidateId, attempt = 1) {
  await initDriveSync067();
  const id = Number(candidateId);
  try {
    const result = await syncDriveCandidate(id);
    if (result?.pending) throw new Error(result.message || 'Пока не хватает данных для папки кандидата');
    await sql`UPDATE candidate_drive_sync_067 SET state='done',attempts=${Number(attempt)},last_error=NULL,next_retry_at=NULL,completed_at=NOW(),updated_at=NOW() WHERE candidate_id=${id}`;
    return { done: true, synced: true, existing: Boolean(result?.existing) };
  } catch (error) {
    const message = String(error?.message || error).slice(0, 500);
    const nextAttempt = Number(attempt) + 1;
    if (nextAttempt <= RETRY_DELAYS_MINUTES.length) {
      const dueAt = new Date(Date.now() + RETRY_DELAYS_MINUTES[nextAttempt - 1] * 60 * 1000);
      await queue(id, nextAttempt, dueAt, message);
      return { done: true, retryScheduled: true, attempt: nextAttempt, dueAt, error: message };
    }
    await sql`INSERT INTO candidate_drive_sync_067(candidate_id,state,attempts,last_error,next_retry_at,completed_at,updated_at)
      VALUES(${id},'attention',${Number(attempt)},${message},NULL,NULL,NOW())
      ON CONFLICT(candidate_id) DO UPDATE SET state='attention',attempts=EXCLUDED.attempts,last_error=EXCLUDED.last_error,next_retry_at=NULL,updated_at=NOW()`;
    return { done: true, attention: true, attempts: Number(attempt), error: message };
  }
}

export async function reconcileDriveSync067() {
  await initDriveSync067();
  const rows = (await sql`
    SELECT c.id
    FROM candidates c
    JOIN candidate_questionnaire_two q ON q.candidate_id=c.id AND q.submitted_at IS NOT NULL
    JOIN LATERAL (
      SELECT submitted_at FROM candidate_tests t
      WHERE t.candidate_id=c.id AND t.submitted_at IS NOT NULL
      ORDER BY t.submitted_at DESC LIMIT 1
    ) t ON TRUE
    LEFT JOIN candidate_drive d ON d.candidate_id=c.id
    WHERE d.candidate_id IS NULL AND c.consent=true
      AND c.status NOT IN ('test_1_incomplete_removed','rejected','cancelled','selection_closed','academy_contact','reserve_no_response')
  `).rows;
  const queued = [];
  for (const row of rows) {
    try { await queueDriveSync067(row.id); queued.push(Number(row.id)); }
    catch (error) {
      await sql`INSERT INTO candidate_drive_sync_067(candidate_id,state,attempts,last_error,next_retry_at,updated_at)
        VALUES(${Number(row.id)},'attention',0,${String(error?.message || error).slice(0,500)},NULL,NOW())
        ON CONFLICT(candidate_id) DO UPDATE SET state='attention',last_error=EXCLUDED.last_error,next_retry_at=NULL,updated_at=NOW()`;
    }
  }
  return { eligible: rows.length, queued: queued.length };
}
