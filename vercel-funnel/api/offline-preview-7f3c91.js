import { createHash,timingSafeEqual } from 'node:crypto';
import { json } from './_core.js';
import { refreshInvitationKeyboards,sendOfflinePreview } from './offline-interview.js';
const HASH='e26f245b2f7254269202173a213c31acf0cd8eda1b2a092e25fe9772bb2f3e51';
function authorized(req){const a=createHash('sha256').update(String(req.headers['x-diagnostic-key']||'')).digest(),e=Buffer.from(HASH,'hex');return a.length===e.length&&timingSafeEqual(a,e)}
export default async function handler(req,res){if(!authorized(req))return json(res,404,{ok:false});if(req.method!=='POST')return json(res,405,{ok:false});try{await refreshInvitationKeyboards();return json(res,200,{ok:true,...(await sendOfflinePreview())})}catch(error){console.error('[offline-preview]',error);return json(res,500,{ok:false,error:String(error?.message||error)})}}
