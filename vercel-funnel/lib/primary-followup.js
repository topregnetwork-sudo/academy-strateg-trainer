import {sql,transaction,telegram,slots} from '../api/_core.js';
import {initPrimaryEvidence} from './primary-evidence.js';
import {initFunnel,effect} from './funnel-store.js';

export const followupText='Здравствуйте! Вы были записаны на собеседование с Академией Стратег. Если сегодня не получилось подключиться, выберите новое удобное время ниже.\n\nЕсли вакансия для вас больше не актуальна, напишите в ответ: <b>не актуально</b>.';
const keyboard={inline_keyboard:Object.entries(slots).map(([id,title])=>[{text:title,callback_data:`trainer_rebook_${id}`}])};

// PRIMARY.NO_ENTRY_FOLLOWUP: exact appointment only. Never infer absence from a keyword.
export async function runPrimaryFollowup({at,slot}){
  if(!at||!slots[slot]||!Number.isFinite(Date.parse(at)))return {due:0,sent:0,failed:0};
  await initPrimaryEvidence();await initFunnel();
  const due=(await sql`SELECT c.id FROM candidates c WHERE c.status='interview_booked' AND c.consent=true AND c.no_show_followup_sent=false
    AND c.interview_at=${at}::timestamptz AND c.slot_id=${slot}
    AND c.interview_at<=NOW()-INTERVAL '60 minutes' AND c.interview_at>=NOW()-INTERVAL '6 hours'
    AND NOT EXISTS(SELECT 1 FROM candidate_zoom_entries e WHERE e.candidate_id=c.id AND e.interview_at=c.interview_at AND e.slot_id=c.slot_id AND e.clicked_at BETWEEN e.interview_at-INTERVAL '15 minutes' AND e.interview_at+INTERVAL '60 minutes')
    AND NOT EXISTS(SELECT 1 FROM candidate_zoom_session_entries e WHERE e.candidate_id=c.id AND e.interview_at=c.interview_at AND e.slot_id=c.slot_id AND e.clicked_at BETWEEN e.interview_at-INTERVAL '15 minutes' AND e.interview_at+INTERVAL '60 minutes')
    ORDER BY c.id`).rows;
  let sent=0,failed=0;
  for(const {id} of due){
    try{
      // Recheck immediately before send: another event may have moved the booking or recorded a click.
      const c=(await sql`SELECT c.id,c.chat_id FROM candidates c WHERE c.id=${id} AND c.status='interview_booked' AND c.consent=true AND c.no_show_followup_sent=false
        AND c.interview_at=${at}::timestamptz AND c.slot_id=${slot}
        AND NOT EXISTS(SELECT 1 FROM candidate_zoom_entries e WHERE e.candidate_id=c.id AND e.interview_at=c.interview_at AND e.slot_id=c.slot_id AND e.clicked_at BETWEEN e.interview_at-INTERVAL '15 minutes' AND e.interview_at+INTERVAL '60 minutes')
        AND NOT EXISTS(SELECT 1 FROM candidate_zoom_session_entries e WHERE e.candidate_id=c.id AND e.interview_at=c.interview_at AND e.slot_id=c.slot_id AND e.clicked_at BETWEEN e.interview_at-INTERVAL '15 minutes' AND e.interview_at+INTERVAL '60 minutes')`).rows[0];
      if(!c)continue;
      const messageId=await effect(`primary-no-entry:${id}:${new Date(at).toISOString()}:${slot}`,()=>telegram(c.chat_id,followupText,{reply_markup:keyboard}));
      // A failed history write rolls back the flag; effect retains the actual delivery for a safe retry.
      await transaction(async tx=>{
        await tx`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) SELECT ${id},'out','no_show_followup',${followupText},'delivered',${String(messageId)} WHERE NOT EXISTS(SELECT 1 FROM messages WHERE candidate_id=${id} AND kind='no_show_followup' AND telegram_message_id=${String(messageId)})`;
        await tx`UPDATE candidates SET no_show_followup_sent=true,updated_at=NOW() WHERE id=${id} AND interview_at=${at}::timestamptz AND slot_id=${slot}`;
      });
      sent++;
    }catch(e){failed++;console.error('[primary-no-entry]',id,e.message);}
  }
  return {due:due.length,sent,failed};
}
