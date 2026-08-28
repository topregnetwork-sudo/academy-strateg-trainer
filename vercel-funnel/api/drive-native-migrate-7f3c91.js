import { createHash, timingSafeEqual } from 'node:crypto';
import { init, json, sql } from './_core.js';
import { syncDriveCandidate } from './drive.js';

const EXPECTED = 'e26f245b2f7254269202173a213c31acf0cd8eda1b2a092e25fe9772bb2f3e51';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  const supplied = createHash('sha256').update(String(req.headers['x-diagnostic-key'] || '')).digest('hex');
  if (!timingSafeEqual(Buffer.from(supplied), Buffer.from(EXPECTED))) return json(res, 401, { error: 'Unauthorized' });
  try {
    await init();
    const requestedId = Number(req.query?.candidate_id || 0);
    const rows = requestedId ? [{ candidate_id: requestedId }] : (await sql`
      SELECT DISTINCT c.id AS candidate_id
      FROM candidates c
      JOIN candidate_questionnaire_two q ON q.candidate_id=c.id AND q.submitted_at IS NOT NULL
      JOIN candidate_tests t ON t.candidate_id=c.id AND t.submitted_at IS NOT NULL
      LEFT JOIN candidate_drive_files doc ON doc.candidate_id=c.id AND doc.mime_type='application/vnd.google-apps.document'
      LEFT JOIN candidate_drive_files sheet ON sheet.candidate_id=c.id AND sheet.mime_type='application/vnd.google-apps.spreadsheet'
      WHERE doc.candidate_id IS NULL OR sheet.candidate_id IS NULL
      ORDER BY c.id LIMIT 3
    `).rows;
    const results = [];
    for (const row of rows) {
      try {
        const synced = await syncDriveCandidate(row.candidate_id);
        results.push({ candidateId: row.candidate_id, ok: !synced.pending, pending: Boolean(synced.pending), folderId: synced.folder?.id || null, files: (synced.files || []).map(file => ({ name: file.name, mimeType: file.mimeType, url: file.url })) });
      } catch (error) {
        results.push({ candidateId: row.candidate_id, ok: false, error: String(error?.message || error) });
      }
    }
    const remaining = (await sql`
      SELECT count(DISTINCT c.id)::int AS count
      FROM candidates c
      JOIN candidate_questionnaire_two q ON q.candidate_id=c.id AND q.submitted_at IS NOT NULL
      JOIN candidate_tests t ON t.candidate_id=c.id AND t.submitted_at IS NOT NULL
      LEFT JOIN candidate_drive_files doc ON doc.candidate_id=c.id AND doc.mime_type='application/vnd.google-apps.document'
      LEFT JOIN candidate_drive_files sheet ON sheet.candidate_id=c.id AND sheet.mime_type='application/vnd.google-apps.spreadsheet'
      WHERE doc.candidate_id IS NULL OR sheet.candidate_id IS NULL
    `).rows[0].count;
    return json(res, 200, { ok: true, results, remaining });
  } catch (error) {
    return json(res, 500, { error: String(error?.message || error) });
  }
}
