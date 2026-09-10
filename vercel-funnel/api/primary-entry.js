import {init,sql} from './_core.js';
import {PRIMARY_ENTRY_AFTER_MINUTES,PRIMARY_ENTRY_BEFORE_MINUTES,recordPrimaryEntry} from '../lib/primary-evidence.js';

const html=(res,status,text)=>{res.setHeader('content-type','text/html; charset=utf-8');res.setHeader('cache-control','no-store');res.setHeader('referrer-policy','no-referrer');return res.status(status).end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Вход в Zoom</title><p>${text}</p>`);};

export default async function handler(req,res){
  if(req.method!=='GET')return html(res,405,'Метод не поддерживается.');
  const code=String(req.query?.code||'');
  if(!/^[a-zA-Z0-9]{20}$/.test(code))return html(res,400,'Ссылка недействительна. Вернитесь в бот и откройте последнее сообщение о собеседовании.');
  try{
    await init();
    const candidate=(await sql`SELECT c.* FROM applications a JOIN candidates c ON c.id=a.candidate_id WHERE a.code=${code} AND c.consent=true ORDER BY a.created_at DESC,a.id DESC LIMIT 1`).rows[0];
    if(!candidate?.interview_at||!candidate?.slot_id||['cancelled','rejected','selection_closed','academy_contact','productivity_failed'].includes(candidate.status))return html(res,410,'Для этой анкеты нет действующей записи. Вернитесь в бот и выберите актуальное время.');
    const start=Date.parse(candidate.interview_at),now=Date.now();
    if(!Number.isFinite(start)||now<start-PRIMARY_ENTRY_BEFORE_MINUTES*60000)return html(res,425,'Ссылка откроется за 60 минут до назначенного времени.');
    if(now>start+PRIMARY_ENTRY_AFTER_MINUTES*60000)return html(res,410,'Время входа завершено. Вернитесь в бот и выберите новое время.');
    const zoom=(await sql`SELECT value FROM app_settings WHERE key='zoom_meeting_url' LIMIT 1`).rows[0]?.value||process.env.ZOOM_MEETING_URL;
    if(!zoom)return html(res,503,'Ссылка Zoom временно недоступна. Напишите координатору в чате с вакансией.');
    if(!await recordPrimaryEntry(candidate))return html(res,409,'Не удалось подтвердить время входа. Обновите страницу и повторите попытку.');
    res.setHeader('cache-control','no-store');res.setHeader('referrer-policy','no-referrer');res.setHeader('location',zoom);return res.status(302).end();
  }catch(error){console.error('[primary-entry] failed',{message:String(error)});return html(res,500,'Не удалось открыть Zoom. Вернитесь в бот или напишите координатору в чате с вакансией.');}
}
