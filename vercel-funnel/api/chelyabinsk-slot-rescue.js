import crypto from 'node:crypto';
import {init,json,sql} from './_core.js';
import {initFunnel,transaction} from '../lib/funnel-store.js';
import {processCampaign,stableId} from '../lib/funnel-engine.js';

const KEY_HASH='2614482425964e0590ae249c9827149542f67a69a5e17e4e9e1558767b1feacd';
const allowed=req=>crypto.createHash('sha256').update(String(req.headers['x-maintenance-key']||'')).digest('hex')===KEY_HASH;
const JOB='chelyabinsk-rescue-20260901-1440';
const CAMPAIGN='chelyabinsk-rescue-slot-20260901-1440';
const ZOOM='https://us04web.zoom.us/j/74249951606?pwd=VLMPEb4ZQG7JFbqMTIJdsuX1YFzdDL.1';
const TEXT='{name}, здравствуйте!\n\nСегодня освободилось одно место на онлайн-интервью на продуктивность Академии Стратег.\n\nДата: 1 сентября 2026 года.\nВремя: 14:40 МСК — 16:40 по Челябинску.\nФормат: Zoom.\n\nЕсли время вам подходит, нажмите кнопку 14:40 ниже. Место займёт первый записавшийся кандидат. После записи бот пришлёт подтверждение и ссылку на Zoom.\n\nДо встречи ознакомьтесь и изучите Цели Академии Стратег:\nhttps://academy-strateg-trainer.vercel.app/goals.html';

async function eligible(){
 return (await sql`SELECT c.id,c.chat_id,c.first_name,c.last_name,c.username,c.city,c.status,c.consent,a.full_name
  FROM candidates c LEFT JOIN LATERAL(SELECT full_name FROM applications WHERE candidate_id=c.id ORDER BY created_at DESC LIMIT 1)a ON TRUE
  WHERE c.city='Челябинск' AND c.consent=true AND c.chat_id IS NOT NULL
   AND c.status IN ('test_1_completed','productivity_invited')
   AND EXISTS(SELECT 1 FROM candidate_tests t WHERE t.candidate_id=c.id AND t.submitted_at IS NOT NULL)
   AND NOT EXISTS(SELECT 1 FROM funnel_bookings b WHERE b.candidate_id=c.id)
   AND NOT EXISTS(SELECT 1 FROM offline_interview_bookings b WHERE b.candidate_id=c.id AND b.status='booked')
  ORDER BY c.id`).rows;
}

async function state(){
 const audience=await eligible();
 const session=(await sql`SELECT * FROM funnel_sessions WHERE config->>'campaignKey'=${CAMPAIGN} LIMIT 1`).rows[0]||null;
 const slots=session?(await sql`SELECT s.*,count(b.id)::int used FROM funnel_slots s LEFT JOIN funnel_bookings b ON b.slot_id=s.id WHERE s.session_id=${session.id} GROUP BY s.id`).rows:[];
 const recipients=(await sql`SELECT r.candidate_id,r.state,r.error,c.username FROM funnel_recipients r JOIN candidates c ON c.id=r.candidate_id WHERE r.job_id=${JOB} ORDER BY r.candidate_id`).rows;
 return {audience:audience.map(({chat_id,...c})=>c),session,slots,recipients};
}

async function launch(){
 const audience=await eligible();
 if(!audience.length)throw new Error('Нет челябинских кандидатов, завершивших Тест 1 и ожидающих записи');
 await transaction(async tx=>{
  await tx`SELECT pg_advisory_xact_lock(521440)`;
  let session=(await tx`SELECT * FROM funnel_sessions WHERE config->>'campaignKey'=${CAMPAIGN} LIMIT 1`).rows[0];
  if(!session){
   const config={name:'Дополнительный слот — Челябинск, 1 сентября 14:40',city:'Челябинск',format:'online',date:'2026-09-01',cutoff:5,capacity:1,location:ZOOM,campaignKey:CAMPAIGN,allowReschedule:true,allowCancel:true,confirmation:'✅ Вы записаны на интервью на продуктивность в Академии Стратег.\n\nДата: 1 сентября 2026 года.\nВремя: {time} МСК — {local_time} по Челябинску.\nФормат: Zoom.\n{location}\n\nДо встречи ознакомьтесь и изучите Цели Академии Стратег:\nhttps://academy-strateg-trainer.vercel.app/goals.html',reminderText:'Напоминаем о вашем интервью на продуктивность Академии Стратег.\nВремя: {time} МСК — {local_time} по Челябинску.\n{location}'};
   session=(await tx`INSERT INTO funnel_sessions(config) VALUES(${JSON.stringify(config)}::text::jsonb) RETURNING *`).rows[0];
   await tx`INSERT INTO funnel_slots(session_id,starts_at,capacity) VALUES(${session.id},'2026-09-01T11:40:00Z',1)`;
  }
  const config={action:'invite',text:TEXT,sessionId:session.id,buttons:[]};
  await tx`INSERT INTO funnel_jobs(id,config,state) VALUES(${JOB},${JSON.stringify(config)}::text::jsonb,'queued') ON CONFLICT(id) DO NOTHING`;
  for(const c of audience)await tx`INSERT INTO funnel_recipients(job_id,candidate_id,original_status) VALUES(${JOB},${c.id},${c.status}) ON CONFLICT DO NOTHING`;
  await tx`UPDATE funnel_jobs SET state='queued' WHERE id=${JOB} AND state='draft'`;
 });
 for(let i=0;i<100;i+=1){const result=await processCampaign(JOB);if(result.done)break;}
 return state();
}

export default async function handler(req,res){
 if(!allowed(req))return json(res,404,{error:'Not found'});
 try{await init();await initFunnel();if(req.method==='GET')return json(res,200,{ok:true,...await state()});if(req.method==='POST')return json(res,200,{ok:true,...await launch()});return json(res,405,{error:'Method not allowed'});}catch(error){return json(res,409,{ok:false,error:String(error?.message||error)});}
}
