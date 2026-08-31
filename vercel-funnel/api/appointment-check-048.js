import crypto from 'node:crypto';
import {sql,json} from './_core.js';
import {readProductivityAppointment,appointmentFields} from '../lib/interview-appointment.js';
// Temporary read-only sample check, one candidate, expires automatically.
export default async function handler(req,res){
  const hash=crypto.createHash('sha256').update(String(req.headers['x-check-key']||'')).digest('hex');
  if(req.method!=='GET'||Date.now()>1788194778254||hash!=='d5f0f4991ef78ba0b36364ea57d90dc16472f865b9d8a028d09b3c1182512c03')return json(res,404,{error:'Not found'});
  try{
    const rows=(await sql`SELECT c.id,c.username,a.full_name FROM candidates c
      LEFT JOIN LATERAL(SELECT full_name FROM applications WHERE candidate_id=c.id ORDER BY created_at DESC LIMIT 1)a ON true
      WHERE lower(c.username)='losiandr'`).rows;
    if(rows.length!==1)return json(res,409,{error:'Ambiguous candidate'});
    const booking=await readProductivityAppointment(sql,rows[0].id);
    return json(res,200,{candidate:rows[0],booking,fields:appointmentFields(booking)});
  }catch(e){console.error('[appointment-check-048]',e.message);return json(res,500,{error:'Read failed'});}
}
