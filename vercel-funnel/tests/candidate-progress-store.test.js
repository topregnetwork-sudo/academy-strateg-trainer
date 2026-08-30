import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite(),queries=[];
await db.exec(`CREATE TABLE offline_interview_invites(candidate_id bigint,event_date date,status text,sent_at timestamptz,telegram_message_id text);
CREATE TABLE offline_interview_bookings(candidate_id bigint,event_date date,slot_time text,status text);
INSERT INTO offline_interview_invites VALUES(1,'2026-09-01','sent',now(),'123'),(2,'2026-09-01','sent',now(),'456');`);
await mock.module('../api/_core.js',{namedExports:{sql:(s,...v)=>{const q=s.reduce((a,b,i)=>a+(i?'$'+i:'')+b,'');queries.push(q);return db.query(q,v);}}});
const {candidateProgress}=await import('../lib/candidate-progress.js');
test('scoped history works without optional new console tables and never writes',async()=>{
 const r=await candidateProgress(1);assert.equal(r.offlineInvites.length,1);assert.equal(r.offlineInvites[0].telegram_message_id,'123');assert.deepEqual(r.errors,[]);assert.deepEqual(r.campaigns,[]);assert.ok(queries.every(q=>q.trim().startsWith('SELECT')));await db.close();
});
