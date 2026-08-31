import { body, ensureTelegramWebhook, init, json, operator, sql, telegram } from './_core.js';
import { syncDriveCandidate, uploadDriveFile } from './drive.js';
import {candidateProgress} from '../lib/candidate-progress.js';

export default async function handler(req,res){
  if(!operator(req))return json(res,401,{error:'Неверный код доступа'});
  try{
    await init();
    const id=Number(req.query.candidate_id);
    if(req.method==='GET'){
      if(id){
        const candidate=(await sql`SELECT c.*,a.full_name,a.age,a.motivation,a.garcia_confirmed,a.test_answer,a.trainer_experience_level FROM candidates c LEFT JOIN LATERAL (SELECT * FROM applications WHERE candidate_id=c.id ORDER BY created_at DESC,id DESC LIMIT 1) a ON TRUE WHERE c.id=${id}`).rows[0];
        const messages=(await sql`SELECT * FROM messages WHERE candidate_id=${id} ORDER BY created_at ASC`).rows;
        const test=(await sql`SELECT id,questionnaire_version,status,answers,sent_at,submitted_at,created_at,updated_at FROM candidate_tests WHERE candidate_id=${id} ORDER BY created_at DESC LIMIT 1`).rows[0]||null;
        const testFiles=(await sql`SELECT id,test_type,file_kind,file_name,mime_type,uploaded_at FROM candidate_test_files WHERE candidate_id=${id} ORDER BY uploaded_at DESC`).rows;
        const questionnaireTwo=(await sql`SELECT status,answers,sent_at,submitted_at FROM candidate_questionnaire_two WHERE candidate_id=${id} LIMIT 1`).rows[0]||null;
        const drive=(await sql`SELECT candidate_id,folder_id,folder_url,folder_name,synced_at FROM candidate_drive WHERE candidate_id=${id} LIMIT 1`).rows[0]||null;
        const driveFiles=(await sql`SELECT file_kind,file_name,file_url,drive_file_id,mime_type,updated_at FROM candidate_drive_files WHERE candidate_id=${id} ORDER BY updated_at DESC`).rows;
        const progress=await candidateProgress(id).catch(()=>({errors:['progress']}));
        return json(res,200,{candidate,messages,test,testFiles,questionnaireTwo,drive,driveFiles,progress});
      }
      const candidates=(await sql`SELECT c.*,m.text AS last_message FROM candidates c LEFT JOIN LATERAL (SELECT text FROM messages WHERE candidate_id=c.id ORDER BY created_at DESC LIMIT 1) m ON true ORDER BY c.created_at DESC`).rows;
      const analytics=(await sql`SELECT count(*) FILTER (WHERE true)::int AS total,count(*) FILTER (WHERE status='interview_booked')::int AS booked,count(*) FILTER (WHERE status='hired')::int AS hired FROM candidates`).rows[0];
      return json(res,200,{candidates,analytics});
    }
    const v=await body(req);
    if(req.method==='PATCH'){
      const accepted=['test_1_incomplete_removed','new','experienced_not_target','interview_booked','interviewed','questionnaire','test_1_completed','test_1_passed','productivity_invited','productivity_booked','productivity_passed','productivity_failed','finalist','selection_closed','academy_contact','training','internship','hired','rejected','cancelled'];
      if(!accepted.includes(v.status))return json(res,400,{error:'Недопустимый статус'});
      if(v.status==='cancelled'){const {cancelCandidate}=await import('../lib/candidate-decline.js');return json(res,200,{ok:true,...await cancelCandidate(v.candidateId,'operator')});}
      await sql`UPDATE candidates SET status=${v.status},updated_at=NOW() WHERE id=${Number(v.candidateId)}`;
      if(['productivity_passed','productivity_failed'].includes(v.status)){
        const {initFunnel}=await import('../lib/funnel-store.js');await initFunnel();
        await sql`INSERT INTO candidate_interview_result_events049(candidate_id,status) VALUES(${Number(v.candidateId)},${v.status}) ON CONFLICT DO NOTHING`;
        const {queueInterviewAppointment}=await import('../lib/interview-appointment.js');await queueInterviewAppointment(v.candidateId);
      }
      return json(res,200,{ok:true});
    }
    if(req.method==='POST'){
      if(v.action==='refresh_telegram_webhook'){
        await ensureTelegramWebhook(req);
        return json(res,200,{ok:true});
      }
      if(v.action==='sync_drive_candidate'&&v.candidateId){
        return json(res,200,{ok:true,...(await syncDriveCandidate(v.candidateId))});
      }
      if(v.action==='upload_drive_file'&&v.candidateId){
        if(!v.fileName||!v.fileData)return json(res,400,{error:'Файл не передан'});
        if(String(v.fileData).length>12000000)return json(res,413,{error:'Файл больше 8 МБ'});
        return json(res,200,{ok:true,...(await uploadDriveFile(v.candidateId,v))});
      }
      if(v.action==='reset_hr_test'&&v.candidateId){
        const candidate=(await sql`SELECT * FROM candidates WHERE id=${Number(v.candidateId)} LIMIT 1`).rows[0];
        if(!candidate||String(candidate.username||'').toLowerCase()!=='hracademystrateg')return json(res,403,{error:'Повторный доступ разрешён только тестовому аккаунту @HRAcademyStrateg'});
        const version='executive-effectiveness-2020-ru-v1';
        const current=(await sql`SELECT * FROM candidate_tests WHERE candidate_id=${candidate.id} AND questionnaire_version=${version} LIMIT 1`).rows[0];
        if(current)await sql`INSERT INTO candidate_test_attempt_archive(candidate_test_id,candidate_id,questionnaire_version,answers,sent_at,submitted_at) VALUES(${current.id},${candidate.id},${version},${current.answers},${current.sent_at},${current.submitted_at})`;
        const token=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
        if(current)await sql`UPDATE candidate_tests SET token=${token},status='pending',answers=NULL,sent_at=NULL,submitted_at=NULL,completion_notice_sent_at=NULL,updated_at=NOW() WHERE id=${current.id}`;
        else await sql`INSERT INTO candidate_tests(candidate_id,token,questionnaire_version,status) VALUES(${candidate.id},${token},${version},'pending')`;
        await sql`UPDATE candidates SET status='interviewed',updated_at=NOW() WHERE id=${candidate.id}`;
        return json(res,200,{ok:true,message:'Повторный доступ открыт. Напишите боту слово «тест».'});
      }
      if(v.action==='upload_test_file'&&v.candidateId){
        if(!['answer_pdf','result_graph'].includes(v.fileKind))return json(res,400,{error:'Недопустимый тип файла'});
        if(!v.fileName||!v.mimeType||!v.fileData)return json(res,400,{error:'Файл не передан'});
        if(String(v.fileData).length>9000000)return json(res,413,{error:'Файл слишком большой. Максимум 6 МБ.'});
        await sql`INSERT INTO candidate_test_files(candidate_id,test_type,file_kind,file_name,mime_type,file_data) VALUES(${Number(v.candidateId)},'test_1',${v.fileKind},${v.fileName},${v.mimeType},${v.fileData}) ON CONFLICT(candidate_id,test_type,file_kind) DO UPDATE SET file_name=EXCLUDED.file_name,mime_type=EXCLUDED.mime_type,file_data=EXCLUDED.file_data,uploaded_at=NOW()`;
        return json(res,200,{ok:true});
      }
      if(v.action==='download_test_file'&&v.fileId){
        const file=(await sql`SELECT file_name,mime_type,file_data FROM candidate_test_files WHERE id=${Number(v.fileId)} LIMIT 1`).rows[0];
        if(!file)return json(res,404,{error:'Файл не найден'});
        return json(res,200,{ok:true,...file});
      }
      if(v.action==='send_test'&&v.candidateId){
        const candidate=(await sql`SELECT id,chat_id,first_name,last_name,username,status FROM candidates WHERE id=${Number(v.candidateId)} LIMIT 1`).rows[0];
        if(!candidate)return json(res,404,{error:'Кандидат не найден'});
        if(!['interviewed','questionnaire'].includes(candidate.status))return json(res,409,{error:'Сначала переведите кандидата в статус «Собеседование» или «Анкета».'});
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
        await sql`UPDATE candidate_tests SET status='sent',sent_at=COALESCE(sent_at,NOW()),updated_at=NOW() WHERE id=${test.id}`;
        const {scheduleStageDeadline}=await import('../lib/stage-deadlines-043.js');
        await scheduleStageDeadline(candidate.id,'test1').catch(e=>console.error('[deadline043]',candidate.id,e.message));
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
