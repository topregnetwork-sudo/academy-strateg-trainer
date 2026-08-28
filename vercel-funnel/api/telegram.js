import { body, init, json, nextInterview, slots, telegram, telegramApi, sql } from './_core.js';
import { handleOfflineInterviewChoice } from './offline-interview.js';

const TOPIC_COMMAND = /^\/trainer_topic(?:@stazherskaya_bot)?(?:\s|$)/i;
const CANDIDATE_GROUP_COMMAND = /^\/candidate_group(?:@stazherskaya_bot)?(?:\s|$)/i;
const CANDIDATE_GROUP_KEYWORD = /^\s*(?:кандидат|кондидат)(?:ы)?[.!]?\s*$/iu;
const CANDIDATE_TEST_KEYWORD = /^\s*тест[.!]?\s*$/iu;
const NOT_RELEVANT_KEYWORD = /^\s*не\s*актуально[.!]?\s*$/iu;
const TEST_VERSION = 'executive-effectiveness-2020-ru-v1';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

async function savePrivateIncoming(message) {
  const chatId = String(message.chat?.id || '');
  const candidate = (await sql`SELECT id FROM candidates WHERE chat_id=${chatId} LIMIT 1`).rows[0];
  if (!candidate) return;
  const text = String(message.text || message.caption || '').trim() || ({ photo: 'Отправил фотографию', document: 'Отправил файл', video: 'Отправил видео', voice: 'Отправил голосовое сообщение', contact: 'Отправил контакт' }[Object.keys(message).find(key => ['photo','document','video','voice','contact'].includes(key))] || 'Отправил сообщение');
  await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) VALUES(${candidate.id},'in','telegram_message',${text},'received',${String(message.message_id || '')})`;
}

function candidateName(candidate) {
  return [candidate.first_name, candidate.last_name].filter(Boolean).join(' ') || candidate.username || `Кандидат ${candidate.id}`;
}

function interviewDate(value) {
  if (!value) return 'дата не указана';
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(new Date(value));
}

function hrBrief(candidate, restored = false) {
  const title = restored ? 'Восстановленная запись на собеседование' : 'Новая запись на собеседование';
  return `🎯 <b>${title}</b>\n\nКандидат: <b>${escapeHtml(candidateName(candidate))}</b>\nГород: ${escapeHtml(candidate.city || 'не указан')}\nТелефон: ${escapeHtml(candidate.phone || 'не указан')}\nИсточник: ${escapeHtml(candidate.source_id || 'direct')}\nДата: <b>${escapeHtml(interviewDate(candidate.interview_at))}</b>\nВремя: <b>${escapeHtml(slots[candidate.slot_id] || 'не указано')}</b>\nTelegram: ${candidate.username ? '@' + escapeHtml(candidate.username) : 'без username'}\n\nСтатус: ${escapeHtml(candidate.status || 'записан')}.`;
}

async function getHrDestination() {
  const settings = await sql`SELECT key,value FROM app_settings WHERE key IN ('hr_brief_chat_id','hr_brief_thread_id')`;
  const values = Object.fromEntries(settings.rows.map(row => [row.key, row.value]));
  const chatId = values.hr_brief_chat_id || process.env.HR_BRIEF_CHAT_ID;
  if (!chatId) return null;
  return { chatId: String(chatId), threadId: values.hr_brief_thread_id ? String(values.hr_brief_thread_id) : '' };
}

async function getZoomMeetingUrl() {
  try {
    const setting = await sql`SELECT value FROM app_settings WHERE key='zoom_meeting_url' LIMIT 1`;
    if (setting.rows[0]?.value) return setting.rows[0].value;
  } catch (error) {
    console.error('[telegram] Zoom setting lookup failed; using environment fallback', { message: String(error) });
  }
  return process.env.ZOOM_MEETING_URL || '';
}

async function getCandidateGroupInviteUrl() {
  const setting = await sql`SELECT value FROM app_settings WHERE key='candidate_group_invite_url' LIMIT 1`;
  return setting.rows[0]?.value || '';
}

async function getCandidateGroupChatId() {
  const setting = await sql`SELECT value FROM app_settings WHERE key='candidate_group_chat_id' LIMIT 1`;
  return setting.rows[0]?.value ? String(setting.rows[0].value) : '';
}

async function recordCandidateGroupJoin(user, unixTime = 0) {
  if (!user?.id) return false;
  const joinedAt = unixTime ? new Date(Number(unixTime) * 1000).toISOString() : new Date().toISOString();
  const candidate = (await sql`UPDATE candidates SET group_joined_at=COALESCE(group_joined_at,${joinedAt}),updated_at=NOW() WHERE chat_id=${String(user.id)} AND group_joined_at IS NULL RETURNING id`).rows[0];
  if (!candidate) return false;
  await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status) VALUES(${candidate.id},'in','candidate_group_joined','Вступил в группу кандидатов','received')`;
  return true;
}

async function handleCandidateGroupMembership(update) {
  const membership = update.chat_member;
  if (!membership?.chat?.id) return false;
  const groupChatId = await getCandidateGroupChatId();
  if (!groupChatId || String(membership.chat.id) !== groupChatId) return false;
  const active = ['member','administrator','creator'].includes(membership.new_chat_member?.status);
  const wasOutside = ['left','kicked'].includes(membership.old_chat_member?.status);
  if (active && wasOutside) await recordCandidateGroupJoin(membership.new_chat_member.user, membership.date);
  return true;
}

async function handleNewCandidateGroupMembers(message) {
  if (!Array.isArray(message.new_chat_members) || !message.new_chat_members.length) return false;
  const groupChatId = await getCandidateGroupChatId();
  if (!groupChatId || String(message.chat?.id) !== groupChatId) return false;
  for (const user of message.new_chat_members) await recordCandidateGroupJoin(user, message.date);
  return true;
}

async function wasDelivered(candidate, destination) {
  const existing = await sql`SELECT 1 FROM hr_brief_deliveries WHERE candidate_id=${candidate.id} AND interview_at=${candidate.interview_at} AND chat_id=${destination.chatId} AND thread_id=${destination.threadId} LIMIT 1`;
  return existing.rows.length > 0;
}

async function deliverHrBrief(candidate, destination, restored = false) {
  if (!destination || await wasDelivered(candidate, destination)) return false;
  const extra = destination.threadId ? { message_thread_id: Number(destination.threadId) } : {};
  const messageId = await telegram(destination.chatId, hrBrief(candidate, restored), extra);
  await sql`INSERT INTO hr_brief_deliveries(candidate_id,interview_at,chat_id,thread_id,telegram_message_id) VALUES(${candidate.id},${candidate.interview_at},${destination.chatId},${destination.threadId},${String(messageId || '')}) ON CONFLICT DO NOTHING`;
  return true;
}

async function backfillTrainerTopic(destination) {
  const candidates = await sql`SELECT id,first_name,last_name,username,phone,city,slot_id,interview_at,source_id,status FROM candidates WHERE interview_at IS NOT NULL ORDER BY interview_at,id`;
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const candidate of candidates.rows) {
    try {
      if (await deliverHrBrief(candidate, destination, true)) sent += 1;
      else skipped += 1;
    } catch (error) {
      failed += 1;
      console.error('[telegram] HR brief backfill failed', { candidateId: candidate.id, message: String(error) });
    }
  }
  return { sent, skipped, failed, total: candidates.rows.length };
}

async function sendTrainerTopicSummary(destination, result) {
  const extra = destination.threadId ? { message_thread_id: Number(destination.threadId) } : {};
  await telegram(destination.chatId, `✅ <b>Тема «Тренеры собеседования» подключена.</b>\n\nПеренесено сейчас: <b>${result.sent}</b>\nУже были перенесены: <b>${result.skipped}</b>\nОшибок: <b>${result.failed}</b>\nВсего записей проверено: <b>${result.total}</b>\n\nВсе новые записи кандидатов будут приходить в эту тему.`, extra);
}

export async function resumeTrainerTopic() {
  await init();
  const destination = await getHrDestination();
  if (!destination?.threadId) throw new Error('Trainer topic destination is not configured');
  const result = await backfillTrainerTopic(destination);
  await sendTrainerTopicSummary(destination, result);
  return result;
}

async function handleCandidateGroupKeyword(message) {
  if (!CANDIDATE_GROUP_KEYWORD.test(message.text || '')) return false;
  const chatId = String(message.chat.id);
  const candidate = (await sql`SELECT id,chat_id,status FROM candidates WHERE chat_id=${chatId} LIMIT 1`).rows[0];
  if (!candidate || !['interview_booked','interviewed','questionnaire','test_1_completed','test_1_passed','training','internship','hired'].includes(candidate.status)) {
    await telegram(chatId, 'Приглашение в группу кандидатов доступно после записи и прохождения собеседования.');
    return true;
  }

  const inviteUrl = await getCandidateGroupInviteUrl();
  if (!inviteUrl) {
    await telegram(chatId, 'Группа кандидатов сейчас настраивается. Напишите координатору, и мы пришлём ссылку.');
    return true;
  }

  const previousStatus = candidate.status;
  if (previousStatus === 'interview_booked') {
    await sql`UPDATE candidates SET status='interviewed',updated_at=NOW() WHERE id=${candidate.id}`;
  }

  let questionnaire = (await sql`SELECT id,token,submitted_at FROM candidate_questionnaire_two WHERE candidate_id=${candidate.id} LIMIT 1`).rows[0];
  if (!questionnaire) {
    const questionnaireToken = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
    questionnaire = (await sql`INSERT INTO candidate_questionnaire_two(candidate_id,token,status) VALUES(${candidate.id},${questionnaireToken},'pending') ON CONFLICT(candidate_id) DO UPDATE SET updated_at=NOW() RETURNING id,token`).rows[0];
  }
  const questionnaireUrl = `https://topregnetwork-sudo.github.io/academy-strateg-trainer/questionnaire-2.html?token=${questionnaire.token}`;
  const text = '✅ <b>Код принят.</b>\n\nПереходите в группу кандидатов Академии Стратег. Там вы познакомитесь с проектом и получите дальнейшие материалы.';
  try {
    const messageId = await telegram(chatId, text, { reply_markup: { inline_keyboard: [[{ text: 'Перейти в группу кандидатов', url: inviteUrl }],[{ text: 'Заполнить Анкету 2', url: questionnaireUrl }]] } });
    await sql`UPDATE candidate_questionnaire_two SET status=CASE WHEN submitted_at IS NULL THEN 'sent' ELSE status END,sent_at=COALESCE(sent_at,NOW()),updated_at=NOW() WHERE id=${questionnaire.id}`;
    if (!questionnaire.submitted_at) await sql`UPDATE candidates SET status='questionnaire',updated_at=NOW() WHERE id=${candidate.id}`;
    try {
      await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) VALUES(${candidate.id},'out','candidate_group_invite',${text},'delivered',${String(messageId || '')})`;
    } catch (historyError) {
      console.error('[telegram] candidate group invite history failed', { candidateId: candidate.id, message: String(historyError) });
    }
  } catch (error) {
    if (previousStatus === 'interview_booked') {
      await sql`UPDATE candidates SET status='interview_booked',updated_at=NOW() WHERE id=${candidate.id}`;
    }
    throw error;
  }
  return true;
}

async function handleCandidateTestKeyword(message) {
  if (!CANDIDATE_TEST_KEYWORD.test(message.text || '')) return false;
  const chatId = String(message.chat.id);
  const candidate = (await sql`SELECT id,chat_id,status FROM candidates WHERE chat_id=${chatId} LIMIT 1`).rows[0];
  if (!candidate) {
    await telegram(chatId, 'Не удалось найти вашу анкету. Откройте бота по кнопке с сайта вакансии и повторите попытку.');
    return true;
  }
  const questionnaireTwo=(await sql`SELECT * FROM candidate_questionnaire_two WHERE candidate_id=${candidate.id} LIMIT 1`).rows[0];
  if(!questionnaireTwo?.submitted_at){
    let questionnaire=questionnaireTwo;
    if(!questionnaire){const questionnaireToken=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');questionnaire=(await sql`INSERT INTO candidate_questionnaire_two(candidate_id,token,status) VALUES(${candidate.id},${questionnaireToken},'pending') RETURNING *`).rows[0]}
    const questionnaireUrl=`https://topregnetwork-sudo.github.io/academy-strateg-trainer/questionnaire-2.html?token=${questionnaire.token}`;
    const questionnaireText='Сначала заполните обязательную Анкету 2. После отправки продолжите изучение материалов группы и следуйте инструкциям.';
    const questionnaireMessageId=await telegram(chatId,questionnaireText,{reply_markup:{inline_keyboard:[[{text:'Заполнить Анкету 2',url:questionnaireUrl}]]}});
    await sql`UPDATE candidate_questionnaire_two SET status='sent',sent_at=COALESCE(sent_at,NOW()),updated_at=NOW() WHERE id=${questionnaire.id}`;
    await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) VALUES(${candidate.id},'out','questionnaire_2_required',${questionnaireText},'delivered',${String(questionnaireMessageId||'')})`;
    return true;
  }
  const existing = (await sql`SELECT * FROM candidate_tests WHERE candidate_id=${candidate.id} AND questionnaire_version=${TEST_VERSION} LIMIT 1`).rows[0];
  if (existing?.submitted_at || ['test_1_completed','test_1_passed'].includes(candidate.status)) {
    const text = '✅ Тест 1 уже заполнен и сохранён в вашей анкете. Повторно проходить его не нужно.';
    const messageId = await telegram(chatId, text);
    await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) VALUES(${candidate.id},'out','candidate_test_already_completed',${text},'delivered',${String(messageId || '')})`;
    return true;
  }
  await sql`UPDATE candidates SET status='questionnaire',updated_at=NOW() WHERE id=${candidate.id} AND status IN ('new','interview_booked','interviewed')`;
  let test = existing;
  if (!test) {
    const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
    test = (await sql`INSERT INTO candidate_tests(candidate_id,token,questionnaire_version,status) VALUES(${candidate.id},${token},${TEST_VERSION},'pending') RETURNING *`).rows[0];
  }
  const testUrl = `https://topregnetwork-sudo.github.io/academy-strateg-trainer/test.html?token=${test.token}`;
  const text = '📝 <b>Тест 1 — эффективность руководителя</b>\n\nОткройте персональную ссылку и ответьте на 200 вопросов. Все вопросы находятся на одной странице; напротив каждого выберите «Да», «Может быть» или «Нет».\n\nПосле отправки ответы автоматически прикрепятся к вашей анкете.';
  const messageId = await telegram(chatId, text, { reply_markup: { inline_keyboard: [[{ text: 'Пройти тест 1', url: testUrl }]] } });
  await sql`UPDATE candidate_tests SET status='sent',sent_at=NOW(),updated_at=NOW() WHERE id=${test.id}`;
  await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) VALUES(${candidate.id},'out','candidate_test_invite',${text},'delivered',${String(messageId || '')})`;
  return true;
}

async function handleNotRelevant(message) {
  if (!NOT_RELEVANT_KEYWORD.test(message.text || '')) return false;
  const chatId = String(message.chat.id);
  const candidate = (await sql`UPDATE candidates SET status='cancelled',consent=false,updated_at=NOW() WHERE chat_id=${chatId} RETURNING id`).rows[0];
  const text = candidate
    ? 'Спасибо, что сообщили. Мы отметили, что вакансия для вас больше не актуальна, и не будем присылать дальнейшие сообщения по этому набору.'
    : 'Спасибо, что сообщили. Мы не будем присылать дальнейшие сообщения по этому набору.';
  const messageId = await telegram(chatId, text);
  if (candidate) await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) VALUES(${candidate.id},'out','declined_confirmation',${text},'delivered',${String(messageId || '')})`;
  return true;
}

async function configureTrainerTopic(message) {
  const chatId = String(message.chat.id);
  const allowedChatId = process.env.HR_BRIEF_CHAT_ID && String(process.env.HR_BRIEF_CHAT_ID);
  if (!TOPIC_COMMAND.test(message.text || '')) return false;

  const threadId = message.message_thread_id ? String(message.message_thread_id) : '';
  const replyExtra = threadId ? { message_thread_id: Number(threadId) } : {};
  if (!threadId) {
    await telegram(chatId, 'Откройте тему «Тренеры собеседования» и отправьте команду /trainer_topic именно внутри неё.');
    return true;
  }

  let isAdministrator = false;
  try {
    const member = await telegramApi('getChatMember', { chat_id: chatId, user_id: message.from?.id });
    isAdministrator = member?.status === 'creator' || member?.status === 'administrator';
  } catch (error) {
    console.error('[telegram] admin verification failed', { chatId, userId: message.from?.id, message: String(error) });
  }
  if (chatId !== allowedChatId && !isAdministrator) {
    await telegram(chatId, '⚠️ Настроить тему может только администратор этой группы. Если вы администратор, временно выдайте боту право видеть администраторов и повторите команду.', replyExtra);
    return true;
  }

  await telegram(chatId, '⏳ Подключаю тему и переношу предыдущие уведомления. Пожалуйста, дождитесь итогового сообщения.', replyExtra);

  await sql`INSERT INTO app_settings(key,value,updated_at) VALUES('hr_brief_chat_id',${chatId},NOW()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`;
  await sql`INSERT INTO app_settings(key,value,updated_at) VALUES('hr_brief_thread_id',${threadId},NOW()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`;

  const destination = { chatId, threadId };
  const result = await backfillTrainerTopic(destination);
  await sendTrainerTopicSummary(destination, result);
  return true;
}

async function configureCandidateGroup(message) {
  if (!CANDIDATE_GROUP_COMMAND.test(message.text || '')) return false;
  const chatId = String(message.chat.id);
  let isAdministrator = false;
  try {
    const member = await telegramApi('getChatMember', { chat_id: chatId, user_id: message.from?.id });
    isAdministrator = member?.status === 'creator' || member?.status === 'administrator';
  } catch (error) {
    console.error('[telegram] candidate group admin verification failed', { chatId, userId: message.from?.id, message: String(error) });
  }
  if (!isAdministrator) {
    await telegram(chatId, '⚠️ Зарегистрировать группу может только её администратор. Отправьте команду из аккаунта администратора группы.');
    return true;
  }
  const bot = await telegramApi('getMe');
  const botMember = await telegramApi('getChatMember', { chat_id: chatId, user_id: bot.id });
  if (!['creator', 'administrator'].includes(botMember?.status)) {
    await telegram(chatId, '⚠️ Чтобы проверять, кто уже находится в группе, назначьте @stazherskaya_bot администратором группы и повторите команду /candidate_group. Публиковать сообщения от имени группы боту не требуется.');
    return true;
  }
  await sql`INSERT INTO app_settings(key,value,updated_at) VALUES('candidate_group_chat_id',${chatId},NOW()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`;
  await telegram(chatId, '✅ Группа кандидатов зарегистрирована. Участники этой группы будут исключены из сообщений о повторной записи на собеседование.');
  return true;
}

async function handlePrivateStart(message) {
  const chatId = String(message.chat.id);
  if (/^\/start\s+questionnaire_done$/i.test(message.text || '')) {
    const candidate = (await sql`SELECT id,status FROM candidates WHERE chat_id=${chatId} LIMIT 1`).rows[0];
    const questionnaire = candidate ? (await sql`SELECT id,token,submitted_at FROM candidate_questionnaire_two WHERE candidate_id=${candidate.id} LIMIT 1`).rows[0] : null;
    if (!candidate || !questionnaire?.submitted_at) {
      const text = 'Сначала заполните Анкету 2. После отправки вернитесь в бота.';
      const extra = questionnaire?.token ? { reply_markup: { inline_keyboard: [[{ text: 'Заполнить Анкету 2', url: `https://topregnetwork-sudo.github.io/academy-strateg-trainer/questionnaire-2.html?token=${questionnaire.token}` }]] } } : {};
      await telegram(chatId, text, extra);
      return;
    }
    await sql`UPDATE candidates SET status='questionnaire',updated_at=NOW() WHERE id=${candidate.id} AND status IN ('new','interview_booked','interviewed')`;
    await sql`UPDATE candidate_questionnaire_two SET completion_notice_sent_at=COALESCE(completion_notice_sent_at,NOW()),updated_at=NOW() WHERE id=${questionnaire.id}`;
    const text = '✅ <b>Анкета 2 получена.</b>\n\nСпасибо, что заполнили анкету. Переходите к изучению материалов группы и следуйте инструкциям. Когда дойдёте до соответствующего этапа, вернитесь в бота.';
    const messageId = await telegram(chatId, text);
    await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) VALUES(${candidate.id},'out','questionnaire_2_completed',${text},'delivered',${String(messageId || '')})`;
    return;
  }
  const match = message.text?.match(/^\/start\s+trainer_app_([a-zA-Z0-9]{20})$/);
  const app = match ? (await sql`SELECT * FROM applications WHERE code=${match[1]}`).rows[0] : null;
  if (!app) {
    await telegram(chatId, 'Здравствуйте! Вернитесь на страницу вакансии Академии Стратег и сначала заполните анкету.');
    return;
  }
  if (app.candidate_id) {
    const linked = (await sql`SELECT id,chat_id,status,interview_at FROM candidates WHERE id=${app.candidate_id} LIMIT 1`).rows[0];
    if (linked?.chat_id === chatId && linked.status === 'interview_booked' && linked.interview_at) {
      await telegram(chatId, 'Вы уже записаны на собеседование. Подтверждение и ссылка Zoom находятся выше в этом чате.');
      return;
    }
  }

  const experienced = app.trainer_experience_level === 'professional';
  const row = (await sql`INSERT INTO candidates(chat_id,username,first_name,last_name,phone,city,slot_id,interview_at,source_id,status) VALUES(${chatId},${message.from?.username || null},${message.from?.first_name || app.full_name},${message.from?.last_name || null},${app.phone || null},${app.city},NULL,NULL,${app.source_id},${experienced ? 'experienced_not_target' : 'new'}) ON CONFLICT(chat_id) DO UPDATE SET username=EXCLUDED.username,first_name=EXCLUDED.first_name,last_name=EXCLUDED.last_name,phone=COALESCE(EXCLUDED.phone,candidates.phone),city=EXCLUDED.city,source_id=EXCLUDED.source_id,status=CASE WHEN candidates.status IN ('new','experienced_not_target') AND candidates.interview_at IS NULL THEN EXCLUDED.status ELSE candidates.status END,consent=true,updated_at=NOW() RETURNING id,first_name,last_name,username,phone,city,slot_id,interview_at,source_id,status`).rows[0];
  await sql`UPDATE applications SET candidate_id=${row.id} WHERE id=${app.id}`;
  if (!['new','experienced_not_target'].includes(row.status)) {
    const reply = 'Спасибо, анкета получена. Ваш текущий этап отбора сохранён — повторное заполнение первой анкеты его не изменило. Продолжайте по последним инструкциям бота.';
    const messageId = await telegram(chatId, reply);
    await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) VALUES(${row.id},'out','repeat_application_preserved',${reply},'delivered',${String(messageId || '')})`;
    return;
  }
  const reply = experienced
    ? 'Спасибо, анкета получена. Нам нужно уточнить несколько моментов по вашему опыту. Если ваш профиль подойдёт к формату текущего набора, мы свяжемся с вами в Telegram.'
    : 'Спасибо, анкета получена. Выберите удобное время собеседования:';
  const keyboard = experienced ? {} : { reply_markup: { inline_keyboard: Object.entries(slots).map(([slotId, title]) => [{ text: title, callback_data: `trainer_slot_${app.code}_${slotId}` }]) } };
  const messageId = await telegram(chatId, reply, keyboard);
  await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) VALUES(${row.id},'out','text',${reply},'delivered',${String(messageId || '')})`;
}

async function handleSlotChoice(callback) {
  const match = callback.data?.match(/^trainer_slot_([a-zA-Z0-9]{20})_([a-z]{3}-[0-9]{4})$/);
  if (!match || !slots[match[2]]) return false;
  const chatId = String(callback.message?.chat?.id || callback.from?.id || '');
  const app = (await sql`SELECT * FROM applications WHERE code=${match[1]} LIMIT 1`).rows[0];
  if (!app || app.trainer_experience_level === 'professional' || !app.candidate_id) {
    await telegramApi('answerCallbackQuery', { callback_query_id: callback.id, text: 'Запись для этой анкеты недоступна.' });
    return true;
  }
  const candidate = (await sql`SELECT * FROM candidates WHERE id=${app.candidate_id} AND chat_id=${chatId} LIMIT 1`).rows[0];
  if (!candidate) {
    await telegramApi('answerCallbackQuery', { callback_query_id: callback.id, text: 'Не удалось найти анкету.' });
    return true;
  }
  if (candidate.status === 'interview_booked' && candidate.interview_at) {
    await telegramApi('answerCallbackQuery', { callback_query_id: callback.id, text: 'Вы уже записаны.' });
    return true;
  }
  const slotId = match[2], at = nextInterview(slotId), date = interviewDate(at);
  const row = (await sql`UPDATE candidates SET slot_id=${slotId},interview_at=${at},status='interview_booked',consent=true,reminded_30m=false,no_show_followup_sent=false,updated_at=NOW() WHERE id=${candidate.id} RETURNING id,first_name,last_name,username,phone,city,slot_id,interview_at,source_id,status`).rows[0];
  await sql`UPDATE applications SET slot_id=${slotId} WHERE id=${app.id}`;
  await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) VALUES(${candidate.id},'in','button_click',${`Нажал кнопку выбора времени: ${slots[slotId]}`},'received',${String(callback.message?.message_id || '')})`;
  const zoom = await getZoomMeetingUrl();
  const reply = `✅ <b>Вы записаны на собеседование</b>\n\nДата: <b>${date}</b>\nВремя: <b>${slots[slotId]}</b>\n\n${zoom ? 'Ссылка Zoom — по кнопке ниже.' : 'Координатор пришлёт ссылку Zoom в этот чат.'}\n\nЗа 30 минут до встречи придёт напоминание.`;
  let messageId;
  try {
    messageId = await telegram(chatId, reply, zoom ? { reply_markup: { inline_keyboard: [[{ text: 'Открыть Zoom', url: zoom }]] } } : {});
  } catch (error) {
    await sql`UPDATE candidates SET slot_id=NULL,interview_at=NULL,status='new',reminded_30m=false,updated_at=NOW() WHERE id=${candidate.id}`;
    await sql`UPDATE applications SET slot_id=NULL WHERE id=${app.id}`;
    throw error;
  }
  await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) VALUES(${row.id},'out','booking_confirmation',${reply},'delivered',${String(messageId || '')})`;
  await telegramApi('answerCallbackQuery', { callback_query_id: callback.id, text: 'Время сохранено' });
  try {
    await deliverHrBrief(row, await getHrDestination());
  } catch (error) {
    console.error('[telegram] HR brief delivery failed', { candidateId: row.id, message: String(error) });
  }
  return true;
}

async function handleRescheduleChoice(callback) {
  const match = callback.data?.match(/^trainer_rebook_([a-z]{3}-[0-9]{4})$/);
  if (!match || !slots[match[1]]) return false;
  const chatId = String(callback.message?.chat?.id || callback.from?.id || '');
  const candidate = (await sql`SELECT * FROM candidates WHERE chat_id=${chatId} AND status='interview_booked' AND no_show_followup_sent=true LIMIT 1`).rows[0];
  if (!candidate) {
    await telegramApi('answerCallbackQuery', { callback_query_id: callback.id, text: 'Перенос для этой записи уже недоступен.' });
    return true;
  }
  const slotId = match[1], at = nextInterview(slotId), date = interviewDate(at);
  const row = (await sql`UPDATE candidates SET slot_id=${slotId},interview_at=${at},status='interview_booked',consent=true,reminded_30m=false,no_show_followup_sent=false,updated_at=NOW() WHERE id=${candidate.id} RETURNING id,first_name,last_name,username,phone,city,slot_id,interview_at,source_id,status`).rows[0];
  await sql`UPDATE applications SET slot_id=${slotId} WHERE candidate_id=${candidate.id}`;
  await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) VALUES(${candidate.id},'in','button_click',${`Нажал кнопку нового времени: ${slots[slotId]}`},'received',${String(callback.message?.message_id || '')})`;
  const zoom = await getZoomMeetingUrl();
  const reply = `✅ <b>Новое время собеседования сохранено</b>\n\nДата: <b>${date}</b>\nВремя: <b>${slots[slotId]}</b>\n\n${zoom ? 'Ссылка Zoom — по кнопке ниже.' : 'Координатор пришлёт ссылку Zoom в этот чат.'}\n\nЗа 30 минут до встречи придёт напоминание.`;
  let messageId;
  try {
    messageId = await telegram(chatId, reply, zoom ? { reply_markup: { inline_keyboard: [[{ text: 'Открыть Zoom', url: zoom }]] } } : {});
  } catch (error) {
    await sql`UPDATE candidates SET slot_id=${candidate.slot_id},interview_at=${candidate.interview_at},status='interview_booked',reminded_30m=true,no_show_followup_sent=true,updated_at=NOW() WHERE id=${candidate.id}`;
    await sql`UPDATE applications SET slot_id=${candidate.slot_id} WHERE candidate_id=${candidate.id}`;
    throw error;
  }
  await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) VALUES(${candidate.id},'out','reschedule_confirmation',${reply},'delivered',${String(messageId || '')})`;
  await telegramApi('answerCallbackQuery', { callback_query_id: callback.id, text: 'Новое время сохранено' });
  try { await deliverHrBrief(row, await getHrDestination()); }
  catch (error) { console.error('[telegram] rescheduled HR brief delivery failed', { candidateId: row.id, message: String(error) }); }
  return true;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false });
  if (process.env.TELEGRAM_WEBHOOK_SECRET && req.headers['x-telegram-bot-api-secret-token'] !== process.env.TELEGRAM_WEBHOOK_SECRET) return json(res, 401, { ok: false });

  let update;
  try {
    update = await body(req);
    if (update.chat_member) {
      await init();
      await handleCandidateGroupMembership(update);
      return json(res, 200, { ok: true });
    }
    const callback = update.callback_query;
    if (callback) {
      await init();
      if (!await handleOfflineInterviewChoice(callback) && !await handleRescheduleChoice(callback)) await handleSlotChoice(callback);
      return json(res, 200, { ok: true });
    }
    const message = update.message;
    if (!message) return json(res, 200, { ok: true });

    if (message.chat?.type && message.chat.type !== 'private') {
      await init();
      if (await handleNewCandidateGroupMembers(message)) return json(res, 200, { ok: true });
      if (!TOPIC_COMMAND.test(message.text || '') && !CANDIDATE_GROUP_COMMAND.test(message.text || '')) return json(res, 200, { ok: true });
      try {
        if (!await configureCandidateGroup(message)) await configureTrainerTopic(message);
      } catch (error) {
        console.error('[telegram] trainer topic setup failed', { chatId: String(message.chat.id), threadId: message.message_thread_id, message: String(error), stack: error?.stack });
        const extra = message.message_thread_id ? { message_thread_id: Number(message.message_thread_id) } : {};
        try {
          await telegram(String(message.chat.id), '❌ Не удалось подключить тему. Ошибка сохранена в журнале; повторять команду сейчас не нужно.', extra);
        } catch (notifyError) {
          console.error('[telegram] trainer topic error response failed', { message: String(notifyError) });
        }
      }
      return json(res, 200, { ok: true });
    }

    await init();
    await savePrivateIncoming(message);
    if (await handleNotRelevant(message)) return json(res, 200, { ok: true });
    if (await handleCandidateGroupKeyword(message)) return json(res, 200, { ok: true });
    if (await handleCandidateTestKeyword(message)) return json(res, 200, { ok: true });
    await handlePrivateStart(message);
    return json(res, 200, { ok: true });
  } catch (error) {
    console.error('[telegram] webhook failed', { message: String(error), stack: error?.stack });
    return json(res, 200, { ok: true });
  }
}
