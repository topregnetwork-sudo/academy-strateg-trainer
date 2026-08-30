import {sql} from '../api/_core.js';

// Read only, scoped to one candidate. Missing optional tables never erase chat data.
export async function candidateProgress(id) {
  const result={offlineInvites:[],offlineBookings:[],campaigns:[],bookings:[],errors:[]};
  const read=async(key,query)=>{try{result[key]=(await query()).rows;}catch{result.errors.push(key);}};
  await read('offlineInvites',()=>sql`SELECT event_date,status,sent_at,telegram_message_id FROM offline_interview_invites WHERE candidate_id=${id} ORDER BY event_date DESC`);
  await read('offlineBookings',()=>sql`SELECT event_date,slot_time,status FROM offline_interview_bookings WHERE candidate_id=${id} ORDER BY event_date DESC`);
  const tables=(await sql`SELECT to_regclass('public.funnel_recipients') AS recipients,to_regclass('public.funnel_bookings') AS bookings`).rows[0];
  if(tables?.recipients)await read('campaigns',()=>sql`SELECT r.state,r.message_id,r.error,r.choice,r.updated_at,j.config,j.state AS job_state FROM funnel_recipients r JOIN funnel_jobs j ON j.id=r.job_id WHERE r.candidate_id=${id} ORDER BY r.updated_at DESC`);
  if(tables?.bookings)await read('bookings',()=>sql`SELECT b.updated_at,s.starts_at,f.config,f.active FROM funnel_bookings b JOIN funnel_slots s ON s.id=b.slot_id JOIN funnel_sessions f ON f.id=b.session_id WHERE b.candidate_id=${id} ORDER BY s.starts_at DESC`);
  return result;
}
