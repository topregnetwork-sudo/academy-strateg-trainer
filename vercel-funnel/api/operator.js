import { body, init, json, operator, sql, telegram } from './_core.js';

export default async function handler(req,res){
  if(!operator(req))return json(res,401,{error:'Неверный код доступа'});
  try{
    await init();
    const id=Number(req.query.candidate_id);
    if(req.method==='GET'){
      if(id){
        const candidate=(await sql`SELECT c.*,a.full_name,a.age,a.motivation,a.garcia_confirmed,a.test_answer,a.trainer_experience_level FROM candidates c LEFT JOIN applications a ON a.candidate_id=c.id WHERE c.id=${id}`).rows[0];
        const messages=(await sql`SELECT * FROM messages WHERE candidate_id=${id} ORDER BY created_at ASC`).rows;
        const test=(await sql`SELECT id,questionnaire_version,status,answers,sent_at,submitted_at,created_at,updated_at FROM candidate_tests WHERE candidate_id=${id} ORDER BY created_at DESC LIMIT 1`).rows[0]||null;
        return json(res,200,{candidate,messages,test});
      }
      const candidates=(await sql`SELECT c.*,m.text AS last_message FROM candidates c LEFT JOIN LATERAL (SELECT text FROM messages WHERE candidate_id=c.id ORDER BY created_at DESC LIMIT 1) m ON true ORDER BY c.created_at DESC`).rows;
      const analytics=(await sql`SELECT count(*) FILTER (WHERE true)::int AS total,count(*) FILTER (WHERE status='interview_booked')::int AS booked,count(*) FILTER (WHERE status='hired')::int AS hired FROM candidates`).rows[0];
      return json(res,200,{candidates,analytics});
    }
    const v=await body(req);
    if(req.method==='PATCH'){
      const accepted=['new','experienced_not_target','interview_booked','interviewed','training','internship','hired','rejected','cancelled'];
      if(!accepted.includes(v.status))return json(res,400,{error:'Недопустимый статус'});
      await sql`UPDATE candidates SET status=${v.status},updated_at=NOW() WHERE id=${Number(v.candidateId)}`;
      return json(res,200,{ok:true});
    }
    if(req.method==='POST'){
      if(v.action==='send_test'&&v.candidateId){
        const candidate=(await sql`SELECT id,chat_id,first_name,last_name,username FROM candidates WHERE id=${Number(v.candidateId)} LIMIT 1`).rows[0];
        if(!candidate)return json(res,404,{error:'Кандидат не найден'});
        const questionnaireVersion='executive-effectiveness-2020-ru-v1';
        let test=(await sql`SELECT * FROM candidate_tests WHERE candidate_id=${candidate.id} AND questionnaire_version=${questionnaireVersion} LIMIT 1`).rows[0];
        if(test?.submitted_at)return json(res,409,{error:'Кандидат уже завершил тест. Ответы находятся в его карточке.'});
        if(!test){
          const token=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
          test=(await sql`INSERT INTO candidate_tests(candidate_id,token,questionnaire_version,status) VALUES(${candidate.id},${token},${questionnaireVersion},'pending') RETURNING *`).rows[0];
        }
        const testUrl=`https://topregnetwork-sudo.github.io/academy-strateg-trainer/test.html?token=${test.token}`;
        const text='📝 <b>Тест кандидата Академии Стратег</b>\n\nОткройте персональную ссылку и ответьте на 200 вопросов. На одной странице нужно выбрать «Да», «Может быть» или «Нет» напротив каждого вопроса.\n\nПосле отправки ответы автоматически прикрепятся к вашей анкете.';
        const messageId=await telegram(candidate.chat_id,text,{reply_markup:{inline_keyboard:[[{text:'Пройти тест',url:testUrl}]]}});
        await sql`UPDATE candidate_tests SET status='sent',sent_at=NOW(),updated_at=NOW() WHERE id=${test.id}`;
        await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) VALUES(${candidate.id},'out','candidate_test_invite',${text},'delivered',${String(messageId||'')})`;
        return json(res,200,{ok:true,status:'sent'});
      }
      const statusFilter=v.statusFilter||null;
      const cityFilter=v.cityFilter||null;
      const sourceFilter=v.sourceFilter||null;
      const interviewDateFilter=/^\d{4}-\d{2}-\d{2}$/.test(v.interviewDateFilter||'')?v.interviewDateFilter:null;
      const slotFilter=v.slotFilter||null;
      if(v.preview){
        const q=(await sql`SELECT count(*)::int AS count FROM candidates WHERE consent=true AND (${statusFilter}::text IS NULL OR status=${statusFilter}) AND (${cityFilter}::text IS NULL OR city=${cityFilter}) AND (${sourceFilter}::text IS NULL OR source_id=${sourceFilter}) AND (${interviewDateFilter}::date IS NULL OR (interview_at AT TIME ZONE 'Europe/Moscow')::date=${interviewDateFilter}::date) AND (${slotFilter}::text IS NULL OR slot_id=${slotFilter})`).rows[0];
        return json(res,200,{recipientCount:q.count});
      }
      if(v.candidateId&&v.text){
        const c=(await sql`SELECT * FROM candidates WHERE id=${Number(v.candidateId)}`).rows[0];
        if(!c)return json(res,404,{error:'Кандидат не найден'});
        const msg=await telegram(c.chat_id,v.text);
        await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) VALUES(${c.id},'out','text',${v.text},'delivered',${String(msg||'')})`;
        return json(res,200,{ok:true});
      }
      if(v.text){
        const recipients=await sql`SELECT * FROM candidates WHERE consent=true AND (${statusFilter}::text IS NULL OR status=${statusFilter}) AND (${cityFilter}::text IS NULL OR city=${cityFilter}) AND (${sourceFilter}::text IS NULL OR source_id=${sourceFilter}) AND (${interviewDateFilter}::date IS NULL OR (interview_at AT TIME ZONE 'Europe/Moscow')::date=${interviewDateFilter}::date) AND (${slotFilter}::text IS NULL OR slot_id=${slotFilter})`;
        let sent=0,failed=0,historyFailed=0;
        for(const c of recipients.rows){
          try{
            const msg=await telegram(c.chat_id,v.text);
            sent++;
            try{await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) VALUES(${c.id},'out','text',${v.text},'delivered',${String(msg||'')})`}
            catch(error){historyFailed++;console.error('Failed to store delivered broadcast message',error)}
          }catch{failed++}
        }
        await sql`INSERT INTO broadcasts(text,status_filter,source_filter,city_filter,sent_count,failed_count) VALUES(${v.text},${statusFilter},${sourceFilter},${cityFilter},${sent},${failed})`;
        return json(res,200,{sent,failed,historyFailed});
      }
    }
    return json(res,405,{error:'Method not allowed'});
  }catch(error){
    console.error('[operator] failed',error);
    return json(res,500,{error:'Не удалось выполнить действие'});
  }
}
