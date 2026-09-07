import { telegram } from '../api/_core.js';
import { createTask, effect, sql } from './funnel-store.js';
import crypto from 'node:crypto';

export const PRODUCTIVITY_TOPICS = Object.freeze({
  passed: 1071,
  reserve: 1073,
});

export const PRODUCTIVITY_PASS_MESSAGE = `Спасибо большое, что вы с нами!

Вы переходите на следующий этап отбора. Сейчас мы собираем как можно больше данных по другим кандидатам, чтобы принять взвешенное решение.

Чуть позже мы пригласим вас на следующее тестирование. Пожалуйста, ожидайте нашего сообщения.`;

export const PRODUCTIVITY_RESERVE_MESSAGE = `Спасибо, что проявили интерес к Академии Стратег и захотели познакомиться с нами.

Для нас это по-настоящему важно. Мы объединяем людей, которым близка наша цель — помогать владельцам бизнеса превращать знания в результат. Мы ценим ваше желание быть частью такого дела и видим возможность для дальнейшего взаимодействия.

Сейчас мы формируем ближайший состав команды. Когда появится подходящая роль или формат сотрудничества, мы в первую очередь вернёмся к тем, кто уже познакомился с Академией и разделяет наш подход.

Предлагаем сохранить с вами связь в кадровом резерве Академии Стратег. Если вы согласны, подтвердите это кнопкой ниже.`;

export const PRODUCTIVITY_RESERVE_CONFIRMATION = `Спасибо, что остаётесь с нами на связи.

Мы сохранили ваш контакт в кадровом резерве Академии Стратег. Вы уже познакомились с нашим подходом, поэтому при появлении подходящего формата взаимодействия в первую очередь вернёмся к вам.

Текущая группа кандидатов предназначена для активного потока отбора, поэтому мы бережно отключим вас от неё, чтобы материалы и маршруты не смешивались. Когда подготовим отдельный формат общения для кадрового резерва, пригласим вас туда отдельно.

Будем рады продолжить общение и вместе искать точку, в которой сможем быть друг другу полезны.`;

export const PRODUCTIVITY_RESERVE_DECLINED = `Спасибо за открытый ответ.

Благодарим за интерес к Академии Стратег и время, которое вы уделили знакомству с нами. Желаем вам сильной команды, интересных задач и хороших возможностей.`;

export const PRODUCTIVITY_RESERVE_REMINDER_MESSAGE = `Мы бережно напоминаем о предложении кадрового резерва Академии Стратег.

Для нас важно понимать, хотели бы вы оставаться с нами на связи и рассматривать будущие форматы взаимодействия. Пожалуйста, выберите удобный для вас ответ ниже — это поможет нам корректно спланировать дальнейший маршрут.`;

export const PRODUCTIVITY_RESERVE_NO_RESPONSE_MESSAGE = `Мы пока не получили ваш ответ по кадровому резерву, поэтому завершаем текущий маршрут отбора.

Спасибо за интерес к Академии Стратег и время, которое вы уделили знакомству с нами. Если позже захотите вернуться к разговору о взаимодействии, напишите нам в этот бот.`;

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
    reserve_group_removal_state TEXT,
    reserve_group_removed_at TIMESTAMPTZ,
    reserve_group_removal_error TEXT,
    reserve_reminded_at TIMESTAMPTZ,
    reserve_response_due_at TIMESTAMPTZ,
    reserve_closed_no_response_at TIMESTAMPTZ,
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
  await sql`ALTER TABLE candidate_productivity_outreach ADD COLUMN IF NOT EXISTS reserve_group_removal_state TEXT`;
  await sql`ALTER TABLE candidate_productivity_outreach ADD COLUMN IF NOT EXISTS reserve_group_removed_at TIMESTAMPTZ`;
  await sql`ALTER TABLE candidate_productivity_outreach ADD COLUMN IF NOT EXISTS reserve_group_removal_error TEXT`;
  await sql`ALTER TABLE candidate_productivity_outreach ADD COLUMN IF NOT EXISTS reserve_reminded_at TIMESTAMPTZ`;
  await sql`ALTER TABLE candidate_productivity_outreach ADD COLUMN IF NOT EXISTS reserve_response_due_at TIMESTAMPTZ`;
  await sql`ALTER TABLE candidate_productivity_outreach ADD COLUMN IF NOT EXISTS reserve_closed_no_response_at TIMESTAMPTZ`;
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

export function reserveStaffText(candidate, removal = {}) {
  const groupState = removal.reserve_group_removal_state === 'removed'
    ? 'Из группы текущего отбора: исключён.'
    : removal.reserve_group_removal_state === 'already_outside'
      ? 'Из группы текущего отбора: уже был вне группы.'
      : removal.reserve_group_removal_state === 'attention'
        ? 'Из группы текущего отбора: требуется проверка в карточке кандидата.'
        : 'Из группы текущего отбора: состояние ещё не подтверждено.';
  return `🗂 КАДРОВЫЙ РЕЗЕРВ — СОГЛАСИЕ ПОЛУЧЕНО\n\n${staffLine(candidate)}\n\nКандидат подтвердил согласие оставаться в кадровом резерве.\n${groupState}`;
}

async function saveCandidateMessage(candidate, kind, text, messageId) {
  await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id)
    SELECT ${candidate.id},'out',${kind},${text},'delivered',${String(messageId || '')}
    WHERE NOT EXISTS(SELECT 1 FROM messages WHERE candidate_id=${candidate.id} AND direction='out' AND telegram_message_id=${String(messageId || '')})`;
}

function reserveTaskId(candidateId, step) {
  const value = crypto.createHash('sha256').update(`productivity-reserve-066:${candidateId}:${step}`).digest('hex').slice(0, 32);
  return `${value.slice(0,8)}-${value.slice(8,12)}-${value.slice(12,16)}-${value.slice(16,20)}-${value.slice(20)}`;
}

async function scheduleReserveTask(candidateId, step, dueAt) {
  await createTask('productivity_reserve_followup_066', { candidateId: Number(candidateId), step }, dueAt, reserveTaskId(candidateId, step));
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
    if (result === 'productivity_failed') {
      const dueAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
      await sql`UPDATE candidate_productivity_outreach SET reserve_response_due_at=${dueAt},updated_at=NOW() WHERE candidate_id=${candidate.id}`;
      try { await scheduleReserveTask(candidate.id, 'reminder', dueAt); }
      catch (error) { await sql`UPDATE candidate_productivity_outreach SET error=${'Не удалось назначить напоминание: '+String(error?.message || error).slice(0,420)},updated_at=NOW() WHERE candidate_id=${candidate.id}`; }
    }
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

export async function runReserveFollowup(candidateId, step) {
  await ensureProductivityOutcomeStore();
  const candidate = await candidateForOutcome(candidateId);
  const outreach = (await sql`SELECT * FROM candidate_productivity_outreach WHERE candidate_id=${Number(candidateId)} AND result='productivity_failed' LIMIT 1`).rows[0];
  if (!candidate || !outreach || outreach.reserve_choice || candidate.status !== 'productivity_failed') return { done: true, skipped: true };
  if (step === 'reminder') {
    const messageId = await effect(`productivity-reserve:reminder:${candidate.id}`, () => telegram(candidate.chat_id, PRODUCTIVITY_RESERVE_REMINDER_MESSAGE, { reply_markup: PRODUCTIVITY_RESERVE_BUTTONS }));
    await saveCandidateMessage(candidate, 'productivity_reserve_reminder', PRODUCTIVITY_RESERVE_REMINDER_MESSAGE, messageId);
    const dueAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    await sql`UPDATE candidate_productivity_outreach SET reserve_reminded_at=NOW(),reserve_response_due_at=${dueAt},error=NULL,updated_at=NOW() WHERE candidate_id=${candidate.id}`;
    try { await scheduleReserveTask(candidate.id, 'close', dueAt); }
    catch (error) { await sql`UPDATE candidate_productivity_outreach SET error=${'Не удалось назначить закрытие маршрута: '+String(error?.message || error).slice(0,400)},updated_at=NOW() WHERE candidate_id=${candidate.id}`; }
    return { done: true, reminderSent: true };
  }
  if (step === 'close') {
    const changed = (await sql`UPDATE candidates SET status='reserve_no_response',updated_at=NOW() WHERE id=${candidate.id} AND status='productivity_failed' RETURNING id`).rows[0];
    if (!changed) return { done: true, skipped: true };
    const messageId = await effect(`productivity-reserve:close:${candidate.id}`, () => telegram(candidate.chat_id, PRODUCTIVITY_RESERVE_NO_RESPONSE_MESSAGE));
    await saveCandidateMessage(candidate, 'productivity_reserve_no_response', PRODUCTIVITY_RESERVE_NO_RESPONSE_MESSAGE, messageId);
    await sql`UPDATE candidate_productivity_outreach SET reserve_closed_no_response_at=NOW(),reserve_response_due_at=NULL,error=NULL,updated_at=NOW() WHERE candidate_id=${candidate.id}`;
    await sql`INSERT INTO funnel_stage_events(candidate_id,project_id,from_status,to_status,trigger,actor)
      SELECT ${candidate.id},id,'productivity_failed','reserve_no_response','productivity_reserve_no_response','system'
      FROM funnel_projects WHERE project_key='academy-trainer'`;
    return { done: true, closed: true };
  }
  throw new Error('Неизвестный шаг кадрового резерва');
}

export async function sendReserveTopicNotice(candidateId) {
  await ensureProductivityOutcomeStore();
  const candidate = await candidateForOutcome(candidateId);
  if (!candidate) throw new Error('Кандидат не найден');
  const existing = (await sql`SELECT reserve_topic_message_sent_at,reserve_group_removal_state,reserve_group_removed_at,reserve_group_removal_error FROM candidate_productivity_outreach WHERE candidate_id=${candidate.id} LIMIT 1`).rows[0];
  if (existing?.reserve_topic_message_sent_at) return { already: true };
  const messageId = await effect(`productivity-reserve:staff:${candidate.id}`, () => telegram(
    '-1004397133749',
    reserveStaffText(candidate, existing),
    { message_thread_id: PRODUCTIVITY_TOPICS.reserve, parse_mode: undefined, disable_web_page_preview: true },
  ));
  await sql`UPDATE candidate_productivity_outreach SET reserve_topic_message_id=${String(messageId || '')},reserve_topic_message_sent_at=NOW(),error=NULL,updated_at=NOW() WHERE candidate_id=${candidate.id}`;
  return { already: false, messageId };
}
