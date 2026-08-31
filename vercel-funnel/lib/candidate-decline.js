import crypto from 'node:crypto';
import {sql,transaction,telegram,telegramApi} from '../api/_core.js';
import {initFunnel,createTask,effect} from './funnel-store.js';
import {reviewThread} from './review-presentation.js';
const SITE='https://academy-strateg-trainer.vercel.app';
const esc=x=>String(x??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
export async function initDeclines(){
 await initFunnel();
 await sql`CREATE TABLE IF NOT EXISTS candidate_decline_events(id text PRIMARY KEY,candidate_id bigint NOT NULL,snapshot jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT NOW(),notified_at timestamptz,error text)`;
 await sql`ALTER TABLE candidate_decline_events ENABLE ROW LEVEL SECURITY`;
}
export async function cancelCandidate(id,origin='operator',{dispatch=true}={}){
 await initDeclines();
 const event=await transaction(async tx=>{
  const c=(await tx`SELECT * FROM candidates WHERE id=${Number(id)} FOR UPDATE`).rows[0];if(!c)throw Error('Кандидат не найден');
  const legacy=(await tx`SELECT * FROM offline_interview_bookings WHERE candidate_id=${c.id} AND status='booked' AND (event_date+make_time(SUBSTRING(slot_time,1,2)::int,SUBSTRING(slot_time,3,2)::int,0)) AT TIME ZONE 'Europe/Moscow'>NOW() FOR UPDATE`).rows;
  const native=(await tx`SELECT b.* FROM funnel_bookings b JOIN funnel_slots s ON s.id=b.slot_id WHERE b.candidate_id=${c.id} AND s.starts_at>NOW() FOR UPDATE OF b`).rows;
  if(c.status==='cancelled'&&!legacy.length&&!native.length){
   const prior=(await tx`SELECT * FROM candidate_decline_events WHERE candidate_id=${c.id} ORDER BY created_at DESC LIMIT 1`).rows[0];if(prior)return prior;
  }
  const full=(await tx`SELECT full_name FROM applications WHERE candidate_id=${c.id} ORDER BY created_at DESC LIMIT 1`).rows[0]?.full_name;
  const snapshot={candidate:c,name:full||[c.first_name,c.last_name].filter(Boolean).join(' ')||c.username,legacy,native,origin};
  const eventId=crypto.randomUUID();
  await tx`INSERT INTO candidate_decline_events(id,candidate_id,snapshot) VALUES(${eventId},${c.id},${JSON.stringify(snapshot)}::text::jsonb)`;
  for(const b of legacy)await tx`DELETE FROM offline_interview_bookings WHERE candidate_id=${c.id} AND event_date=${b.event_date}::date AND status='booked'`;
  for(const b of native)await tx`DELETE FROM funnel_bookings WHERE id=${b.id} AND candidate_id=${c.id}`;
  await tx`UPDATE candidates SET status='cancelled',consent=false,updated_at=NOW() WHERE id=${c.id}`;
  const payload={eventId,candidateId:Number(c.id)};
  await tx`INSERT INTO funnel_tasks(id,kind,payload,due_at) VALUES(${eventId},'candidate_declined',${JSON.stringify(payload)}::text::jsonb,NOW()) ON CONFLICT DO NOTHING`;
  return {id:eventId,candidate_id:c.id,snapshot,notified_at:null};
 });
 let warning;
 if(dispatch&&!event.notified_at){try{await createTask('candidate_declined',{eventId:event.id,candidateId:Number(id)},new Date(),event.id);}catch(e){warning='Отказ сохранён, место освобождено. Бриф пока не удалось поставить на отправку: '+e.message;}}
 return {eventId:event.id,freed:event.snapshot.legacy.length+event.snapshot.native.length,notification:event.notified_at?'sent':'queued',warning};
}
export async function notifyCancellation(eventId){
 await initDeclines();
 const e=(await sql`SELECT * FROM candidate_decline_events WHERE id=${eventId}`).rows[0];if(!e||e.notified_at)return {done:true};
 const s=e.snapshot,c=s.candidate,review=s.legacy.length||s.native.length;
 if(review){const {queueInterviewAppointment}=await import('./interview-appointment.js');await queueInterviewAppointment(c.id);}
 const settings=Object.fromEntries((await sql`SELECT key,value FROM app_settings WHERE key IN ('hr_brief_chat_id','hr_brief_thread_id')`).rows.map(r=>[r.key,r.value]));
 const chat=review?'-1004397133749':settings.hr_brief_chat_id||process.env.HR_BRIEF_CHAT_ID;
 const thread=review?reviewThread(c.city):Number(settings.hr_brief_thread_id||0);if(!chat)throw Error('Тема брифов не настроена');
 const lines=s.legacy.map(b=>`${String(b.event_date).slice(0,10)} · ${b.slot_time.slice(0,2)}:${b.slot_time.slice(2)} МСК`);
 for(const b of s.native){const slot=(await sql`SELECT starts_at FROM funnel_slots WHERE id=${b.slot_id}`).rows[0];if(slot)lines.push(new Date(slot.starts_at).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})+' МСК');}
 if(!review&&c.interview_at)lines.push(new Date(c.interview_at).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})+' МСК');
 const text=`❌ <b>Кандидат отказался от дальнейшего отбора</b>\n\n${esc(s.name)} · ${esc(c.city)}\n${esc(lines.join('\n'))}\n${review?'Запись отменена, место освобождено. Кандидата не ожидаем.':'Кандидата не ожидаем. Напоминания прекращены.'}\nОснование: ${s.origin==='bot'?'кандидат сообщил в боте':'оператор отметил отказ'}\n<a href="${SITE}/operator.html?candidate_id=${c.id}">Карточка кандидата</a>`;
 try{
  await effect(`decline-notice:${e.id}`,()=>telegram(chat,text,{message_thread_id:thread||undefined,disable_web_page_preview:true}));
  if(s.legacy.length){
   const {slotSummary,refreshInvitationKeyboards}=await import('../api/offline-interview.js');
   const summary=await slotSummary();
   await effect(`decline-summary:${e.id}`,()=>telegram(chat,summary.text,{message_thread_id:thread,disable_web_page_preview:true}));
   await refreshInvitationKeyboards({onlyUnbooked:true,strict:true});
  }
  if(s.native.length){const {sendSessionSummary,sessionKeyboard}=await import('./funnel-engine.js');for(const session of new Set(s.native.map(b=>b.session_id))){
    await sendSessionSummary(session,`decline-summary:${e.id}:${session}`);
    const invitees=(await sql`SELECT c.id,c.chat_id,r.message_id FROM funnel_recipients r JOIN funnel_jobs j ON j.id=r.job_id JOIN candidates c ON c.id=r.candidate_id WHERE j.config->>'sessionId'=${String(session)} AND r.state='sent' AND j.config->>'action' IN ('invite','test_passed') AND c.status='productivity_invited' AND c.consent=true AND NOT EXISTS(SELECT 1 FROM funnel_bookings b WHERE b.candidate_id=c.id AND b.session_id=${session})`).rows;
    for(const r of invitees){try{await telegramApi('editMessageReplyMarkup',{chat_id:r.chat_id,message_id:Number(r.message_id),reply_markup:await sessionKeyboard(session,r.id)});}catch(error){if(!/message is not modified/i.test(error.message))throw error;}}
  }}
  if(!review&&c.interview_at){
   const rows=(await sql`SELECT id,first_name,last_name,city FROM candidates WHERE interview_at=${c.interview_at} AND slot_id=${c.slot_id} AND status='interview_booked' AND consent=true ORDER BY id`).rows;
   const list=rows.map((r,i)=>`${i+1}. ${esc([r.first_name,r.last_name].filter(Boolean).join(' '))} · ${esc(r.city)}`).join('\n');
   await effect(`decline-summary:${e.id}`,()=>telegram(chat,`📋 <b>Обновлённый список первого Zoom</b>\n${esc(lines.join('\n'))}\nЗаписано: ${rows.length}\n${list||'Записей нет'}`,{message_thread_id:thread||undefined}));
  }
  await sql`UPDATE candidate_decline_events SET notified_at=NOW(),error=NULL WHERE id=${e.id}`;
  return {done:true};
 }catch(error){await sql`UPDATE candidate_decline_events SET error=${error.message} WHERE id=${e.id}`;throw error;}
}
