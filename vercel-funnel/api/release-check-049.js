import crypto from 'node:crypto';
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 const key=String(req.headers['x-release-check']||req.query.key||'');
 if(Date.now()>1788211305285||crypto.createHash('sha256').update(key).digest('hex')!=='c7dd196ebaeb4127fc3651b2c1dcac2479987b43ea49facf00e9a73490d505bf')return res.status(404).end();
 try{
 const url=process.env.GOOGLE_DRIVE_BRIDGE_URL||'https://script.google.com/macros/s/AKfycbyUI5L871jnAwoExsqOTFbcBL5K37UYv_Z0RzpA3ZuTaE_Ovp69jpgNbZGkK_vkosa6Xg/exec';
 const secret=process.env.GOOGLE_DRIVE_BRIDGE_SECRET||process.env.OPERATOR_ACCESS_KEY;
 const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({secret,action:'capabilities'}),signal:AbortSignal.timeout(15000)});
 const capabilities=await response.json();
 return res.status(200).json({capabilities,appointmentEnabled:process.env.INTERVIEW_APPOINTMENT_048,template:'048'});
 }catch(e){return res.status(500).json({error:e.message});}
}
