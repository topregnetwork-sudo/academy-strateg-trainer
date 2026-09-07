import { telegram } from '../api/_core.js';
import { effect, sql } from './funnel-store.js';

export const PRODUCTIVITY_TOPICS = Object.freeze({
  passed: 1071,
  reserve: 1073,
});

export const PRODUCTIVITY_PASS_MESSAGE = `Спасибо большое, что вы с нами!

Вы переходите на следующий этап отбора. Сейчас мы собираем как можно больше данных по другим кандидатам, чтобы принять взвешенное решение.

Чуть позже мы пригласим вас на следующее тестирование. Пожалуйста, ожидайте нашего сообщения.`;

export const PRODUCTIVITY_RESERVE_MESSAGE = `Спасибо, что приняли участие в интервью на продуктивность.

Сейчас мы не готовы начать сотрудничество прямо сейчас, но видим потенциал для дальнейшего взаимодействия и приглашаем вас в кадровый резерв Академии Стратег.

Если вы согласны, мы сможем связаться с вами позже и обсудить подходящие возможности.`;

export const PRODUCTIVITY_RESERVE_BUTTONS = {
  inline_keyboard: [[
    { text: 'Да, в кадровый резерв', callback_data: 'productivity_reserve_yes' },
    { text: 'Нет, спасибо', callback_data: 'productivity_reserve_no' },
  ]],
};

export async function ensureProductivityOutcomeStore() {
  await sql`CREATE TABLE IF NOT EXISTS candidate_productivity_outreach(
    candidate_id BIGINT PRIMARY KEY,
    result TEXT NOT NULL,
    message_pending BOOLEAN NOT NULL DEFAULT TRUE,
    candidate_message_id TEXT,
    candidate_message_sent_at TIMESTAMPTZ,
    staff_message_id TEXT,
    staff_message_sent_at TIMESTAMPTZ,
    reserve_choice TEXT,
    reserve_choice_at TIMESTAMPTZ,
    reserve_topic_message_id TEXT,
    reserve_topic_message_sent_at TIMESTAMPTZ,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`ALTER TABLE candidate_productivity_outreach ADD COLUMN IF NOT EXISTS candidate_message_id TEXT`;
  await sql`ALTER TABLE candidate_productivity_outreach ADD COLUMN IF NOT EXISTS candidate_message_sent_at TIMESTAMPTZ`;
  await sql`ALTER TABLE candidate_productivity_outreach ADD COLUMN IF NOT EXISTS staff_message_id TEXT`;
  await sql`ALTER TABLE candidate_productivity_outreach ADD COLUMN IF NOT EXISTS staff_message_sent_at TIMESTAMPTZ`;
  await sql`ALTER TABLE candidate_productivity_outreach ADD COLUMN IF NOT EXISTS reserve_choice TEXT`;
  await sql`ALTER TABLE candidate_productivity_outreach ADD COLUMN IF NOT EXISTS reserve_choice_at TIMESTAMPTZ`;
  await sql`ALTER TABLE candidate_productivity_outreach ADD COLUMN IF NOT EXISTS reserve_topic_message_id TEXT`;
  await sql`ALTER TABLE candidate_productivity_outreach ADD COLUMN IF NOT EXISTS reserve_topic_message_sent_at TIMESTAMPTZ`;
  await sql`ALTER TABLE candidate_productivity_outreach ADD COLUMN IF NOT EXISTS error TEXT`;
}

async function candidateForOutcome(candidateId) {
  return (await sql`
    SELECT c.id,c.chat_id,c.username,c.first_name,c.last_name,c.city,c.status,d.folder_url,
      COALESCE(NULLIF(TRIM(a.full_name),''),NULLIF(TRIM(CONCAT_WS(' ',c.first_name,c.last_name)),''),NULLIF(c.username,''),CONCAT('Кандидат №',c.id)) AS full_name
    FROM candidates c
    LEFT JOIN LATERAL (SELECT full_name FROM applications WHERE candidate_id=c.id ORDER BY created_at DESC,id DESC LIMIT 1) a ON TRUE
    LEFT JOIN candidate_drive d ON d.candidate_id=c.id
    WHERE c.id=${Number(candidateId)}
    LIMIT 1
  `).rows[0];
}

function staffLine(candidate) {
  return [
    `Кандидат: ${candidate.full_name}`,
    `Город: ${candidate.city || 'не указан'}`,
    `Telegram: ${candidate.username ? '@' + candidate.username : 'не указан'}`,
    candidate.folder_url ? `Папка кандидата: ${candidate.folder_url}` : 'Папка кандидата: пока не создана',
    `Карточка: https://academy-strateg-trainer.vercel.app/operator.html?candidate_id=${candidate.id}`,
  ].join('\n');
}

export function productivityStaffText(candidate, result) {
  if (result === 'productivity_passed') {
    return `✅ ПРОШЁЛ ИНТЕРВЬЮ НА ПРОДУКТИВНОСТЬ\n\n${staffLine(candidate)}\n\nПереходит на следующий этап тестирования. Персональное сообщение кандидату отправлено.`;
  }
  return `🗂 КАНДИДАТ ПРИГЛАШЁН В КАДРОВЫЙ РЕЗЕРВ\n\n${staffLine(candidate)}\n\nПредложение кадрового резерва отправлено кандидату. Запись в тему сделана после его согласия.`;
}

export function reserveStaffText(candidate) {
  return `🗂 КАДРОВЫЙ РЕЗЕРВ — СОГЛАСИЕ ПОЛУЧЕНО\n\n${staffLine(candidate)}\n\nКандидат подтвердил согласие оставаться в кадровом резерве.`;
}

async function saveCandidateMessage(candidate, kind, text, messageId) {
  await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id)
    SELECT ${candidate.id},'out',${kind},${text},'delivered',${String(messageId || '')}
    WHERE NOT EXISTS(SELECT 1 FROM messages WHERE candidate_id=${candidate.id} AND direction='out' AND telegram_message_id=${String(messageId || '')})`;
}

export async function sendProductivityOutcome(candidateId, result) {
  if (!['productivity_passed', 'productivity_failed'].includes(result)) throw new Error('Неверный результат интервью');
  await ensureProductivityOutcomeStore();
  const candidate = await candidateForOutcome(candidateId);
  if (!candidate) throw new Error('Кандидат не найден');
  await sql`INSERT INTO candidate_productivity_outreach(candidate_id,result,message_pending)
    VALUES(${candidate.id},${result},TRUE) ON CONFLICT(candidate_id) DO UPDATE SET result=EXCLUDED.result,updated_at=NOW()`;
  let outreach = (await sql`SELECT * FROM candidate_productivity_outreach WHERE candidate_id=${candidate.id} LIMIT 1`).rows[0];

  if (!outreach.candidate_message_sent_at) {
    const text = result === 'productivity_passed' ? PRODUCTIVITY_PASS_MESSAGE : PRODUCTIVITY_RESERVE_MESSAGE;
    const messageId = await effect(`productivity-outcome:${result}:candidate:${candidate.id}`, () => telegram(
      candidate.chat_id,
      text,
      result === 'productivity_failed' ? { reply_markup: PRODUCTIVITY_RESERVE_BUTTONS } : {},
    ));
    await saveCandidateMessage(candidate, result === 'productivity_passed' ? 'productivity_passed_notice' : 'productivity_reserve_offer', text, messageId);
    await sql`UPDATE candidate_productivity_outreach SET candidate_message_id=${String(messageId || '')},candidate_message_sent_at=NOW(),error=NULL,updated_at=NOW() WHERE candidate_id=${candidate.id}`;
    outreach = (await sql`SELECT * FROM candidate_productivity_outreach WHERE candidate_id=${candidate.id} LIMIT 1`).rows[0];
  }

  if (result === 'productivity_passed' && !outreach.staff_message_sent_at) {
    const staffMessageId = await effect(`productivity-outcome:${result}:staff:${candidate.id}`, () => telegram(
      '-1004397133749',
      productivityStaffText(candidate, result),
      { message_thread_id: PRODUCTIVITY_TOPICS[result === 'productivity_passed' ? 'passed' : 'reserve'], parse_mode: undefined, disable_web_page_preview: true },
    ));
    await sql`UPDATE candidate_productivity_outreach SET staff_message_id=${String(staffMessageId || '')},staff_message_sent_at=NOW(),error=NULL,updated_at=NOW() WHERE candidate_id=${candidate.id}`;
  }
  await sql`UPDATE candidate_productivity_outreach SET message_pending=FALSE,error=NULL,updated_at=NOW() WHERE candidate_id=${candidate.id}`;
  return { messagePending: false, candidateMessageSent: true, staffMessageSent: result === 'productivity_passed' };
}

export async function sendReserveTopicNotice(candidateId) {
  await ensureProductivityOutcomeStore();
  const candidate = await candidateForOutcome(candidateId);
  if (!candidate) throw new Error('Кандидат не найден');
  const existing = (await sql`SELECT reserve_topic_message_sent_at FROM candidate_productivity_outreach WHERE candidate_id=${candidate.id} LIMIT 1`).rows[0];
  if (existing?.reserve_topic_message_sent_at) return { already: true };
  const messageId = await effect(`productivity-reserve:staff:${candidate.id}`, () => telegram(
    '-1004397133749',
    reserveStaffText(candidate),
    { message_thread_id: PRODUCTIVITY_TOPICS.reserve, parse_mode: undefined, disable_web_page_preview: true },
  ));
  await sql`UPDATE candidate_productivity_outreach SET reserve_topic_message_id=${String(messageId || '')},reserve_topic_message_sent_at=NOW(),error=NULL,updated_at=NOW() WHERE candidate_id=${candidate.id}`;
  return { already: false, messageId };
}
