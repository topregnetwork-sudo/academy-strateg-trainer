import { createHash, timingSafeEqual } from 'node:crypto';
import { body, init, json, sql } from './_core.js';

const EXPECTED_KEY_HASH = '64921be5d836bf037d8af4071b9208479a64ffcb137e896d937d97000753db5b';

function authorized(req) {
  const supplied = String(req.headers['x-candidate-group-key'] || '');
  const actual = createHash('sha256').update(supplied).digest();
  const expected = Buffer.from(EXPECTED_KEY_HASH, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function validInviteUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 't.me' && url.pathname.startsWith('/+');
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false });
  if (!authorized(req)) return json(res, 404, { ok: false });
  try {
    const payload = await body(req);
    const inviteUrl = String(payload.invite_url || '').trim();
    if (!validInviteUrl(inviteUrl)) return json(res, 400, { ok: false, error: 'invalid_invite_url' });
    await init();
    await sql`INSERT INTO app_settings(key,value,updated_at) VALUES('candidate_group_invite_url',${inviteUrl},NOW()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`;
    const counts = (await sql`SELECT count(*) FILTER (WHERE status='interview_booked')::int AS booked,count(*) FILTER (WHERE status='interviewed')::int AS interviewed FROM candidates`).rows[0];
    return json(res, 200, { ok: true, configured: true, booked: counts.booked, interviewed: counts.interviewed, messages_sent: 0 });
  } catch (error) {
    console.error('[candidate-group] one-time configuration failed', { message: String(error), stack: error?.stack });
    return json(res, 500, { ok: false, error: 'candidate_group_config_failed' });
  }
}
