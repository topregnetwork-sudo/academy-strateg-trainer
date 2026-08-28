import { json } from './_core.js';
import { createHash, timingSafeEqual } from 'node:crypto';
import { sendOfflineSlotSummary } from './offline-interview.js';

const EXPECTED = 'e26f245b2f7254269202173a213c31acf0cd8eda1b2a092e25fe9772bb2f3e51';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  const supplied = createHash('sha256').update(String(req.headers['x-diagnostic-key'] || '')).digest('hex');
  if (!timingSafeEqual(Buffer.from(supplied), Buffer.from(EXPECTED))) return json(res, 401, { error: 'Unauthorized' });
  try { return json(res, 200, { ok: true, ...(await sendOfflineSlotSummary()) }); }
  catch (error) { return json(res, 500, { error: String(error?.message || error) }); }
}
