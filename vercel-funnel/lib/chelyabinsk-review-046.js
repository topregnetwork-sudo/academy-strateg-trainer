import {telegram,sql} from '../api/_core.js';
import {initFunnel,transaction,effect,createTask} from './funnel-store.js';
import {validateSession,validateMessage,renderText,eligibility} from './funnel-model.js';
import {sessionKeyboard,stableId,sendSessionSummary} from './funnel-engine.js';
export const KEY='chelyabinsk-review-046',JOB='chelyabinsk-review-046-invitations';
export const ZOOM='https://us04web.zoom.us/j/74249951606?pwd=VLMPEb4ZQG7JFbqMTIJdsuX1YFzdDL.1';
export const TEXT='{name}, здравствуйте!\n\nСпасибо, что заполнили анкету и завершили Тест 1.\n\nПриглашаем вас на следующий этап — онлайн-интервью на продуктивность в Академии Стратег.\n\nДата: 1 сентября 2026 года.\nФормат: Zoom, приезжать в офис не нужно.\n\nВыберите доступное время по кнопке ниже. Все кнопки — по московскому времени. В Челябинске на 2 часа больше: 14:00 МСК — это 16:00 в Челябинске.\n\nНа каждое время предусмотрено одно место. После записи бот отправит подтверждение с вашим временем и ссылкой на Zoom.\n\nДо встречи ознакомьтесь и изучите Цели Академии Стратег:\nhttps://academy-strateg-trainer.vercel.app/goals.html\n\nPDF можно скачать по кнопке ниже.';
export function sessionConfig(now=Date.now()){
 const config=validateSession({name:'Интервью на продуктивность — Челябинск, 1 сентября',city:'Челябинск',format:'online',date:'2026-09-01',start:'14:00',end:'16:20',interval:20,capacity:1,cutoff:60,location:ZOOM,
 confirmation:'✅ Вы записаны на интервью на продуктивность в Академии Стратег.\n\nДата: 1 сентября 2026 года.\nВремя: {time} МСК — {local_time} по Челябинску.\n\nВстреча пройдёт онлайн. Приезжать в офис не нужно. Подключитесь в назначенное время по кнопке ниже.\n{location}\n\nДо встречи ознакомьтесь и изучите Цели Академии Стратег:\nhttps://academy-strateg-trainer.vercel.app/goals.html\n\nЗа 30 минут до начала придёт напоминание.'},now);
 return {...config,campaignKey:KEY,allowReschedule:true,allowCancel:true,reminderText:'Напоминаем: через 30 минут ваше интервью на продуктивность в Академии Стратег.\nДата: 1 сентября 2026 года.\nВремя: {time} МСК — {local_time} по Челябинску.\nПодключитесь в назначенное время по кнопке ниже.\n{location}'};
}
export function eligible046(c){return c.city==='Челябинск'&&c.consent===true&&c.test_completed&&Boolean(c.chat_id)&&![30,45].includes(Number(c.id))&&['test_1_completed','productivity_invited'].includes(c.status)&&!c.review_booked;}
async function audience(){return (await sql`SELECT c.id,c.chat_id,c.first_name,c.last_name,c.username,c.city,c.status,c.consent,a.full_name,true AS test_completed,
 (EXISTS(SELECT 1 FROM funnel_bookings b WHERE b.candidate_id=c.id) OR EXISTS(SELECT 1 FROM offline_interview_bookings b WHERE b.candidate_id=c.id AND b.status='booked')) AS review_booked
 FROM candidates c LEFT JOIN LATERAL(SELECT full_name FROM applications WHERE candidate_id=c.id ORDER BY created_at DESC LIMIT 1) a ON TRUE
 WHERE c.city='Челябинск' AND EXISTS(SELECT 1 FROM candidate_tests t WHERE t.candidate_id=c.id AND t.submitted_at IS NOT NULL) ORDER BY c.id`).rows;}
export async function audit046(){
 await initFunnel();const rows=await audience();
 const session=(await sql`SELECT * FROM funnel_sessions WHERE config->>'campaignKey'=${KEY} LIMIT 1`).rows[0];
 const recipients=(await sql`SELECT r.candidate_id,r.original_status,r.state,r.error,r.message_id,c.first_name,c.last_name,c.city,c.status FROM funnel_recipients r JOIN candidates c ON c.id=r.candidate_id WHERE r.job_id=${JOB} ORDER BY r.candidate_id`).rows;
 const task=(await sql`SELECT id,state,error FROM funnel_tasks WHERE id=${stableId('campaign:'+JOB)}`).rows[0];
 const effects=(await sql`SELECT key,state,message_id,error FROM funnel_effects WHERE key IN (${KEY+':sample'},${'job-summary:'+JOB})`).rows;
 return {eligible:rows.filter(eligible046).map(({chat_id,...r})=>r),excluded:rows.filter(c=>!eligible046(c)).map(({chat_id,...r})=>r),session,recipients,task,effects,
 slots:session?(await sql`SELECT s.id,s.starts_at,s.capacity,count(b.id)::int AS used FROM funnel_slots s LEFT JOIN funnel_bookings b ON b.slot_id=s.id WHERE s.session_id=${session.id} GROUP BY s.id ORDER BY s.starts_at`).rows:[]};
}
export async function setup046(){
 await initFunnel();const cfg=sessionConfig(),rows=await audience();
 return transaction(async tx=>{
  await tx`SELECT pg_advisory_xact_lock(460901)`;
  let session=(await tx`SELECT * FROM funnel_sessions WHERE config->>'campaignKey'=${KEY} LIMIT 1`).rows[0];
  if(!session){session=(await tx`INSERT INTO funnel_sessions(config) VALUES(${JSON.stringify(cfg)}::text::jsonb) RETURNING *`).rows[0];for(const at of cfg.slots)await tx`INSERT INTO funnel_slots(session_id,starts_at,capacity) VALUES(${session.id},${at},1)`;}
  const config=validateMessage({action:'invite',text:TEXT,sessionId:session.id,buttons:[]});
  const fresh=(await tx`INSERT INTO funnel_jobs(id,config) VALUES(${JOB},${JSON.stringify(config)}::text::jsonb) ON CONFLICT DO NOTHING RETURNING id`).rows[0];
  if(fresh){
   for(const c of rows.filter(eligible046)){if(!eligibility(c,config,session))await tx`INSERT INTO funnel_recipients(job_id,candidate_id,original_status) VALUES(${JOB},${c.id},${c.status})`;}
   await tx`INSERT INTO funnel_templates(name,version,config) VALUES('Челябинск — продуктивность 1 сентября',1,${JSON.stringify(config)}::text::jsonb) ON CONFLICT DO NOTHING`;
  }
  return {sessionId:session.id,jobId:JOB};
 });
}
export async function launch046(){
 const state=await audit046();if(!state.session||!state.recipients.length)throw Error('Сначала создать встречу и проверить получателей');
 const id=state.session.id;
 await effect(KEY+':sample',()=>telegram('-1004397133749','🧪 Образец приглашения кандидатам — Челябинск\nКнопки времени тестовые: места не занимают. Имя в личном сообщении будет персональным.\n\n'+renderText(TEXT,{full_name:'Имя кандидата'},state.session.config),{message_thread_id:635,parse_mode:undefined,disable_web_page_preview:true,reply_markup:null}));
 // Keyboard is attached using the same generator as actual candidates, with inert time callbacks.
 const sample=(await sql`SELECT message_id FROM funnel_effects WHERE key=${KEY+':sample'} AND state='done'`).rows[0];
 const {telegramApi}=await import('../api/_core.js');
 try{await telegramApi('editMessageReplyMarkup',{chat_id:'-1004397133749',message_id:Number(sample.message_id),reply_markup:await sessionKeyboard(id,0,true)});}catch(e){if(!/message is not modified/i.test(e.message))throw e;}
 await sql`UPDATE funnel_jobs SET state='queued' WHERE id=${JOB} AND state='draft'`;
 await createTask('campaign',{jobId:JOB},new Date(),stableId('campaign:'+JOB));
 await sendSessionSummary(id,KEY+':initial-summary');
 return {sampleMessageId:sample.message_id,sessionId:id,recipients:state.recipients.length};
}
