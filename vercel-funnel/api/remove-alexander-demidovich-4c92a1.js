import { init, json, sql, telegramApi } from './_core.js';

const SETUP_KEY = '87af389d71e64b36be13f23328795c78';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (req.headers['x-setup-key'] !== SETUP_KEY) return json(res, 404, { error: 'Not found' });
  try {
    await init();
    const candidates = (await sql`
      SELECT DISTINCT ON (c.id) c.id,c.chat_id,c.username,c.first_name,c.last_name,c.status,
             COALESCE(NULLIF(TRIM(a.full_name),''),NULLIF(TRIM(CONCAT_WS(' ',c.first_name,c.last_name)),''),c.username) AS full_name
      FROM candidates c
      LEFT JOIN applications a ON a.candidate_id=c.id
      WHERE LOWER(COALESCE(a.full_name,'')) LIKE '%александр%'
        AND LOWER(COALESCE(a.full_name,'')) LIKE '%демидович%'
      ORDER BY c.id,a.created_at DESC
    `).rows;
    if (candidates.length !== 1) return json(res, 409, { error: 'Expected exactly one candidate', matches: candidates.map(item => ({ id: item.id, username: item.username, fullName: item.full_name })) });
    const candidate = candidates[0];
    const groupChatId = (await sql`SELECT value FROM app_settings WHERE key='candidate_group_chat_id' LIMIT 1`).rows[0]?.value;
    if (!groupChatId) throw new Error('Candidate group is not configured');
    const before = await telegramApi('getChatMember', { chat_id: groupChatId, user_id: Number(candidate.chat_id) });
    if (req.query?.action !== 'remove') {
      return json(res, 200, { ok: true, candidate: { id: candidate.id, username: candidate.username, fullName: candidate.full_name, funnelStatus: candidate.status }, groupStatus: before.status });
    }
    if (!['member','restricted'].includes(before.status)) throw new Error(`Candidate cannot be softly removed: ${before.status}`);
    await telegramApi('unbanChatMember', { chat_id: groupChatId, user_id: Number(candidate.chat_id), only_if_banned: false });
    const after = await telegramApi('getChatMember', { chat_id: groupChatId, user_id: Number(candidate.chat_id) });
    return json(res, 200, { ok: true, candidateId: candidate.id, username: candidate.username, fullName: candidate.full_name, beforeStatus: before.status, afterStatus: after.status });
  } catch (error) {
    console.error('[remove-alexander-demidovich]', error);
    return json(res, 500, { error: String(error?.message || error) });
  }
}
