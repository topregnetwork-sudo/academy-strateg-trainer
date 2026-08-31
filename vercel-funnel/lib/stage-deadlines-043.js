import {sql,transaction,telegram,telegramApi} from '../api/_core.js';
import {initFunnel,createTask,effect} from './funnel-store.js';
import {primaryAccess,evidenceId} from './primary-evidence.js';
export const SINCE='2026-08-31T07:45:00+03:00';
export const dueAt=sent=>new Date(new Date(sent).getTime()+72*3600000);
const open=c=>c&&![30,45].includes(Number(c.id))&&!/^(itopreg|hracademystrateg)$/i.test(c.username||'')&&c.consent&&['new','interview_booked','interviewed','questionnaire'].includes(c.status);
const label=step=>step==='q2'?'Анкета 2':'Тест 1';
export const farewell=step=>'Здравствуйте!\n\nСпасибо за интерес к работе в Академии Стратег и участие в отборе.\n\nНа данный момент мы не получили от вас '+(step==='q2'?'заполненную Анкету 2':'завершённый Тест 1')+'. Поэтому на этом этапе завершаем ваше участие в отборе и продолжим его с кандидатами, которые выполнили этот шаг.\n\nДоступ к рабочей группе кандидатов будет закрыт. Благодарим за уделённое время и желаем успехов в дальнейшей работе!';
let ready;
async function init(){if(!ready)ready=(async()=>{await initFunnel();await sql`CREATE TABLE IF NOT EXISTS stage_deadlines043(candidate_id BIGINT NOT NULL,step TEXT NOT NULL,task_id TEXT NOT NULL,issued_at TIMESTAMPTZ NOT NULL,due_at TIMESTAMPTZ NOT NULL,snapshot JSONB,state TEXT NOT NULL DEFAULT 'scheduled',message_id TEXT,service_deleted_id TEXT,error TEXT,PRIMARY KEY(candidate_id,step))`;await sql`ALTER TABLE stage_deadlines043 ENABLE ROW LEVEL SECURITY`;})().catch(e=>{ready=null;throw e;});await ready;}
async function detail(id){
 const c=(await sql`SELECT * FROM candidates WHERE id=${Number(id)}`).rows[0];if(!c)return null;
 const q=(await sql`SELECT sent_at,submitted_at FROM candidate_questionnaire_two WHERE candidate_id=${Number(id)}`).rows[0];
 const t=(await sql`SELECT sent_at,submitted_at,status FROM candidate_tests WHERE candidate_id=${Number(id)} ORDER BY created_at LIMIT 1`).rows[0];
 return {c,q,t};
}
async function staff(key,text){return effect(key,()=>telegram('-1004397133749',text,{message_thread_id:30,parse_mode:undefined}));}
export async function scheduleStageDeadline(id,step){
 if(!['q2','test1'].includes(step))throw Error('Invalid stage');
 await init();const d=await detail(id);if(!d||!open(d.c))return {skipped:true};
 const item=step==='q2'?d.q:d.t;
 if(!item?.sent_at||item.submitted_at||d.t?.submitted_at||d.t?.status==='completed')return {skipped:true};
 // First issuance and first qualifying Zoom entry define the new cohort, not status alone.
 if(!d.q?.sent_at||new Date(d.q.sent_at)<new Date(SINCE))return {skipped:true};
 const access=await primaryAccess(Number(id));
 if(!access.clickedAt||new Date(access.clickedAt)<new Date(SINCE))return {skipped:true};
 const key=evidenceId(`stage-deadline043:${id}:${step}`),due=dueAt(item.sent_at);
 await sql`INSERT INTO stage_deadlines043(candidate_id,step,task_id,issued_at,due_at) VALUES(${Number(id)},${step},${key},${item.sent_at},${due}) ON CONFLICT DO NOTHING`;
 const saved=(await sql`SELECT * FROM stage_deadlines043 WHERE candidate_id=${Number(id)} AND step=${step}`).rows[0];
 if(saved.state!=='scheduled')return {skipped:true};
 try{await createTask('stage_deadline043',{candidateId:Number(id),step},new Date(saved.due_at),saved.task_id);return {scheduled:true,dueAt:saved.due_at};}
 catch(e){await sql`UPDATE stage_deadlines043 SET error=${String(e.message)} WHERE candidate_id=${Number(id)} AND step=${step}`;await staff(`stage043:schedule-error:${id}:${step}`,`⚠️ Не удалось поставить точный срок: ${label(step)}, кандидат №${id}. Требуется проверка таймера; исключение не выполнялось.`);return {error:true};}
}
export async function runStageDeadline(id,step,now=new Date()){
 await init();const job=(await sql`SELECT * FROM stage_deadlines043 WHERE candidate_id=${Number(id)} AND step=${step}`).rows[0];
 if(!job)return {done:true};
 if(new Date(job.due_at)>now)return {done:false};
 const d=await detail(id);const done=()=>step==='q2'?d.q?.submitted_at:d.t?.submitted_at||d.t?.status==='completed';
 if(job.state==='removed'){await report();return {done:true};}
 if(job.state!=='scheduled')return {done:true};
 if(!d||!open(d.c)||done()||d.t?.submitted_at||d.t?.status==='completed'){await state('completed_or_protected');return {done:true};}
 // An unanswered human message is not non-participation. Escalate only this person.
 const latest=(await sql`SELECT direction,kind FROM messages WHERE candidate_id=${Number(id)} ORDER BY created_at DESC,id DESC LIMIT 1`).rows[0];
 if(latest?.direction==='in'&&!['link_open'].includes(latest.kind)){await state('attention','Есть сообщение кандидата без ответа');await staff(`stage043:attention:${id}:${step}`,`⚠️ Срок ${label(step)} истёк: ${d.c.first_name||''} · ${d.c.city||''} · №${id}. Есть сообщение без ответа. Исключение остановлено, нужен ответ оператора.`);return {done:true};}
 const gid=(await sql`SELECT value FROM app_settings WHERE key='candidate_group_chat_id'`).rows[0]?.value;if(!gid)throw Error('Candidate group missing');
 const member=await telegramApi('getChatMember',{chat_id:gid,user_id:Number(d.c.chat_id)});
 if(!['member','restricted','left','kicked'].includes(member.status)){await state('protected_member');return {done:true};}
 const text=farewell(step);
 await sql`UPDATE stage_deadlines043 SET snapshot=COALESCE(snapshot,${JSON.stringify(d.c)}::text::jsonb) WHERE candidate_id=${Number(id)} AND step=${step}`;
 const mid=await effect(`stage043:dm:${id}:${step}`,()=>telegram(d.c.chat_id,text));
 await sql`UPDATE stage_deadlines043 SET message_id=${String(mid)} WHERE candidate_id=${Number(id)} AND step=${step}`;
 await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) SELECT ${Number(id)},'out','stage_deadline_closure043',${text},'delivered',${String(mid)} WHERE NOT EXISTS(SELECT 1 FROM messages WHERE candidate_id=${Number(id)} AND telegram_message_id=${String(mid)} AND direction='out')`;
 await transaction(async tx=>{
 const t=(await tx`SELECT submitted_at,status FROM candidate_tests WHERE candidate_id=${Number(id)} FOR UPDATE`).rows;
 const q=(await tx`SELECT submitted_at FROM candidate_questionnaire_two WHERE candidate_id=${Number(id)} FOR UPDATE`).rows[0];
 const c=(await tx`SELECT * FROM candidates WHERE id=${Number(id)} FOR UPDATE`).rows[0];
 if(!open(c)||t.some(x=>x.submitted_at||x.status==='completed')||step==='q2'&&q?.submitted_at){await tx`UPDATE stage_deadlines043 SET state='completed_during_delivery' WHERE candidate_id=${Number(id)} AND step=${step}`;return;}
 await effect(`stage043:remove:${id}:${step}`,async()=>{if(member.status==='member'||member.status==='restricted'&&member.is_member)await telegramApi('unbanChatMember',{chat_id:gid,user_id:Number(c.chat_id),only_if_banned:false});return 'removed';});
 const after=await telegramApi('getChatMember',{chat_id:gid,user_id:Number(c.chat_id)});if(!['left','kicked'].includes(after.status))throw Error('Removal not confirmed');
 await tx`UPDATE candidates SET status='test_1_incomplete_removed',consent=false,updated_at=NOW() WHERE id=${Number(id)}`;
 await tx`UPDATE stage_deadlines043 SET state='removed',error=NULL WHERE candidate_id=${Number(id)} AND step=${step}`;
 });
 const final=(await sql`SELECT state FROM stage_deadlines043 WHERE candidate_id=${Number(id)} AND step=${step}`).rows[0];
 if(final.state==='removed')await report();else await staff(`stage043:race:${id}:${step}`,`⚠️ Кандидат №${id} завершил шаг во время отправки прощального сообщения. Он НЕ исключён. Проверьте переписку.`);
 return {done:true};
 async function state(s,error=null){await sql`UPDATE stage_deadlines043 SET state=${s},error=${error} WHERE candidate_id=${Number(id)} AND step=${step}`;}
 async function report(){await staff(`stage043:report:${id}:${step}`,`📋 Участие в отборе завершено\n${d?.c.first_name||''} ${d?.c.last_name||''} · ${d?.c.city||''}\n${d?.c.username?'@'+d.c.username:'Кандидат №'+id}\nПричина: ${label(step)} не заполнен(а) за 3 дня после выдачи.\nСообщение доставлено. В группе больше не состоит.\nСтатус: Не заполнил. Исключён.\nhttps://academy-strateg-trainer.vercel.app/operator.html?candidate_id=${id}`);}
}
