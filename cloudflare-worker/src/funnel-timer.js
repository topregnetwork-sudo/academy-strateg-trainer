import { DurableObject } from 'cloudflare:workers';
const ENDPOINT='https://academy-strateg-trainer.vercel.app/api/funnel-task';
export async function scheduleRequest(request,env){
  if(request.method!=='POST')return new Response('Method not allowed',{status:405});
  if(Number(request.headers.get('content-length')||0)>512)return new Response('Too large',{status:413});
  const body=await request.text();if(body.length>512)return new Response('Too large',{status:413});
  let token;try{token=JSON.parse(body).token;}catch{return new Response('Invalid request',{status:400});}
  if(!/^[a-f0-9-]{36}\.[a-f0-9]{64}$/.test(token||''))return new Response('Unauthorized',{status:401});
  const check=await fetch(ENDPOINT,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token,validate:true}),signal:AbortSignal.timeout(15000)});
  if(!check.ok)return new Response('Task not authorized',{status:check.status});
  const task=await check.json();
  if(!task.done)await env.FUNNEL_TIMERS.getByName(task.id).schedule(token,task.dueAt);
  return Response.json({ok:true});
}
export class FunnelTimer extends DurableObject {
  async schedule(token,dueAt){
    await this.ctx.storage.put('task',{token,attempts:0});
    await this.ctx.storage.setAlarm(Math.max(Date.now()+1000,dueAt));
  }
  async alarm(){
    const task=await this.ctx.storage.get('task');if(!task)return;
    try{
      const r=await fetch(ENDPOINT,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:task.token}),signal:AbortSignal.timeout(55000)});
      if(!r.ok)throw new Error('Task callback '+r.status);
      const result=await r.json();
      if(result.done){await this.ctx.storage.delete('task');return;}
      await this.ctx.storage.put('task',{...task,attempts:0});
      await this.ctx.storage.setAlarm(Math.max(Date.now()+1000,result.nextAt||Date.now()+2000));
    }catch(e){
      const attempts=task.attempts+1;
      await this.ctx.storage.put('task',{...task,attempts});
      console.error('funnel-timer-failure',{attempts,message:e.message});
      // Never abandon one concrete funnel event because of a temporary outage.
      // Fast retries first, then one controlled retry every30minutes until fixed.
      await this.ctx.storage.setAlarm(Date.now()+Math.min(1800000,30000*2**Math.min(attempts,6)));
    }
  }
}
