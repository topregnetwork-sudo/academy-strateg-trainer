import { json } from './_core.js';
import { enableRescheduleControlsForBookedCandidates, sendOfflineReschedulePreviewToCoordination } from './offline-interview.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (req.headers['x-setup-key'] !== '39dd286ce26c42e9a5cb6c4f373f38a7') return json(res, 404, { error: 'Not found' });
  try {
    const controls = await enableRescheduleControlsForBookedCandidates();
    const preview = await sendOfflineReschedulePreviewToCoordination();
    return json(res, 200, { ok: true, controls, preview });
  } catch (error) {
    console.error('[offline-reschedule-setup]', error);
    return json(res, 500, { error: String(error?.message || error) });
  }
}
