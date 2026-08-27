import crypto, { createHash, timingSafeEqual } from 'node:crypto';
import { init, json, telegram, sql } from './_core.js';

const EXPECTED_KEY_HASH = 'da81522318426a1f691c6618e2c27b323b7b6ebaf8fe7b0df49607a095500280';
function authorized(req) {
  const actual = createHash('sha256').update(String(req.headers['x-repair-key'] || '')).digest();
  const expected = Buffer.from(EXPECTED_KEY_HASH, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false });
  if (!authorized(req)) return json(res, 404, { ok: false });
  try {
    await init();
    const candidate = (await sql`SELECT id,chat_id,username,status FROM candidates WHERE id=82 AND lower(username)='evgeniypavlovich2104' LIMIT 1`).rows[0];
    if (!candidate) return json(res, 404, { ok: false, error: 'candidate_not_found' });
    const existingInvite = (await sql`SELECT telegram_message_id FROM messages WHERE candidate_id=${candidate.id} AND direction='out' AND kind='candidate_group_invite' ORDER BY created_at DESC LIMIT 1`).rows[0];
    if (existingInvite) return json(res, 200, { ok: true, alreadySent: true, status: candidate.status, messageId: existingInvite.telegram_message_id });
    const inviteUrl = (await sql`SELECT value FROM app_settings WHERE key='candidate_group_invite_url' LIMIT 1`).rows[0]?.value;
    if (!inviteUrl) return json(res, 500, { ok: false, error: 'group_invite_not_configured' });
    let questionnaire = (await sql`SELECT id,token,submitted_at FROM candidate_questionnaire_two WHERE candidate_id=${candidate.id} LIMIT 1`).rows[0];
    if (!questionnaire) {
      const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
      questionnaire = (await sql`INSERT INTO candidate_questionnaire_two(candidate_id,token,status) VALUES(${candidate.id},${token},'pending') RETURNING id,token,submitted_at`).rows[0];
    }
    const questionnaireUrl = `https://topregnetwork-sudo.github.io/academy-strateg-trainer/questionnaire-2.html?token=${questionnaire.token}`;
    const text = '✅ <b>Ваш этап восстановлен.</b>\n\nПереходите в группу кандидатов Академии Стратег. Там вы познакомитесь с проектом и получите дальнейшие материалы.';
    await sql`UPDATE candidates SET status='interviewed',consent=true,updated_at=NOW() WHERE id=${candidate.id}`;
    try {
      const messageId = await telegram(candidate.chat_id, text, { reply_markup: { inline_keyboard: [[{ text: 'Перейти в группу кандидатов', url: inviteUrl }],[{ text: 'Заполнить Анкету 2', url: questionnaireUrl }]] } });
      await sql`UPDATE candidate_questionnaire_two SET status=CASE WHEN submitted_at IS NULL THEN 'sent' ELSE status END,sent_at=COALESCE(sent_at,NOW()),updated_at=NOW() WHERE id=${questionnaire.id}`;
      if (!questionnaire.submitted_at) await sql`UPDATE candidates SET status='questionnaire',updated_at=NOW() WHERE id=${candidate.id}`;
      await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) VALUES(${candidate.id},'out','candidate_group_invite',${text},'delivered',${String(messageId || '')})`;
      return json(res, 200, { ok: true, repaired: true, messageId: String(messageId || ''), status: questionnaire.submitted_at ? 'interviewed' : 'questionnaire', groupUrl: inviteUrl });
    } catch (error) {
      await sql`UPDATE candidates SET status='new',updated_at=NOW() WHERE id=${candidate.id}`;
      throw error;
    }
  } catch (error) {
    console.error('[repair-evgeniy] failed', { message: String(error) });
    return json(res, 500, { ok: false, error: 'repair_failed' });
  }
}
