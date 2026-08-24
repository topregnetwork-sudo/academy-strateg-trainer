import { createHash, timingSafeEqual } from 'node:crypto';
import { json } from './_core.js';
import { resumeTrainerTopic } from './telegram.js';

const EXPECTED_KEY_HASH = 'c4cb9b736dd398ea5776aafcb18b44c04c33deb6dd739a226a29fbd05a881a81';

function authorized(req) {
  const supplied = String(req.headers['x-topic-resume-key'] || '');
  const actual = createHash('sha256').update(supplied).digest();
  const expected = Buffer.from(EXPECTED_KEY_HASH, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false });
  if (!authorized(req)) return json(res, 404, { ok: false });
  try {
    const result = await resumeTrainerTopic();
    return json(res, 200, { ok: true, ...result });
  } catch (error) {
    console.error('[telegram] one-time topic resume failed', { message: String(error), stack: error?.stack });
    return json(res, 500, { ok: false, error: 'resume_failed' });
  }
}
