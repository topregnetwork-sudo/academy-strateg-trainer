import {sql,telegram} from '../api/_core.js';
import {initFunnel,createTask,effect} from './funnel-store.js';
import {evidenceId} from './primary-evidence.js';

export const REVIEW_DATE='2026-09-01';
const ZOOM='https://us06web.zoom.us/j/8954571284?pwd=G7yvsAdaV7ZrPUFnXDIf4tfKR3f9fX.1';
const SITE='https://academy-strateg-trainer.vercel.app';
const esc=v=>String(v??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
export function reviewAt(date,slot){
  if(date!==REVIEW_DATE||!/^(11(00|15|30|45)|12(00|15|30|45)|13(00|15|30))$/.test(slot))throw new Error('Unknown review slot');
  return new Date(`${date}T${slot.slice(0,2)}:${slot.slice(2)}:00+03:00`);
}
export async function scheduleMinskReminder(slot){
  const at=reviewAt(REVIEW_DATE,slot),due=at.getTime()-1800000;
  if(Date.now()>=at.getTime())return {expired:true};
  await createTask('minsk_review_30m',{date:REVIEW_DATE,slot},new Date(Math.max(Date.now()+1000,due)),evidenceId(`minsk-review-30:${REVIEW_DATE}:${slot}`));
  return {scheduled:true};
}
export async function reviewParticipants(slot){
  return (await sql`SELECT c.id,c.chat_id,c.username,c.first_name,c.last_name,c.city,a.full_name,a.trainer_experience_level,d.folder_url
    FROM offline_interview_bookings b JOIN candidates c ON c.id=b.candidate_id
    LEFT JOIN LATERAL(SELECT full_name,trainer_experience_level FROM applications WHERE candidate_id=c.id ORDER BY created_at DESC,id DESC LIMIT 1)a ON TRUE
    LEFT JOIN candidate_drive d ON d.candidate_id=c.id
    WHERE b.event_date=${REVIEW_DATE}::date AND b.slot_time=${slot} AND b.status='booked' AND c.consent=true
    AND c.status NOT IN ('productivity_failed','productivity_passed','rejected','cancelled','selection_closed','academy_contact','hired','finalist') ORDER BY c.id`).rows;
}
export async function runMinskReminder({date,slot}){
  const at=reviewAt(date,slot);
  if(Date.now()>=at.getTime())return {expired:true}; // Never send an outdated "30 minutes" notice.
  await initFunnel();
  const people=await reviewParticipants(slot),time=slot.slice(0,2)+':'+slot.slice(2),minutes=Math.max(1,Math.round((at-Date.now())/60000));
  if(!people.length)return {empty:true};
  const text=`⏰ Напоминаем о первичном разборе Академии Стратег в Zoom.\nДата: 1 сентября 2026 года\nВремя: ${time} МСК\nДо встречи — около ${minutes} минут. Подключитесь в своё назначенное время. Ехать в офис не нужно.`;
  const failures=[];
  for(const c of people){try{
    const id=await effect(`review-reminder:${date}:${slot}:${c.id}`,()=>telegram(c.chat_id,text,{reply_markup:{inline_keyboard:[[{text:'Подключиться к Zoom',url:ZOOM}]]}}));
    await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) SELECT ${c.id},'out','review_reminder_30m',${text},'delivered',${String(id)} WHERE NOT EXISTS(SELECT 1 FROM messages WHERE candidate_id=${c.id} AND kind='review_reminder_30m' AND telegram_message_id=${String(id)})`;
  }catch(e){failures.push(e.message);}}
  const experience={none:'нет',occasional:'отдельные занятия',under_one_year:'менее года',professional:'год или больше'};
  const lines=people.map((c,i)=>`${i+1}. <b>${esc(c.full_name||[c.first_name,c.last_name].filter(Boolean).join(' '))}</b> · ${esc(c.city)}\nОпыт: ${esc(experience[c.trainer_experience_level]||'не указан')}\n${c.folder_url?`<a href="${esc(c.folder_url)}">Папка кандидата</a>`:'Папка ещё не готова'}\n${esc(c.username?'@'+c.username:'без username')}`);
  const panel=new URL(SITE+'/operator.html');panel.searchParams.set('candidate_id',String(people[0].id));
  if(process.env.OPERATOR_ACCESS_KEY)panel.hash='access='+encodeURIComponent(process.env.OPERATOR_ACCESS_KEY);
  const brief=`📋 <b>Первичный разбор в Zoom — Минск</b>\n1 сентября 2026 года, ${time} МСК · через ${minutes} минут\nЗаписано: ${people.length}\n\n${lines.join('\n\n')}`;
  await effect(`review-brief:${date}:${slot}`,()=>telegram('-1004397133749',brief,{message_thread_id:30,reply_markup:{inline_keyboard:[[{text:'Открыть панель',url:panel.href}]]}}));
  if(failures.length)throw new Error('Не все напоминания доставлены: '+failures.join('; '));
  return {participants:people.length};
}
