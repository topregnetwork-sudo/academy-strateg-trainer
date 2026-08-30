import crypto from 'node:crypto';
import { telegram, telegramApi, slots as zoomSlots } from '../api/_core.js';
import { sql, transaction, initFunnel, sessionById, candidateById, effect, createTask } from './funnel-store.js';
import { ACTIONS, eligibility, renderText } from './funnel-model.js';
const COORD = '-1004397133749', THREAD = 30;
const SITE = 'https://academy-strateg-trainer.vercel.app';
const goals = [[{ text: 'Изучить Цели Академии', url: SITE + '/goals.html' }, { text: 'Скачать PDF', url: SITE + '/academy-strateg-goals.pdf' }]];
const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function sendLogged(key, candidate, text, keyboard) {
  const id = await effect(key, () => telegram(candidate.chat_id, text, { parse_mode: undefined, ...(keyboard ? {reply_markup: keyboard} : {}) }));
  await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id)
    SELECT ${candidate.id},'out','funnel_action',${text},'delivered',${String(id)} WHERE NOT EXISTS(SELECT 1 FROM messages WHERE candidate_id=${candidate.id} AND telegram_message_id=${String(id)} AND direction='out')`;
  return id;
}
async function coordinate(key, text, keyboard) {
  return effect(key, () => telegram(COORD, text, { message_thread_id: THREAD, ...(keyboard ? {reply_markup: keyboard} : {}) }));
}
async function remove(candidate, key) {
  const chatId = (await sql`SELECT value FROM app_settings WHERE key='candidate_group_chat_id'`).rows[0]?.value;
  if (!chatId) throw new Error('Группа кандидатов не настроена');
  const member = await telegramApi('getChatMember', { chat_id: chatId, user_id: Number(candidate.chat_id) });
  if (['left','kicked'].includes(member.status)) return;
  if (!['member','restricted'].includes(member.status)) throw new Error('Защищённый участник: ' + member.status);
  await effect(key, async () => { await telegramApi('unbanChatMember', {chat_id:chatId,user_id:Number(candidate.chat_id),only_if_banned:false}); return 'removed'; });
}
export async function available(sessionId) {
  const session = await sessionById(sessionId);
  if (!session?.active) return [];
  return (await sql`SELECT s.*,count(b.id)::int AS used FROM funnel_slots s LEFT JOIN funnel_bookings b ON b.slot_id=s.id
    WHERE s.session_id=${Number(sessionId)} AND s.starts_at > NOW() + ${session.config.cutoff} * INTERVAL '1 minute'
    GROUP BY s.id HAVING count(b.id)<s.capacity ORDER BY s.starts_at`).rows;
}
export async function sessionKeyboard(sessionId, candidateId, preview = false) {
  const rows = [...goals];
  const slots = await available(sessionId);
  for (let i=0; i<slots.length; i+=2) rows.push(slots.slice(i,i+2).map(s => ({ text: new Date(s.starts_at).toLocaleTimeString('ru-RU',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit'}), callback_data: preview ? 'fc_demo' : `fc_book_${sessionId}_${s.id}` })));
  return { inline_keyboard: rows };
}
export async function messageKeyboard(config, jobId, candidateId, preview = false) {
  if(config.action==='primary_invite'){
    const app=(await sql`SELECT code FROM applications WHERE candidate_id=${candidateId} ORDER BY created_at DESC LIMIT 1`).rows[0];
    if(!app&&!preview)throw new Error('Не найдена первая анкета');
    return {inline_keyboard:Object.entries(zoomSlots).map(([id,text])=>[{text,callback_data:preview?'fc_demo':`trainer_slot_${app.code}_${id}`}])};
  }
  if (['invite','test_passed'].includes(config.action)) return sessionKeyboard(config.sessionId, candidateId, preview);
  const buttons = config.buttons.map((b,i) => b.url ? {text:b.text,url:b.url} : {text:b.text,callback_data:preview?'fc_demo':`fc_answer_${jobId}_${i}`});
  return {inline_keyboard:buttons.length?[buttons]:[]};
}
export async function processCampaign(jobId) {
  const job = (await sql`SELECT * FROM funnel_jobs WHERE id=${jobId}`).rows[0];
  if (!job || !['queued','running'].includes(job.state)) return {done:true};
  const session = job.config.sessionId ? await sessionById(job.config.sessionId) : null;
  await sql`UPDATE funnel_jobs SET state='running' WHERE id=${jobId}`;
  const recipients = (await sql`SELECT * FROM funnel_recipients WHERE job_id=${jobId} AND state='pending' ORDER BY candidate_id LIMIT 3`).rows;
  for (const r of recipients) {
    const claimed = (await sql`UPDATE funnel_recipients SET state='processing',updated_at=NOW() WHERE job_id=${jobId} AND candidate_id=${r.candidate_id} AND state='pending' RETURNING *`).rows[0];
    if (!claimed) continue;
    try {
      const c = await candidateById(r.candidate_id);
      if(c&&session)c.invited_session=Boolean((await sql`SELECT 1 FROM funnel_recipients r JOIN funnel_jobs j ON j.id=r.job_id WHERE r.candidate_id=${c.id} AND r.state='sent' AND j.config->>'sessionId'=${String(session.id)} LIMIT 1`).rows[0]);
      const reason = !c ? 'Кандидат не найден' : c.status !== r.original_status ? 'Этап изменён после предпросмотра' : eligibility(c,job.config,session);
      if (reason) throw new Error(reason);
      if (session && !(await available(session.id)).length) throw new Error('Свободных открытых слотов больше нет');
      const text = renderText(job.config.text,c,session?.config);
      const messageId = await sendLogged(`job:${jobId}:${c.id}`,c,text,await messageKeyboard(job.config,jobId,c.id));
      const target = ACTIONS[job.config.action].status;
      if (target) await sql`UPDATE candidates SET status=${target},updated_at=NOW() WHERE id=${c.id} AND status=${r.original_status}`;
      if (ACTIONS[job.config.action].remove) await remove(c,`remove:${jobId}:${c.id}`);
      await sql`UPDATE funnel_recipients SET state='sent',message_id=${String(messageId)},updated_at=NOW() WHERE job_id=${jobId} AND candidate_id=${c.id}`;
    } catch(e) { await sql`UPDATE funnel_recipients SET state='attention',error=${String(e.message).slice(0,500)},updated_at=NOW() WHERE job_id=${jobId} AND candidate_id=${r.candidate_id}`; }
  }
  const count = (await sql`SELECT count(*) FILTER(WHERE state='pending')::int AS pending,count(*) FILTER(WHERE state='sent')::int AS sent,count(*) FILTER(WHERE state NOT IN ('pending','sent'))::int AS attention FROM funnel_recipients WHERE job_id=${jobId}`).rows[0];
  if (count.pending) return {done:false};
  await coordinate(`job-summary:${jobId}`,`📋 <b>Результат отправки</b>\nДействие: ${esc(ACTIONS[job.config.action].label)}\nДоставлено: ${count.sent}\nТребуют внимания: ${count.attention}\n<a href="${SITE}/operator.html">Открыть панель и журнал</a>`);
  await sql`UPDATE funnel_jobs SET state=${count.attention?'attention':'done'} WHERE id=${jobId}`;
  return {done:true};
}
export async function book(sessionId, slotId, candidateId) {
  return transaction(async tx => {
    // A session lock serializes all capacity decisions and slot moves.
    const session = (await tx`SELECT * FROM funnel_sessions WHERE id=${sessionId} FOR UPDATE`).rows[0];
    if (!session?.active) throw new Error('Запись закрыта');
    const c = (await tx`SELECT * FROM candidates WHERE id=${candidateId} FOR UPDATE`).rows[0];
    if (!c || ['rejected','cancelled','academy_contact','selection_closed','productivity_failed','finalist','hired','training','internship'].includes(c.status) || c.city !== session.config.city) throw new Error('Запись для вашего этапа недоступна');
    const authorized = (await tx`SELECT 1 FROM funnel_recipients r JOIN funnel_jobs j ON j.id=r.job_id WHERE r.candidate_id=${candidateId} AND r.state='sent' AND (j.config->>'sessionId')::bigint=${sessionId} LIMIT 1`).rows[0];
    if (!authorized) throw new Error('Сначала дождитесь персонального приглашения');
    const slot = (await tx`SELECT * FROM funnel_slots WHERE id=${slotId} AND session_id=${sessionId} AND starts_at>NOW()+${session.config.cutoff}*INTERVAL '1 minute'`).rows[0];
    if (!slot) throw new Error('Это время уже закрыто');
    const old = (await tx`SELECT * FROM funnel_bookings WHERE session_id=${sessionId} AND candidate_id=${candidateId}`).rows[0];
    if (Number(old?.slot_id)===slotId) return {booking:old,slot,session,unchanged:true};
    const used = (await tx`SELECT count(*)::int AS n FROM funnel_bookings WHERE slot_id=${slotId}`).rows[0].n;
    if (used>=slot.capacity) throw new Error('Место уже занято. Выберите другое время. Ваша предыдущая запись сохранена.');
    const booking = (await tx`INSERT INTO funnel_bookings(session_id,candidate_id,slot_id) VALUES(${sessionId},${candidateId},${slotId}) ON CONFLICT(session_id,candidate_id) DO UPDATE SET slot_id=EXCLUDED.slot_id,version=funnel_bookings.version+1,updated_at=NOW() RETURNING *`).rows[0];
    await tx`UPDATE candidates SET status='productivity_booked',updated_at=NOW() WHERE id=${candidateId}`;
    return {booking,slot,session,unchanged:false};
  });
}
export async function bookingFollowup(bookingId, version) {
  const booking = (await sql`SELECT b.*,s.starts_at FROM funnel_bookings b JOIN funnel_slots s ON s.id=b.slot_id WHERE b.id=${bookingId}`).rows[0];
  if (!booking || Number(booking.version)!==Number(version)) return {done:true};
  const c=await candidateById(booking.candidate_id), session=await sessionById(booking.session_id);
  await sendLogged(`booking:${bookingId}:${version}`,c,renderText(session.config.confirmation,c,session.config,booking.starts_at),{inline_keyboard:[[{text:'Изменить время',callback_data:`fc_change_${session.id}`}]]});
  const at = new Date(booking.starts_at), label = at.toLocaleString('ru-RU',{timeZone:'Europe/Moscow'});
  await coordinate(`booking-brief:${bookingId}:${version}`,`✅ <b>${Number(version)>1?'Изменение времени':'Новая запись'} — ${esc(session.config.name)}</b>\n${esc(c.full_name || c.first_name)} · ${esc(c.city)}\nTelegram: @${esc(c.username || 'не указан')}\nТелефон: ${esc(c.phone)}\n${esc(label)} МСК\n${c.folder_url?`<a href="${esc(c.folder_url)}">Папка кандидата</a>`:'Папка пока недоступна'}\n<a href="${SITE}/operator.html?funnel_session=${session.id}">Участники встречи в панели</a>`);
  await sendSessionSummary(session.id,`booking-summary:${bookingId}:${version}`);
  const due = +at-30*60000; // All cities: fixed 30-minute reminder per user rule.
  if (due>Date.now()) {
    const id=stableId(`reminder:${bookingId}:${version}`);
    await createTask('booking_reminder',{bookingId,version},new Date(due),id);
  }
  await createTask('session_brief',{sessionId:session.id,slotId:booking.slot_id},new Date(Math.max(Date.now()+1000,due)),stableId(`brief:${session.id}:${booking.slot_id}`));
  return {done:true};
}
export function stableId(key) { const s=crypto.createHash('sha256').update(key).digest('hex').slice(0,32);return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`; }
export async function sendSessionSummary(sessionId,key,slotId=null) {
  const session=await sessionById(sessionId);
  const rows=(await sql`SELECT s.id,s.starts_at,s.capacity,c.first_name,c.last_name,c.city,c.username,d.folder_url FROM funnel_slots s LEFT JOIN funnel_bookings b ON b.slot_id=s.id LEFT JOIN candidates c ON c.id=b.candidate_id LEFT JOIN candidate_drive d ON d.candidate_id=c.id WHERE s.session_id=${sessionId} AND (${slotId}::bigint IS NULL OR s.id=${slotId}) ORDER BY s.starts_at,c.id`).rows;
  const groups=new Map();for(const r of rows){if(!groups.has(r.id))groups.set(r.id,[]);groups.get(r.id).push(r);}
  const lines=[`📋 <b>${slotId?'Встреча скоро начнётся':'Общая сводка'}: ${esc(session.config.name)}</b>`,esc(session.config.date)];
  for(const entries of groups.values()){
    const people=entries.filter(r=>r.first_name||r.username||r.last_name),s=entries[0];
    lines.push(`\n<b>${new Date(s.starts_at).toLocaleTimeString('ru-RU',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit'})}: ${people.length} / ${s.capacity}</b>`);
    for(const r of people){const name=esc([r.first_name,r.last_name].filter(Boolean).join(' ')||r.username);lines.push(`${r.folder_url?`<a href="${esc(r.folder_url)}">${name}</a>`:name} · ${esc(r.city)}`);}
  }
  // Split on whole lines rather than truncate a name or HTML link.
  const chunks=[];let chunk='';for(const line of lines){if(chunk.length+line.length>3400){chunks.push(chunk);chunk='';}chunk+=line+'\n';}if(chunk)chunks.push(chunk);
  for(let i=0;i<chunks.length;i++)await coordinate(`${key}:${i}`,chunks[i],{inline_keyboard:[[{text:'Участники в панели',url:`${SITE}/operator.html?funnel_session=${sessionId}`}]]});
}
export async function runFunnelTask(task) {
  if(task.kind==='primary_entry_report'){const {reportPrimaryEntry}=await import('./primary-evidence.js');await reportPrimaryEntry(task.payload.candidateId);return {done:true};}
  if(task.kind==='minsk_review_30m'){const {runMinskReminder}=await import('./review-reminders.js');await runMinskReminder(task.payload);return {done:true};}
  if(task.kind==='primary_session') { const {runExactSession}=await import('../api/reminders.js');await runExactSession(task.payload);return {done:true}; }
  if(task.kind==='campaign') return processCampaign(task.payload.jobId);
  if(task.kind==='booking_followup')return bookingFollowup(task.payload.bookingId,task.payload.version);
  if(task.kind==='session_brief'){
    const session=await sessionById(task.payload.sessionId);
    if(session?.active)await sendSessionSummary(task.payload.sessionId,`task:${task.id}`,task.payload.slotId);
  }
  if(task.kind==='booking_reminder'){
    const b=(await sql`SELECT b.*,s.starts_at FROM funnel_bookings b JOIN funnel_slots s ON s.id=b.slot_id WHERE b.id=${task.payload.bookingId}`).rows[0];
    if(b&&Number(b.version)===Number(task.payload.version)&&new Date(b.starts_at)>new Date()){
      const c=await candidateById(b.candidate_id),s=await sessionById(b.session_id);
      if(s.active&&c.consent&&!['cancelled','rejected','selection_closed','academy_contact','productivity_failed'].includes(c.status))await sendLogged(`task:${task.id}`,c,renderText('Напоминаем о встрече Академии Стратег.\nДата: {date}\nВремя: {time} МСК\n{location}',c,s.config,b.starts_at));
    }
  }
  if(task.kind==='choice'){
    const {jobId,candidateId,choice}=task.payload,job=(await sql`SELECT * FROM funnel_jobs WHERE id=${jobId}`).rows[0],c=await candidateById(candidateId);
    if(job&&c){
      if(job.config.action==='not_passed'){
        const reason=eligibility(c,{action:'close'},null);if(reason)throw new Error(reason);
        const status=choice==='yes'?'academy_contact':'rejected';
        await sendLogged(`choice:${jobId}:${candidateId}`,c,choice==='yes'?'Спасибо за ваш ответ! Позднее расскажем о возможностях взаимодействия. Участие в отборе завершено, поэтому мы отключим вас от рабочей группы кандидатов.':'Спасибо, что ответили. Благодарим за время и участие. Отбор завершён, мы отключим вас от рабочей группы кандидатов. До новых встреч!');
        await sql`UPDATE candidates SET status=${status},updated_at=NOW() WHERE id=${candidateId}`;
        await remove(c,`choice-remove:${jobId}:${candidateId}`);
      }
      await coordinate(`choice-coord:${jobId}:${candidateId}`,`Ответ кандидата: <b>${esc(c.full_name||c.first_name)}</b> · ${esc(c.city)}\nВыбор: <b>${esc(choice)}</b>`);
    }
  }
  return {done:true};
}
export async function handleFunnelCallback(callback) {
  if(!callback.data?.startsWith('fc_'))return false;
  if(callback.data==='fc_demo'){await telegramApi('answerCallbackQuery',{callback_query_id:callback.id,text:'Тестовая кнопка: запись и статус не меняются.',show_alert:true});return true;}
  await initFunnel();
  const c=(await sql`SELECT * FROM candidates WHERE chat_id=${String(callback.from.id)} LIMIT 1`).rows[0];
  try{
    if(!c)throw new Error('Ваша анкета не найдена');
    let match=callback.data.match(/^fc_book_(\d+)_(\d+)$/);
    if(match){
      const result=await book(Number(match[1]),Number(match[2]),Number(c.id));
      await createTask('booking_followup',{bookingId:result.booking.id,version:result.booking.version},new Date(),stableId(`followup:${result.booking.id}:${result.booking.version}`));
      await telegramApi('answerCallbackQuery',{callback_query_id:callback.id,text:'Вы записаны. Подтверждение придёт отдельным сообщением.'});return true;
    }
    match=callback.data.match(/^fc_change_(\d+)$/);
    if(match){await telegram(c.chat_id,'Выберите другое время. Прежнее место сохраняется до подтверждения нового.',{reply_markup:await sessionKeyboard(Number(match[1]),c.id)});await telegramApi('answerCallbackQuery',{callback_query_id:callback.id});return true;}
    match=callback.data.match(/^fc_answer_([a-f0-9-]{36})_(\d)$/);
    if(match){
      const job=(await sql`SELECT j.* FROM funnel_jobs j JOIN funnel_recipients r ON r.job_id=j.id WHERE j.id=${match[1]} AND r.candidate_id=${c.id} AND r.state='sent'`).rows[0];
      const button=job?.config.buttons[Number(match[2])];if(!button?.choice)throw new Error('Ответ недоступен');
      const r=(await sql`UPDATE funnel_recipients SET choice=${button.choice},updated_at=NOW() WHERE job_id=${job.id} AND candidate_id=${c.id} AND choice IS NULL RETURNING *`).rows[0];
      const chosen=r?.choice||(await sql`SELECT choice FROM funnel_recipients WHERE job_id=${job.id} AND candidate_id=${c.id}`).rows[0]?.choice;
      await createTask('choice',{jobId:job.id,candidateId:c.id,choice:chosen},new Date(),stableId(`choice:${job.id}:${c.id}`));
      await telegramApi('answerCallbackQuery',{callback_query_id:callback.id,text:'Спасибо! Ответ сохранён.'});return true;
    }
    throw new Error('Кнопка устарела');
  }catch(e){await telegramApi('answerCallbackQuery',{callback_query_id:callback.id,text:String(e.message).slice(0,180),show_alert:true});return true;}
}
