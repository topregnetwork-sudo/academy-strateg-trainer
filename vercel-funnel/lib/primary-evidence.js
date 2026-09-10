import {sql,transaction,telegram,telegramApi,slots} from '../api/_core.js';
import {initFunnel,createTask,effect} from './funnel-store.js';
import crypto from 'node:crypto';
export function evidenceId(key){const s=crypto.createHash('sha256').update(key).digest('hex').slice(0,32);return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;}
// The reminder is sent 30 minutes before the meeting. Keep the button active
// through the reminder window and close it shortly after the start time.
export const PRIMARY_ENTRY_BEFORE_MINUTES=60;
export const PRIMARY_ENTRY_AFTER_MINUTES=10;
const lateEntryText='Вы опоздали и не смогли принять участие в первом собеседовании полностью. Рекомендуем повторно ознакомиться с материалами. После завершения окна текущей встречи выберите новое время и подключитесь с начала.';

let ready;
export async function initPrimaryEvidence(){
  if(!ready)ready=(async()=>{
    await sql`CREATE TABLE IF NOT EXISTS candidate_zoom_entries(candidate_id BIGINT PRIMARY KEY REFERENCES candidates(id),clicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),interview_at TIMESTAMPTZ,slot_id TEXT)`;
    await sql`ALTER TABLE candidate_zoom_entries ENABLE ROW LEVEL SECURITY`;
    await sql`CREATE TABLE IF NOT EXISTS candidate_zoom_session_entries(candidate_id BIGINT NOT NULL REFERENCES candidates(id),interview_at TIMESTAMPTZ NOT NULL,slot_id TEXT NOT NULL,clicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(candidate_id,interview_at,slot_id))`;
    await sql`ALTER TABLE candidate_zoom_session_entries ENABLE ROW LEVEL SECURITY`;
    await sql`INSERT INTO app_settings(key,value) VALUES('primary_click_gate_since',NOW()::text) ON CONFLICT DO NOTHING`;
  })().catch(e=>{ready=null;throw e;});
  return ready;
}
export function rebookKeyboard(){return {inline_keyboard:Object.entries(slots).map(([id,title])=>[{text:title,callback_data:`trainer_rebook_${id}`}])};}
const publicOrigin=()=>String(process.env.PUBLIC_SITE_URL||'https://academy-strateg-trainer.vercel.app').replace(/\/$/,'');
export function primaryEntryUrl(applicationCode){return /^[a-zA-Z0-9]{20}$/.test(String(applicationCode||''))?`${publicOrigin()}/api/primary-entry?code=${encodeURIComponent(applicationCode)}`:'';}
export function entryKeyboard(applicationCode){const url=primaryEntryUrl(applicationCode);return {inline_keyboard:[url?[{text:'Подключиться к Zoom',url}]:[{text:'Открыть Zoom',callback_data:'primary_zoom_enter'}],[{text:'Выбрать новое время',callback_data:'primary_rebook_menu'}]]};}
const rebookText='Если вы не смогли попасть на первое собеседование, выберите новое удобное время ниже. Прежняя запись заменится только после выбора нового слота.';
export async function offerPrimaryRebook(chatId,eventKey){
  await initPrimaryEvidence();await initFunnel();
  const c=(await sql`SELECT * FROM candidates WHERE chat_id=${String(chatId)} AND status='interview_booked' AND consent=true AND interview_at<=NOW()-INTERVAL '60 minutes' LIMIT 1`).rows[0];
  if(!c)return {ok:false,reason:'Новое время станет доступно через 60 минут после начала пропущенного собеседования.'};
  const messageId=await effect(`primary-self-rebook-059:${c.id}:${new Date(c.interview_at).toISOString()}:${eventKey}`,()=>telegram(c.chat_id,rebookText,{reply_markup:rebookKeyboard()}));
  await transaction(async tx=>{
    await tx`UPDATE candidates SET no_show_followup_sent=true,updated_at=NOW() WHERE id=${c.id} AND status='interview_booked' AND interview_at=${c.interview_at}`;
    await tx`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) SELECT ${c.id},'out','self_rebook_offer',${rebookText},'delivered',${String(messageId)} WHERE NOT EXISTS(SELECT 1 FROM messages WHERE candidate_id=${c.id} AND direction='out' AND telegram_message_id=${String(messageId)})`;
  });
  return {ok:true,candidateId:Number(c.id),messageId};
}
export async function handlePrimaryRebookMenu(callback){
  if(callback.data!=='primary_rebook_menu')return false;
  const chat=callback.message?.chat,valid=chat?.type==='private'&&String(chat.id)===String(callback.from?.id);
  const result=valid?await offerPrimaryRebook(callback.from.id,`callback:${callback.id}`):{ok:false,reason:'Кнопка доступна только адресату.'};
  await telegramApi('answerCallbackQuery',{callback_query_id:callback.id,text:result.ok?'Выберите новое время в сообщении ниже.':result.reason,show_alert:!result.ok});
  return true;
}
export async function primaryAccess(id){
  await initPrimaryEvidence();
  const row=(await sql`SELECT (SELECT MIN(e.clicked_at) FROM (SELECT * FROM candidate_zoom_entries UNION ALL SELECT candidate_id,clicked_at,interview_at,slot_id FROM candidate_zoom_session_entries) e WHERE e.candidate_id=c.id AND e.clicked_at BETWEEN e.interview_at-(${PRIMARY_ENTRY_BEFORE_MINUTES} * INTERVAL '1 minute') AND e.interview_at+(${PRIMARY_ENTRY_AFTER_MINUTES} * INTERVAL '1 minute')) AS clicked_at,
    (SELECT MIN(m.created_at) FROM messages m WHERE m.candidate_id=c.id AND m.kind='primary_zoom_link' AND m.created_at BETWEEN c.interview_at-(${PRIMARY_ENTRY_BEFORE_MINUTES} * INTERVAL '1 minute') AND c.interview_at+(${PRIMARY_ENTRY_AFTER_MINUTES} * INTERVAL '1 minute')) AS message_clicked_at,
    EXISTS(SELECT 1 FROM candidate_questionnaire_two q WHERE q.candidate_id=c.id AND q.sent_at<(SELECT value::timestamptz FROM app_settings WHERE key='primary_click_gate_since')) AS legacy
    FROM candidates c WHERE c.id=${id}`).rows[0];
  // Older deployments could send the URL before the 15-minute window opened
  // without saving an evidence row. Recover that logged bot event once.
  if(!row?.clicked_at&&row?.message_clicked_at){
    const c=(await sql`SELECT id,interview_at,slot_id FROM candidates WHERE id=${id} LIMIT 1`).rows[0];
    if(c?.interview_at&&c?.slot_id){
      await sql`INSERT INTO candidate_zoom_session_entries(candidate_id,interview_at,slot_id,clicked_at) VALUES(${c.id},${c.interview_at},${c.slot_id},${row.message_clicked_at}) ON CONFLICT(candidate_id,interview_at,slot_id) DO UPDATE SET clicked_at=LEAST(candidate_zoom_session_entries.clicked_at,EXCLUDED.clicked_at)`;
      await sql`INSERT INTO candidate_zoom_entries(candidate_id,interview_at,slot_id,clicked_at) VALUES(${c.id},${c.interview_at},${c.slot_id},${row.message_clicked_at}) ON CONFLICT DO NOTHING`;
    }
  }
  const clickedAt=row?.clicked_at||row?.message_clicked_at||null;
  return {clickedAt,legacy:!!row?.legacy,allowed:!!(clickedAt||row?.legacy)};
}
export async function recordPrimaryEntry(candidate){
  await initPrimaryEvidence();
  if(!candidate?.id||!candidate?.interview_at||!candidate?.slot_id)return null;
  const qualified=(await sql`INSERT INTO candidate_zoom_session_entries(candidate_id,interview_at,slot_id) SELECT ${candidate.id},${candidate.interview_at}::timestamptz,${candidate.slot_id} WHERE NOW() BETWEEN ${candidate.interview_at}::timestamptz-(${PRIMARY_ENTRY_BEFORE_MINUTES} * INTERVAL '1 minute') AND ${candidate.interview_at}::timestamptz+(${PRIMARY_ENTRY_AFTER_MINUTES} * INTERVAL '1 minute') ON CONFLICT(candidate_id,interview_at,slot_id) DO UPDATE SET clicked_at=candidate_zoom_session_entries.clicked_at RETURNING clicked_at`).rows[0];
  if(qualified){
    await sql`INSERT INTO candidate_zoom_entries(candidate_id,interview_at,slot_id,clicked_at) VALUES(${candidate.id},${candidate.interview_at},${candidate.slot_id},${qualified.clicked_at}) ON CONFLICT DO NOTHING`;
    await initFunnel();
    await createTask('primary_entry_report',{candidateId:Number(candidate.id)},new Date(),evidenceId(`primary-entry-report:${candidate.id}`));
  }
  return qualified||null;
}
async function applicationCodeForCandidate(id){return (await sql`SELECT code FROM applications WHERE candidate_id=${id} ORDER BY created_at DESC,id DESC LIMIT 1`).rows[0]?.code||'';}
export async function requirePrimaryAccess(candidate){
  if((await primaryAccess(candidate.id)).allowed)return true;
  const text='Дальнейший этап доступен после первого собеседования. В назначенное время нажмите «Открыть Zoom» в боте и присоединитесь к встрече. После встречи следуйте инструкции ведущего.';
  const messageId=await telegram(candidate.chat_id,text,candidate.status==='interview_booked'?{reply_markup:entryKeyboard(await applicationCodeForCandidate(candidate.id))}:{});
  await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) VALUES(${candidate.id},'out','primary_access_required',${text},'delivered',${String(messageId)})`;
  return false;
}
export async function handlePrimaryEntry(callback){
  if(callback.data!=='primary_zoom_enter')return false;
  await initPrimaryEvidence();
  const chat=callback.message?.chat;
  const c=chat?.type==='private'&&String(chat.id)===String(callback.from?.id)?(await sql`SELECT * FROM candidates WHERE chat_id=${String(callback.from.id)} AND consent=true LIMIT 1`).rows[0]:null;
  const allowed=c&&c.interview_at&&!['new','experienced_not_target','cancelled','rejected','selection_closed','academy_contact','productivity_failed'].includes(c.status);
  const start=c?.interview_at?Date.parse(c.interview_at):NaN;
  const active=Number.isFinite(start)&&Date.now()>=start-PRIMARY_ENTRY_BEFORE_MINUTES*60*1000&&Date.now()<=start+PRIMARY_ENTRY_AFTER_MINUTES*60*1000;
  if(!allowed||!active){
    if(!allowed){await telegramApi('answerCallbackQuery',{callback_query_id:callback.id,text:'Доступна только ваша действующая запись на первое собеседование.',show_alert:true});return true;}
    await telegramApi('answerCallbackQuery',{callback_query_id:callback.id,text:'Время входа в это собеседование завершено.',show_alert:true});
    await initFunnel();
    const messageId=await effect(`primary-entry-window-closed:${c.id}:${new Date(c.interview_at).toISOString()}`,()=>telegram(c.chat_id,lateEntryText));
    await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) SELECT ${c.id},'out','primary_entry_window_closed',${lateEntryText},'delivered',${String(messageId||'')} WHERE NOT EXISTS(SELECT 1 FROM messages WHERE candidate_id=${c.id} AND kind='primary_entry_window_closed')`;
    return true;
  }
  const zoom=(await sql`SELECT value FROM app_settings WHERE key='zoom_meeting_url'`).rows[0]?.value||process.env.ZOOM_MEETING_URL;
  if(!zoom)throw new Error('Primary Zoom URL is missing');
  const qualified=await recordPrimaryEntry(c);
  await telegramApi('answerCallbackQuery',{callback_query_id:callback.id,text:'Ссылка на первое собеседование — в сообщении ниже.'});
  await initFunnel();
  const text='Подключитесь к первому собеседованию по кнопке ниже в назначенное вам время.';
  const messageId=await effect(`primary-entry-link:${callback.id}`,()=>telegram(c.chat_id,text,{reply_markup:{inline_keyboard:[[{text:'Подключиться к Zoom',url:zoom}]]}}));
  await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) SELECT ${c.id},'out','primary_zoom_link',${text},'delivered',${String(messageId)} WHERE NOT EXISTS(SELECT 1 FROM messages WHERE candidate_id=${c.id} AND kind='primary_zoom_link' AND telegram_message_id=${String(messageId)})`;
  // Repeat delivery can recover a failed report scheduling; stable task ID prevents duplicates.
  return true;
}
const esc=v=>String(v??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
export async function reportPrimaryEntry(id){
  await initPrimaryEvidence();
  const c=(await sql`SELECT c.*,e.clicked_at,e.interview_at AS entry_interview_at,e.slot_id AS entry_slot FROM (SELECT * FROM candidate_zoom_entries UNION ALL SELECT candidate_id,clicked_at,interview_at,slot_id FROM candidate_zoom_session_entries) e JOIN candidates c ON c.id=e.candidate_id WHERE c.id=${id} AND e.clicked_at BETWEEN e.interview_at-(${PRIMARY_ENTRY_BEFORE_MINUTES} * INTERVAL '1 minute') AND e.interview_at+(${PRIMARY_ENTRY_AFTER_MINUTES} * INTERVAL '1 minute') ORDER BY e.clicked_at LIMIT 1`).rows[0];
  if(!c)return;
  const count=(await sql`SELECT count(DISTINCT candidate_id)::int AS count FROM (SELECT * FROM candidate_zoom_entries UNION ALL SELECT candidate_id,clicked_at,interview_at,slot_id FROM candidate_zoom_session_entries) e WHERE interview_at=${c.entry_interview_at} AND slot_id=${c.entry_slot} AND clicked_at BETWEEN interview_at-(${PRIMARY_ENTRY_BEFORE_MINUTES} * INTERVAL '1 minute') AND interview_at+(${PRIMARY_ENTRY_AFTER_MINUTES} * INTERVAL '1 minute')`).rows[0]?.count||0;
  const settings=Object.fromEntries((await sql`SELECT key,value FROM app_settings WHERE key IN ('hr_brief_chat_id','hr_brief_thread_id')`).rows.map(r=>[r.key,r.value]));
  const chat=settings.hr_brief_chat_id||process.env.HR_BRIEF_CHAT_ID;if(!chat)throw new Error('Primary staff topic is missing');
  const text=`▶️ <b>Нажал вход в первое Zoom-собеседование</b>\n${esc([c.first_name,c.last_name].filter(Boolean).join(' '))} · ${esc(c.city)}\nTelegram: ${esc(c.username?'@'+c.username:'без username')}\nПервое нажатие: ${esc(new Date(c.clicked_at).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'}))} МСК\nНажали на этот сеанс: ${count}\nЭто факт нажатия кнопки, не подтверждение присутствия в Zoom.`;
  await effect(`primary-entry-report:${id}`,()=>telegram(chat,text,settings.hr_brief_thread_id?{message_thread_id:Number(settings.hr_brief_thread_id)}:{}));
}
