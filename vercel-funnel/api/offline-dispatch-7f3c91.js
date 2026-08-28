import { createHash, timingSafeEqual } from 'node:crypto';
import { init, json, sql } from './_core.js';
import { sendOfflineInvites } from './offline-interview.js';

const EXPECTED_KEY_HASH = 'e26f245b2f7254269202173a213c31acf0cd8eda1b2a092e25fe9772bb2f3e51';
function authorized(req){const actual=createHash('sha256').update(String(req.headers['x-diagnostic-key']||'')).digest(),expected=Buffer.from(EXPECTED_KEY_HASH,'hex');return actual.length===expected.length&&timingSafeEqual(actual,expected)}

export default async function handler(req,res){
  if(!authorized(req))return json(res,404,{ok:false});
  try{
    await init();
    if(req.method==='GET'){
      const rows=(await sql`SELECT COALESCE(NULLIF(a.city,''),c.city,'') AS city,count(DISTINCT c.id)::int AS count FROM candidates c JOIN candidate_tests t ON t.candidate_id=c.id AND t.submitted_at IS NOT NULL LEFT JOIN LATERAL (SELECT city FROM applications WHERE candidate_id=c.id ORDER BY created_at DESC LIMIT 1) a ON TRUE LEFT JOIN offline_interview_invites i ON i.candidate_id=c.id AND i.event_date='2026-08-28'::date WHERE c.consent=true AND i.candidate_id IS NULL GROUP BY COALESCE(NULLIF(a.city,''),c.city,'') ORDER BY city`).rows;
      return json(res,200,{ok:true,rows});
    }
    if(req.method==='POST')return json(res,200,{ok:true,...(await sendOfflineInvites())});
    return json(res,405,{ok:false});
  }catch(error){console.error('[offline-dispatch] failed',{message:String(error)});return json(res,500,{ok:false,error:'dispatch_failed'})}
}
