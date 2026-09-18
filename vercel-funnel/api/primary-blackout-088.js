import crypto from 'node:crypto';
import {init,json,sql,slots,telegram} from './_core.js';
import {candidateBlackoutMessage,primaryBlackoutPreview,renderPrimaryBlackoutPreview} from '../lib/primary-blackout-088.js';
import {initFunnel} from '../lib/funnel-store.js';

const CHANGE_ID='AS-TRAINER-PRIMARY-BLACKOUT-20260918-19-001';
const TOKEN_HASH='b57ece243725b7d481bf2fd4ede3b70825ba5ac0247264da087efb6c3fbe9b2c';
const hash=value=>crypto.createHash('sha256').update(String(value||'')).digest('hex');
const authorized=req=>hash(String(req.headers.authorization||'').replace(/^Bearer\s+/i,''))===TOKEN_HASH;
const keyboard={reply_markup:{inline_keyboard:Object.entries(slots).map(([id,label])=>[{text:label,callback_data:`trainer_rebook_${id}`}])}};

async function ensureStore(){
  await sql`CREATE TABLE IF NOT EXISTS primary_blackout_history088(
    change_id TEXT NOT NULL,candidate_id BIGINT NOT NULL,old_status TEXT NOT NULL,
    old_slot_id TEXT,old_interview_at TIMESTAMPTZ NOT NULL,old_reminded_30m BOOLEAN,
    old_no_show_followup_sent BOOLEAN,message_text TEXT,message_id TEXT,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(change_id,candidate_id))`;
}

async function apply(){
  await ensureStore();
  const preview=await primaryBlackoutPreview(sql);
  const results=[];
  for(const candidate of preview.candidates){
    const text=candidateBlackoutMessage(candidate);
    const inserted=(await sql`INSERT INTO primary_blackout_history088(
      change_id,candidate_id,old_status,old_slot_id,old_interview_at,old_reminded_30m,
      old_no_show_followup_sent,message_text
    ) VALUES(${CHANGE_ID},${candidate.id},${candidate.status},${candidate.slot_id},
      ${candidate.interview_at},${candidate.reminded_30m},${candidate.no_show_followup_sent},${text})
    ON CONFLICT DO NOTHING RETURNING candidate_id`).rows[0];
    if(!inserted){results.push({candidateId:candidate.id,state:'already_applied'});continue;}
    await sql`UPDATE funnel_tasks SET state='done',error=${'stopped by '+CHANGE_ID},updated_at=NOW()
      WHERE kind='primary_session' AND state<>'done'
      AND (payload->>'at')::timestamptz=${candidate.interview_at}::timestamptz
      AND payload->>'slot'=${candidate.slot_id}`;
    await sql`UPDATE candidates SET reminded_30m=true,no_show_followup_sent=true,updated_at=NOW()
      WHERE id=${candidate.id} AND interview_at=${candidate.interview_at}::timestamptz AND slot_id=${candidate.slot_id}`;
    const messageId=await telegram(candidate.chat_id,text,keyboard);
    await sql`UPDATE primary_blackout_history088 SET message_id=${String(messageId||'')} WHERE change_id=${CHANGE_ID} AND candidate_id=${candidate.id}`;
    await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id)
      VALUES(${candidate.id},'out','primary_blackout_rebook',${text},'delivered',${String(messageId||'')})`;
    results.push({candidateId:candidate.id,state:'delivered',messageId:String(messageId||'')});
  }
  return {changeId:CHANGE_ID,readAt:preview.readAt,candidates:preview.candidates.map(c=>({id:c.id,first_name:c.first_name,last_name:c.last_name,username:c.username,slot_id:c.slot_id,interview_at:c.interview_at,status:c.status,text:candidateBlackoutMessage(c)})),tasks:preview.tasks,results};
}

export default async function handler(req,res){
  if(!authorized(req))return json(res,401,{ok:false});
  if(!['GET','POST'].includes(req.method))return json(res,405,{ok:false});
  await init();await initFunnel();
  if(req.method==='GET'){const data=await primaryBlackoutPreview(sql);return json(res,200,{ok:true,data,text:renderPrimaryBlackoutPreview(data)});}
  return json(res,200,{ok:true,...await apply()});
}
