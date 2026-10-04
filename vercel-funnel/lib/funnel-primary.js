import {createTask,initFunnel,sql,armTask} from './funnel-store.js';
import {isPrimarySlotAllowed} from './primary-schedule.js';
import {primaryTaskDueAt} from './primary-timing.js';
import crypto from 'node:crypto';
function idFor(s){const x=crypto.createHash('sha256').update(s).digest('hex').slice(0,32);return `${x.slice(0,8)}-${x.slice(8,12)}-${x.slice(12,16)}-${x.slice(16,20)}-${x.slice(20)}`;}
export async function schedulePrimary(session){
  await initFunnel();
  const at=new Date(session.interview_at).toISOString(),slot=session.slot_id;
  for(const name of ['reminder','no_show']){
    const due=primaryTaskDueAt(at,name);
    if(+due<Date.now()-20*60000)continue;
    await createTask('primary_session',{at,slot},new Date(Math.max(+due,Date.now()+1000)),idFor(`primary:${name}:${at}:${slot}`));
  }
}
export async function migrateNoEntryTimers({at,slot}={}){
  await initFunnel();
  if(!at||!slot||!isPrimarySlotAllowed(slot)||!Number.isFinite(Date.parse(at)))throw new Error('Exact primary appointment is required');
  const normalizedAt=new Date(at).toISOString(),taskId=idFor(`primary:no_show:${normalizedAt}:${slot}`);
  const tasks=(await sql`SELECT id,payload,due_at,state,error FROM funnel_tasks WHERE id=${taskId} AND kind='primary_session' AND state<>'done' AND payload->>'at'=${normalizedAt} AND payload->>'slot'=${slot} LIMIT 1`).rows;
  const updated=[];
  for(const t of tasks){
    const p=typeof t.payload==='string'?JSON.parse(t.payload):t.payload;
    if(t.id!==idFor(`primary:no_show:${p.at}:${p.slot}`))continue;
    const due=primaryTaskDueAt(p.at,'no_show');
    const row=(await sql`UPDATE funnel_tasks SET due_at=${due},state='pending',error=NULL,updated_at=NOW() WHERE id=${t.id} AND state<>'done' RETURNING id,due_at,state`).rows[0];
    if(!row)continue;
    try{await armTask(t.id);}
    catch(error){
      await sql`UPDATE funnel_tasks SET due_at=${t.due_at},state=${t.state},error=${t.error},updated_at=NOW() WHERE id=${t.id} AND state<>'done'`;
      try{await armTask(t.id);}catch{}
      throw error;
    }
    updated.push({id:t.id,dueAt:new Date(row.due_at).toISOString(),slot:p.slot,state:row.state});
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
