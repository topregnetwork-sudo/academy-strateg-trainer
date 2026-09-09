import { telegram, sql } from '../api/_core.js';
import { effect, initFunnel } from './funnel-store.js';

const OFFER = `Добрый день, {name}!

Спасибо, что откликнулись на предложение Академии Стратег. Просим прощения за поздний ответ: нам нужно было собрать необходимые данные и принять решение по текущему набору.

Мы внимательно рассмотрели ваш опыт. Сейчас в основную программу мы набираем людей без опыта бизнес-тренера — это особенность текущего набора, а не оценка вашей компетентности и квалификации.

Мы ценим ваш опыт и видим, что он может быть полезен в других направлениях Академии Стратег.

Предлагаем оставаться на связи и рассмотреть возможные варианты сотрудничества с Академией.

Если вам это интересно, нажмите кнопку ниже. Мы пригласим вас в отдельный чат, где можно будет спокойно обсудить возможные форматы взаимодействия.`;

const BUTTONS = {
  reply_markup: { inline_keyboard: [
    [{ text: 'Да, интересно', callback_data: 'experienced_collaboration_yes' }],
    [{ text: 'Нет, спасибо', callback_data: 'experienced_collaboration_no' }],
  ] },
};

const botBlocked = error => /bot was blocked by the user/i.test(String(error?.message || error || ''));
const nameOf = candidate => String(candidate.first_name || 'коллега').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');

export async function reconcileExperiencedBacklog082(apply = false) {
  await initFunnel();
  const rows = (await sql`
    SELECT id,chat_id,first_name,status
    FROM candidates
    WHERE status='experienced_not_target' AND consent=true
      AND NOT EXISTS(SELECT 1 FROM messages WHERE candidate_id=candidates.id AND kind='experienced_collaboration_offer')
    ORDER BY id
  `).rows;
  const result = { due: rows.length, sent: 0, blockedClosed: 0, failed: 0 };
  if (!apply) return result;
  for (const candidate of rows) {
    const text = OFFER.replace('{name}', nameOf(candidate));
    try {
      const messageId = await effect(`experienced-backlog-082:${candidate.id}`, () => telegram(candidate.chat_id, text, BUTTONS));
      await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id)
        SELECT ${candidate.id},'out','experienced_collaboration_offer',${text},'delivered',${String(messageId || '')}
        WHERE NOT EXISTS(SELECT 1 FROM messages WHERE candidate_id=${candidate.id} AND kind='experienced_collaboration_offer')`;
      result.sent++;
    } catch (error) {
      if (botBlocked(error)) {
        const changed = (await sql`UPDATE candidates SET status='reserve_no_response',consent=FALSE,updated_at=NOW() WHERE id=${candidate.id} AND status='experienced_not_target' RETURNING id`).rows[0];
        if (changed) {
          await sql`INSERT INTO funnel_stage_events(candidate_id,project_id,from_status,to_status,trigger,actor)
            SELECT ${candidate.id},id,'experienced_not_target','reserve_no_response','experienced_bot_blocked_082','system'
            FROM funnel_projects WHERE project_key='academy-trainer'`;
          result.blockedClosed++;
        }
      } else {
        await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id)
          VALUES(${candidate.id},'out','experienced_collaboration_offer',${text},'failed',NULL)`;
        result.failed++;
      }
    }
  }
  return result;
}
