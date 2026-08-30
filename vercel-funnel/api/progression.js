import { init, json, sql, telegram } from './_core.js';
import { syncDriveCandidate } from './drive.js';

const TEST_COMPLETED = '✅ <b>Тест 1 заполнен</b>\n\nВсе 200 ответов сохранены в вашей карточке кандидата. Следующий этап — интервью на продуктивность. Информацию о времени встречи мы отправим отдельным сообщением.';
const QUESTIONNAIRE_COMPLETED = '✅ <b>Анкета 2 получена</b>\n\nСпасибо, что заполнили анкету. Переходите к изучению материалов группы и следуйте инструкциям. Когда дойдёте до соответствующего этапа, вернитесь в бота.';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
}

async function claim(type, token) {
  if (type === 'test_1_completed') return (await sql`
    UPDATE candidate_tests t SET completion_notice_sent_at=NOW(),updated_at=NOW()
    FROM candidates c WHERE t.candidate_id=c.id AND t.token=${token} AND t.submitted_at IS NOT NULL
      AND t.completion_notice_sent_at IS NULL RETURNING t.id,c.id AS candidate_id,c.chat_id
  `).rows[0];
  if (type === 'questionnaire_2_completed') return (await sql`
    UPDATE candidate_questionnaire_two q SET completion_notice_sent_at=NOW(),updated_at=NOW()
    FROM candidates c WHERE q.candidate_id=c.id AND q.token=${token} AND q.submitted_at IS NOT NULL
      AND q.completion_notice_sent_at IS NULL RETURNING q.id,c.id AS candidate_id,c.chat_id
  `).rows[0];
  return null;
}

async function release(type, id) {
  if (type === 'test_1_completed') await sql`UPDATE candidate_tests SET completion_notice_sent_at=NULL,updated_at=NOW() WHERE id=${id}`;
  if (type === 'questionnaire_2_completed') await sql`UPDATE candidate_questionnaire_two SET completion_notice_sent_at=NULL,updated_at=NOW() WHERE id=${id}`;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  try {
    await init();
    const type = String(req.body?.type || ''), token = String(req.body?.token || '').trim();
    if (!/^[a-f0-9]{48,80}$/i.test(token) || !['test_1_completed','questionnaire_2_completed'].includes(type)) return json(res, 400, { error: 'Invalid event' });
    const item = await claim(type, token);
    if (!item) {
      let drive = null;
      if (type === 'test_1_completed') {
        const existing=(await sql`SELECT candidate_id FROM candidate_tests WHERE token=${token} AND submitted_at IS NOT NULL LIMIT 1`).rows[0];
        if (existing) try { drive=await syncDriveCandidate(existing.candidate_id); } catch (error) { drive={ok:false,error:String(error?.message||error)}; }
      }
      return json(res, 200, { ok: true, status: 'already_processed', drive });
    }
    const message = type === 'test_1_completed' ? TEST_COMPLETED : QUESTIONNAIRE_COMPLETED;
    try {
      const messageId = await telegram(item.chat_id, message);
      await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) VALUES(${item.candidate_id},'out',${type},${message},'delivered',${String(messageId || '')})`;
    } catch (error) {
      await release(type, item.id);
      throw error;
    }
    let drive = null;
    if (type === 'test_1_completed') {
      for(let attempt=1;attempt<=3;attempt++){
        try { drive = await syncDriveCandidate(item.candidate_id); break; }
        catch (error) { drive = { ok: false, error: String(error?.message || error) }; if(attempt<3) await new Promise(resolve=>setTimeout(resolve,1000*attempt)); }
      }
      if(drive?.ok===false) console.error('[progression] drive sync failed', { candidateId: item.candidate_id, error: drive.error });
    }
    return json(res, 200, { ok: true, status: 'processed', candidateId: item.candidate_id, drive });
  } catch (error) {
    console.error('[progression] failed', String(error?.message || error));
    return json(res, 500, { error: 'Progression failed' });
  }
}
