import { init, json, operator } from './_core.js';

export default async function handler(req,res){
  if(!operator(req))return json(res,401,{error:'Unauthorized'});
  try{await init();return json(res,200,{ok:true})}
  catch(error){return json(res,500,{error:String(error),code:error?.code||null,detail:error?.detail||null})}
}
