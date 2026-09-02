import crypto from 'node:crypto';
import {init,json,sql} from './_core.js';
import {initFunnel} from '../lib/funnel-store.js';
import {processCampaign} from '../lib/funnel-engine.js';

const HASH='aeb9f2a2efd4f16185b121abb4f39279dbdeb9e038310f105a8274b9830335f7';
const JOB='219f65b8-a059-4b95-b73b-d85863613d29';
const TEXT=`Здравствуйте!

Вы написали, что не успели подключиться к первому собеседованию. Мы готовы дать вам ещё одну возможность продолжить отбор.

Выберите удобное время первичного Zoom-собеседования по кнопке ниже. После встречи вы получите дальнейшие инструкции по Анкете 2 и Тесту 1.`;

export default async function handler(req,res){
 if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
 const token=String(req.body?.token||''),actual=crypto.createHash('sha256').update(token).digest('hex');
 if(actual.length!==HASH.length||!crypto.timingSafeEqual(Buffer.from(actual),Buffer.from(HASH)))return json(res,404,{error:'Not found'});
 try{
  await init();await initFunnel();
  const c=(await sql`SELECT * FROM candidates WHERE LOWER(username)='mioeuforia' LIMIT 1`).rows[0];
  if(!c||Number(c.id)!==56)throw Error('Точный кандидат не найден');
  if(!c.consent||!['new','interview_booked'].includes(c.status))throw Error('Текущий этап не допускает повторное первичное приглашение');
  const config={action:'primary_invite',text:TEXT,buttons:[],sessionId:null};
  await sql`INSERT INTO funnel_jobs(id,config,state) VALUES(${JOB},${JSON.stringify(config)}::text::jsonb,'queued') ON CONFLICT DO NOTHING`;
  await sql`INSERT INTO funnel_recipients(job_id,candidate_id,original_status) VALUES(${JOB},${c.id},${c.status}) ON CONFLICT DO NOTHING`;
  await processCampaign(JOB);
  const recipient=(await sql`SELECT state,error,message_id FROM funnel_recipients WHERE job_id=${JOB} AND candidate_id=${c.id}`).rows[0];
  return json(res,recipient?.state==='sent'?200:409,{ok:recipient?.state==='sent',candidate:{id:c.id,username:c.username,status:c.status},recipient});
 }catch(error){return json(res,500,{error:String(error?.message||error)});}
}
