import crypto from 'node:crypto';
import {init,json,sql,telegram} from './_core.js';
import {initFunnel,effect} from '../lib/funnel-store.js';
import {processCampaign,sessionKeyboard} from '../lib/funnel-engine.js';

const HASH='4dee6eb88afe906c1470b744089b037ea30e63680c45b273e4d32386b078e480';
const KEY='shared-productivity-20260903-04';
const JOB='ca2750d1-f6f1-4322-8b39-b69ee30e5f6f';
const ZOOM='https://us04web.zoom.us/j/73551020080?pwd=umoXpn7PdnHOQ6FhRHNnvdMBzUH8Vb.1';
const TEXT=`{name}, здравствуйте!

Приглашаем вас на следующий этап отбора — интервью на продуктивность в Академии Стратег. Встреча пройдёт онлайн в Zoom.

Выберите удобные дату и время по кнопке ниже. Запись общая для кандидатов из Минска и Челябинска.

До встречи ознакомьтесь и изучите Цели Академии Стратег.`;
const TIMES=['11:00','11:20','11:40','12:00','12:20','12:40'];

export default async function handler(req,res){
 if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
 const actual=crypto.createHash('sha256').update(String(req.body?.token||'')).digest('hex');
 if(actual.length!==HASH.length||!crypto.timingSafeEqual(Buffer.from(actual),Buffer.from(HASH)))return json(res,404,{error:'Not found'});
 try{
  await init();await initFunnel();
  let session=(await sql`SELECT * FROM funnel_sessions WHERE config->>'campaignKey'=${KEY} LIMIT 1`).rows[0];
  if(!session){
   const config={campaignKey:KEY,multiDay:true,name:'Интервью на продуктивность — 3–4 сентября',city:'Все города',format:'online',date:'3–4 сентября 2026 года',location:ZOOM,interval:20,capacity:1,cutoff:60,reminder:30,allowReschedule:true,allowCancel:true,confirmation:'Вы записаны на интервью на продуктивность.\nДата: {date}\nВремя: {time} МСК\nПодключитесь к Zoom по кнопке ниже.'};
   session=(await sql`INSERT INTO funnel_sessions(config) VALUES(${JSON.stringify(config)}::text::jsonb) RETURNING *`).rows[0];
   for(const day of ['2026-09-03','2026-09-04'])for(const time of TIMES)await sql`INSERT INTO funnel_slots(session_id,starts_at,capacity) VALUES(${session.id},${new Date(`${day}T${time}:00+03:00`).toISOString()},1) ON CONFLICT DO NOTHING`;
  }
  const candidates=(await sql`SELECT c.id,c.status FROM candidates c WHERE c.consent=true AND c.status IN ('test_1_completed','productivity_invited') AND EXISTS(SELECT 1 FROM candidate_tests t WHERE t.candidate_id=c.id AND t.submitted_at IS NOT NULL) AND c.id NOT IN (30,45) AND NOT EXISTS(SELECT 1 FROM funnel_bookings b JOIN funnel_slots s ON s.id=b.slot_id WHERE b.candidate_id=c.id AND s.starts_at>NOW()) ORDER BY c.id`).rows;
  const config={action:'invite',text:TEXT,buttons:[],sessionId:Number(session.id)};
  await sql`INSERT INTO funnel_jobs(id,config,state) VALUES(${JOB},${JSON.stringify(config)}::text::jsonb,'queued') ON CONFLICT DO NOTHING`;
  for(const c of candidates)await sql`INSERT INTO funnel_recipients(job_id,candidate_id,original_status) VALUES(${JOB},${c.id},${c.status}) ON CONFLICT DO NOTHING`;
  const sample='🧪 ОБРАЗЕЦ приглашения кандидатам после Теста 1\n\nКнопки в образце тестовые и места не занимают. Кандидаты увидят своё имя и те же даты и время.\n\n'+TEXT.replace('{name}','Имя кандидата');
  const keyboard=await sessionKeyboard(session.id,0,true);
  await effect(KEY+':sample:minsk',()=>telegram('-1004397133749',sample,{message_thread_id:619,parse_mode:undefined,reply_markup:keyboard}));
  await effect(KEY+':sample:chelyabinsk',()=>telegram('-1004397133749',sample,{message_thread_id:635,parse_mode:undefined,reply_markup:keyboard}));
  for(let i=0;i<10;i++){const done=await processCampaign(JOB);if(done.done)break;}
  const recipients=(await sql`SELECT r.candidate_id,r.state,r.error,r.message_id,c.first_name,c.last_name,c.username,c.city FROM funnel_recipients r JOIN candidates c ON c.id=r.candidate_id WHERE r.job_id=${JOB} ORDER BY c.city,c.id`).rows;
  const slots=(await sql`SELECT starts_at,capacity FROM funnel_slots WHERE session_id=${session.id} ORDER BY starts_at`).rows;
  return json(res,200,{ok:recipients.every(r=>r.state==='sent'),sessionId:session.id,slots,recipients});
 }catch(error){return json(res,500,{error:String(error?.message||error)});}
}
