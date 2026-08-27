import { createHash, timingSafeEqual } from 'node:crypto';
import { init, json, sql } from './_core.js';
import { syncDriveCandidate } from './drive.js';

const EXPECTED_KEY_HASH = 'e26f245b2f7254269202173a213c31acf0cd8eda1b2a092e25fe9772bb2f3e51';

function authorized(req) {
  const actual = createHash('sha256').update(String(req.headers['x-diagnostic-key'] || '')).digest();
  const expected = Buffer.from(EXPECTED_KEY_HASH, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export default async function handler(req, res) {
  if (!authorized(req)) return json(res, 404, { ok: false });
  try {
    await init();
    if (req.method === 'POST') {
      const testResult = await syncDriveCandidate(4);
      const updated = (await sql`
        UPDATE candidate_drive d
        SET folder_name = x.full_name || ' — ' || x.city || ' — ' || substring(d.folder_name FROM '([0-9]{2}\\.[0-9]{2}\\.[0-9]{4})$'),
            updated_at = NOW()
        FROM (
          SELECT c.id,
                 COALESCE(NULLIF(TRIM(a.city),''),NULLIF(TRIM(c.city),''),'Город не указан') AS city,
                 COALESCE(NULLIF(TRIM(a.full_name),''),NULLIF(TRIM(CONCAT_WS(' ',c.first_name,c.last_name)),''),NULLIF(TRIM(c.username),''),'Кандидат ' || c.id::text) AS full_name
          FROM candidates c
          LEFT JOIN LATERAL (SELECT city,full_name FROM applications WHERE candidate_id=c.id ORDER BY created_at DESC LIMIT 1) a ON TRUE
        ) x
        WHERE d.candidate_id=x.id
        RETURNING d.candidate_id,d.folder_id,d.folder_name
      `).rows;
      return json(res, 200, { ok: true, testedFolderId: testResult.folder?.id || null, updated });
    }
    if (req.method !== 'GET') return json(res, 405, { ok: false });
    const rows = (await sql`
      SELECT d.candidate_id,d.folder_id,d.folder_url,d.folder_name,d.synced_at,
             COALESCE(NULLIF(TRIM(a.city),''),NULLIF(TRIM(c.city),''),'Город не указан') AS city,
             COALESCE(NULLIF(TRIM(a.full_name),''),NULLIF(TRIM(CONCAT_WS(' ',c.first_name,c.last_name)),''),NULLIF(TRIM(c.username),''),'Кандидат ' || c.id::text) AS full_name
      FROM candidate_drive d
      JOIN candidates c ON c.id=d.candidate_id
      LEFT JOIN LATERAL (
        SELECT city,full_name FROM applications WHERE candidate_id=c.id ORDER BY created_at DESC LIMIT 1
      ) a ON TRUE
      ORDER BY d.candidate_id
    `).rows;
    return json(res, 200, { ok: true, rows });
  } catch (error) {
    console.error('[drive-city-diag] failed', { message: String(error) });
    return json(res, 500, { ok: false, error: 'diagnostic_failed' });
  }
}
