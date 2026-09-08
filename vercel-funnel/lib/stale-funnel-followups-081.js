import crypto from 'node:crypto';
import { telegram } from '../api/_core.js';
import { createTask, effect, initFunnel, sql } from './funnel-store.js';
import { removeFromCandidateGroup } from './candidate-group-removal-078.js';
import { sendProductivityOutcome } from './productivity-outcomes-064.js';

const SITE = 'https://topregnetwork-sudo.github.io/academy-strateg-trainer';
const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;
const taskId = key => { const hash = crypto.createHash('sha256').update(key).digest('hex').slice(0, 32); return `${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20)}`; };

async function init() {
  await initFunnel();
  await sql`CREATE TABLE IF NOT EXISTS candidate_followups081(candidate_id BIGINT NOT NULL,step TEXT NOT NULL,issued_at TIMESTAMPTZ NOT NULL,reminder_due_at TIMESTAMPTZ NOT NULL,reminder_sent_at TIMESTAMPTZ,close_due_at TIMESTAMPTZ,state TEXT NOT NULL DEFAULT 'scheduled',reminder_message_id TEXT,closure_message_id TEXT,error TEXT,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(candidate_id,step))`;
  await sql`ALTER TABLE candidate_followups081 ENABLE ROW LEVEL SECURITY`;
}

async function context(candidateId) {
  const candidate = (await sql`SELECT * FROM candidates WHERE id=${Number(candidateId)} LIMIT 1`).rows[0];
  if (!candidate) return null;
  const questionnaire = (await sql`SELECT * FROM candidate_questionnaire_two WHERE candidate_id=${candidate.id} LIMIT 1`).rows[0] || null;
  const test = (await sql`SELECT * FROM candidate_tests WHERE candidate_id=${candidate.id} ORDER BY created_at DESC LIMIT 1`).rows[0] || null;
  const application = (await sql`SELECT code FROM applications WHERE candidate_id=${candidate.id} ORDER BY created_at DESC LIMIT 1`).rows[0] || null;
  return { candidate, questionnaire, test, application };
}

function issuedAt(item, step) {
  if (step === 'primary') return item.candidate.created_at;
  if (step === 'q2') return item.questionnaire?.sent_at;
  if (step === 'test1') return item.test?.sent_at || item.questionnaire?.submitted_at;
  return null;
}

function active(item, step) {
  const c = item?.candidate;
  if (!c?.consent) return false;
  if (step === 'primary') return c.status === 'new' && !c.interview_at;
  if (step === 'q2') return c.status === 'questionnaire' && !item.questionnaire?.submitted_at;
  if (step === 'test1') return c.status === 'questionnaire' && Boolean(item.questionnaire?.submitted_at) && !item.test?.submitted_at;
  return false;
}

function copy(item, step) {
  if (step === 'primary') return {
    text: 'Здравствуйте! Вы оставили заявку на роль тренера Академии Стратег. Пожалуйста, выберите удобное время первого собеседования по кнопке ниже. Если вакансия для вас больше не актуальна, напишите в ответ: «не актуально».',
    extra: { reply_markup: { inline_keyboard: Object.entries({ 'mon-0800':'Понедельник, 08:00 МСК','tue-0800':'Вторник, 08:00 МСК','wed-0800':'Среда, 08:00 МСК','thu-1800':'Четверг, 18:00 МСК','fri-1800':'Пятница, 18:00 МСК','sat-0600':'Суббота, 06:00 МСК' }).map(([slot, label]) => [{ text: label, callback_data: `trainer_slot_${item.application?.code}_${slot}` }]) } },
  };
  if (step === 'q2') return {
    text: 'Здравствуйте! Напоминаем: для продолжения отбора нужно заполнить Анкету 2. Откройте её по кнопке ниже. Если вакансия для вас больше не актуальна, напишите в ответ: «не актуально».',
    extra: { reply_markup: { inline_keyboard: [[{ text: 'Заполнить Анкету 2', url: `${SITE}/questionnaire-2.html?token=${item.questionnaire.token}` }]] } },
  };
  if (item.test?.token) return {
    text: 'Здравствуйте! Напоминаем: следующий шаг отбора — Тест 1. Откройте персональную ссылку по кнопке ниже. Если вакансия для вас больше не актуальна, напишите в ответ: «не актуально».',
    extra: { reply_markup: { inline_keyboard: [[{ text: 'Пройти Тест 1', url: `${SITE}/test.html?token=${item.test.token}` }]] } },
  };
  return { text: 'Здравствуйте! Вы заполнили Анкету 2. Напоминаем: чтобы перейти к Тесту 1, вернитесь в бот и напишите «тест». Если вакансия для вас больше не актуальна, напишите в ответ: «не актуально».', extra: {} };
}

function closure(step) {
  if (step === 'primary') return 'Мы не получили ответ на приглашение к первому собеседованию, поэтому завершаем текущий маршрут отбора. Спасибо за интерес к Академии Стратег. Если позже захотите вернуться к разговору, напишите нам в этот бот.';
  return 'Мы не получили завершённый следующий шаг после напоминания, поэтому завершаем текущий маршрут отбора. Спасибо за интерес к Академии Стратег и уделённое время. Если позже захотите вернуться к разговору, напишите нам в этот бот.';
}

const botBlocked = error => /bot was blocked by the user/i.test(String(error?.message || error || ''));

async function closeUnreachable(item, step, error) {
  if (step !== 'primary') await removeFromCandidateGroup(item.candidate).catch(() => null);
  const next = step === 'primary' ? 'reserve_no_response' : 'test_1_incomplete_removed';
  const changed = (await sql`UPDATE candidates SET status=${next},consent=FALSE,updated_at=NOW() WHERE id=${item.candidate.id} AND status=${item.candidate.status} RETURNING id`).rows[0];
  await sql`UPDATE candidate_followups081 SET state='closed',error=${String(error?.message || error || 'Бот недоступен').slice(0,400)},updated_at=NOW() WHERE candidate_id=${item.candidate.id} AND step=${step}`;
  if (changed) await sql`INSERT INTO funnel_stage_events(candidate_id,project_id,from_status,to_status,trigger,actor) SELECT ${item.candidate.id},id,${item.candidate.status},${next},'bot_blocked_081','system' FROM funnel_projects WHERE project_key='academy-trainer'`;
  return { done: true, closed: true, deliveryFailed: true };
}

async function closeBlockedReserve(candidateId, expectedStatus, error) {
  const changed = (await sql`UPDATE candidates SET status='reserve_no_response',consent=FALSE,updated_at=NOW() WHERE id=${Number(candidateId)} AND status=${expectedStatus} RETURNING id`).rows[0];
  if (changed) await sql`INSERT INTO funnel_stage_events(candidate_id,project_id,from_status,to_status,trigger,actor) SELECT ${Number(candidateId)},id,${expectedStatus},'reserve_no_response','bot_blocked_081','system' FROM funnel_projects WHERE project_key='academy-trainer'`;
  return Boolean(changed);
}

export async function scheduleFollowup081(candidateId, step) {
  await init();
  const item = await context(candidateId), start = item && issuedAt(item, step);
  if (!item || !active(item, step) || !start) return { skipped: true };
  const due = new Date(new Date(start).getTime() + THREE_DAYS);
  await sql`INSERT INTO candidate_followups081(candidate_id,step,issued_at,reminder_due_at) VALUES(${item.candidate.id},${step},${start},${due}) ON CONFLICT(candidate_id,step) DO NOTHING`;
  const row = (await sql`SELECT * FROM candidate_followups081 WHERE candidate_id=${item.candidate.id} AND step=${step}`).rows[0];
  if (row.state === 'scheduled') await createTask('stale_funnel_followup_081', { candidateId: item.candidate.id, step, phase: 'remind' }, new Date(row.reminder_due_at), taskId(`followup081:remind:${item.candidate.id}:${step}`));
  return { scheduled: true, dueAt: row.reminder_due_at };
}

export async function runFollowup081(candidateId, step, phase = 'remind') {
  await init();
  const row = (await sql`SELECT * FROM candidate_followups081 WHERE candidate_id=${Number(candidateId)} AND step=${step}`).rows[0];
  const item = await context(candidateId);
  if (!row || !item || !active(item, step)) { if (row) await sql`UPDATE candidate_followups081 SET state='resolved',updated_at=NOW() WHERE candidate_id=${Number(candidateId)} AND step=${step}`; return { done: true, skipped: true }; }
  if (phase === 'remind') {
    if (row.state === 'attention' && botBlocked(row.error)) return closeUnreachable(item, step, row.error);
    if (row.state !== 'scheduled') return { done: true, skipped: true };
    const human = (await sql`SELECT 1 FROM messages WHERE candidate_id=${item.candidate.id} AND direction='in' AND kind<>'link_open' AND created_at>${row.issued_at} LIMIT 1`).rows[0];
    if (human) {
      await sql`UPDATE candidate_followups081 SET state='attention',error='Кандидат ответил до напоминания',updated_at=NOW() WHERE candidate_id=${item.candidate.id} AND step=${step}`;
      return { done: true, attention: true };
    }
    const reminder = copy(item, step);
    let messageId;
    try {
      messageId = await effect(`followup081:remind:${item.candidate.id}:${step}`, () => telegram(item.candidate.chat_id, reminder.text, reminder.extra));
    } catch (error) {
      if (botBlocked(error)) return closeUnreachable(item, step, error);
      await sql`UPDATE candidate_followups081 SET state='attention',error=${String(error.message || error).slice(0,400)},updated_at=NOW() WHERE candidate_id=${item.candidate.id} AND step=${step}`;
      return { done: true, attention: true, deliveryFailed: true };
    }
    await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) VALUES(${item.candidate.id},'out',${`followup081_${step}_reminder`},${reminder.text},'delivered',${String(messageId || '')})`;
    const closeDue = new Date(Date.now() + THREE_DAYS);
    await sql`UPDATE candidate_followups081 SET state='reminded',reminder_sent_at=NOW(),reminder_message_id=${String(messageId || '')},close_due_at=${closeDue},error=NULL,updated_at=NOW() WHERE candidate_id=${item.candidate.id} AND step=${step}`;
    await createTask('stale_funnel_followup_081', { candidateId: item.candidate.id, step, phase: 'close' }, closeDue, taskId(`followup081:close:${item.candidate.id}:${step}`));
    return { done: true, reminded: true };
  }
  if (row.state !== 'reminded') return { done: true, skipped: true };
  const human = (await sql`SELECT 1 FROM messages WHERE candidate_id=${item.candidate.id} AND direction='in' AND kind<>'link_open' AND created_at>${row.reminder_sent_at} LIMIT 1`).rows[0];
  if (human) { await sql`UPDATE candidate_followups081 SET state='attention',error='Кандидат ответил после напоминания',updated_at=NOW() WHERE candidate_id=${item.candidate.id} AND step=${step}`; return { done: true, attention: true }; }
  if (step !== 'primary') {
    const removed = await removeFromCandidateGroup(item.candidate);
    if (!removed.removed && removed.reason !== 'already_outside') { await sql`UPDATE candidate_followups081 SET state='attention',error=${String(removed.error || removed.reason || 'Не удалось исключить из группы').slice(0,400)},updated_at=NOW() WHERE candidate_id=${item.candidate.id} AND step=${step}`; return { done: true, attention: true }; }
  }
  const next = step === 'primary' ? 'reserve_no_response' : 'test_1_incomplete_removed';
  const changed = (await sql`UPDATE candidates SET status=${next},consent=FALSE,updated_at=NOW() WHERE id=${item.candidate.id} AND status=${item.candidate.status} RETURNING id`).rows[0];
  if (!changed) return { done: true, skipped: true };
  const text = closure(step), messageId = await effect(`followup081:close:${item.candidate.id}:${step}`, () => telegram(item.candidate.chat_id, text));
  await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) VALUES(${item.candidate.id},'out',${`followup081_${step}_closed`},${text},'delivered',${String(messageId || '')})`;
  await sql`UPDATE candidate_followups081 SET state='closed',closure_message_id=${String(messageId || '')},error=NULL,updated_at=NOW() WHERE candidate_id=${item.candidate.id} AND step=${step}`;
  await sql`INSERT INTO funnel_stage_events(candidate_id,project_id,from_status,to_status,trigger,actor) SELECT ${item.candidate.id},id,${item.candidate.status},${next},'stale_followup_081','system' FROM funnel_projects WHERE project_key='academy-trainer'`;
  return { done: true, closed: true };
}

export async function reconcileStaleFunnel081(apply = false) {
  await init();
  const rows = (await sql`SELECT id,status FROM candidates WHERE consent=true AND status IN ('new','questionnaire','productivity_invited','productivity_failed') ORDER BY id`).rows;
  const result = { primary: { due: 0, sent: 0, closed: 0 }, q2: { due: 0, sent: 0, closed: 0 }, test1: { due: 0, sent: 0, closed: 0 }, reserve: { due: 0, sent: 0, closed: 0 }, attention: 0, errors: [] };
  for (const candidate of rows) try {
    if (candidate.status === 'productivity_invited') {
      result.reserve.due++;
      if (apply) {
        const moved = (await sql`UPDATE candidates SET status='productivity_failed',updated_at=NOW() WHERE id=${candidate.id} AND status='productivity_invited' RETURNING id`).rows[0];
        if (moved) {
          await sql`INSERT INTO funnel_stage_events(candidate_id,project_id,from_status,to_status,trigger,actor) SELECT ${candidate.id},id,'productivity_invited','productivity_failed','stale_followup_081','system' FROM funnel_projects WHERE project_key='academy-trainer'`;
          try { await sendProductivityOutcome(candidate.id, 'productivity_failed'); result.reserve.sent++; }
          catch (error) { if (botBlocked(error)) { if (await closeBlockedReserve(candidate.id, 'productivity_failed', error)) result.reserve.closed++; } else throw error; }
        }
      }
      continue;
    }
    if (candidate.status === 'productivity_failed') {
      const has = (await sql`SELECT candidate_message_sent_at FROM candidate_productivity_outreach WHERE candidate_id=${candidate.id} LIMIT 1`).rows[0];
      if (!has?.candidate_message_sent_at) {
        result.reserve.due++;
        if (apply) {
          try { await sendProductivityOutcome(candidate.id, 'productivity_failed'); result.reserve.sent++; }
          catch (error) { if (botBlocked(error)) { if (await closeBlockedReserve(candidate.id, 'productivity_failed', error)) result.reserve.closed++; } else throw error; }
        }
      }
      continue;
    }
    const item = await context(candidate.id);
    const step = candidate.status === 'new' ? 'primary' : (!item.questionnaire?.submitted_at ? 'q2' : 'test1');
    const start = issuedAt(item, step); if (!start) continue;
    const overdue = new Date(start).getTime() + THREE_DAYS <= Date.now();
    if (overdue) result[step].due++;
    if (apply) {
      await scheduleFollowup081(candidate.id, step);
      if (overdue) { const out = await runFollowup081(candidate.id, step, 'remind'); if (out.reminded) result[step].sent++; if (out.closed) result[step].closed++; if (out.attention) result.attention++; }
    }
  } catch (error) { result.errors.push({ id: candidate.id, error: String(error.message || error).slice(0,180) }); }
  result.followupStates = (await sql`SELECT step,state,count(*)::int AS count FROM candidate_followups081 GROUP BY step,state ORDER BY step,state`).rows;
  return result;
}
