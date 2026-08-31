import crypto from 'node:crypto';
import {interviewPayload} from '../lib/interview-sheet.js';
import {testAnswersCsv} from './drive.js';
// Temporary scoped 047 verification. No database or candidate messaging access.
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 const key=String(req.headers['x-check-047']||'');
 if(req.method!=='POST'||Date.now()>1788196083090||crypto.createHash('sha256').update(key).digest('hex')!=='736ea3af0a416c461d25a70ba41bbe377720e04757cff4d0a30caef92b411ff6')return res.status(404).end();
 const url=process.env.GOOGLE_DRIVE_BRIDGE_URL||'https://script.google.com/macros/s/AKfycbyUI5L871jnAwoExsqOTFbcBL5K37UYv_Z0RzpA3ZuTaE_Ovp69jpgNbZGkK_vkosa6Xg/exec';
 const secret=process.env.GOOGLE_DRIVE_BRIDGE_SECRET||process.env.OPERATOR_ACCESS_KEY;
 if(!secret)return res.status(503).json({ok:false,error:'Bridge secret missing'});
 const action=req.body?.action;
 const payload=action==='capabilities'?{action:'capabilities'}:action==='test'?{
  parentFolderId:'1WAkR2zT0lvgkhF8Ne0tL2YjQke7RE7H_',folderName:'Тест интеграции 047 — служебный, не кандидат',files:[],
  interview:interviewPayload({candidate:{id:'TEST-047',full_name:'ТЕСТ 047 — не кандидат',city:'Техническая проверка'},application:{full_name:'ТЕСТ 047 — не кандидат',motivation:'Проверка автозаполнения'},questionnaireTwo:{answers:{goals:'Тестовая цель 047',achievements:'Тестовое достижение 047',income:'Тестовый доход',strengths:'Проверка',development:'Проверка',hobbies:'Проверка',family:'Не применимо',children:'Не применимо',readiness:0,work_history:'Тестовая организация / Тестовая сфера / Тестовая должность / 2020-2025'}},test:{submitted_at:'2026-08-31',answers:Array(200).fill('+')}})
 }:null;
 if(!payload)return res.status(400).json({ok:false});
 if(action==='test')payload.files=[{name:'03 — Тест 1 — ответы (служебная проверка)',nativeType:'spreadsheet',mimeType:'text/csv;charset=utf-8',data:Buffer.from(testAnswersCsv({candidate:{id:'TEST-047',city:'Техническая проверка'},application:{full_name:'ТЕСТ 047 — не кандидат'},test:{submitted_at:'2026-08-31',answers:Array(200).fill('+')}}),'utf8').toString('base64')}];
 try{
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,secret}),signal:AbortSignal.timeout(25000)});
  const data=await response.json();
  return res.status(response.ok?200:502).json({...data,interviewSheetEnabled:process.env.GOOGLE_DRIVE_INTERVIEW_SHEET_047!=='false'});
 }catch(e){return res.status(502).json({ok:false,error:e.name==='TimeoutError'?'Bridge timed out':'Bridge did not return JSON'});}
}
