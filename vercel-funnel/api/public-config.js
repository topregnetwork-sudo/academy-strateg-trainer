import { json } from './_core.js';
import { publicConfigFor } from '../lib/public-config.js';

export default function handler(req,res){
  if(req.method!=='GET')return json(res,405,{error:'Method not allowed'});
  const config=publicConfigFor();
  if(!config)return json(res,503,{error:'Public database configuration is unavailable'});
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control',config.preview?'no-store':'public, max-age=3600, s-maxage=3600');
  return json(res,200,{supabaseUrl:config.supabaseUrl,supabaseAnonKey:config.supabaseAnonKey});
}
