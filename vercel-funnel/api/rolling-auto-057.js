import crypto from 'node:crypto';
import {init,json,sql} from './_core.js';
import {ensureRollingWindow057,ROLLING_KEY} from '../lib/rolling-productivity-057.js';
const HASH='bfce00b7917f4200ce8119b47e3c911b8b55c030488dcb766fdedc5d2e7e76fc';
export default async function handler(req,res){
 if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
 const actual=crypto.createHash('sha256').update(String(req.body?.token||'')).digest('hex');
 if(actual.length!==HASH.length||!crypto.timingSafeEqual(Buffer.from(actual),Buffer.from(HASH)))return json(res,404,{error:'Not found'});
 try{
  await init();const result=await ensureRollingWindow057();
  const tasks=result.sessionId?(await sql`SELECT id,due_at,state,error FROM funnel_tasks WHERE kind='rolling_window_refresh_057' AND payload->>'sessionId'=${String(result.sessionId)} ORDER BY due_at`).rows:[];
  const slots=result.sessionId?(await sql`SELECT (starts_at AT TIME ZONE 'Europe/Moscow')::date::text day,count(*)::int slots FROM funnel_slots WHERE session_id=${result.sessionId} GROUP BY day ORDER BY day`).rows:[];
  return json(res,200,{ok:result.active,key:ROLLING_KEY,...result,slots,tasks});
 }catch(error){return json(res,500,{error:String(error?.message||error)});}
}
