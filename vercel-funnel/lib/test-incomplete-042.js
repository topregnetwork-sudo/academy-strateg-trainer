import {sql,transaction,telegram,telegramApi} from '../api/_core.js';
import {initFunnel,effect} from './funnel-store.js';
export const TEXT='Здравствуйте!\n\nСпасибо за интерес к работе в Академии Стратег и участие в отборе.\n\nНа данный момент мы не получили от вас завершённый Тест 1. Поэтому на этом этапе завершаем ваше участие в отборе и продолжим его с кандидатами, которые выполнили этот шаг.\n\nДоступ к рабочей группе кандидатов будет закрыт. Благодарим за уделённое время и желаем успехов в дальнейшей работе!';
export function protectedCandidate(c){return [30,45].includes(Number(c.id))||c.completed||!['new','interview_booked','interviewed','questionnaire'].includes(c.status)||/^(hracademystrateg|itopreg)$/i.test(c.username||'');}
async function setup(){
 await initFunnel();
 await sql`CREATE TABLE IF NOT EXISTS incomplete042(candidate_id BIGINT PRIMARY KEY,snapshot JSONB NOT NULL,message_id TEXT,removed_at TIMESTAMPTZ,error TEXT,created_at TIMESTAMPTZ DEFAULT NOW())`;
 await sql`ALTER TABLE incomplete042 ENABLE ROW LEVEL SECURITY`;
 await sql`ALTER TABLE incomplete042 ADD COLUMN IF NOT EXISTS service_deleted_id TEXT`;
}
async function group(){const id=(await sql`SELECT value FROM app_settings WHERE key='candidate_group_chat_id'`).rows[0]?.value;if(!id)throw Error('No candidate group');return id;}
async function candidates(){return (await sql`SELECT c.*,a.full_name,q.submitted_at AS questionnaire_submitted_at,
 EXISTS(SELECT 1 FROM candidate_tests t JOIN candidates c2 ON c2.id=t.candidate_id WHERE (c2.chat_id=c.chat_id OR c2.id=c.id) AND (t.submitted_at IS NOT NULL OR t.status='completed')) AS completed
 FROM candidates c LEFT JOIN LATERAL(SELECT full_name FROM applications WHERE candidate_id=c.id ORDER BY created_at DESC,id DESC LIMIT 1)a ON TRUE
 LEFT JOIN candidate_questionnaire_two q ON q.candidate_id=c.id ORDER BY c.id`).rows;}
export async function audit(offset=0){
 await setup();const gid=await group(),all=await candidates(),eligible=[],errors=[];let completed=0,protectedCount=0;
 const pool=all.filter(c=>!protectedCandidate(c));completed=all.filter(c=>c.completed).length;protectedCount=all.length-pool.length;
 for(const c of pool.slice(offset,offset+15)){
 try{const m=await telegramApi('getChatMember',{chat_id:gid,user_id:Number(c.chat_id)});
 if(m.status==='member'||m.status==='restricted'&&m.is_member){eligible.push({id:c.id,name:c.full_name||[c.first_name,c.last_name].filter(Boolean).join(' '),username:c.username,city:c.city,status:c.status,questionnaire_submitted_at:c.questionnaire_submitted_at});}}
 catch(e){errors.push({id:c.id,error:String(e.message)});}}
 return {group:gid,eligible,completed,protectedCount,errors,totalToCheck:pool.length,next:offset+15<pool.length?offset+15:null};
}
export async function execute(id){
 await setup();const gid=await group();let c=(await candidates()).find(x=>Number(x.id)===Number(id));
 const previous=(await sql`SELECT * FROM incomplete042 WHERE candidate_id=${Number(id)}`).rows[0];
 if(previous?.removed_at)return {id,alreadyRemoved:true};
 if(!c||protectedCandidate(c))return {id,skipped:'protected/completed'};
 const m=await telegramApi('getChatMember',{chat_id:gid,user_id:Number(c.chat_id)});
 if(!['member','restricted'].includes(m.status)||m.status==='restricted'&&!m.is_member)return {id,skipped:m.status};
 await sql`INSERT INTO incomplete042(candidate_id,snapshot) VALUES(${c.id},${JSON.stringify(c)}::text::jsonb) ON CONFLICT DO NOTHING`;
 try{
 const mid=previous?.message_id||await effect('incomplete042:dm:'+c.id,()=>telegram(c.chat_id,TEXT));
 await sql`UPDATE incomplete042 SET message_id=${String(mid)},error=NULL WHERE candidate_id=${c.id}`;
 await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) SELECT ${c.id},'out','test_incomplete_closure042',${TEXT},'delivered',${String(mid)} WHERE NOT EXISTS(SELECT 1 FROM messages WHERE candidate_id=${c.id} AND kind='test_incomplete_closure042')`;
 // Lock existing test rows during final check/removal so an in-flight submission wins first.
 const result=await transaction(async tx=>{
 const tests=(await tx`SELECT t.* FROM candidate_tests t JOIN candidates c2 ON c2.id=t.candidate_id WHERE c2.chat_id=${c.chat_id} FOR UPDATE OF t`).rows;
 const current=(await tx`SELECT * FROM candidates WHERE id=${c.id} FOR UPDATE`).rows[0];
 if(protectedCandidate({...current,completed:tests.some(t=>t.submitted_at||t.status==='completed')}))return {id,skipped:'completed/advanced before removal',messageId:mid};
 await effect('incomplete042:remove:'+c.id,async()=>{await telegramApi('unbanChatMember',{chat_id:gid,user_id:Number(c.chat_id),only_if_banned:false});return 'removed';});
 const now=await telegramApi('getChatMember',{chat_id:gid,user_id:Number(c.chat_id)});
 if(!['left','kicked'].includes(now.status))throw Error('Removal not confirmed: '+now.status);
 await tx`UPDATE candidates SET status='test_1_incomplete_removed',consent=false,updated_at=NOW() WHERE id=${c.id}`;
 await tx`UPDATE incomplete042 SET removed_at=NOW(),error=NULL WHERE candidate_id=${c.id}`;
 return {id,removed:true,messageId:mid};});return result;
 }catch(e){await sql`UPDATE incomplete042 SET error=${String(e.message)} WHERE candidate_id=${c.id}`;return {id,error:String(e.message)};}
}
export async function summary(send=false){
 await setup();const rows=(await sql`SELECT candidate_id,snapshot->>'full_name' AS name,snapshot->>'first_name' AS first_name,snapshot->>'username' AS username,snapshot->>'city' AS city,message_id,removed_at,error,service_deleted_id FROM incomplete042 ORDER BY candidate_id`).rows;
 if(send){const lines=rows.map(r=>`${r.name||r.first_name||r.candidate_id} · ${r.city||'город не указан'}${r.username?' · @'+r.username:''} — ${r.removed_at?'исключён':r.error?'ошибка: '+r.error:'отправлено, исключение не подтверждено'}`);
 const chunks=[];let t='📋 Завершение отбора: Тест 1 не заполнен\n\nИсключено: '+rows.filter(r=>r.removed_at).length+'\nТребуют проверки: '+rows.filter(r=>!r.removed_at).length+'\n\n';
 for(const l of lines){if((t+l).length>3000){chunks.push(t);t='Продолжение сводки\n\n';}t+=l+'\n';}chunks.push(t+'\nЗавершившие Тест 1 сохранены. Минск и Челябинск, ожидающие нас, не затронуты.');
 for(let i=0;i<chunks.length;i++)await effect('incomplete042:summary:'+i,()=>telegram('-1004397133749',chunks[i],{message_thread_id:30,parse_mode:undefined}));}
 return {rows};
}
