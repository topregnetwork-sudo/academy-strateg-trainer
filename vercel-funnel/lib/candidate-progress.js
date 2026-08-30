import {sql} from '../api/_core.js';

// Read only, scoped to one candidate. Missing optional tables never erase chat data.
export async function candidateProgress(id) {
  const result={offlineInvites:[],offlineBookings:[],campaigns:[],bookings:[],errors:[]};
  const read=async(key,query)=>{try{result[key]=(await query()).rows;}catch{result.errors.push(key);}};
  await read('offlineInvites',()=>sql`SELECT event_date,status,sent_at,telegram_message_id FROM offline_interview_invites WHERE candidate_id=${id} ORDER BY event_date DESC`);
  await read('offlineBookings',()=>sql`SELECT event_date,slot_time,status FROM offline_interview_bookings WHERE candidate_id=${id} ORDER BY event_date DESC`);
  const tables=(await sql`SELECT to_regclass('public.funnel_recipients') AS recipients,to_regclass('public.funnel_bookings') AS bookings`).rows[0];
  const evidenceTables=(await sql`SELECT to_regclass('public.candidate_zoom_entries') AS entries,to_regclass('public.funnel_tasks') AS tasks`).rows[0];
  const sessions=(await sql`SELECT to_regclass('public.candidate_zoom_session_entries') AS entries`).rows[0];
  if(sessions?.entries)await read('primaryEntry',()=>sql`SELECT clicked_at,interview_at,slot_id FROM (SELECT * FROM candidate_zoom_entries UNION ALL SELECT candidate_id,clicked_at,interview_at,slot_id FROM candidate_zoom_session_entries) e WHERE candidate_id=${id} AND clicked_at BETWEEN interview_at-INTERVAL '15 minutes' AND interview_at+INTERVAL '60 minutes' ORDER BY clicked_at LIMIT 1`);
  else if(evidenceTables?.entries)await read('primaryEntry',()=>sql`SELECT clicked_at,interview_at,slot_id FROM candidate_zoom_entries WHERE candidate_id=${id} AND clicked_at BETWEEN interview_at-INTERVAL '15 minutes' AND interview_at+INTERVAL '60 minutes'`);
  if(evidenceTables?.tasks)await read('timers',()=>sql`SELECT t.kind,t.due_at,t.state,t.error FROM funnel_tasks t WHERE (t.payload->>'candidateId')=${String(id)} OR (t.kind='primary_session' AND (t.payload->>'at')::timestamptz=(SELECT interview_at FROM candidates WHERE id=${id}) AND t.payload->>'slot'=(SELECT slot_id FROM candidates WHERE id=${id})) OR (t.kind='minsk_review_30m' AND EXISTS(SELECT 1 FROM offline_interview_bookings b WHERE b.candidate_id=${id} AND b.status='booked' AND b.event_date=(t.payload->>'date')::date AND b.slot_time=t.payload->>'slot')) ORDER BY t.due_at DESC LIMIT 12`);
  if(tables?.recipients)await read('campaigns',()=>sql`SELECT r.state,r.message_id,r.error,r.choice,r.updated_at,j.config,j.state AS job_state FROM funnel_recipients r JOIN funnel_jobs j ON j.id=r.job_id WHERE r.candidate_id=${id} ORDER BY r.updated_at DESC`);
  if(tables?.bookings)await read('bookings',()=>sql`SELECT b.updated_at,s.starts_at,f.config,f.active FROM funnel_bookings b JOIN funnel_slots s ON s.id=b.slot_id JOIN funnel_sessions f ON f.id=b.session_id WHERE b.candidate_id=${id} ORDER BY s.starts_at DESC`);
  return result;
}
