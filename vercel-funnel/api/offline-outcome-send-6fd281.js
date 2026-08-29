import { init, json, sql, telegram } from './_core.js';

const SETUP_KEY = '7c912541aca74e3e832f1fcc2d81a7a0';
const NAMES = [
  'Соболевская Ирина Юрьевна',
  'Павлович Евгений Анатольевич',
  'Василевская Инна Викторовна',
  'Демидович Александр Леонидович',
  'Гедиш Наталия Евгеньевна',
  'Романова Карина Владимировна'
];

const TEXT = `Спасибо, что прошли вместе с нами несколько этапов отбора в команду тренеров Академии Стратег.\n\nВы заполнили анкеты, выполнили тестовые задания, приехали в Академию и лично познакомились с нашей командой. До этого этапа дошли далеко не все участники. Уже сам этот результат говорит о вашей настойчивости, ответственности и готовности вкладываться в новые возможности.\n\nПо итогам текущего отбора мы не готовы предложить вам продолжение именно на позиции тренера Академии Стратег.\n\nНа этом ваше участие в отборе завершается, поэтому после ответа мы отключим вас от рабочей группы кандидатов. При этом нам важно сохранить с вами хорошие отношения.\n\nМы проводим мероприятия для предпринимателей, владельцев бизнеса и руководителей. Возможно, они будут интересны вам, вашим друзьям, коллегам, партнёрам или знакомым.\n\nХотели бы вы оставаться с Академией на связи, получать информацию о наших проектах и при случае рассказывать о них своему окружению?`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (req.headers['x-setup-key'] !== SETUP_KEY) return json(res, 404, { error: 'Not found' });
  try {
    await init();
    const rows = (await sql`
      SELECT DISTINCT ON (c.id) c.id,c.chat_id,c.username,c.status,a.full_name
      FROM candidates c JOIN applications a ON a.candidate_id=c.id
      WHERE a.full_name IN (${NAMES[0]},${NAMES[1]},${NAMES[2]},${NAMES[3]},${NAMES[4]},${NAMES[5]})
      ORDER BY c.id,a.created_at DESC
    `).rows;
    const foundNames = new Set(rows.map(item => item.full_name));
    const missing = NAMES.filter(name => !foundNames.has(name));
    if (rows.length !== NAMES.length || missing.length) return json(res, 409, { error: 'Cohort mismatch', found: rows.map(item => ({ id: item.id, fullName: item.full_name, username: item.username })), missing });
    if (rows.some(item => /\bволкова\b/iu.test(item.full_name))) return json(res, 409, { error: 'Protected candidate appeared in cohort' });
    if (req.query?.action !== 'send') return json(res, 200, { ok: true, recipients: rows.map(item => ({ id: item.id, fullName: item.full_name, username: item.username, status: item.status })) });
    let sent = 0, skipped = 0, failed = 0;
    const results = [];
    for (const candidate of rows) {
      const duplicate = (await sql`SELECT id FROM messages WHERE candidate_id=${candidate.id} AND kind='offline_outcome_invite_20260829' AND delivery_status='delivered' LIMIT 1`).rows[0];
      if (duplicate) { skipped++; results.push({ id: candidate.id, fullName: candidate.full_name, result: 'already_sent' }); continue; }
      try {
        const messageId = await telegram(candidate.chat_id, TEXT, { reply_markup: { inline_keyboard: [[{ text: 'Да, оставаться на связи', callback_data: 'offline_outcome_20260829_yes' }],[{ text: 'Нет, спасибо', callback_data: 'offline_outcome_20260829_no' }]] } });
        await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) VALUES(${candidate.id},'out','offline_outcome_invite_20260829',${TEXT},'delivered',${String(messageId || '')})`;
        sent++; results.push({ id: candidate.id, fullName: candidate.full_name, result: 'sent', messageId });
      } catch (error) {
        failed++; results.push({ id: candidate.id, fullName: candidate.full_name, result: 'failed', error: String(error?.message || error) });
      }
    }
    return json(res, 200, { ok: failed === 0, sent, skipped, failed, results });
  } catch (error) {
    console.error('[offline-outcome-send]', error);
    return json(res, 500, { error: String(error?.message || error) });
  }
}
