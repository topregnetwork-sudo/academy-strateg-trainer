import crypto from 'node:crypto';
import { init, body, json, operator, telegram } from './_core.js';
import { initFunnel, sql, transaction, sessionById, candidateById, createTask, armTask } from '../lib/funnel-store.js';
import { ACTIONS, DEFAULT_TEMPLATES, assert, validateMessage, validateSession, eligibility, renderText } from '../lib/funnel-model.js';
import { available, messageKeyboard, stableId } from '../lib/funnel-engine.js';
import { migratePrimaryTimers } from '../lib/funnel-primary.js';

export default async function handler(req,res) {
  if(!operator(req))return json(res,401,{error:'Неверный код доступа'});
  try{
    await init();await initFunnel();
    if(req.method==='GET'){
      const sessions=(await sql`SELECT * FROM funnel_sessions ORDER BY id DESC LIMIT 100`).rows;
      const templates=(await sql`SELECT * FROM funnel_templates ORDER BY id DESC LIMIT 200`).rows;
      const jobs=(await sql`SELECT j.*,count(r.candidate_id)::int AS total,count(*) FILTER(WHERE r.state='sent')::int AS sent,count(*) FILTER(WHERE r.state='attention' OR r.state='processing')::int AS attention FROM funnel_jobs j LEFT JOIN funnel_recipients r ON r.job_id=j.id GROUP BY j.id ORDER BY j.created_at DESC LIMIT 30`).rows;
      const tasks=(await sql`SELECT id,kind,state,error,due_at,payload FROM funnel_tasks WHERE state<>'done' ORDER BY due_at LIMIT 100`).rows;
      const bookings=req.query.sessionId?(await sql`SELECT b.*,s.starts_at,c.first_name,c.last_name,c.username,c.city,d.folder_url FROM funnel_bookings b JOIN funnel_slots s ON s.id=b.slot_id JOIN candidates c ON c.id=b.candidate_id LEFT JOIN candidate_drive d ON d.candidate_id=c.id WHERE b.session_id=${Number(req.query.sessionId)} ORDER BY s.starts_at`).rows:[];
      const recipients=req.query.jobId?(await sql`SELECT r.*,c.first_name,c.last_name,c.username,c.city FROM funnel_recipients r JOIN candidates c ON c.id=r.candidate_id WHERE r.job_id=${req.query.jobId} ORDER BY c.id`).rows:[];
      return json(res,200,{actions:ACTIONS,defaults:DEFAULT_TEMPLATES,sessions,templates,jobs,tasks,bookings,recipients});
    }
    if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
    const v=await body(req);
    if(v.action==='migrate_timers')return json(res,200,{ok:true,...await migratePrimaryTimers()});
    if(v.action==='save_template'){
      const config=validateMessage(v.config);assert(typeof v.name==='string'&&v.name.trim()&&v.name.length<=100,'Укажите название');
      const row=await transaction(async tx=>{
        await tx`SELECT pg_advisory_xact_lock(32032)`;
        return (await tx`INSERT INTO funnel_templates(name,version,config) SELECT ${v.name.trim()},COALESCE(MAX(version),0)+1,${JSON.stringify(config)}::text::jsonb FROM funnel_templates WHERE name=${v.name.trim()} RETURNING *`).rows[0];
      });
      return json(res,200,{ok:true,template:row});
    }
    if(v.action==='save_session'){
      const config=validateSession(v.config);
      const session=await transaction(async tx=>{
        const s=(await tx`INSERT INTO funnel_sessions(config) VALUES(${JSON.stringify(config)}::text::jsonb) RETURNING *`).rows[0];
        for(const at of config.slots)await tx`INSERT INTO funnel_slots(session_id,starts_at,capacity) VALUES(${s.id},${at},${config.capacity})`;
        return s;
      });
      return json(res,200,{ok:true,session});
    }
    if(v.action==='session_active'){
      assert(typeof v.active==='boolean','Укажите состояние');
      await sql`UPDATE funnel_sessions SET active=${v.active} WHERE id=${Number(v.sessionId)}`;
      return json(res,200,{ok:true});
    }
    if(v.action==='preview'||v.action==='test'){
      const config=validateMessage(v.config);
      if(!['invite','test_passed'].includes(config.action))config.sessionId=null;
      const session=config.sessionId?await sessionById(config.sessionId):null;
      if(['invite','test_passed'].includes(config.action))assert(session?.active&&(await available(session.id)).length,'Создайте и выберите встречу с открытыми слотами');
      if(v.action==='test'){
        const test=(await sql`SELECT * FROM candidates WHERE LOWER(username)='hracademystrateg' LIMIT 1`).rows[0];
        assert(test,'Тестовый аккаунт @HRAcademyStrateg не найден');
        await telegram(test.chat_id,'ТЕСТ — данные и запись не меняются\n\n'+renderText(config.text,test,session?.config),{parse_mode:undefined,reply_markup:await messageKeyboard(config,'test',test.id,true)});
        return json(res,200,{ok:true});
      }
      const ids=[...new Set((v.candidateIds||[]).map(Number))];
      assert(ids.length&&ids.length<=300&&ids.every(i=>Number.isSafeInteger(i)&&i>0),'Выберите от 1 до 300 кандидатов');
      const rows=(await sql`SELECT c.*,a.full_name,EXISTS(SELECT 1 FROM candidate_tests t WHERE t.candidate_id=c.id AND t.submitted_at IS NOT NULL) AS test_completed,EXISTS(SELECT 1 FROM funnel_bookings b WHERE b.candidate_id=c.id AND b.session_id=${config.sessionId||0}) AS booked_session,EXISTS(SELECT 1 FROM funnel_recipients r JOIN funnel_jobs j ON j.id=r.job_id WHERE r.candidate_id=c.id AND r.state='sent' AND j.config->>'sessionId'=${String(config.sessionId||0)}) AS invited_session
        FROM candidates c LEFT JOIN LATERAL(SELECT full_name FROM applications WHERE candidate_id=c.id ORDER BY created_at DESC LIMIT 1) a ON TRUE WHERE c.id IN(SELECT value::bigint FROM jsonb_array_elements_text(${JSON.stringify(ids)}::text::jsonb)) ORDER BY c.id`).rows;
      const excluded=[],recipients=[];for(const c of rows){const reason=eligibility(c,config,session);if(reason)excluded.push({id:c.id,name:c.full_name||c.first_name,reason});else recipients.push(c);}
      for(const id of ids)if(!rows.some(c=>Number(c.id)===id))excluded.push({id,reason:'Кандидат не найден'});
      assert(recipients.length,'Нет подходящих получателей: '+excluded.map(c=>c.reason).join('; '));
      const id=crypto.randomUUID();
      await transaction(async tx=>{
        await tx`INSERT INTO funnel_jobs(id,config) VALUES(${id},${JSON.stringify(config)}::text::jsonb)`;
        for(const c of recipients)await tx`INSERT INTO funnel_recipients(job_id,candidate_id,original_status) VALUES(${id},${c.id},${c.status})`;
      });
      return json(res,200,{ok:true,jobId:id,recipients:recipients.map(c=>({id:c.id,name:c.full_name||c.first_name,username:c.username,city:c.city,status:c.status,text:renderText(config.text,c,session?.config)})),excluded,config});
    }
    if(v.action==='send'){
      const job=(await sql`SELECT * FROM funnel_jobs WHERE id=${String(v.jobId)}`).rows[0];assert(job,'Отправка не найдена');
      assert(new Date(job.created_at)>new Date(Date.now()-3600000),'Предпросмотр устарел — сформируйте заново');
      await sql`UPDATE funnel_jobs SET state='queued' WHERE id=${job.id} AND state='draft'`;
      const taskId=await createTask('campaign',{jobId:job.id},new Date(),stableId('campaign:'+job.id));
      return json(res,200,{ok:true,jobId:job.id,taskId});
    }
    if(v.action==='retry_task'){
      const task=(await sql`SELECT * FROM funnel_tasks WHERE id=${String(v.taskId)}`).rows[0];assert(task,'Задача не найдена');
      assert(task.state!=='done','Задача уже выполнена');
      await sql`UPDATE funnel_tasks SET state='pending',error=NULL WHERE id=${task.id}`;
      await armTask(task.id);return json(res,200,{ok:true});
    }
    if(v.action==='resume_job'){
      // Does not reset delivered/uncertain effects. Only pending recipients resume.
      await sql`UPDATE funnel_jobs SET state='queued' WHERE id=${String(v.jobId)} AND state<>'draft'`;
      const id=stableId('campaign:'+v.jobId);
      await sql`UPDATE funnel_tasks SET state='pending',error=NULL WHERE id=${id}`;
      await armTask(id);return json(res,200,{ok:true});
    }
    return json(res,400,{error:'Неизвестное действие'});
  }catch(e){console.error('[funnel]',e.message);return json(res,e.status||500,{error:e.message||'Не удалось выполнить действие'});}
}
