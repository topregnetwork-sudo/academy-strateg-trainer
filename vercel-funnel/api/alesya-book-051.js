import crypto from 'node:crypto';
import {init,json,sql,telegram,transaction} from './_core.js';
import {effect,initFunnel} from '../lib/funnel-store.js';
import {bookingFollowup} from '../lib/funnel-engine.js';
import {bookingKeyboard,confirmationText,slotSummary} from './offline-interview.js';
import {scheduleMinskReminder} from '../lib/review-reminders.js';
import {queueInterviewAppointment} from '../lib/interview-appointment.js';

const KEY_HASH='8c6e1f84a09e07c3e421320ca017ff6f43bae6076e7cd765b3c2219046255f5c';
const allowed=req=>crypto.createHash('sha256').update(String(req.headers['x-maintenance-key']||'')).digest('hex')===KEY_HASH;

async function target(){
  const candidate=(await sql`SELECT id,chat_id,username,city,status,consent FROM candidates WHERE lower(username)='slkpwr' LIMIT 1`).rows[0];
  const slots=(await sql`SELECT s.id,s.session_id,s.starts_at,s.capacity,f.active,f.config,count(b.id)::int AS used
    FROM funnel_slots s JOIN funnel_sessions f ON f.id=s.session_id LEFT JOIN funnel_bookings b ON b.slot_id=s.id
    WHERE f.config->>'city'='Минск' AND (s.starts_at AT TIME ZONE 'Europe/Moscow')::date='2026-09-01'::date
      AND to_char(s.starts_at AT TIME ZONE 'Europe/Moscow','HH24:MI')='13:15'
    GROUP BY s.id,f.id ORDER BY s.starts_at`).rows;
  const existing=candidate?(await sql`SELECT b.*,s.starts_at FROM funnel_bookings b JOIN funnel_slots s ON s.id=b.slot_id WHERE b.candidate_id=${candidate.id} ORDER BY s.starts_at DESC`).rows:[];
  const today=(await sql`SELECT s.id,s.session_id,s.starts_at,s.capacity,f.active,f.config,count(b.id)::int AS used
    FROM funnel_slots s JOIN funnel_sessions f ON f.id=s.session_id LEFT JOIN funnel_bookings b ON b.slot_id=s.id
    WHERE (s.starts_at AT TIME ZONE 'Europe/Moscow')::date='2026-09-01'::date
    GROUP BY s.id,f.id ORDER BY s.starts_at`).rows;
  const legacy=candidate?(await sql`SELECT * FROM offline_interview_bookings WHERE candidate_id=${candidate.id} ORDER BY event_date DESC`).rows:[];
  const legacy1315=(await sql`SELECT b.*,c.username,c.first_name,c.last_name FROM offline_interview_bookings b JOIN candidates c ON c.id=b.candidate_id WHERE b.event_date='2026-09-01'::date AND b.slot_time='1315' AND b.status='booked'`).rows;
  return {candidate,slots,today,existing,legacy,legacy1315};
}

export default async function handler(req,res){
  if(!allowed(req))return json(res,404,{error:'Not found'});
  try{
    await init();await initFunnel();
    if(req.method==='GET')return json(res,200,await target());
    if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
    const before=await target(),candidate=before.candidate,slot=before.slots[0];
    if(!candidate)throw Error('Алеся @slkpwr не найдена');
    if(before.slots.length===0){
      if(before.legacy1315.some(row=>Number(row.candidate_id)!==Number(candidate.id)))throw Error('Слот 13:15 уже занят другим кандидатом');
      const booking=await transaction(async tx=>{
        const occupied=(await tx`SELECT candidate_id FROM offline_interview_bookings WHERE event_date='2026-09-01'::date AND slot_time='1315' AND slot_position=1 AND status='booked' FOR UPDATE`).rows[0];
        if(occupied&&Number(occupied.candidate_id)!==Number(candidate.id))throw Error('Слот 13:15 уже занят другим кандидатом');
        const row=(await tx`INSERT INTO offline_interview_bookings(candidate_id,event_date,slot_time,slot_position,status) VALUES(${candidate.id},'2026-09-01','1315',1,'booked')
          ON CONFLICT(candidate_id,event_date) DO UPDATE SET slot_time='1315',slot_position=1,status='booked',updated_at=NOW() RETURNING *`).rows[0];
        await tx`UPDATE candidates SET status='productivity_booked',consent=true,updated_at=NOW() WHERE id=${candidate.id}`;
        return row;
      });
      const text=confirmationText('1315');
      const messageId=await effect(`alesya-book-051:confirmation:${candidate.id}`,()=>telegram(String(candidate.chat_id),text,{disable_web_page_preview:true,reply_markup:bookingKeyboard()}));
      await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id)
        SELECT ${candidate.id},'out','offline_interview_confirmation',${text},'delivered',${String(messageId)}
        WHERE NOT EXISTS(SELECT 1 FROM messages WHERE candidate_id=${candidate.id} AND telegram_message_id=${String(messageId)} AND direction='out')`;
      await scheduleMinskReminder('1315');
      await queueInterviewAppointment(candidate.id);
      const summary=await slotSummary({ensureDrive:true});
      await effect(`alesya-book-051:staff:${candidate.id}`,()=>telegram('-1004397133749',`✅ Алеся @slkpwr вручную записана на первичный разбор\n1 сентября 2026 года, 13:15 МСК\nСтатус восстановлен: «Записан на продуктивность».\n\n${summary.text}`,{message_thread_id:30,disable_web_page_preview:true}));
      return json(res,200,{ok:true,mode:'legacy_minsk',booking,after:await target()});
    }
    if(before.slots.length!==1)throw Error(`Ожидался один слот 13:15, найдено: ${before.slots.length}`);
    if(!slot.active)throw Error('Сессия закрыта');
    const result=await transaction(async tx=>{
      await tx`SELECT id FROM funnel_sessions WHERE id=${slot.session_id} FOR UPDATE`;
      const locked=(await tx`SELECT * FROM funnel_slots WHERE id=${slot.id} FOR UPDATE`).rows[0];
      const old=(await tx`SELECT * FROM funnel_bookings WHERE session_id=${slot.session_id} AND candidate_id=${candidate.id}`).rows[0];
      const used=(await tx`SELECT count(*)::int AS n FROM funnel_bookings WHERE slot_id=${slot.id} AND candidate_id<>${candidate.id}`).rows[0].n;
      if(used>=locked.capacity)throw Error('Слот 13:15 уже занят');
      const booking=(await tx`INSERT INTO funnel_bookings(session_id,candidate_id,slot_id) VALUES(${slot.session_id},${candidate.id},${slot.id})
        ON CONFLICT(session_id,candidate_id) DO UPDATE SET slot_id=EXCLUDED.slot_id,version=CASE WHEN funnel_bookings.slot_id=EXCLUDED.slot_id THEN funnel_bookings.version ELSE funnel_bookings.version+1 END,updated_at=NOW() RETURNING *`).rows[0];
      await tx`UPDATE candidates SET status='productivity_booked',consent=true,updated_at=NOW() WHERE id=${candidate.id}`;
      return {booking,unchanged:Number(old?.slot_id)===Number(slot.id)};
    });
    await bookingFollowup(result.booking.id,result.booking.version);
    return json(res,200,{ok:true,before,result,after:await target()});
  }catch(error){console.error('[alesya-book-051]',error);return json(res,409,{error:String(error?.message||error)});}
}
