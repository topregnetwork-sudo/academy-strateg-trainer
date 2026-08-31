// Only timestamps: no test answers, scoring or candidate-wide scans.
export function timelineFields(data,booking) {
  const fields={};
  const dates={B6:data.clicked_at,B7:data.q_sent,B8:data.group_joined_at,B9:data.q_opened,B10:data.q_submitted,
    B11:data.t_sent,B12:data.t_opened,B13:data.t_submitted,B14:data.invited_at,B15:booking?.updated_at,
    B16:booking?.starts_at,B17:data.result_at};
  for(const [cell,value] of Object.entries(dates)) {
    if(value){const date=new Date(value);if(!Number.isFinite(+date))throw Error('Invalid timeline date');fields[cell]={iso:date.toISOString()};}
  }
  fields.B16=booking?fields.B16:{clear:true};
  fields.E16={text:booking?'Запланировано; не считается пройденным':'Нет действующей записи'};
  fields.E17={text:data.status==='productivity_passed'?'Продуктивность пройдена':data.status==='productivity_failed'?'Продуктивность не пройдена':'Решение ещё не зафиксировано'};
  return fields;
}

export async function readInterviewTimeline(db,id,booking) {
  const row=(await db`SELECT c.status,c.group_joined_at,
    (SELECT MIN(clicked_at) FROM candidate_zoom_entries WHERE candidate_id=c.id) AS clicked_at,
    q.sent_at AS q_sent,q.opened_at AS q_opened,q.submitted_at AS q_submitted,
    t.sent_at AS t_sent,t.opened_at AS t_opened,t.submitted_at AS t_submitted,
    (SELECT MIN(sent_at) FROM offline_interview_invites WHERE candidate_id=c.id AND status='sent') AS legacy_invited_at,
    (SELECT MIN(r.updated_at) FROM funnel_recipients r JOIN funnel_jobs j ON j.id=r.job_id
     WHERE r.candidate_id=c.id AND r.state='sent' AND j.config->>'action' IN ('invite','test_passed')) AS native_invited_at,
    (SELECT MAX(recorded_at) FROM candidate_interview_result_events049 WHERE candidate_id=c.id AND status=c.status) AS result_at
    FROM candidates c LEFT JOIN candidate_questionnaire_two q ON q.candidate_id=c.id
    LEFT JOIN LATERAL(SELECT sent_at,opened_at,submitted_at FROM candidate_tests WHERE candidate_id=c.id ORDER BY created_at DESC LIMIT 1)t ON TRUE
    WHERE c.id=${id}`).rows[0];
  if(!row)throw Error('Кандидат не найден');
  row.invited_at=[row.legacy_invited_at,row.native_invited_at].filter(Boolean).sort((a,b)=>+new Date(a)-+new Date(b))[0];
  return timelineFields(row,booking);
}
