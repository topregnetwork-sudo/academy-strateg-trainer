import { init, json, telegram, telegramApi, sql, slots } from './_core.js';
import crypto from 'node:crypto';
const trustedScope = Symbol('exact-session');
export async function runExactSession(scope) {
  let status=200,result;
  await handler({headers:{host:'academy-strateg-trainer.vercel.app'},[trustedScope]:scope},{status(s){status=s;return this;},json(v){result=v;return v;}});
  if(status!==200||result?.failed||result?.briefFailed||result?.followupFailed||result?.followupMembershipCheckFailed)throw new Error('Не все действия напоминания завершены');
  return result;
}

const reminderText = '⏰ Напоминаем: ваше собеседование с Академией Стратег начнётся примерно через 30 минут. Пожалуйста, проверьте связь и подготовьтесь к встрече.';
const noShowText = 'Здравствуйте! Вы были записаны на собеседование с Академией Стратег. Если сегодня не получилось подключиться, выберите новое удобное время ниже.\n\nЕсли вакансия для вас больше не актуальна, напишите в ответ: <b>не актуально</b>.';
const rescheduleKeyboard = { inline_keyboard: Object.entries(slots).map(([slotId, title]) => [{ text: title, callback_data: `trainer_rebook_${slotId}` }]) };
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const compact = (value, limit) => { const text = String(value || '').replace(/\s+/g, ' ').trim(); if (limit <= 0) return ''; return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text; };
const moscowDate = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
const moscowReadableDate = value => new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(value));

async function briefDestination() {
  const rows = (await sql`SELECT key,value FROM app_settings WHERE key IN ('hr_brief_chat_id','hr_brief_thread_id')`).rows;
  const settings = Object.fromEntries(rows.map(row => [row.key, row.value]));
  const chatId = settings.hr_brief_chat_id || process.env.HR_BRIEF_CHAT_ID || '';
  const threadId = settings.hr_brief_thread_id || '';
  if (!chatId) throw new Error('Interview brief chat is not configured');
  return { chatId, threadId };
}

async function candidateGroupChatId() {
  const setting = (await sql`SELECT value FROM app_settings WHERE key='candidate_group_chat_id' LIMIT 1`).rows[0]?.value;
  const chatId = setting || process.env.CANDIDATE_GROUP_CHAT_ID || '';
  if (!chatId) throw new Error('Candidate group chat is not configured');
  return String(chatId);
}

async function isCandidateGroupMember(userId, groupChatId) {
  const member = await telegramApi('getChatMember', { chat_id: groupChatId, user_id: Number(userId) });
  return ['creator', 'administrator', 'member', 'restricted'].includes(member?.status);
}

function panelLink(req, session) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'academy-strateg-trainer.vercel.app').split(',')[0].trim();
  const access = process.env.OPERATOR_ACCESS_KEY || '';
  if (!access) throw new Error('Operator access key is not configured');
  const query = new URLSearchParams({ interview_date: moscowDate(session.interview_at), slot_id: session.slot_id }).toString();
  return `https://${host}/operator.html?${query}#access=${encodeURIComponent(access)}`;
}

async function participantsFor(session) {
  return (await sql`
    SELECT c.id,c.first_name,c.last_name,c.username,c.city,c.slot_id,c.interview_at,a.full_name,a.age,a.motivation,a.trainer_experience_level
    FROM candidates c LEFT JOIN applications a ON a.candidate_id=c.id
    WHERE c.status='interview_booked' AND c.consent=true AND c.interview_at=${session.interview_at} AND c.slot_id=${session.slot_id}
    ORDER BY COALESCE(NULLIF(a.full_name,''),NULLIF(c.first_name,''),NULLIF(c.username,'')),c.id
  `).rows;
}

function buildBrief(session, participants, { test = false } = {}) {
  const heading = test ? '🧪 <b>ТЕСТОВЫЙ БРИФ НА ЗАВТРА</b>' : '📋 <b>Собеседование через 30 минут</b>';
  const header = [heading, `Дата: <b>${escapeHtml(moscowReadableDate(session.interview_at))}</b>`, `Время: <b>${escapeHtml(slots[session.slot_id] || session.slot_id)}</b>`, `Участников: <b>${participants.length}</b>`].join('\n');
  const experienceLabels = { none: 'без опыта', occasional: 'отдельные занятия', under_one_year: 'до года', professional: 'профессиональный опыт' };
  const render = (motivationLimit, includeAge = true) => participants.map((person, index) => {
    const name = person.full_name || [person.first_name, person.last_name].filter(Boolean).join(' ') || person.username || `Кандидат ${person.id}`;
    const experience = experienceLabels[person.trainer_experience_level] || 'опыт не указан';
    const facts = [person.city || 'город не указан', experience, includeAge && person.age ? `возраст ${person.age}` : ''].filter(Boolean).join(' · ');
    const motivation = compact(person.motivation, motivationLimit);
    return `${index + 1}. <b>${escapeHtml(name)}</b> — ${escapeHtml(facts)}${motivation ? `\nОпыт/ответ: ${escapeHtml(motivation)}` : ''}`;
  }).join('\n\n');
  let body = render(35), text = `${header}${body ? `\n\n${body}` : '\n\nНа этот слот пока нет зарегистрированных участников.'}`;
  if (text.length > 3800) body = render(0), text = `${header}\n\n${body}`;
  if (text.length > 3800) body = render(0, false), text = `${header}\n\n${body}`;
  return text.length > 3900 ? `${text.slice(0, 3899).trimEnd()}…` : text;
}

async function sendBrief(req, session, { test = false } = {}) {
  const destination = await briefDestination(), participants = await participantsFor(session), link = panelLink(req, session);
  let claimed = false;
  if (!test) {
    const claim = (await sql`INSERT INTO interview_brief_deliveries(interview_at,slot_id,chat_id,thread_id) VALUES(${session.interview_at},${session.slot_id},${destination.chatId},${destination.threadId}) ON CONFLICT(interview_at,chat_id,thread_id) DO NOTHING RETURNING interview_at`).rows;
    if (!claim.length) return { sent: false, skipped: true, participants: participants.length };
    claimed = true;
  }
  try {
    const messageId = await telegram(destination.chatId, buildBrief(session, participants, { test }), {
      ...(destination.threadId ? { message_thread_id: Number(destination.threadId) } : {}),
      reply_markup: { inline_keyboard: [[{ text: 'Открыть участников в панели', url: link }]] }
    });
    if (!test) await sql`UPDATE interview_brief_deliveries SET telegram_message_id=${String(messageId || '')} WHERE interview_at=${session.interview_at} AND chat_id=${destination.chatId} AND thread_id=${destination.threadId}`;
    return { sent: true, skipped: false, participants: participants.length, messageId: String(messageId || '') };
  } catch (error) {
    if (claimed) await sql`DELETE FROM interview_brief_deliveries WHERE interview_at=${session.interview_at} AND chat_id=${destination.chatId} AND thread_id=${destination.threadId} AND telegram_message_id IS NULL`;
    throw error;
  }
}

export async function sendTomorrowTestBrief(req) {
  await init();
  const sessions = (await sql`SELECT interview_at,slot_id,COUNT(*)::int AS participant_count FROM candidates WHERE status='interview_booked' AND consent=true AND (interview_at AT TIME ZONE 'Europe/Moscow')::date=((NOW() AT TIME ZONE 'Europe/Moscow')::date + 1) GROUP BY interview_at,slot_id ORDER BY interview_at LIMIT 1`).rows;
  let session = sessions[0];
  if (!session) {
    const tomorrow = new Date(Date.now() + 86400000), date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(tomorrow);
    session = { interview_at: `${date}T05:00:00.000Z`, slot_id: 'wed-0800', participant_count: 0 };
  }
  const result = await sendBrief(req, session, { test: true });
  return { ok: true, test: true, date: moscowDate(session.interview_at), slotId: session.slot_id, participants: result.participants, sent: result.sent, messageId: result.messageId };
}

export default async function handler(req, res) {
  const supplied=String(req.headers.authorization||'').replace(/^Bearer\s+/,'');
  const suppliedHash=crypto.createHash('sha256').update(supplied).digest('hex');
  const scheduledHash='1b54055576c6ca87193e5dda67e5fcf17eb2a786b9d27a28813737bb18670154';
  const authorized=Boolean(req[trustedScope])||(process.env.CRON_SECRET&&supplied===process.env.CRON_SECRET)||crypto.timingSafeEqual(Buffer.from(suppliedHash),Buffer.from(scheduledHash));
  if (!authorized) return json(res, 401, { error: 'Unauthorized' });
  try {
    await init();
    const scopeAt=req[trustedScope]?.at||null,scopeSlot=req[trustedScope]?.slot||null;
    if(!scopeAt&&(await sql`SELECT value FROM app_settings WHERE key='funnel_primary_timers_migrated'`).rows[0]?.value==='yes')return json(res,200,{ok:true,mode:'exact_tasks',legacyScanSkipped:true});
    const sessions = (await sql`SELECT interview_at,slot_id,COUNT(*)::int AS participant_count FROM candidates WHERE status='interview_booked' AND consent=true AND (${scopeAt}::timestamptz IS NULL OR interview_at=${scopeAt}::timestamptz) AND (${scopeSlot}::text IS NULL OR slot_id=${scopeSlot}) AND interview_at BETWEEN NOW() + INTERVAL '20 minutes' AND NOW() + INTERVAL '40 minutes' GROUP BY interview_at,slot_id ORDER BY interview_at`).rows;
    let briefSent = 0, briefSkipped = 0, briefFailed = 0;
    for (const session of sessions) {
      try { const result = await sendBrief(req, session); if (result.skipped) briefSkipped++; else briefSent++; }
      catch (error) { briefFailed++; console.error('[reminders] interview brief failed', { interviewAt: session.interview_at, slotId: session.slot_id, message: String(error) }); }
    }
    const due = (await sql`SELECT id FROM candidates WHERE status='interview_booked' AND consent=true AND reminded_30m=false AND (${scopeAt}::timestamptz IS NULL OR interview_at=${scopeAt}::timestamptz) AND (${scopeSlot}::text IS NULL OR slot_id=${scopeSlot}) AND interview_at BETWEEN NOW() + INTERVAL '20 minutes' AND NOW() + INTERVAL '40 minutes' ORDER BY id`).rows;
    let sent = 0, failed = 0;
    const batchSize = 10;
    for (let offset = 0; offset < due.length; offset += batchSize) {
      const results = await Promise.allSettled(due.slice(offset, offset + batchSize).map(async ({ id }) => {
        const claimed = (await sql`UPDATE candidates SET reminded_30m=true,updated_at=NOW() WHERE id=${id} AND status='interview_booked' AND consent=true AND reminded_30m=false RETURNING *`).rows[0];
        if (!claimed) return false;
        try {
          const messageId = await telegram(claimed.chat_id, reminderText);
          await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) VALUES(${claimed.id},'out','text',${reminderText},'delivered',${String(messageId || '')})`;
          return true;
        } catch (error) {
          await sql`UPDATE candidates SET reminded_30m=false,updated_at=NOW() WHERE id=${claimed.id}`;
          throw Object.assign(error, { candidateId: claimed.id });
        }
      }));
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) sent++;
        if (result.status === 'rejected') {
          failed++;
          console.error('[reminders] candidate failed', { candidateId: result.reason?.candidateId, message: String(result.reason) });
        }
      }
      if (offset + batchSize < due.length) await new Promise(resolve => setTimeout(resolve, 500));
    }
    const noShows = (await sql`SELECT id FROM candidates WHERE status='interview_booked' AND consent=true AND no_show_followup_sent=false AND (${scopeAt}::timestamptz IS NULL OR interview_at=${scopeAt}::timestamptz) AND (${scopeSlot}::text IS NULL OR slot_id=${scopeSlot}) AND interview_at <= NOW() - INTERVAL '90 minutes' AND interview_at >= NOW() - INTERVAL '7 days' ORDER BY id`).rows;
    let followupSent = 0, followupFailed = 0, followupSkippedInGroup = 0, followupMembershipCheckFailed = 0;
    const groupChatId = await candidateGroupChatId();
    for (let offset = 0; offset < noShows.length; offset += batchSize) {
      const results = await Promise.allSettled(noShows.slice(offset, offset + batchSize).map(async ({ id }) => {
        const candidate = (await sql`SELECT * FROM candidates WHERE id=${id} AND status='interview_booked' AND consent=true AND no_show_followup_sent=false LIMIT 1`).rows[0];
        if (!candidate) return 'skipped';
        try {
          if (await isCandidateGroupMember(candidate.chat_id, groupChatId)) return 'in_group';
        } catch (error) {
          throw Object.assign(error, { candidateId: candidate.id, membershipCheckFailed: true });
        }
        const claimed = (await sql`UPDATE candidates SET no_show_followup_sent=true,updated_at=NOW() WHERE id=${id} AND status='interview_booked' AND consent=true AND no_show_followup_sent=false RETURNING *`).rows[0];
        if (!claimed) return 'skipped';
        try {
          const messageId = await telegram(claimed.chat_id, noShowText, { reply_markup: rescheduleKeyboard });
          await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) VALUES(${claimed.id},'out','no_show_followup',${noShowText},'delivered',${String(messageId || '')})`;
          return 'sent';
        } catch (error) {
          await sql`UPDATE candidates SET no_show_followup_sent=false,updated_at=NOW() WHERE id=${claimed.id}`;
          throw Object.assign(error, { candidateId: claimed.id });
        }
      }));
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value === 'sent') followupSent++;
        if (result.status === 'fulfilled' && result.value === 'in_group') followupSkippedInGroup++;
        if (result.status === 'rejected') {
          if (result.reason?.membershipCheckFailed) followupMembershipCheckFailed++;
          else followupFailed++;
          console.error('[reminders] no-show follow-up failed', { candidateId: result.reason?.candidateId, message: String(result.reason) });
        }
      }
      if (offset + batchSize < noShows.length) await new Promise(resolve => setTimeout(resolve, 500));
    }
    return json(res,200,{ok:true,due:due.length,sent,failed,briefDue:sessions.length,briefSent,briefSkipped,briefFailed,followupDue:noShows.length,followupSent,followupSkippedInGroup,followupFailed,followupMembershipCheckFailed});
  } catch (error) {
    console.error('[reminders] run failed', { message: String(error) });
    return json(res, 500, { error: 'Reminder failed' });
  }
}
