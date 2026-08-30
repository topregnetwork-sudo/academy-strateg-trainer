import { sql, transaction } from '../api/_core.js';
import crypto from 'node:crypto';
export { sql, transaction };
let ready;
export async function initFunnel() {
  if (!ready) ready = (async () => {
    await sql`CREATE TABLE IF NOT EXISTS funnel_templates(id BIGSERIAL PRIMARY KEY,name TEXT NOT NULL,version BIGINT NOT NULL,config JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(name,version))`;
    await sql`CREATE TABLE IF NOT EXISTS funnel_sessions(id BIGSERIAL PRIMARY KEY,config JSONB NOT NULL,active BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
    await sql`CREATE TABLE IF NOT EXISTS funnel_slots(id BIGSERIAL PRIMARY KEY,session_id BIGINT NOT NULL REFERENCES funnel_sessions(id),starts_at TIMESTAMPTZ NOT NULL,capacity INT NOT NULL,UNIQUE(session_id,starts_at))`;
    await sql`CREATE TABLE IF NOT EXISTS funnel_bookings(id BIGSERIAL PRIMARY KEY,session_id BIGINT NOT NULL REFERENCES funnel_sessions(id),candidate_id BIGINT NOT NULL,slot_id BIGINT NOT NULL REFERENCES funnel_slots(id),version INT NOT NULL DEFAULT 1,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(session_id,candidate_id))`;
    await sql`CREATE TABLE IF NOT EXISTS funnel_jobs(id TEXT PRIMARY KEY,config JSONB NOT NULL,state TEXT NOT NULL DEFAULT 'draft',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
    await sql`CREATE TABLE IF NOT EXISTS funnel_recipients(job_id TEXT NOT NULL REFERENCES funnel_jobs(id),candidate_id BIGINT NOT NULL,original_status TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',error TEXT,message_id TEXT,choice TEXT,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(job_id,candidate_id))`;
    await sql`CREATE TABLE IF NOT EXISTS funnel_effects(key TEXT PRIMARY KEY,state TEXT NOT NULL,message_id TEXT,error TEXT,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
    await sql`CREATE TABLE IF NOT EXISTS funnel_tasks(id TEXT PRIMARY KEY,kind TEXT NOT NULL,payload JSONB NOT NULL,due_at TIMESTAMPTZ NOT NULL,state TEXT NOT NULL DEFAULT 'pending',error TEXT,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
    await sql`CREATE INDEX IF NOT EXISTS funnel_recipients_job_state ON funnel_recipients(job_id,state)`;
    // Personal data cannot be queried using the public application's anonymous role.
    await sql`ALTER TABLE funnel_templates ENABLE ROW LEVEL SECURITY`;
    await sql`ALTER TABLE funnel_sessions ENABLE ROW LEVEL SECURITY`;
    await sql`ALTER TABLE funnel_slots ENABLE ROW LEVEL SECURITY`;
    await sql`ALTER TABLE funnel_bookings ENABLE ROW LEVEL SECURITY`;
    await sql`ALTER TABLE funnel_jobs ENABLE ROW LEVEL SECURITY`;
    await sql`ALTER TABLE funnel_recipients ENABLE ROW LEVEL SECURITY`;
    await sql`ALTER TABLE funnel_effects ENABLE ROW LEVEL SECURITY`;
    await sql`ALTER TABLE funnel_tasks ENABLE ROW LEVEL SECURITY`;
  })().catch(e => { ready = null; throw e; });
  return ready;
}
export async function sessionById(id) { return (await sql`SELECT * FROM funnel_sessions WHERE id=${Number(id) || 0}`).rows[0]; }
export async function candidateById(id) {
  return (await sql`SELECT c.*,a.full_name,EXISTS(SELECT 1 FROM candidate_tests t WHERE t.candidate_id=c.id AND t.submitted_at IS NOT NULL) AS test_completed,d.folder_url
    FROM candidates c LEFT JOIN LATERAL(SELECT full_name FROM applications WHERE candidate_id=c.id ORDER BY created_at DESC LIMIT 1) a ON TRUE
    LEFT JOIN candidate_drive d ON d.candidate_id=c.id WHERE c.id=${Number(id)}`).rows[0];
}
export function taskToken(id) {
  const secret = process.env.OPERATOR_ACCESS_KEY;
  if (!secret) throw new Error('Operator key missing');
  return `${id}.${crypto.createHmac('sha256', secret).update(`funnel-task-v1:${id}`).digest('hex')}`;
}
export function verifyTaskToken(token) {
  if (!/^[a-f0-9-]{36}\.[a-f0-9]{64}$/.test(token || '') || !process.env.OPERATOR_ACCESS_KEY) return null;
  const id = token.split('.')[0], expected = taskToken(id);
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected)) ? id : null;
}
export async function armTask(id) {
  const response = await fetch('https://academy-strateg-trainer-fallback.academy-strateg-network.workers.dev/_funnel/schedule', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: taskToken(id) }), signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) {
    await sql`UPDATE funnel_tasks SET error='Не удалось назначить точный запуск',updated_at=NOW() WHERE id=${id}`;
    throw new Error('Не удалось назначить запуск. Задача сохранена: повторите запуск из журнала.');
  }
  await sql`UPDATE funnel_tasks SET error=NULL,updated_at=NOW() WHERE id=${id}`;
}
export async function createTask(kind, payload, dueAt = new Date(), id = crypto.randomUUID()) {
  await initFunnel();
  await sql`INSERT INTO funnel_tasks(id,kind,payload,due_at) VALUES(${id},${kind},${JSON.stringify(payload)}::jsonb,${dueAt}) ON CONFLICT DO NOTHING`;
  await armTask(id);
  return id;
}
// Exactly-once delivery cannot be promised across a Telegram network timeout.
// Reserve before send; ambiguous outcomes are never automatically resent.
export async function effect(key, send) {
  const claimed = (await sql`INSERT INTO funnel_effects(key,state) VALUES(${key},'sending') ON CONFLICT DO NOTHING RETURNING key`).rows[0];
  if (!claimed) {
    const old = (await sql`SELECT * FROM funnel_effects WHERE key=${key}`).rows[0];
    if (old.state === 'done') return old.message_id;
    throw new Error('Результат прежней отправки требует проверки: ' + key);
  }
  let messageId;
  try { messageId = await send(); }
  catch (e) {
    await sql`UPDATE funnel_effects SET state='uncertain',error=${String(e.message).slice(0,500)},updated_at=NOW() WHERE key=${key}`;
    throw e;
  }
  await sql`UPDATE funnel_effects SET state='done',message_id=${String(messageId || '')},updated_at=NOW() WHERE key=${key}`;
  return messageId;
}
