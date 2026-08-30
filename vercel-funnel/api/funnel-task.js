import {init,body,json} from './_core.js';
import {initFunnel,sql,verifyTaskToken} from '../lib/funnel-store.js';
import {runFunnelTask} from '../lib/funnel-engine.js';
export default async function handler(req,res){
  if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
  const v=await body(req),id=verifyTaskToken(v.token);
  if(!id)return json(res,401,{error:'Unauthorized'});
  try{
    await init();await initFunnel();
    const task=(await sql`SELECT * FROM funnel_tasks WHERE id=${id}`).rows[0];
    if(!task)return json(res,404,{error:'Task not found'});
    if(v.validate)return json(res,200,{id,dueAt:new Date(task.due_at).getTime(),done:task.state==='done'});
    if(task.state==='done')return json(res,200,{done:true});
    if(new Date(task.due_at)>new Date())return json(res,200,{done:false,nextAt:new Date(task.due_at).getTime()});
    // A task has a single durable dispatcher. SQL claim also protects simultaneous retries.
    const claim=(await sql`UPDATE funnel_tasks SET state='running',updated_at=NOW() WHERE id=${id} AND (state IN ('pending','attention') OR (state='running' AND updated_at<NOW()-INTERVAL '2 minutes')) RETURNING id`).rows[0];
    if(!claim)return json(res,200,{done:false,nextAt:Date.now()+150000});
    try{
      const result=await runFunnelTask(task);
      await sql`UPDATE funnel_tasks SET state=${result.done?'done':'pending'},error=NULL,updated_at=NOW() WHERE id=${id}`;
      return json(res,200,{...result,nextAt:result.done?null:Date.now()+2000});
    }catch(e){await sql`UPDATE funnel_tasks SET state='attention',error=${String(e.message).slice(0,500)},updated_at=NOW() WHERE id=${id}`;throw e;}
  }catch(e){console.error('[funnel-task]',id,e.message);return json(res,503,{error:'Task failed'});}
}
