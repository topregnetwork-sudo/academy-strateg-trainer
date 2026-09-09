import { telegram, sql } from '../api/_core.js';
import { createTask, effect, initFunnel } from './funnel-store.js';
import crypto from 'node:crypto';

const OFFER = `Добрый день, {name}!

Спасибо, что подождали.

Мы внимательно рассмотрели ваш опыт. Сейчас в основную программу мы набираем людей без опыта бизнес-тренера — это особенность текущего набора, а не оценка вашей компетентности и квалификации.

Мы ценим ваш опыт и видим, что он может быть полезен в других направлениях Академии Стратег.

Предлагаем оставаться на связи и рассмотреть возможные варианты сотрудничества с Академией.

Если вам это интересно, нажмите кнопку ниже. Чуть позже мы пришлём приглашение в отдельный чат, где можно будет спокойно обсудить возможные форматы взаимодействия.`;

const BUTTONS = {
  reply_markup: { inline_keyboard: [
    [{ text: 'Да, интересно', callback_data: 'experienced_collaboration_yes' }],
    [{ text: 'Нет, спасибо', callback_data: 'experienced_collaboration_no' }],
  ] },
};

const botBlocked = error => /bot was blocked by the user/i.test(String(error?.message || error || ''));
const nameOf = candidate => String(candidate.first_name || 'коллега').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const stableId = key => { const s = crypto.createHash('sha256').update(key).digest('hex').slice(0,32); return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`; };
async function scheduleClose(candidateId) {
  try {
    await createTask('experienced_collaboration_close_084', { candidateId: Number(candidateId) }, new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), stableId(`experienced-collaboration-close-084:${candidateId}`));
    return true;
  } catch (error) {
    console.error('[experienced-close-084]', candidateId, String(error?.message || error));
    return false;
  }
}

export async function reconcileExperiencedBacklog082(apply = false) {
  await initFunnel();
  const rows = (await sql`
    SELECT id,chat_id,first_name,status
    FROM candidates
    WHERE status='experienced_not_target' AND consent=true
    ORDER BY id
  `).rows;
  const result = { due: rows.length, sent: 0, blockedClosed: 0, failed: 0 };
  if (!apply) return result;
  for (const candidate of rows) {
    const text = OFFER.replace('{name}', nameOf(candidate));
    const existing = (await sql`SELECT id FROM messages WHERE candidate_id=${candidate.id} AND kind='experienced_collaboration_offer' LIMIT 1`).rows[0];
    if (existing) {
      await scheduleClose(candidate.id);
      continue;
    }
    try {
      const messageId = await effect(`experienced-backlog-082:${candidate.id}`, () => telegram(candidate.chat_id, text, BUTTONS));
      await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id)
        SELECT ${candidate.id},'out','experienced_collaboration_offer',${text},'delivered',${String(messageId || '')}
        WHERE NOT EXISTS(SELECT 1 FROM messages WHERE candidate_id=${candidate.id} AND kind='experienced_collaboration_offer')`;
      await scheduleClose(candidate.id);
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

export async function runExperiencedCollaborationClose084(candidateId) {
  await initFunnel();
  const candidate = (await sql`SELECT id,status FROM candidates WHERE id=${Number(candidateId)} AND status='experienced_not_target' LIMIT 1`).rows[0];
  if (!candidate) return { done: true, skipped: 'stage_changed' };
  const offer = (await sql`SELECT created_at FROM messages WHERE candidate_id=${candidate.id} AND direction='out' AND kind='experienced_collaboration_offer' ORDER BY created_at DESC LIMIT 1`).rows[0];
  const answer = (await sql`SELECT created_at FROM messages WHERE candidate_id=${candidate.id} AND direction='in' AND kind IN ('experienced_collaboration_choice','telegram_message') ORDER BY created_at DESC LIMIT 1`).rows[0];
  if (!offer) return { done: true, skipped: 'no_offer' };
  if (answer && new Date(answer.created_at) > new Date(offer.created_at)) return { done: true, skipped: 'answered_or_attention' };
  const changed = (await sql`UPDATE candidates SET status='reserve_no_response',consent=FALSE,updated_at=NOW() WHERE id=${candidate.id} AND status='experienced_not_target' RETURNING id`).rows[0];
  if (changed) await sql`INSERT INTO funnel_stage_events(candidate_id,project_id,from_status,to_status,trigger,actor)
    SELECT ${candidate.id},id,'experienced_not_target','reserve_no_response','experienced_no_answer_084','system'
    FROM funnel_projects WHERE project_key='academy-trainer'`;
  return { done: true, closed: Boolean(changed) };
}
