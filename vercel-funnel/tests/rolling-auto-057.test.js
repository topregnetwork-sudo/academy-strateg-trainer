import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
const tag=conn=>(s,...v)=>conn.query(s.reduce((a,b,i)=>a+(i?'$'+i:'')+b,''),v);
const sql=tag(db);
await mock.module('../api/_core.js',{namedExports:{sql,transaction:fn=>db.transaction(tx=>fn(tag(tx)))}});
global.fetch=async()=>({ok:true});process.env.OPERATOR_ACCESS_KEY='test';
const {initFunnel}=await import('../lib/funnel-store.js');
const {ensureRollingWindow057,nextEligibleDay057,ROLLING_KEY}=await import('../lib/rolling-productivity-057.js');

test('Sunday is skipped',()=>assert.equal(nextEligibleDay057('2026-09-05'),'2026-09-07'));
test('keeps two open days and replay creates no duplicate slots or tasks',async()=>{
 await initFunnel();
 const config={campaignKey:ROLLING_KEY,cutoff:60,multiDay:true};
 const session=(await sql`INSERT INTO funnel_sessions(config) VALUES(${JSON.stringify(config)}::text::jsonb) RETURNING id`).rows[0];
 const first=await ensureRollingWindow057();assert.equal(first.openDays.length,2);assert.equal(first.addedDays.length,2);
 assert.equal(Number((await sql`SELECT count(*) n FROM funnel_slots WHERE session_id=${session.id}`).rows[0].n),12);
 const replay=await ensureRollingWindow057();assert.equal(replay.addedDays.length,0);
 assert.equal(Number((await sql`SELECT count(*) n FROM funnel_slots WHERE session_id=${session.id}`).rows[0].n),12);
 assert.equal(Number((await sql`SELECT count(*) n FROM funnel_tasks WHERE kind='rolling_window_refresh_057'`).rows[0].n),1);
 await sql`UPDATE funnel_slots SET capacity=0 WHERE session_id=${session.id} AND (starts_at AT TIME ZONE 'Europe/Moscow')::date::text=${first.openDays[0]}`;
 const extended=await ensureRollingWindow057();assert.equal(extended.addedDays.length,1);assert.equal(extended.openDays.length,2);
 assert.equal(Number((await sql`SELECT count(*) n FROM funnel_slots WHERE session_id=${session.id}`).rows[0].n),18);
});
test.after(()=>db.close());
