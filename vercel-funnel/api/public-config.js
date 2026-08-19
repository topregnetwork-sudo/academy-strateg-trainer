import { json } from './_core.js';

export default function handler(req,res){
  if(req.method!=='GET')return json(res,405,{error:'Method not allowed'});
  const supabaseUrl=process.env.SUPABASE_URL;
  const supabaseAnonKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||process.env.SUPABASE_ANON_KEY;
  if(!supabaseUrl||!supabaseAnonKey)return json(res,503,{error:'Public database configuration is unavailable'});
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control','public, max-age=3600, s-maxage=3600');
  return json(res,200,{supabaseUrl,supabaseAnonKey});
}
