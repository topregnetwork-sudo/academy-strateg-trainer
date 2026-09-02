import {initFunnel,sql,transaction,createTask} from './funnel-store.js';
import crypto from 'node:crypto';

export const ROLLING_KEY='shared-productivity-20260903-04';
const TIMES=['11:00','11:20','11:40','12:00','12:20','12:40'];
const DAY_LIMIT=2;
const stableId=key=>{const s=crypto.createHash('sha256').update(key).digest('hex').slice(0,32);return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;};
const dayAt=(day,time)=>new Date(`${day}T${time}:00+03:00`);
const isoDay=date=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
const nextDay=day=>isoDay(new Date(dayAt(day,'12:00').getTime()+86400000));
const isSunday=day=>new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Moscow',weekday:'short'}).format(dayAt(day,'12:00'))==='Sun';
export function nextEligibleDay057(day){do{day=nextDay(day);}while(isSunday(day));return day;}

async function openDays(query,sessionId){
 return (await query`SELECT DISTINCT (s.starts_at AT TIME ZONE 'Europe/Moscow')::date::text AS day
   FROM funnel_slots s JOIN funnel_sessions fs ON fs.id=s.session_id
   WHERE s.session_id=${sessionId}
     AND s.starts_at>NOW()+COALESCE((fs.config->>'cutoff')::int,60)*INTERVAL '1 minute'
     AND (SELECT count(*) FROM funnel_bookings b WHERE b.slot_id=s.id)<s.capacity
   ORDER BY day`).rows.map(r=>r.day);
}

export async function ensureRollingWindow057(){
 await initFunnel();
 const result=await transaction(async tx=>{
   const session=(await tx`SELECT * FROM funnel_sessions WHERE active=true AND config->>'campaignKey'=${ROLLING_KEY} ORDER BY id DESC LIMIT 1 FOR UPDATE`).rows[0];
   if(!session)return {active:false,addedDays:[],openDays:[],sessionId:null};
   const before=await openDays(tx,session.id),addedDays=[];
   let cursor=(await tx`SELECT COALESCE(MAX((starts_at AT TIME ZONE 'Europe/Moscow')::date)::text,${isoDay(new Date())}) AS day FROM funnel_slots WHERE session_id=${session.id}`).rows[0].day;
   let count=before.length;
   while(count<DAY_LIMIT){
     cursor=nextEligibleDay057(cursor);
     for(const time of TIMES)await tx`INSERT INTO funnel_slots(session_id,starts_at,capacity) VALUES(${session.id},${dayAt(cursor,time)},1) ON CONFLICT(session_id,starts_at) DO NOTHING`;
     addedDays.push(cursor);count++;
   }
   return {active:true,sessionId:Number(session.id),addedDays,openDays:await openDays(tx,session.id)};
 });
 if(!result.active)return result;
 const earliest=result.openDays[0];
 if(earliest){
   const due=dayAt(earliest,'13:00');
   if(due>Date.now())await createTask('rolling_window_refresh_057',{sessionId:result.sessionId},due,stableId(`rolling-window-057:${result.sessionId}:${earliest}`));
 }
 return result;
}

export async function inviteRollingCandidate057(candidateId){
 const window=await ensureRollingWindow057();
 if(!window.active)return {sent:0,reason:'Активная общая сессия не найдена'};
 const c=(await sql`SELECT c.*,EXISTS(SELECT 1 FROM candidate_tests t WHERE t.candidate_id=c.id AND t.submitted_at IS NOT NULL) AS test_completed FROM candidates c WHERE c.id=${Number(candidateId)}`).rows[0];
 if(!c||!c.consent||!c.chat_id||!c.test_completed||!['test_1_completed','productivity_invited'].includes(c.status))return {sent:0,reason:'Кандидат не готов к интервью на продуктивность'};
 if((await sql`SELECT 1 FROM funnel_bookings WHERE candidate_id=${c.id} AND session_id=${window.sessionId} LIMIT 1`).rows[0])return {sent:0,reason:'Уже записан'};
 if((await sql`SELECT 1 FROM funnel_recipients r JOIN funnel_jobs j ON j.id=r.job_id WHERE r.candidate_id=${c.id} AND j.config->>'sessionId'=${String(window.sessionId)} AND r.state IN ('pending','processing','sent') LIMIT 1`).rows[0])return {sent:0,reason:'Приглашение уже создано'};
 const jobId=`rolling-057-${window.sessionId}-${c.id}`;
 const config={action:'invite',sessionId:window.sessionId,text:'Спасибо, что заполнили анкету и завершили Тест 1.\n\nПриглашаем вас на интервью на продуктивность в Академии Стратег.\n\nВыберите один из ближайших доступных дней и время по кнопке ниже.\n\nДо интервью ознакомьтесь и изучите Цели Академии Стратег.',buttons:[]};
 await transaction(async tx=>{
   await tx`INSERT INTO funnel_jobs(id,config,state) VALUES(${jobId},${JSON.stringify(config)}::text::jsonb,'queued') ON CONFLICT(id) DO NOTHING`;
   await tx`INSERT INTO funnel_recipients(job_id,candidate_id,original_status,state) VALUES(${jobId},${c.id},${c.status},'pending') ON CONFLICT(job_id,candidate_id) DO NOTHING`;
 });
 await createTask('campaign',{jobId},new Date(),stableId(`campaign:${jobId}`));
 return {sent:1,jobId,sessionId:window.sessionId,openDays:window.openDays};
}
