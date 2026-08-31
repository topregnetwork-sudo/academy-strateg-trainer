import {test,mock} from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';
const db=new PGlite(),sent=[],tasks=new Map(),effects=new Map(),members=new Map([[1,'member'],[2,'member'],[3,'member']]);const tag=d=>(s,...v)=>d.query(s.reduce((a,b,i)=>a+(i?'$'+i:'')+b,''),v);
await db.exec(`CREATE TABLE candidates(id bigint PRIMARY KEY,chat_id text,status text,consent boolean,updated_at timestamptz,username text,first_name text,last_name text,city text);
CREATE TABLE candidate_tests(id bigint,candidate_id bigint,status text,sent_at timestamptz,submitted_at timestamptz,created_at timestamptz);
CREATE TABLE candidate_questionnaire_two(candidate_id bigint,sent_at timestamptz,submitted_at timestamptz);
CREATE TABLE app_settings(key text,value text); INSERT INTO app_settings VALUES('candidate_group_chat_id','-123');
CREATE TABLE messages(id bigserial,candidate_id bigint,direction text,kind text,text text,delivery_status text,telegram_message_id text,created_at timestamptz DEFAULT NOW());
INSERT INTO candidates VALUES(1,'1','questionnaire',true,NOW(),'one','One','','Минск'),(2,'2','questionnaire',true,NOW(),'two','Two','','Челябинск'),(3,'3','questionnaire',true,NOW(),'old','Old','','Минск');
INSERT INTO candidate_questionnaire_two VALUES(1,'2026-08-31T08:00:00+03:00',NULL),(2,'2026-08-31T08:00:00+03:00','2026-08-31T09:00:00+03:00'),(3,'2026-08-29T08:00:00+03:00',NULL);
INSERT INTO candidate_tests VALUES(2,2,'sent','2026-08-31T10:00:00+03:00',NULL,NOW());`);
await mock.module('../api/_core.js',{namedExports:{sql:tag(db),transaction:fn=>db.transaction(tx=>fn(tag(tx))),telegram:async(...a)=>{sent.push(a);return sent.length;},telegramApi:async(method,v)=>{if(method==='getChatMember')return {status:members.get(v.user_id)};if(method==='unbanChatMember'){members.set(v.user_id,'left');return true;}throw Error(method);}}});
await mock.module('../lib/funnel-store.js',{namedExports:{initFunnel:async()=>{},createTask:async(k,p,d,id)=>{tasks.set(id,{k,p,d});},effect:async(k,fn)=>{if(effects.has(k))return effects.get(k);const r=await fn();effects.set(k,r);return r;}}});
await mock.module('../lib/primary-evidence.js',{namedExports:{primaryAccess:async()=>({clickedAt:'2026-08-31T08:00:00+03:00'}),evidenceId:k=>k}});
const op=await import('../lib/stage-deadlines-043.js');
test('exact72h, old cohort excluded, repeat does not extend, complete protected, Q2 closure only at deadline, replay no duplicate',async()=>{
 assert.equal(op.dueAt('2026-08-31T08:00:00+03:00').toISOString(),'2026-09-03T05:00:00.000Z');
 await op.scheduleStageDeadline(1,'q2');await op.scheduleStageDeadline(2,'test1');await op.scheduleStageDeadline(3,'q2');assert.equal(tasks.size,2);assert.equal(sent.length,0);
 await db.exec(`UPDATE candidate_questionnaire_two SET sent_at='2026-09-01T08:00:00+03:00' WHERE candidate_id=1`);await op.scheduleStageDeadline(1,'q2');assert.equal(new Date(tasks.get('stage-deadline043:1:q2').d).toISOString(),'2026-09-03T05:00:00.000Z');
 assert.equal((await op.runStageDeadline(1,'q2',new Date('2026-09-03T04:59:59Z'))).done,false);assert.equal(sent.length,0);
 await db.exec(`UPDATE candidate_tests SET submitted_at=NOW(),status='completed' WHERE candidate_id=2`);await op.runStageDeadline(2,'test1',new Date('2026-09-04'));assert.equal(sent.length,0);assert.equal(members.get(2),'member');
 await op.runStageDeadline(1,'q2',new Date('2026-09-03T05:00:00Z'));assert.equal(members.get(1),'left');assert.equal(sent[0][1],op.farewell('q2'));assert.equal(sent[1][2].message_thread_id,30);
 await op.runStageDeadline(1,'q2',new Date('2026-09-04'));assert.equal(sent.length,2);
});
test('unanswered message pauses exclusion and sends staff attention only',async()=>{
 await db.exec(`UPDATE candidate_questionnaire_two SET sent_at='2026-08-31T08:00:00+03:00' WHERE candidate_id=3;INSERT INTO messages(candidate_id,direction,kind,text) VALUES(3,'in','text','Не работает ссылка')`);
 await op.scheduleStageDeadline(3,'q2');await op.runStageDeadline(3,'q2',new Date('2026-09-04'));assert.equal(members.get(3),'member');assert.equal(sent.length,3);assert.equal(sent[2][0],'-1004397133749');
 await op.runStageDeadline(3,'q2',new Date('2026-09-04'));assert.equal(sent.length,3);
});
