import {sql,telegramApi} from '../api/_core.js';
import {bookingKeyboard} from '../api/offline-interview.js';
import {notification} from './minsk-zoom-migration.js';
import {withGoalsHtml,withGoalsKeyboard} from './goals-links.js';
async function rows(){const items=(await sql`SELECT m.id,m.candidate_id,c.chat_id,m.telegram_message_id,m.text FROM messages m JOIN candidates c ON c.id=m.candidate_id WHERE m.kind='minsk_zoom_format_change' AND m.delivery_status='delivered' AND m.telegram_message_id IS NOT NULL AND c.consent=true AND c.status NOT IN ('cancelled','rejected','selection_closed','productivity_failed','test_1_incomplete_removed') AND LOWER(TRIM(c.city))='минск' ORDER BY m.id`).rows;
 const sample=(await sql`SELECT message_id FROM funnel_effects WHERE key='minsk-zoom-036:coordination' AND state='done'`).rows[0];
 if(sample)items.push({id:'sample',chat_id:'-1004397133749',telegram_message_id:sample.message_id,text:'🧪 <b>Образец уведомления кандидатам — Минск, 1 сентября</b>\nВ личном сообщении подставлены имя и выбранное время каждого участника.\n\n'+notification('Имя кандидата','1100')});return items;}
export async function editGoals(apply=false){
 const items=await rows();if(!apply)return {items:items.map(({text,...r})=>({...r,hasGoals:text.includes('/goals.html')}))};
 await sql`CREATE TABLE IF NOT EXISTS goals_edit044(chat_id TEXT,message_id TEXT,original_text TEXT NOT NULL,original_keyboard JSONB,edited_at TIMESTAMPTZ,error TEXT,PRIMARY KEY(chat_id,message_id))`;await sql`ALTER TABLE goals_edit044 ENABLE ROW LEVEL SECURITY`;
 const results=[];
 for(const r of items){const text=withGoalsHtml(r.text),keyboard=withGoalsKeyboard(bookingKeyboard());
 await sql`INSERT INTO goals_edit044(chat_id,message_id,original_text,original_keyboard) VALUES(${String(r.chat_id)},${String(r.telegram_message_id)},${r.text},${JSON.stringify(bookingKeyboard())}::text::jsonb) ON CONFLICT DO NOTHING`;
 try{let response;try{response=await telegramApi('editMessageText',{chat_id:r.chat_id,message_id:Number(r.telegram_message_id),text,parse_mode:'HTML',disable_web_page_preview:true,reply_markup:keyboard});}catch(e){if(!/message is not modified/i.test(e.message))throw e;}
 if(r.id!=='sample')await sql`UPDATE messages SET text=${text} WHERE id=${r.id}`;
 await sql`UPDATE goals_edit044 SET edited_at=NOW(),error=NULL WHERE chat_id=${String(r.chat_id)} AND message_id=${String(r.telegram_message_id)}`;
 results.push({id:r.id,candidateId:r.candidate_id,messageId:r.telegram_message_id,edited:true,buttons:response?.reply_markup?.inline_keyboard});
 }catch(e){await sql`UPDATE goals_edit044 SET error=${String(e.message)} WHERE chat_id=${String(r.chat_id)} AND message_id=${String(r.telegram_message_id)}`;results.push({id:r.id,error:String(e.message)});}}
 return {results};
}
