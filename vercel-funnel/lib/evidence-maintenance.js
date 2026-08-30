// Temporary 038 deployment verification. Bounded operations only; removed after migration.
import crypto from 'node:crypto';
import {init,json,sql,telegramApi} from '../api/_core.js';
import {initPrimaryEvidence,entryKeyboard} from './primary-evidence.js';
import {initFunnel} from './funnel-store.js';
import {schedulePrimary} from './funnel-primary.js';
import {scheduleMinskReminder} from './review-reminders.js';
const HASH='1feb2ffd23cf281123c958dacdeedda1444e6f4b69f49bf6682f15c498854da0',EXPIRES=1788118462704;
async function sessions(){return (await sql`SELECT interview_at,slot_id,count(*)::int AS participants FROM candidates WHERE status='interview_booked' AND consent=true AND interview_at>NOW() AND interview_at<NOW()+INTERVAL '14 days' GROUP BY interview_at,slot_id ORDER BY interview_at,slot_id`).rows;}
export async function evidenceMaintenance(req,res){
 if(req.method!=='POST'||Date.now()>EXPIRES||crypto.createHash('sha256').update(String(req.headers['x-maintenance-token']||'')).digest('hex')!==HASH)return json(res,404,{error:'Not found'});
 await init();await initFunnel();await initPrimaryEvidence();
 const mode=req.query?.mode;
 if(mode==='normalize_tasks'){
  const fixed=(await sql`UPDATE funnel_tasks SET payload=(payload#>>'{}')::jsonb WHERE jsonb_typeof(payload)='string' RETURNING id`).rows;
  const sessions=(await sql`UPDATE funnel_sessions SET config=(config#>>'{}')::jsonb WHERE jsonb_typeof(config)='string' RETURNING id`).rows;
  const jobs=(await sql`UPDATE funnel_jobs SET config=(config#>>'{}')::jsonb WHERE jsonb_typeof(config)='string' RETURNING id`).rows;
  const templates=(await sql`UPDATE funnel_templates SET config=(config#>>'{}')::jsonb WHERE jsonb_typeof(config)='string' RETURNING id`).rows;
  return json(res,200,{tasks:fixed.length,sessions:sessions.length,jobs:jobs.length,templates:templates.length});
 }
 if(mode==='audit'){
  const primary=await sessions();
  const review=(await sql`SELECT slot_time,count(*)::int AS participants FROM offline_interview_bookings WHERE event_date='2026-09-01' AND status='booked' GROUP BY slot_time ORDER BY slot_time`).rows;
  const tasks=(await sql`SELECT id,kind,due_at,state,error,payload FROM funnel_tasks WHERE kind IN ('primary_session','minsk_review_30m') ORDER BY due_at DESC LIMIT 100`).rows;
  const settings=(await sql`SELECT key,value FROM app_settings WHERE key IN ('funnel_primary_timers_migrated','hr_brief_chat_id','hr_brief_thread_id','primary_click_gate_since')`).rows;
  const edits=(await sql`SELECT m.id,c.id AS candidate_id,m.telegram_message_id FROM candidates c JOIN LATERAL(SELECT id,telegram_message_id FROM messages WHERE candidate_id=c.id AND kind IN ('booking_confirmation','reschedule_confirmation') AND delivery_status='delivered' AND telegram_message_id IS NOT NULL ORDER BY created_at DESC,id DESC LIMIT 1)m ON TRUE WHERE c.status='interview_booked' AND c.consent=true AND c.interview_at>NOW() AND c.interview_at<NOW()+INTERVAL '14 days' ORDER BY c.id`).rows;
  return json(res,200,{primary,review,tasks,settings,edits});
 }
 if(mode==='arm_primary'){const list=await sessions(),s=list[Number(req.query.index)];if(!s)return json(res,400,{error:'Unknown session'});await schedulePrimary(s);return json(res,200,{armed:s});}
 if(mode==='arm_review'){const slot=String(req.query.slot||'');const row=(await sql`SELECT slot_time FROM offline_interview_bookings WHERE event_date='2026-09-01' AND slot_time=${slot} AND status='booked' LIMIT 1`).rows[0];if(!row)return json(res,400,{error:'Unknown booking'});return json(res,200,await scheduleMinskReminder(slot));}
 if(mode==='edit_button'){
  const id=Number(req.query.id),row=(await sql`SELECT m.*,c.chat_id FROM messages m JOIN candidates c ON c.id=m.candidate_id WHERE m.id=${id} AND m.kind IN ('booking_confirmation','reschedule_confirmation') AND c.status='interview_booked' AND c.consent=true AND c.interview_at>NOW() AND c.interview_at<NOW()+INTERVAL '14 days'`).rows[0];
  if(!row)return json(res,400,{error:'Unknown message'});
  try{await telegramApi('editMessageReplyMarkup',{chat_id:row.chat_id,message_id:Number(row.telegram_message_id),reply_markup:entryKeyboard()});}catch(e){if(!/message is not modified/i.test(String(e.message)))throw e;}
  return json(res,200,{edited:id});
 }
 if(mode==='activate_exact'){
  const list=await sessions();
  for(const s of list){const rows=(await sql`SELECT kind,state,error,payload FROM funnel_tasks WHERE kind='primary_session' AND (payload->>'at')::timestamptz=${s.interview_at} AND payload->>'slot'=${s.slot_id}`).rows;if(rows.length<2||rows.some(r=>r.error))return json(res,409,{error:'Not every future session is armed'});}
  await sql`INSERT INTO app_settings(key,value) VALUES('funnel_primary_timers_migrated','yes') ON CONFLICT(key) DO UPDATE SET value='yes',updated_at=NOW()`;
  return json(res,200,{exact:true});
 }
 return json(res,400,{error:'Unknown mode'});
}
