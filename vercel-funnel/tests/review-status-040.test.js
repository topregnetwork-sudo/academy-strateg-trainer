import {test} from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';
import {installReviewStatus,reconcileReviewStatus} from '../lib/review-status.js';
const db=new PGlite();const tag=conn=>(s,...v)=>conn.query(s.reduce((a,b,i)=>a+(i?'$'+i:'')+b,''),v);const sql=tag(db);
await db.exec(`CREATE TABLE candidates(id bigint PRIMARY KEY,status text,consent boolean DEFAULT true,updated_at timestamptz DEFAULT NOW());CREATE TABLE offline_interview_invites(candidate_id bigint,status text,telegram_message_id text);CREATE TABLE offline_interview_bookings(candidate_id bigint,status text);CREATE TABLE funnel_sessions(id bigint,active boolean);CREATE TABLE funnel_bookings(candidate_id bigint,session_id bigint);CREATE TABLE funnel_jobs(id bigint,config jsonb);CREATE TABLE funnel_recipients(candidate_id bigint,job_id bigint,state text);
INSERT INTO candidates(id,status) VALUES(1,'test_1_completed'),(2,'test_1_completed'),(3,'test_1_completed'),(45,'finalist');INSERT INTO offline_interview_invites VALUES(2,'sent','m2');INSERT INTO offline_interview_bookings VALUES(3,'booked'),(45,'booked');`);
test('atomic invitation/booking status, no regression on replay or manual decision, transactional rollback',async()=>{
 await installReviewStatus(sql);await installReviewStatus(sql);
 const status=async()=> (await db.query('SELECT status FROM candidates WHERE id=1')).rows[0].status;
 await db.exec(`INSERT INTO offline_interview_invites VALUES(1,'attention',NULL)`);assert.equal(await status(),'test_1_completed');
 await db.exec(`UPDATE offline_interview_invites SET status='sent',telegram_message_id='m1' WHERE candidate_id=1`);assert.equal(await status(),'productivity_invited');
 await assert.rejects(db.transaction(async tx=>{await tx.exec(`INSERT INTO offline_interview_bookings VALUES(1,'booked')`);throw Error('rollback');}));assert.equal(await status(),'productivity_invited');
 await db.exec(`INSERT INTO offline_interview_bookings VALUES(1,'booked');UPDATE offline_interview_invites SET status='sent' WHERE candidate_id=1`);assert.equal(await status(),'productivity_booked');
 await db.exec(`UPDATE candidates SET status='productivity_failed' WHERE id=1;UPDATE offline_interview_bookings SET status='booked' WHERE candidate_id=1`);assert.equal(await status(),'productivity_failed');
 const result=await reconcileReviewStatus(sql,fn=>db.transaction(tx=>fn(tag(tx))),true);assert.deepEqual(result.changed.map(r=>[r.id,r.target]),[[2,'productivity_invited'],[3,'productivity_booked']]);assert.equal(result.remaining.length,0);
 assert.equal((await db.query('SELECT status FROM candidates WHERE id=45')).rows[0].status,'finalist');assert.equal((await reconcileReviewStatus(sql,fn=>db.transaction(tx=>fn(tag(tx))),true)).changed.length,0);await db.close();
});
