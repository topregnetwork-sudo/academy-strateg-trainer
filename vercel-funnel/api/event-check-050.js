import crypto from 'node:crypto';
import {init,sql,telegramApi} from './_core.js';
export default async function handler(req,res){
 const key=String(req.headers['x-event-check']||'');
 if(crypto.createHash('sha256').update(key).digest('hex')!=='8c6e1f84a09e07c3e421320ca017ff6f43bae6076e7cd765b3c2219046255f5c')return res.status(404).end();
 try{await init();
 const candidate=(await sql`SELECT id,username,status,consent,updated_at FROM candidates WHERE LOWER(username)=LOWER('slkpwr') LIMIT 1`).rows[0];
 if(!candidate)return res.status(200).json({candidate:null});
 const q=(await sql`SELECT status,sent_at,opened_at,submitted_at,completion_notice_sent_at FROM candidate_questionnaire_two WHERE candidate_id=${candidate.id}`).rows[0]||null;
 const tests=(await sql`SELECT id,status,sent_at,opened_at,submitted_at,created_at,updated_at FROM candidate_tests WHERE candidate_id=${candidate.id} ORDER BY created_at DESC`).rows;
 const messages=(await sql`SELECT direction,kind,text,delivery_status,telegram_message_id,created_at FROM messages WHERE candidate_id=${candidate.id} ORDER BY created_at DESC,id DESC LIMIT 12`).rows;
 let deadlines=[];try{deadlines=(await sql`SELECT step,state,issued_at,due_at,error FROM stage_deadlines043 WHERE candidate_id=${candidate.id} ORDER BY issued_at`).rows}catch{}
 const tasks=(await sql`SELECT kind,state,due_at,error,updated_at FROM funnel_tasks WHERE payload->>'candidateId'=${String(candidate.id)} ORDER BY updated_at DESC LIMIT 12`).rows;
 const webhook=await telegramApi('getWebhookInfo');
 return res.status(200).json({candidate,q,tests,messages,deadlines,tasks,webhook:{url:webhook.url,pending_update_count:webhook.pending_update_count,last_error_date:webhook.last_error_date,last_error_message:webhook.last_error_message,max_connections:webhook.max_connections}});
 }catch(e){return res.status(500).json({error:e.message});}
}
