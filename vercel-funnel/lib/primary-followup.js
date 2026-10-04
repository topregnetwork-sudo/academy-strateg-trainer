import {sql,transaction,telegram,slots} from '../api/_core.js';
import {initPrimaryEvidence,PRIMARY_ENTRY_BEFORE_MINUTES,PRIMARY_ENTRY_AFTER_MINUTES} from './primary-evidence.js';
import {initFunnel,effect} from './funnel-store.js';
import {PRIMARY_NO_ENTRY_AFTER_MINUTES} from './primary-timing.js';

export const followupText='Здравствуйте! Вы были записаны на собеседование с Академией Стратег. Если сегодня не получилось подключиться, выберите новое удобное время ниже.\n\nЕсли вакансия для вас больше не актуальна, напишите в ответ: <b>не актуально</b>.';
export const noResponseText='Мы не получили ответа после пропущенного первого собеседования, поэтому завершаем текущий маршрут отбора.\n\nСпасибо за интерес к Академии Стратег. Если позже захотите вернуться к разговору, напишите нам в этот бот.';
const keyboard={inline_keyboard:Object.entries(slots).map(([id,title])=>[{text:title,callback_data:`trainer_rebook_${id}`}])};
const botBlocked=error=>/bot was blocked by the user/i.test(String(error?.message||error||''));

async function claimPrimaryNoEntry({id,at,slot}){
  return transaction(async tx=>{
    // The candidate row is the single appointment boundary lock shared with
    // handlePrimaryEntry. Acquire it in a statement of its own: under PostgreSQL
    // READ COMMITTED a subquery evaluated before a lock wait could otherwise keep
    // a stale snapshot. The second statement therefore rechecks evidence only
    // after this transaction owns the exact appointment row.
    const c=(await tx`SELECT c.id,c.chat_id FROM candidates c WHERE c.id=${id} AND c.status='interview_booked' AND c.consent=true AND c.no_show_followup_sent=false
      AND c.interview_at=${at}::timestamptz AND c.slot_id=${slot}
      AND c.interview_at<=NOW()-(${PRIMARY_NO_ENTRY_AFTER_MINUTES} * INTERVAL '1 minute') AND c.interview_at>=NOW()-INTERVAL '6 hours'
      FOR UPDATE OF c`).rows[0];
    if(!c)return null;
    const eligible=(await tx`SELECT 1 AS eligible WHERE
      NOT EXISTS(SELECT 1 FROM candidate_zoom_entries e JOIN candidates c ON c.id=e.candidate_id WHERE c.id=${id} AND c.interview_at=${at}::timestamptz AND c.slot_id=${slot} AND e.interview_at=c.interview_at AND e.slot_id=c.slot_id AND e.clicked_at BETWEEN e.interview_at-(${PRIMARY_ENTRY_BEFORE_MINUTES} * INTERVAL '1 minute') AND e.interview_at+(${PRIMARY_ENTRY_AFTER_MINUTES} * INTERVAL '1 minute'))
      AND NOT EXISTS(SELECT 1 FROM candidate_zoom_session_entries e JOIN candidates c ON c.id=e.candidate_id WHERE c.id=${id} AND c.interview_at=${at}::timestamptz AND c.slot_id=${slot} AND e.interview_at=c.interview_at AND e.slot_id=c.slot_id AND e.clicked_at BETWEEN e.interview_at-(${PRIMARY_ENTRY_BEFORE_MINUTES} * INTERVAL '1 minute') AND e.interview_at+(${PRIMARY_ENTRY_AFTER_MINUTES} * INTERVAL '1 minute'))
      AND NOT EXISTS(SELECT 1 FROM messages m JOIN candidates c ON c.id=m.candidate_id WHERE c.id=${id} AND c.interview_at=${at}::timestamptz AND c.slot_id=${slot} AND m.kind='primary_zoom_link' AND m.created_at BETWEEN c.interview_at-(${PRIMARY_ENTRY_BEFORE_MINUTES} * INTERVAL '1 minute') AND c.interview_at+(${PRIMARY_ENTRY_AFTER_MINUTES} * INTERVAL '1 minute'))`).rows[0];
    if(!eligible)return null;
    return (await tx`UPDATE candidates SET no_show_followup_sent=true,updated_at=NOW() WHERE id=${id} AND interview_at=${at}::timestamptz AND slot_id=${slot} AND no_show_followup_sent=false RETURNING id,chat_id`).rows[0]||null;
  });
}

async function releaseDefiniteNoEntryFailure({id,at,slot}){
  await transaction(async tx=>{
    await tx`SELECT id FROM candidates WHERE id=${id} FOR UPDATE`;
    await tx`UPDATE candidates SET no_show_followup_sent=false,updated_at=NOW() WHERE id=${id} AND interview_at=${at}::timestamptz AND slot_id=${slot} AND no_show_followup_sent=true
      AND NOT EXISTS(SELECT 1 FROM messages WHERE candidate_id=${id} AND kind='no_show_followup' AND delivery_status='delivered')`;
  });
}

async function closePrimaryNoResponse(candidate, reason='primary_no_response_082') {
  const changed=(await sql`UPDATE candidates SET status='reserve_no_response',consent=FALSE,updated_at=NOW() WHERE id=${candidate.id} AND status='interview_booked' RETURNING id`).rows[0];
  if(!changed)return false;
  await sql`INSERT INTO funnel_stage_events(candidate_id,project_id,from_status,to_status,trigger,actor)
    SELECT ${candidate.id},id,'interview_booked','reserve_no_response',${reason},'system'
    FROM funnel_projects WHERE project_key='academy-trainer'`;
  return true;
}

// PRIMARY.NO_ENTRY_FOLLOWUP: exact appointment only. Never infer absence from a keyword.
export async function runPrimaryFollowup({at,slot}){
  if(!at||!slots[slot]||!Number.isFinite(Date.parse(at)))return {due:0,sent:0,failed:0};
  await initPrimaryEvidence();await initFunnel();
  const due=(await sql`SELECT c.id FROM candidates c WHERE c.status='interview_booked' AND c.consent=true AND c.no_show_followup_sent=false
    AND c.interview_at=${at}::timestamptz AND c.slot_id=${slot}
    AND c.interview_at<=NOW()-(${PRIMARY_NO_ENTRY_AFTER_MINUTES} * INTERVAL '1 minute') AND c.interview_at>=NOW()-INTERVAL '6 hours'
    AND NOT EXISTS(SELECT 1 FROM candidate_zoom_entries e WHERE e.candidate_id=c.id AND e.interview_at=c.interview_at AND e.slot_id=c.slot_id AND e.clicked_at BETWEEN e.interview_at-(${PRIMARY_ENTRY_BEFORE_MINUTES} * INTERVAL '1 minute') AND e.interview_at+(${PRIMARY_ENTRY_AFTER_MINUTES} * INTERVAL '1 minute'))
    AND NOT EXISTS(SELECT 1 FROM candidate_zoom_session_entries e WHERE e.candidate_id=c.id AND e.interview_at=c.interview_at AND e.slot_id=c.slot_id AND e.clicked_at BETWEEN e.interview_at-(${PRIMARY_ENTRY_BEFORE_MINUTES} * INTERVAL '1 minute') AND e.interview_at+(${PRIMARY_ENTRY_AFTER_MINUTES} * INTERVAL '1 minute'))
    AND NOT EXISTS(SELECT 1 FROM messages m WHERE m.candidate_id=c.id AND m.kind='primary_zoom_link' AND m.created_at BETWEEN c.interview_at-(${PRIMARY_ENTRY_BEFORE_MINUTES} * INTERVAL '1 minute') AND c.interview_at+(${PRIMARY_ENTRY_AFTER_MINUTES} * INTERVAL '1 minute'))
    ORDER BY c.id`).rows;
  let sent=0,failed=0;
  for(const {id} of due){
    try{
      const c=await claimPrimaryNoEntry({id,at,slot});
      if(!c)continue;
      const messageId=await effect(`primary-no-entry:${id}:${new Date(at).toISOString()}:${slot}`,()=>telegram(c.chat_id,followupText,{reply_markup:keyboard}));
      await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) SELECT ${id},'out','no_show_followup',${followupText},'delivered',${String(messageId)} WHERE NOT EXISTS(SELECT 1 FROM messages WHERE candidate_id=${id} AND kind='no_show_followup' AND telegram_message_id=${String(messageId)})`;
      sent++;
    }catch(e){
      if(e?.definite)await releaseDefiniteNoEntryFailure({id,at,slot});
      failed++;console.error('[primary-no-entry]',id,e.message);
    }
  }
  return {due:due.length,sent,failed};
}

export async function reconcilePrimaryNoEntry082(apply=false){
  await initPrimaryEvidence();await initFunnel();
  const due=(await sql`SELECT c.id,c.chat_id,c.interview_at,c.slot_id FROM candidates c
    WHERE c.status='interview_booked' AND c.consent=true AND c.no_show_followup_sent=false
      AND c.interview_at<=NOW()-(${PRIMARY_NO_ENTRY_AFTER_MINUTES} * INTERVAL '1 minute')
      AND NOT EXISTS(SELECT 1 FROM candidate_zoom_entries e WHERE e.candidate_id=c.id AND e.interview_at=c.interview_at AND e.slot_id=c.slot_id AND e.clicked_at BETWEEN e.interview_at-(${PRIMARY_ENTRY_BEFORE_MINUTES} * INTERVAL '1 minute') AND e.interview_at+(${PRIMARY_ENTRY_AFTER_MINUTES} * INTERVAL '1 minute'))
      AND NOT EXISTS(SELECT 1 FROM candidate_zoom_session_entries e WHERE e.candidate_id=c.id AND e.interview_at=c.interview_at AND e.slot_id=c.slot_id AND e.clicked_at BETWEEN e.interview_at-(${PRIMARY_ENTRY_BEFORE_MINUTES} * INTERVAL '1 minute') AND e.interview_at+(${PRIMARY_ENTRY_AFTER_MINUTES} * INTERVAL '1 minute'))
      AND NOT EXISTS(SELECT 1 FROM messages m WHERE m.candidate_id=c.id AND m.kind='primary_zoom_link' AND m.created_at BETWEEN c.interview_at-(${PRIMARY_ENTRY_BEFORE_MINUTES} * INTERVAL '1 minute') AND c.interview_at+(${PRIMARY_ENTRY_AFTER_MINUTES} * INTERVAL '1 minute'))
    ORDER BY c.id`).rows;
  const closable=(await sql`
    SELECT c.id,c.chat_id,n.created_at AS followup_at
    FROM candidates c
    JOIN LATERAL (
      SELECT created_at FROM messages
      WHERE candidate_id=c.id AND kind='no_show_followup'
      ORDER BY created_at DESC LIMIT 1
    ) n ON TRUE
    WHERE c.status='interview_booked' AND c.consent=true AND c.no_show_followup_sent=true
      AND n.created_at<=NOW()-INTERVAL '3 days'
      AND NOT EXISTS(SELECT 1 FROM messages m WHERE m.candidate_id=c.id AND m.direction='in' AND m.kind<>'link_open' AND m.created_at>n.created_at)
      AND NOT EXISTS(SELECT 1 FROM candidate_zoom_entries e WHERE e.candidate_id=c.id AND e.interview_at=c.interview_at AND e.slot_id=c.slot_id AND e.clicked_at BETWEEN e.interview_at-(${PRIMARY_ENTRY_BEFORE_MINUTES} * INTERVAL '1 minute') AND e.interview_at+(${PRIMARY_ENTRY_AFTER_MINUTES} * INTERVAL '1 minute'))
      AND NOT EXISTS(SELECT 1 FROM candidate_zoom_session_entries e WHERE e.candidate_id=c.id AND e.interview_at=c.interview_at AND e.slot_id=c.slot_id AND e.clicked_at BETWEEN e.interview_at-(${PRIMARY_ENTRY_BEFORE_MINUTES} * INTERVAL '1 minute') AND e.interview_at+(${PRIMARY_ENTRY_AFTER_MINUTES} * INTERVAL '1 minute'))
    ORDER BY c.id`).rows;
  const result={due:due.length,sent:0,closed:0,blockedClosed:0,attention:0,failed:0,closable:closable.length};
  if(!apply)return result;
  for(const c of due){
    try{
      const claimed=await claimPrimaryNoEntry({id:c.id,at:c.interview_at,slot:c.slot_id});
      if(!claimed)continue;
      const messageId=await effect(`primary-no-entry-082:${c.id}`,()=>telegram(claimed.chat_id,followupText,{reply_markup:keyboard}));
      await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id)
        SELECT ${c.id},'out','no_show_followup',${followupText},'delivered',${String(messageId||'')}
        WHERE NOT EXISTS(SELECT 1 FROM messages WHERE candidate_id=${c.id} AND kind='no_show_followup' AND telegram_message_id=${String(messageId||'')})`;
      result.sent++;
    }catch(error){
      if(error?.definite)await releaseDefiniteNoEntryFailure({id:c.id,at:c.interview_at,slot:c.slot_id});
      if(botBlocked(error)){
        if(await closePrimaryNoResponse(c,'primary_bot_blocked_082'))result.blockedClosed++;
      }else{
        await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id)
          VALUES(${c.id},'out','no_show_followup',${followupText},'failed',NULL)`;
        result.failed++;
      }
    }
  }
  for(const c of closable){
    const human=(await sql`SELECT 1 FROM messages WHERE candidate_id=${c.id} AND direction='in' AND kind<>'link_open' AND created_at>${c.followup_at} LIMIT 1`).rows[0];
    if(human){result.attention++;continue;}
    try{
      const messageId=await effect(`primary-no-entry-close-082:${c.id}`,()=>telegram(c.chat_id,noResponseText));
      await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id)
        SELECT ${c.id},'out','primary_no_response_closed_082',${noResponseText},'delivered',${String(messageId||'')}
        WHERE NOT EXISTS(SELECT 1 FROM messages WHERE candidate_id=${c.id} AND kind='primary_no_response_closed_082')`;
      if(await closePrimaryNoResponse(c))result.closed++;
    }catch(error){
      if(botBlocked(error)){
        if(await closePrimaryNoResponse(c,'primary_bot_blocked_082'))result.blockedClosed++;
      }else result.failed++;
    }
  }
  return result;
}
