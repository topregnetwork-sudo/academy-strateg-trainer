import { createHash, timingSafeEqual } from 'node:crypto';
import { init, json, sql } from './_core.js';

const EXPECTED = 'e26f245b2f7254269202173a213c31acf0cd8eda1b2a092e25fe9772bb2f3e51';

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  const supplied = createHash('sha256').update(String(req.headers['x-diagnostic-key'] || '')).digest('hex');
  if (!timingSafeEqual(Buffer.from(supplied), Buffer.from(EXPECTED))) return json(res, 401, { error: 'Unauthorized' });
  await init();
  const username = String(req.query?.username || '').replace(/^@+/, '').toLowerCase();
  const candidate = (await sql`SELECT id,username,first_name,last_name,city,status,created_at,updated_at FROM candidates WHERE LOWER(username)=${username} LIMIT 1`).rows[0] || null;
  if (!candidate) return json(res, 404, { error: 'Candidate not found' });
  const questionnaire = (await sql`SELECT status,sent_at,opened_at,submitted_at,updated_at FROM candidate_questionnaire_two WHERE candidate_id=${candidate.id} LIMIT 1`).rows[0] || null;
  const test = (await sql`SELECT status,sent_at,submitted_at,updated_at FROM candidate_tests WHERE candidate_id=${candidate.id} ORDER BY created_at DESC LIMIT 1`).rows[0] || null;
  const drive = (await sql`SELECT folder_id,folder_url,folder_name,synced_at,updated_at FROM candidate_drive WHERE candidate_id=${candidate.id} LIMIT 1`).rows[0] || null;
  const files = (await sql`SELECT file_name,mime_type,file_url,updated_at FROM candidate_drive_files WHERE candidate_id=${candidate.id} ORDER BY updated_at DESC`).rows;
  return json(res, 200, { candidate, questionnaire, test, drive, files });
}
