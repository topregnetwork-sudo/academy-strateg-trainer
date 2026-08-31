import crypto from 'node:crypto';
import {sql,json} from './_core.js';
import {readProductivityAppointment,appointmentFields} from '../lib/interview-appointment.js';
export default async function handler(req,res){
 const hash=crypto.createHash('sha256').update(String(req.headers['x-check-key']||'')).digest('hex');
 if(req.method!=='GET'||Date.now()>1788194778254||hash!=='d5f0f4991ef78ba0b36364ea57d90dc16472f865b9d8a028d09b3c1182512c03')return json(res,404,{error:'Not found'});
 try{
  const candidate=(await sql`SELECT id,username,status,group_joined_at FROM candidates WHERE id=94 AND lower(username)='losiandr'`).rows[0];
  if(!candidate)return json(res,404,{error:'Not found'});
  const entry=(await sql`SELECT MIN(clicked_at) AS at FROM
    (SELECT candidate_id,clicked_at,interview_at FROM candidate_zoom_entries UNION ALL
     SELECT candidate_id,clicked_at,interview_at FROM candidate_zoom_session_entries)e
    WHERE candidate_id=94 AND clicked_at BETWEEN interview_at-INTERVAL '15 minutes' AND interview_at+INTERVAL '60 minutes'`).rows[0];
  const q=(await sql`SELECT sent_at,opened_at,submitted_at FROM candidate_questionnaire_two WHERE candidate_id=94`).rows[0];
  const t=(await sql`SELECT created_at,opened_at,submitted_at FROM candidate_tests WHERE candidate_id=94 ORDER BY created_at DESC LIMIT 1`).rows[0];
  const invite=(await sql`SELECT sent_at FROM offline_interview_invites WHERE candidate_id=94 AND event_date='2026-09-01'`).rows[0];
  const registration=(await sql`SELECT created_at,updated_at FROM offline_interview_bookings WHERE candidate_id=94 AND event_date='2026-09-01' AND status='booked'`).rows[0];
  const booking=await readProductivityAppointment(sql,94);
  return json(res,200,{candidate,entry,q,t,invite,registration,booking,fields:appointmentFields(booking)});
 }catch(e){console.error('[appointment-check-048]',e.message);return json(res,500,{error:'Read failed'});}
}
