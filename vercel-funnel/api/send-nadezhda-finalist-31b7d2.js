import { init, json, sql, telegram } from './_core.js';

const SETUP_KEY = 'dc978cfe1cdd48ec9a87604915222ed2';
const TEXT = `Надежда, здравствуйте!\n\nПоздравляем — вы успешно прошли предварительное тестирование и вышли в финал отбора на позицию тренера Академии Стратег.\n\nНам понадобится немного времени, чтобы внимательно собрать и проанализировать все результаты пройденных вами этапов.\n\nОкончательные итоги отбора мы подведём 6–7 сентября. После этого обязательно свяжемся с вами и сообщим о дальнейшем решении и следующих шагах.\n\nСпасибо за ваше участие, серьёзное отношение к отбору и проделанную работу. Пожалуйста, ожидайте нашего сообщения`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (req.headers['x-setup-key'] !== SETUP_KEY) return json(res, 404, { error: 'Not found' });
  try {
    await init();
    const rows = (await sql`
      SELECT DISTINCT ON (c.id) c.id,c.chat_id,c.username,c.status,a.full_name
      FROM candidates c JOIN applications a ON a.candidate_id=c.id
      WHERE LOWER(a.full_name)=LOWER('Волкова Надежда Игоревна')
      ORDER BY c.id,a.created_at DESC
    `).rows;
    if (rows.length !== 1) return json(res, 409, { error: 'Expected exactly one protected finalist', matches: rows.map(item => ({ id: item.id, fullName: item.full_name, username: item.username })) });
    const candidate = rows[0];
    if (req.query?.action !== 'send') return json(res, 200, { ok: true, candidate: { id: candidate.id, fullName: candidate.full_name, username: candidate.username, status: candidate.status } });
    const duplicate = (await sql`SELECT telegram_message_id FROM messages WHERE candidate_id=${candidate.id} AND kind='nadezhda_finalist_invite_20260829' AND delivery_status='delivered' LIMIT 1`).rows[0];
    if (duplicate) return json(res, 200, { ok: true, sent: 0, skipped: 1, messageId: duplicate.telegram_message_id });
    const messageId = await telegram(candidate.chat_id, TEXT, { reply_markup: { inline_keyboard: [[{ text: 'Спасибо', callback_data: 'nadezhda_finalist_thanks' }, { text: 'Дай вам Бог лексус)', callback_data: 'nadezhda_finalist_lexus' }]] } });
    await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) VALUES(${candidate.id},'out','nadezhda_finalist_invite_20260829',${TEXT},'delivered',${String(messageId || '')})`;
    return json(res, 200, { ok: true, sent: 1, skipped: 0, candidateId: candidate.id, messageId });
  } catch (error) {
    console.error('[send-nadezhda-finalist]', error);
    return json(res, 500, { error: String(error?.message || error) });
  }
}
