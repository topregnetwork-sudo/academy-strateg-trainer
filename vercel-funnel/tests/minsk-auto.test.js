import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
mock.timers.enable({apis:['Date'],now:new Date('2026-08-30T10:00:00Z')});
const db=new PGlite(),sent=[];
await db.exec(`CREATE TABLE candidates(id bigint,chat_id text,username text,first_name text,last_name text,city text,status text,consent boolean);
CREATE TABLE candidate_tests(candidate_id bigint,submitted_at timestamptz);
CREATE TABLE applications(candidate_id bigint,full_name text,city text,created_at timestamptz);
CREATE TABLE offline_interview_invites(candidate_id bigint,event_date date,status text,telegram_message_id text,sent_at timestamptz,updated_at timestamptz,PRIMARY KEY(candidate_id,event_date));
CREATE TABLE offline_interview_bookings(candidate_id bigint,event_date date,slot_time text,status text);
CREATE TABLE messages(candidate_id bigint,direction text,kind text,text text,delivery_status text,telegram_message_id text);
INSERT INTO candidates VALUES(1,'101','one','Имя','','Минск','test_1_completed',true),(2,'102','two','Другой','','Минск','test_1_completed',true),(3,'103','three','Челябинск','','Челябинск','test_1_completed',true),(4,'104','four','Отказ','','Минск','productivity_failed',true),(45,'145','protected','Надежда','','Минск','test_1_completed',true);
INSERT INTO candidate_tests SELECT id,now() FROM candidates;`);
await mock.module('../api/_core.js',{namedExports:{init:async()=>{},json:()=>{},operator:()=>false,sql:(s,...v)=>db.query(s.reduce((a,b,i)=>a+(i?'$'+i:'')+b,''),v),telegram:async(chat,text,k)=>{sent.push({chat,text,k});return 500+sent.length;},telegramApi:async()=>{}}});
await mock.module('../api/drive.js',{namedExports:{syncDriveCandidate:async()=>{}}});
const {sendOfflineInvites,pendingMinskInvites}=await import('../api/offline-interview.js');
test('one event sends only that Minsk candidate; replay sends nothing; protected and other cities excluded',async()=>{
 assert.deepEqual((await pendingMinskInvites()).map(x=>Number(x.id)),[1,2]);
 assert.equal((await sendOfflineInvites(1)).sent,1);assert.equal(sent[0].chat,'101');assert.match(sent[0].text,/первичный разбор/);
 assert.equal((await sendOfflineInvites(1)).sent,0);
 assert.equal((await sendOfflineInvites(3)).sent,0);assert.equal((await sendOfflineInvites(4)).sent,0);assert.equal((await sendOfflineInvites(45)).sent,0);
 assert.equal(sent.length,1);
});
test('closed event does not send remaining candidate',async()=>{
 mock.timers.setTime(new Date('2026-09-01T10:30:00Z').getTime());
 assert.equal((await sendOfflineInvites(2)).stopped,true);assert.equal(sent.length,1);await db.close();
});
