import crypto from 'node:crypto';
import { json } from './_core.js';
import { sendTomorrowTestBrief } from './reminders.js';

const EXPECTED_HASH = 'dded28ad993bb6d6b1739c45cb9059d2e16e3a947e74b330d3b6bbb529ca5dd6';
const authorized = req => {
  const value = String(req.headers['x-interview-brief-test-key'] || '');
  const actual = crypto.createHash('sha256').update(value).digest('hex');
  return actual.length === EXPECTED_HASH.length && crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(EXPECTED_HASH));
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (!authorized(req)) return json(res, 404, { error: 'Not found' });
  try {
    return json(res, 200, await sendTomorrowTestBrief(req));
  } catch (error) {
    console.error('[interview-brief-test] failed', { message: String(error) });
    return json(res, 500, { error: 'Test brief failed' });
  }
}
