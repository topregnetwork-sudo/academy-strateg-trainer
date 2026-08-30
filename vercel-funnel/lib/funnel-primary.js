import {createTask,initFunnel,sql,armTask} from './funnel-store.js';
import crypto from 'node:crypto';
function idFor(s){const x=crypto.createHash('sha256').update(s).digest('hex').slice(0,32);return `${x.slice(0,8)}-${x.slice(8,12)}-${x.slice(12,16)}-${x.slice(16,20)}-${x.slice(20)}`;}
export async function schedulePrimary(session){
  await initFunnel();
  const at=new Date(session.interview_at).toISOString(),slot=session.slot_id;
  for(const [name,offset] of [['reminder',-30],['no_show',60]]){
    const due=new Date(at).getTime()+offset*60000;
    if(due<Date.now()-20*60000)continue;
    await createTask('primary_session',{at,slot},new Date(Math.max(due,Date.now()+1000)),idFor(`primary:${name}:${at}:${slot}`));
  }
}
export async function migrateNoEntryTimers(){
  await initFunnel();
  const tasks=(await sql`SELECT id,payload FROM funnel_tasks WHERE kind='primary_session' AND state<>'done' AND (payload->>'at')::timestamptz>NOW() ORDER BY due_at`).rows;
  const updated=[];
  for(const t of tasks){
    const p=typeof t.payload==='string'?JSON.parse(t.payload):t.payload;
    if(t.id!==idFor(`primary:no_show:${p.at}:${p.slot}`))continue;
    const due=new Date(new Date(p.at).getTime()+60*60000);
    await sql`UPDATE funnel_tasks SET due_at=${due},updated_at=NOW() WHERE id=${t.id} AND state<>'done'`;
    await armTask(t.id);
    updated.push({id:t.id,dueAt:due.toISOString(),slot:p.slot});
  }
  return {updated};
}
export async function migratePrimaryTimers(){
  await initFunnel();
  const done=(await sql`SELECT value FROM app_settings WHERE key='funnel_primary_timers_migrated'`).rows[0]?.value;
  if(done==='yes')return {migrated:true};
  const sessions=(await sql`SELECT DISTINCT interview_at,slot_id FROM candidates WHERE status='interview_booked' AND interview_at>NOW() ORDER BY interview_at`).rows;
  for(const session of sessions)await schedulePrimary(session);
  await sql`INSERT INTO app_settings(key,value) VALUES('funnel_primary_timers_migrated','yes') ON CONFLICT(key) DO UPDATE SET value='yes',updated_at=NOW()`;
  return {migrated:true,sessions:sessions.length};
}
