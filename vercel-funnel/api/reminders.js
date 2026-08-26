import { init, json, telegram, telegramApi, sql, slots } from './_core.js';

const reminderText = '⏰ Напоминаем: ваше собеседование с Академией Стратег начнётся примерно через 30 минут. Пожалуйста, проверьте связь и подготовьтесь к встрече.';
const noShowText = 'Здравствуйте! Вы были записаны на собеседование с Академией Стратег. Если сегодня не получилось подключиться, выберите новое удобное время ниже.\n\nЕсли вакансия для вас больше не актуальна, напишите в ответ: <b>не актуально</b>.';
const testOneCompletedText = '✅ <b>Тест 1 заполнен</b>\n\nВсе 200 ответов сохранены в вашей карточке кандидата. Команда проверит результат. После проверки вы получите информацию о следующем этапе — IQ-тесте.';
const questionnaireTwoIntro = '📋 <b>Анкета 2 — следующий этап отбора</b>\n\nЗаполните персональную анкету об опыте, достижениях, сильных сторонах и целях. После отправки ответы сохранятся в вашей карточке. Затем вернитесь в @stazherskaya_bot и напишите слово <b>тест</b>, чтобы получить тест из 200 вопросов.';
const questionnaireTwoCompleted = '✅ <b>Анкета 2 получена</b>\n\nСпасибо! Ответы сохранены в вашей карточке кандидата. Следующий шаг: напишите этому боту слово <b>тест</b> — бот пришлёт персональную ссылку на тест из 200 вопросов.';
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
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return json(res, 401, { error: 'Unauthorized' });
  try {
    await init();
    const groupAnnouncementSent=(await sql`SELECT value FROM app_settings WHERE key='questionnaire_two_group_announcement_sent' LIMIT 1`).rows[0]?.value;
    let questionnaireGroupAnnouncementSent=0;
    if(!groupAnnouncementSent){
      try{const groupId=await candidateGroupChatId();await telegram(groupId,'📋 <b>Новый обязательный этап для кандидатов — Анкета 2</b>\n\nПерсональная ссылка придёт каждому кандидату в личном сообщении от @stazherskaya_bot. Заполните анкету, затем вернитесь в бот и напишите слово <b>тест</b>, чтобы получить тест из 200 вопросов.');await sql`INSERT INTO app_settings(key,value,updated_at) VALUES('questionnaire_two_group_announcement_sent','yes',NOW()) ON CONFLICT(key) DO UPDATE SET value='yes',updated_at=NOW()`;questionnaireGroupAnnouncementSent=1}catch(error){console.error('[reminders] questionnaire group announcement failed',String(error))}
    }
    const questionnaireRecipients=(await sql`SELECT c.id,c.chat_id,q.id AS questionnaire_id,q.token,q.sent_at FROM candidates c LEFT JOIN candidate_questionnaire_two q ON q.candidate_id=c.id WHERE c.status='interviewed' AND c.consent=true AND (q.id IS NULL OR (q.sent_at IS NULL AND q.submitted_at IS NULL)) ORDER BY c.id LIMIT 100`).rows;
    let questionnaireSent=0,questionnaireFailed=0;
    for(const candidate of questionnaireRecipients){
      try{let qid=candidate.questionnaire_id,token=candidate.token;if(!qid){token=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');const created=(await sql`INSERT INTO candidate_questionnaire_two(candidate_id,token) VALUES(${candidate.id},${token}) ON CONFLICT(candidate_id) DO UPDATE SET updated_at=NOW() RETURNING id,token`).rows[0];qid=created.id;token=created.token}const url=`https://topregnetwork-sudo.github.io/academy-strateg-trainer/questionnaire-2.html?token=${token}`;const messageId=await telegram(candidate.chat_id,questionnaireTwoIntro,{reply_markup:{inline_keyboard:[[{text:'Заполнить Анкету 2',url}]]}});await sql`UPDATE candidate_questionnaire_two SET status='sent',sent_at=NOW(),updated_at=NOW() WHERE id=${qid}`;await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) VALUES(${candidate.id},'out','questionnaire_2_invite',${questionnaireTwoIntro},'delivered',${String(messageId||'')})`;questionnaireSent++}catch(error){questionnaireFailed++;console.error('[reminders] questionnaire invite failed',{candidateId:candidate.id,message:String(error)})}
    }
    const questionnaireCompletedRows=(await sql`SELECT q.id,c.id AS candidate_id,c.chat_id FROM candidate_questionnaire_two q JOIN candidates c ON c.id=q.candidate_id WHERE q.submitted_at IS NOT NULL AND q.completion_notice_sent_at IS NULL ORDER BY q.submitted_at LIMIT 100`).rows;
    let questionnaireCompletionSent=0,questionnaireCompletionFailed=0;
    for(const item of questionnaireCompletedRows){try{const messageId=await telegram(item.chat_id,questionnaireTwoCompleted);await sql`UPDATE candidate_questionnaire_two SET completion_notice_sent_at=NOW(),updated_at=NOW() WHERE id=${item.id}`;await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) VALUES(${item.candidate_id},'out','questionnaire_2_completed',${questionnaireTwoCompleted},'delivered',${String(messageId||'')})`;questionnaireCompletionSent++}catch(error){questionnaireCompletionFailed++;console.error('[reminders] questionnaire completion failed',{candidateId:item.candidate_id,message:String(error)})}}
    const sessions = (await sql`SELECT interview_at,slot_id,COUNT(*)::int AS participant_count FROM candidates WHERE status='interview_booked' AND consent=true AND interview_at BETWEEN NOW() + INTERVAL '20 minutes' AND NOW() + INTERVAL '40 minutes' GROUP BY interview_at,slot_id ORDER BY interview_at`).rows;
    let briefSent = 0, briefSkipped = 0, briefFailed = 0;
    for (const session of sessions) {
      try { const result = await sendBrief(req, session); if (result.skipped) briefSkipped++; else briefSent++; }
      catch (error) { briefFailed++; console.error('[reminders] interview brief failed', { interviewAt: session.interview_at, slotId: session.slot_id, message: String(error) }); }
    }
    const due = (await sql`SELECT id FROM candidates WHERE status='interview_booked' AND consent=true AND reminded_30m=false AND interview_at BETWEEN NOW() + INTERVAL '20 minutes' AND NOW() + INTERVAL '40 minutes' ORDER BY id`).rows;
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
    const noShows = (await sql`SELECT id FROM candidates WHERE status='interview_booked' AND consent=true AND no_show_followup_sent=false AND interview_at <= NOW() - INTERVAL '90 minutes' AND interview_at >= NOW() - INTERVAL '7 days' ORDER BY id`).rows;
    const completedTests=(await sql`SELECT t.id AS test_id,c.id AS candidate_id,c.chat_id FROM candidate_tests t JOIN candidates c ON c.id=t.candidate_id WHERE t.submitted_at IS NOT NULL AND t.completion_notice_sent_at IS NULL ORDER BY t.submitted_at LIMIT 50`).rows;
    let testCompletionSent=0,testCompletionFailed=0;
    for(const item of completedTests){
      try{
        const messageId=await telegram(item.chat_id,testOneCompletedText);
        await sql`UPDATE candidate_tests SET completion_notice_sent_at=NOW(),updated_at=NOW() WHERE id=${item.test_id} AND completion_notice_sent_at IS NULL`;
        await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) VALUES(${item.candidate_id},'out','test_1_completed',${testOneCompletedText},'delivered',${String(messageId||'')})`;
        testCompletionSent++;
      }catch(error){testCompletionFailed++;console.error('[reminders] test completion notice failed',{candidateId:item.candidate_id,message:String(error)})}
    }
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
    return json(res,200,{ok:true,questionnaireGroupAnnouncementSent,questionnaireDue:questionnaireRecipients.length,questionnaireSent,questionnaireFailed,questionnaireCompletionDue:questionnaireCompletedRows.length,questionnaireCompletionSent,questionnaireCompletionFailed,due:due.length,sent,failed,briefDue:sessions.length,briefSent,briefSkipped,briefFailed,followupDue:noShows.length,followupSent,followupSkippedInGroup,followupFailed,followupMembershipCheckFailed,testCompletionDue:completedTests.length,testCompletionSent,testCompletionFailed});
  } catch (error) {
    console.error('[reminders] run failed', { message: String(error) });
    return json(res, 500, { error: 'Reminder failed' });
  }
}
