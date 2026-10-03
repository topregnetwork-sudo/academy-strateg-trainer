import {init,body,json} from './_core.js';
import {initFunnel,sql,verifyTaskToken} from '../lib/funnel-store.js';
import {runFunnelTask} from '../lib/funnel-engine.js';
import {randomUUID} from 'node:crypto';
import {claimFunnelTask,failFunnelTask,finishFunnelTask} from '../lib/funnel-task-claim.js';
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
    // Each claim gets a fencing token; an expired worker cannot settle a newer claim.
    const leaseToken=randomUUID();
    if(!await claimFunnelTask(sql,id,leaseToken))return json(res,200,{done:false,nextAt:Date.now()+150000});
    try{
      const result=await runFunnelTask(task);
      if(!await finishFunnelTask(sql,id,leaseToken,result))return json(res,200,{done:false,nextAt:Date.now()+150000});
      return json(res,200,{...result,nextAt:result.done?null:Date.now()+2000});
    }catch(e){
      if(!await failFunnelTask(sql,id,leaseToken,e))return json(res,200,{done:false,nextAt:Date.now()+150000});
      throw e;
    }
  }catch(e){console.error('[funnel-task]',id,e.message);return json(res,503,{error:'Task failed'});}
}
