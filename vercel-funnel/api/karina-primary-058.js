import crypto from 'node:crypto';
import {init,json,sql,transaction,telegram,slots} from './_core.js';
import {initFunnel,effect} from '../lib/funnel-store.js';
const HASH='0dd841f114bea1ea25a5a284d4971ab114a3e5c296a546012b9857a3adbdf1f0';
const TEXT=`Карина, здравствуйте!

Отправляем вам повторную запись именно на первое Zoom-собеседование Академии Стратег.

Выберите новое удобное время по кнопке ниже. После выбора прежняя запись будет заменена, а вам придёт подтверждение с датой, временем и кнопкой подключения к Zoom.`;
export default async function handler(req,res){
 if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
 const actual=crypto.createHash('sha256').update(String(req.body?.token||'')).digest('hex');
 if(actual.length!==HASH.length||!crypto.timingSafeEqual(Buffer.from(actual),Buffer.from(HASH)))return json(res,404,{error:'Not found'});
 try{
  await init();await initFunnel();
  const c=(await sql`SELECT c.*,EXISTS(SELECT 1 FROM candidate_questionnaire_two q WHERE q.candidate_id=c.id AND q.submitted_at IS NOT NULL) q2_done,EXISTS(SELECT 1 FROM candidate_tests t WHERE t.candidate_id=c.id AND t.submitted_at IS NOT NULL) test_done FROM candidates c WHERE c.id=56 AND LOWER(c.username)='mioeuforia' LIMIT 1`).rows[0];
  if(!c||!c.consent||c.status!=='interview_booked'||!c.interview_at||c.q2_done||c.test_done)throw Error('Карина не находится на ожидаемом этапе первичного собеседования');
  const keyboard={inline_keyboard:Object.entries(slots).map(([id,title])=>[{text:title,callback_data:`trainer_rebook_${id}`}])};
  const messageId=await effect('karina-primary-058:candidate56',()=>telegram(c.chat_id,TEXT,{reply_markup:keyboard}));
  await transaction(async tx=>{
   await tx`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) SELECT 56,'out','no_show_followup',${TEXT},'delivered',${String(messageId)} WHERE NOT EXISTS(SELECT 1 FROM messages WHERE candidate_id=56 AND telegram_message_id=${String(messageId)} AND direction='out')`;
   await tx`UPDATE candidates SET no_show_followup_sent=true,updated_at=NOW() WHERE id=56 AND status='interview_booked'`;
  });
  return json(res,200,{ok:true,candidate:{id:c.id,username:c.username,status:c.status,oldInterviewAt:c.interview_at,slotId:c.slot_id,q2Done:c.q2_done,testDone:c.test_done},messageId,buttons:Object.values(slots)});
 }catch(error){return json(res,409,{error:String(error?.message||error)});}
}
