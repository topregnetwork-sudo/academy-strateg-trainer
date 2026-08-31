import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {validateSession,validateMessage,eligibility} from '../lib/funnel-model.js';
const db=new PGlite(),sent=[];
function query(client,strings,values){return client.query(strings.reduce((s,x,i)=>s+(i?'$'+i:'')+x,''),values);}
await db.exec(`CREATE TABLE candidates(id bigint primary key,chat_id text,first_name text,last_name text,username text,phone text,city text,status text,updated_at timestamptz);
CREATE TABLE applications(id serial,candidate_id bigint,full_name text,created_at timestamptz default now());
CREATE TABLE candidate_tests(candidate_id bigint,submitted_at timestamptz);
CREATE TABLE candidate_drive(candidate_id bigint,folder_url text);
CREATE TABLE messages(candidate_id bigint,direction text,kind text,text text,delivery_status text,telegram_message_id text);
CREATE TABLE app_settings(key text primary key,value text,updated_at timestamptz);
INSERT INTO candidates VALUES(1,'101','Ирина','','ira','','Минск','test_1_completed',now()),(2,'102','Анна','','anna','','Минск','test_1_completed',now()),(3,'103','Иван','','ivan','','Челябинск','test_1_completed',now()),(45,'145','Надежда','Волкова','der_mond5','','Минск','test_1_completed',now());
INSERT INTO candidate_tests SELECT id,now() FROM candidates;`);
await mock.module('../api/_core.js',{namedExports:{
  sql:(s,...v)=>query(db,s,v),transaction:fn=>db.transaction(tx=>fn((s,...v)=>query(tx,s,v))),init:async()=>{},
  body:async req=>req.body,json:(res,status,data)=>res.status(status).json(data),operator:req=>req.headers?.authorization==='Bearer test-only',
  telegram:async(chat,text,extra)=>{sent.push({chat,text,extra});return sent.length;},
  telegramApi:async(method,args)=>{if(method==='getChatMember')return {status:'left'};sent.push({method,args});return sent.length;},slots:{}
}});
global.fetch=async()=>({ok:true});
process.env.OPERATOR_ACCESS_KEY='test-only';
const {default:handler}=await import('../api/funnel.js');
const {processCampaign,book,bookingFollowup,handleFunnelCallback}=await import('../lib/funnel-engine.js');
const {effect,verifyTaskToken,taskToken}=await import('../lib/funnel-store.js');
async function request(body,auth=true,method='POST',q={}){let code,data;await handler({method,body,query:q,headers:{authorization:auth?'Bearer test-only':''}},{status(s){code=s;return this},json(v){data=v;return v}});return {code,data};}
let sessionId,jobId;
test('authorization and token tamper protection',async()=>{
  assert.equal((await request({},false)).code,401);
  const id='12345678-1234-1234-1234-123456789012';assert.equal(verifyTaskToken(taskToken(id)),id);assert.equal(verifyTaskToken(taskToken(id).replace(/.$/,'z')),null);
});
test('input validation preserves scope and protects finalist',()=>{
  assert.throws(()=>validateMessage({action:'message',text:'x',buttons:[{text:'x',url:'javascript:alert(1)'}]}));
  assert.throws(()=>validateSession({}));
  assert.ok(eligibility({id:45,chat_id:'145',status:'test_1_completed'},{action:'close'}));
  assert.equal(eligibility({id:5,chat_id:'105',city:'Минск',test_completed:true,status:'productivity_failed'},{action:'invite'},{active:true,config:{city:'Минск'}}),'Этап уже завершён');
});
test('create configurable session and append template versions',async()=>{
  const date=new Date(Date.now()+86400000*10).toISOString().slice(0,10);
  const result=await request({action:'save_session',config:{name:'Проверка',city:'Минск',format:'offline',date,start:'11:00',end:'11:30',interval:15,capacity:1,location:'Площадь Свободы, 8'}});
  assert.equal(result.code,200,JSON.stringify(result));sessionId=Number(result.data.session.id);
  for(let i=1;i<=2;i++){const r=await request({action:'save_template',name:'Проверка',config:{action:'invite',text:'Изучите цели. {date}',buttons:[]}});assert.equal(Number(r.data.template.version),i);}
});
test('preview freezes exact recipients, excludes other city, sends once',async()=>{
  const p=await request({action:'preview',candidateIds:[1,2,3],config:{action:'invite',text:'Здравствуйте, {name}. {date} {location}',buttons:[],sessionId}});
  assert.equal(p.code,200,JSON.stringify(p));assert.equal(p.data.recipients.length,2);assert.equal(p.data.excluded.length,1);jobId=p.data.jobId;
  const before=sent.length;await request({action:'send',jobId});assert.equal(sent.length,before);
  await processCampaign(jobId);const n=sent.length;await processCampaign(jobId);assert.equal(sent.length,n);
  assert.equal((await db.query(`SELECT count(*)::int n FROM funnel_recipients WHERE state='sent'`)).rows[0].n,2);
});
test('two simultaneous bookings cannot take one place; failed move retains old place',async()=>{
  const slots=(await db.query('SELECT * FROM funnel_slots ORDER BY id')).rows;
  const first=await book(sessionId,Number(slots[0].id),1);
  await assert.rejects(book(sessionId,Number(slots[0].id),2),/занято/);
  await book(sessionId,Number(slots[1].id),2);
  await assert.rejects(book(sessionId,Number(slots[1].id),1),/занято/);
  assert.equal(Number((await db.query('SELECT slot_id FROM funnel_bookings WHERE candidate_id=1')).rows[0].slot_id),Number(slots[0].id));
  const n=sent.length;await bookingFollowup(first.booking.id,first.booking.version);assert.ok(sent.length>n);const after=sent.length;await bookingFollowup(first.booking.id,first.booking.version);assert.equal(sent.length,after);
  const race=await Promise.allSettled([book(sessionId,Number(slots[2].id),1),book(sessionId,Number(slots[2].id),2)]);
  assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(race.filter(r=>r.status==='rejected').length,1);
});
test('test callback changes no booking and ambiguous send never resends',async()=>{
  const before=(await db.query('SELECT count(*)::int n FROM funnel_bookings')).rows[0].n;
  await handleFunnelCallback({id:'test',data:'fc_demo',from:{id:101}});
  assert.equal((await db.query('SELECT count(*)::int n FROM funnel_bookings')).rows[0].n,before);
  let tries=0;const send=()=>{tries++;throw new Error('network timeout');};
  await assert.rejects(effect('test-failure',send));await assert.rejects(effect('test-failure',send));assert.equal(tries,1);
});
test('operator can read detailed delivery and slot ledger',async()=>{
  const r=await request(null,true,'GET',{jobId,sessionId});assert.equal(r.code,200);assert.equal(r.data.bookings.length,2);assert.equal(r.data.recipients.length,2);
});
test('046 Chelyabinsk launch:8 slots, safe sample, city logs, confirmation, reminders, no reschedule or duplicate',async()=>{
 await db.exec(`ALTER TABLE candidates ADD COLUMN consent boolean DEFAULT true; CREATE TABLE offline_interview_bookings(candidate_id bigint,status text);`);
 const {sessionConfig,eligible046,setup046,launch046,audit046,JOB,ZOOM}=await import('../lib/chelyabinsk-review-046.js');
 const cfg=sessionConfig(0);assert.equal(cfg.slots.length,8);assert.equal(cfg.slots[0],'2026-09-01T11:00:00.000Z');assert.equal(cfg.slots[7],'2026-09-01T13:20:00.000Z');assert.equal(cfg.capacity,1);
 const c={id:3,city:'Челябинск',consent:true,test_completed:true,chat_id:'103',status:'test_1_completed'};
 assert.ok(eligible046(c));for(const override of [{city:'Минск'},{consent:false},{test_completed:false},{status:'productivity_passed'},{status:'productivity_failed'},{status:'cancelled'},{review_booked:true}])assert.equal(eligible046({...c,...override}),false);
 const setup=await setup046();assert.equal((await audit046()).recipients.length,1);await setup046();assert.equal((await audit046()).recipients.length,1);
 // Keep booking tests independent of the calendar date of the test runner.
 await db.query("UPDATE funnel_slots SET starts_at=starts_at+interval '3650 days' WHERE session_id=$1",[setup.sessionId]);
 await launch046();await processCampaign(JOB);let state=await audit046();assert.equal(state.recipients[0].state,'sent');
 const dm=sent.find(x=>x.chat==='103'&&x.text?.includes('интервью на продуктивность'));assert.ok(dm.text.includes('/goals.html'));assert.equal(dm.extra.reply_markup.inline_keyboard.flat().length,10);
 const sample=sent.find(x=>x.text?.includes('Образец приглашения'));assert.equal(sample.extra.message_thread_id,635);
 const sampleButtons=sent.find(x=>x.method==='editMessageReplyMarkup'&&x.args.message_id===Number(state.effects.find(x=>x.key.endsWith(':sample')).message_id)).args.reply_markup.inline_keyboard.flat();assert.equal(sampleButtons.filter(x=>x.callback_data==='fc_demo').length,8);
 const n=sent.filter(x=>x.chat==='103').length;await processCampaign(JOB);assert.equal(sent.filter(x=>x.chat==='103').length,n);
 const slots=state.slots;const result=await book(Number(setup.sessionId),Number(slots[0].id),3);await bookingFollowup(result.booking.id,result.booking.version);
 const confirm=sent.filter(x=>x.chat==='103').at(-1);assert.ok(confirm.text.includes('16:00 по Челябинску'));assert.deepEqual(confirm.extra.reply_markup.inline_keyboard,[[{text:'Подключиться к Zoom',url:ZOOM}]]);
 await assert.rejects(book(Number(setup.sessionId),Number(slots[1].id),3),/подтверждено/);
 const tasks=(await db.query("SELECT * FROM funnel_tasks WHERE kind IN ('booking_reminder','session_brief') AND (payload->>'bookingId'=$1 OR payload->>'sessionId'=$2)",[String(result.booking.id),String(setup.sessionId)])).rows;assert.equal(tasks.length,2);for(const t of tasks)assert.equal(+new Date(t.due_at),+new Date(result.slot.starts_at)-1800000);
 const notices=sent.filter(x=>x.text?.includes('Челябинск')&&x.chat==='-1004397133749');assert.ok(notices.length>=3);for(const m of notices)assert.equal(m.extra.message_thread_id,635);
});
test.after(()=>db.close());
