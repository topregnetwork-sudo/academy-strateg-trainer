import crypto from 'node:crypto';
import {init,json,sql} from './_core.js';
import {bridgeCapabilities,syncDriveCandidate} from './drive.js';
import {syncInterviewAppointment} from '../lib/interview-appointment.js';

const KEY_HASH='2614482425964e0590ae249c9827149542f67a69a5e17e4e9e1558767b1feacd';
const allowed=req=>crypto.createHash('sha256').update(String(req.headers['x-maintenance-key']||'')).digest('hex')===KEY_HASH;

async function candidates(){
  return (await sql`SELECT DISTINCT c.id,COALESCE(a.full_name,c.first_name||' '||c.last_name,c.username,'Кандидат '||c.id) AS name,d.folder_url
    FROM candidates c
    JOIN candidate_questionnaire_two q ON q.candidate_id=c.id AND q.submitted_at IS NOT NULL
    JOIN candidate_tests t ON t.candidate_id=c.id AND t.submitted_at IS NOT NULL
    JOIN candidate_drive d ON d.candidate_id=c.id
    LEFT JOIN LATERAL(SELECT full_name FROM applications WHERE candidate_id=c.id ORDER BY created_at DESC LIMIT 1)a ON TRUE
    ORDER BY c.id`).rows;
}

export default async function handler(req,res){
  if(!allowed(req))return json(res,404,{error:'Not found'});
  try{
    await init();
    const capabilities=await bridgeCapabilities();
    if(capabilities.bridgeVersion!=='052-tuning-1'||!capabilities.migration052)throw new Error('Мост 052 не подтверждён');
    if(req.method==='GET')return json(res,200,{ok:true,capabilities,candidates:await candidates()});
    if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
    const id=Number(req.body?.candidateId||0),list=await candidates();
    if(!list.some(row=>Number(row.id)===id))throw new Error('Кандидат не входит в проверенный список миграции');
    const result=await syncDriveCandidate(id);
    const appointment=await syncInterviewAppointment(id);
    return json(res,200,{ok:true,candidateId:id,interview:result.files?.find(file=>String(file.name||'').startsWith('Интервью на продуктивность —'))||null,folder:result.folder,appointment});
  }catch(error){return json(res,409,{ok:false,error:String(error?.message||error)});}
}
