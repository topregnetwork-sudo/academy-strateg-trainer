import crypto from 'node:crypto';
import { ensureTelegramWebhook, init, json } from './_core.js';

const EXPECTED_HASH='88fb25fc0341ee64d482b77d5d6399dc51a259644aeab41e9fd54c14dbaa9764';
function authorized(req){const actual=crypto.createHash('sha256').update(String(req.headers['x-routing-setup-key']||'')).digest('hex');return actual.length===EXPECTED_HASH.length&&crypto.timingSafeEqual(Buffer.from(actual),Buffer.from(EXPECTED_HASH));}

export default async function handler(req,res){
  if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
  if(!authorized(req))return json(res,404,{error:'Not found'});
  try{await init();await ensureTelegramWebhook(req);return json(res,200,{ok:true,schema:true,webhook:true,allowedUpdates:['message','callback_query']});}
  catch(error){console.error('[experience-routing-setup] failed',{message:String(error)});return json(res,500,{error:'Setup failed'});}
}
