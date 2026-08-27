import { createHash, timingSafeEqual } from 'node:crypto';
import { init, json, sql } from './_core.js';

const EXPECTED_KEY_HASH = '93522a0d799d958f6a18fa9338065396ba9f28410b672ed7e787cc297a1169bd';

function authorized(req) {
  const actual = createHash('sha256').update(String(req.headers['x-diagnostic-key'] || '')).digest();
  const expected = Buffer.from(EXPECTED_KEY_HASH, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { ok: false });
  if (!authorized(req)) return json(res, 404, { ok: false });
  try {
    await init();
    const username = 'evgeniypavlovich2104';
    const candidate = (await sql`SELECT id,chat_id,username,first_name,last_name,phone,city,slot_id,interview_at,source_id,status,consent,created_at,updated_at FROM candidates WHERE lower(username)=${username} LIMIT 1`).rows[0] || null;
    const application = candidate ? (await sql`SELECT id,code,full_name,age,city,motivation,phone,slot_id,trainer_experience_level,source_id,candidate_id,created_at FROM applications WHERE candidate_id=${candidate.id} ORDER BY created_at DESC LIMIT 1`).rows[0] || null : null;
    const messages = candidate ? (await sql`SELECT direction,kind,text,delivery_status,telegram_message_id,created_at FROM messages WHERE candidate_id=${candidate.id} ORDER BY created_at DESC LIMIT 15`).rows : [];
    const questionnaireTwo = candidate ? (await sql`SELECT status,sent_at,opened_at,submitted_at,completion_notice_sent_at FROM candidate_questionnaire_two WHERE candidate_id=${candidate.id} LIMIT 1`).rows[0] || null : null;
    const settings = (await sql`SELECT key,value,updated_at FROM app_settings WHERE key IN ('candidate_group_invite_url','candidate_group_chat_id') ORDER BY key`).rows;
    return json(res, 200, { ok: true, candidate, application, messages, questionnaireTwo, settings });
  } catch (error) {
    console.error('[candidate-diag] failed', { message: String(error) });
    return json(res, 500, { ok: false, error: 'diagnostic_failed' });
  }
}
