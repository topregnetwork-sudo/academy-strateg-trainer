import {sql,telegram,telegramApi} from '../api/_core.js';
import {initFunnel,effect} from './funnel-store.js';
import {bookingKeyboard,confirmationText,invitationText,inviteKeyboard} from '../api/offline-interview.js';
const date='2026-09-01',group='-1004397133749';
const esc=v=>String(v??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
export function notification(name,slot){return `${esc(name)}, здравствуйте!\n\nВаша встреча с Академией Стратег 1 сентября пройдёт онлайн в Zoom вместо встречи в офисе. Приезжать по адресу Площадь Свободы, 8 не нужно.\n\nМы изменили формат, чтобы вам было удобнее принять участие и не пришлось тратить время на дорогу.\n\nВаше выбранное время сохраняется:\n📅 1 сентября\n🕒 ${esc(slot.slice(0,2)+':'+slot.slice(2))} — по Минску\n\nПовторно записываться не нужно. Подключитесь к Zoom в назначенное вам время по кнопке ниже.\n\nДо встречи ознакомьтесь и изучите Цели Академии Стратег, если ещё не успели этого сделать.\n\nДо встречи!`;}
async function roster(){return (await sql`SELECT b.candidate_id,b.slot_time,c.chat_id,c.city,c.status,COALESCE(NULLIF(a.full_name,''),NULLIF(c.first_name,''),c.username,'Кандидат') AS name FROM offline_interview_bookings b JOIN candidates c ON c.id=b.candidate_id LEFT JOIN LATERAL(SELECT full_name FROM applications WHERE candidate_id=c.id ORDER BY created_at DESC LIMIT 1) a ON TRUE WHERE b.event_date=${date}::date AND b.status='booked' AND LOWER(TRIM(c.city))='минск' ORDER BY b.slot_time`).rows;}
export async function migrateMinskZoom(v){
 const all=await roster(),excluded=all.filter(c=>['rejected','cancelled','productivity_failed','selection_closed','academy_contact'].includes(c.status)),people=all.filter(c=>!excluded.includes(c));
 if(v.mode==='preview')return {people,excluded};
 await initFunnel();
 if(v.mode==='notify'){
   const c=people.find(c=>Number(c.candidate_id)===Number(v.candidateId));if(!c)throw Error('Not an eligible Minsk September1 booking');
   const text=notification(c.name,c.slot_time);
   const messageId=await effect(`minsk-zoom-036:${c.candidate_id}`,()=>telegram(c.chat_id,text,{reply_markup:bookingKeyboard()}));
   await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) SELECT ${c.candidate_id},'out','minsk_zoom_format_change',${text},'delivered',${String(messageId)} WHERE NOT EXISTS(SELECT 1 FROM messages WHERE candidate_id=${c.candidate_id} AND telegram_message_id=${String(messageId)} AND direction='out')`;
   return {candidateId:c.candidate_id,messageId,slot:c.slot_time};
 }
 if(v.mode==='coordination'){
   const sample='🧪 <b>Образец уведомления кандидатам — Минск, 1 сентября</b>\nВ личном сообщении подставлены имя и выбранное время каждого участника.\n\n'+notification('Имя кандидата','1100');
   const messageId=await effect('minsk-zoom-036:coordination',()=>telegram(group,sample,{message_thread_id:30,reply_markup:bookingKeyboard()}));
   return {messageId};
 }
 if(v.mode==='edit'){
   // Only messages of the specified September1 campaign; August messages untouched.
   const rows=(await sql`SELECT DISTINCT m.candidate_id,c.chat_id,m.telegram_message_id,m.kind FROM messages m JOIN candidates c ON c.id=m.candidate_id WHERE LOWER(TRIM(c.city))='минск' AND m.direction='out' AND m.delivery_status='delivered' AND m.kind IN ('offline_interview_invite','offline_interview_confirmation','offline_interview_rescheduled') AND m.text LIKE '%1 сентября 2026%' AND m.telegram_message_id IS NOT NULL ORDER BY m.candidate_id`).rows;
   const results=[];
   for(const r of rows.filter(r=>Number(r.candidate_id)===Number(v.candidateId))){
     const c=all.find(c=>String(c.candidate_id)===String(r.candidate_id)),booked=Boolean(c);
     const text=booked?confirmationText(c.slot_time):invitationText(),keyboard=booked?bookingKeyboard():await inviteKeyboard();
     try{await telegramApi('editMessageText',{chat_id:r.chat_id,message_id:Number(r.telegram_message_id),text,parse_mode:'HTML',disable_web_page_preview:true,reply_markup:keyboard});}
     catch(e){if(!String(e.message).includes('message is not modified')){results.push({messageId:r.telegram_message_id,error:e.message});continue;}}
     await sql`UPDATE messages SET text=${text} WHERE candidate_id=${r.candidate_id} AND telegram_message_id=${r.telegram_message_id} AND direction='out'`;
     results.push({messageId:r.telegram_message_id,edited:true});
   }
   return {results};
 }
 if(v.mode==='edit-list')return {ids:(await sql`SELECT DISTINCT m.candidate_id FROM messages m JOIN candidates c ON c.id=m.candidate_id WHERE LOWER(TRIM(c.city))='минск' AND m.direction='out' AND m.kind IN ('offline_interview_invite','offline_interview_confirmation','offline_interview_rescheduled') AND m.text LIKE '%1 сентября 2026%'`).rows};
 if(v.mode==='report')return {deliveries:(await sql`SELECT candidate_id,telegram_message_id,created_at FROM messages WHERE kind='minsk_zoom_format_change' ORDER BY candidate_id`).rows,people,excluded};
 throw Error('Unknown operation');
}
