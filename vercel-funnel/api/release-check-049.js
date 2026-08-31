import crypto from 'node:crypto';
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 const key=String(req.headers['x-release-check']||'');
 if(Date.now()>1788211305285||crypto.createHash('sha256').update(key).digest('hex')!=='c7dd196ebaeb4127fc3651b2c1dcac2479987b43ea49facf00e9a73490d505bf')return res.status(404).end();
 try{
 const url=process.env.GOOGLE_DRIVE_BRIDGE_URL||'https://script.google.com/macros/s/AKfycbyUI5L871jnAwoExsqOTFbcBL5K37UYv_Z0RzpA3ZuTaE_Ovp69jpgNbZGkK_vkosa6Xg/exec';
 const secret=process.env.GOOGLE_DRIVE_BRIDGE_SECRET||process.env.OPERATOR_ACCESS_KEY;
 const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({secret,action:'capabilities'}),signal:AbortSignal.timeout(15000)});
 const capabilities=await response.json();
 if(req.method==='POST'){
 if(req.query.action==='template'){
 const {interviewPayload}=await import('../lib/interview-sheet.js');
 const interview=interviewPayload({candidate:{id:'release-check-049',username:'test049'},application:{full_name:'Проверка моста 049 — не кандидат',city:'Проверка',trainer_experience:'none'},questionnaireTwo:{answers:{goals:'Проверка переноса ответа Анкеты 2'}}});
 const testResponse=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(45000),body:JSON.stringify({secret,parentFolderId:'1WAkR2zT0lvgkhF8Ne0tL2YjQke7RE7H_',folderName:'Проверка моста 049 — технический образец',files:[],interview})});
 return res.status(200).json(await testResponse.json());
 }
 const {syncInterviewAppointment}=await import('../lib/interview-appointment.js');
 return res.status(200).json({capabilities,result:await syncInterviewAppointment(94)});
 }
 return res.status(200).json({capabilities,appointmentEnabled:process.env.INTERVIEW_APPOINTMENT_048});
 }catch(e){return res.status(500).json({error:e.message});}
}
