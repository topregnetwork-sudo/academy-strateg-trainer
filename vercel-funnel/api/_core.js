import postgres from 'postgres';

let connection;
function getConnection(){
  if(!connection){
    const url=process.env.STORAGE_URL||process.env.DATABASE_URL||process.env.POSTGRES_URL;
    if(!url) throw new Error('Database connection is not configured');
    connection=postgres(url,{prepare:false,ssl:'require'});
  }
  return connection;
}
export async function sql(strings,...values){
  const rows=await getConnection()(strings,...values);
  return {rows};
}

export const slots={"mon-0800":"Понедельник, 08:00 МСК","tue-0800":"Вторник, 08:00 МСК","wed-0800":"Среда, 08:00 МСК","thu-1800":"Четверг, 18:00 МСК","fri-1800":"Пятница, 18:00 МСК","sat-0600":"Суббота, 06:00 МСК"};
const schedule={"mon-0800":[1,8],"tue-0800":[2,8],"wed-0800":[3,8],"thu-1800":[4,18],"fri-1800":[5,18],"sat-0600":[6,6]};
export const json=(res,status,data)=>res.status(status).json(data);
export async function body(req){return typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});}
export function code(){return crypto.randomUUID().replaceAll('-','').slice(0,20);}
export function nextInterview(slotId,now=new Date()){const [weekday,hour]=schedule[slotId]||schedule['mon-0800'];const moscow=new Date(now.getTime()+3*3600000);let days=(weekday-moscow.getUTCDay()+7)%7;if(days===0&&moscow.getUTCHours()>=hour)days=7;return new Date(Date.UTC(moscow.getUTCFullYear(),moscow.getUTCMonth(),moscow.getUTCDate()+days,hour-3)).toISOString();}
async function enablePublicApplications(){await sql`ALTER TABLE applications ENABLE ROW LEVEL SECURITY`;await sql`GRANT INSERT ON applications TO anon`;await sql`GRANT USAGE, SELECT ON SEQUENCE applications_id_seq TO anon`;try{await sql`CREATE POLICY public_candidate_insert ON applications FOR INSERT TO anon WITH CHECK (candidate_id IS NULL AND char_length(code)=20)`}catch(error){if(error?.code!=='42710')throw error}}
export async function init(){await sql`CREATE TABLE IF NOT EXISTS applications (id BIGSERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL, full_name TEXT NOT NULL, age TEXT, city TEXT NOT NULL, motivation TEXT NOT NULL, phone TEXT, slot_id TEXT NOT NULL, source_id TEXT NOT NULL DEFAULT 'direct', garcia_confirmed BOOLEAN NOT NULL DEFAULT FALSE, test_answer TEXT NOT NULL, candidate_id BIGINT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;await sql`ALTER TABLE applications ENABLE ROW LEVEL SECURITY`;await sql`GRANT INSERT ON applications TO anon`;await sql`GRANT USAGE, SELECT ON SEQUENCE applications_id_seq TO anon`;await sql`DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='applications' AND policyname='public_candidate_insert') THEN CREATE POLICY public_candidate_insert ON applications FOR INSERT TO anon WITH CHECK (candidate_id IS NULL AND char_length(code)=20); END IF; END $`;await sql`CREATE TABLE IF NOT EXISTS candidates (id BIGSERIAL PRIMARY KEY, chat_id TEXT UNIQUE NOT NULL, username TEXT, first_name TEXT, last_name TEXT, phone TEXT, city TEXT, slot_id TEXT, interview_at TIMESTAMPTZ, source_id TEXT NOT NULL DEFAULT 'direct', status TEXT NOT NULL DEFAULT 'new', consent BOOLEAN NOT NULL DEFAULT TRUE, reminded_30m BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;await sql`CREATE TABLE IF NOT EXISTS messages (id BIGSERIAL PRIMARY KEY, candidate_id BIGINT NOT NULL, direction TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'text', text TEXT NOT NULL, delivery_status TEXT NOT NULL DEFAULT 'pending', telegram_message_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;await sql`CREATE TABLE IF NOT EXISTS broadcasts (id BIGSERIAL PRIMARY KEY, text TEXT NOT NULL, status_filter TEXT, source_filter TEXT, sent_count INTEGER NOT NULL DEFAULT 0, failed_count INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;}
export async function telegram(chatId,text,extra={}){const token=process.env.TELEGRAM_BOT_TOKEN;if(!token)throw new Error('Telegram bot token is not configured');const r=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chatId,text,parse_mode:'HTML',...extra})});const data=await r.json();if(!data.ok)throw new Error(data.description||'Telegram delivery failed');return data.result?.message_id;}
export async function ensureTelegramWebhook(req){const token=process.env.TELEGRAM_BOT_TOKEN,secret=process.env.TELEGRAM_WEBHOOK_SECRET;if(!token||!secret)return;const host=req.headers['x-forwarded-host']||req.headers.host;if(!host)return;await fetch(`https://api.telegram.org/bot${token}/setWebhook`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:`https://${host}/api/telegram`,secret_token:secret,allowed_updates:['message']})});}
export function operator(req){const expected=process.env.OPERATOR_ACCESS_KEY;if(!expected||req.headers.authorization!==`Bearer ${expected}`)return false;return true;}




