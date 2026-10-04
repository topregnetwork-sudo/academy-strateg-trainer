const PREVIEW_BRANCH='codex/trainer-preview-35859b0';
const PREVIEW_SUPABASE_HOST='qovkhpfyuptlkrbgrmsb.supabase.co';

export function publicConfigFor(env=process.env){
  if(env.VERCEL_ENV==='preview'){
    if(env.VERCEL_GIT_COMMIT_REF!==PREVIEW_BRANCH)return null;
    const supabaseUrl=env.TRAINER_FORM2_PREVIEW_SUPABASE_URL;
    const supabaseAnonKey=env.TRAINER_FORM2_PREVIEW_SUPABASE_ANON_KEY;
    if(!supabaseUrl||!supabaseAnonKey)return null;
    let previewUrl;
    try{previewUrl=new URL(supabaseUrl)}catch{return null}
    if(previewUrl.protocol!=='https:'||previewUrl.hostname!==PREVIEW_SUPABASE_HOST)return null;
    return {supabaseUrl,supabaseAnonKey,preview:true};
  }
  const supabaseUrl=env.SUPABASE_URL;
  const supabaseAnonKey=env.NEXT_PUBLIC_SUPABASE_ANON_KEY||env.SUPABASE_ANON_KEY;
  return supabaseUrl&&supabaseAnonKey?{supabaseUrl,supabaseAnonKey,preview:false}:null;
}
