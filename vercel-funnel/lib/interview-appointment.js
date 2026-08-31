// INTERVIEW-APPOINTMENT-048: only saved productivity bookings, never primary Zoom or screenshots.
export function appointmentFields(booking) {
  if (!booking) return {F9:'',F10:'',F11:'',F12:''};
  const at = new Date(booking.starts_at);
  if (!Number.isFinite(+at)) throw new Error('Некорректное время записи на продуктивность');
  const options = {timeZone:'Europe/Moscow'};
  return {
    F9: new Intl.DateTimeFormat('ru-RU',{...options,day:'numeric',month:'long',year:'numeric'}).format(at),
    F10: new Intl.DateTimeFormat('ru-RU',{...options,hour:'2-digit',minute:'2-digit'}).format(at)+' — МСК (UTC+3)',
    F11: booking.format==='online'?'Онлайн':booking.format==='offline'?'Офлайн':'',
    F12: booking.interviewer || ''
  };
}

// Explicitly approved host for these two September 1 campaigns only.
function host(config) {
  if (config.interviewer) return config.interviewer;
  if (config.date==='2026-09-01' && config.city==='Челябинск' &&
      /^https:\/\/us04web\.zoom\.us\/j\/74249951606(?:\?|$)/.test(config.location || '')) return 'Шипунов Максим';
  return '';
}

export async function readProductivityAppointment(db, candidateId) {
  const native = (await db`SELECT b.id,b.version,b.updated_at,s.starts_at,f.config
    FROM funnel_bookings b JOIN funnel_slots s ON s.id=b.slot_id
    JOIN funnel_sessions f ON f.id=b.session_id WHERE b.candidate_id=${candidateId}`).rows;
  const legacy = (await db`SELECT event_date::text AS event_date,slot_time,
    (event_date+make_time(SUBSTRING(slot_time,1,2)::int,SUBSTRING(slot_time,3,2)::int,0)) AT TIME ZONE 'Europe/Moscow' AS starts_at
    FROM offline_interview_bookings WHERE candidate_id=${candidateId} AND status='booked' AND event_date='2026-09-01'::date`).rows;
  const bookings = native.map(b=>({...b,source:'funnel_bookings',key:'funnel:'+b.id+':'+b.version,
    format:b.config.format,interviewer:host(b.config)})).concat(legacy.map(b=>({...b,source:'offline_interview_bookings',
    key:'legacy:'+candidateId+':'+b.event_date+':'+b.slot_time,
    format:b.event_date==='2026-09-01'?'online':'offline',interviewer:b.event_date==='2026-09-01'?'Шипунов Максим':''})));
  // A later meeting supersedes the historical one. Multiple meetings on the same date are ambiguous.
  bookings.sort((a,b)=>+new Date(b.starts_at)-+new Date(a.starts_at));
  if (bookings.length>1 && new Date(bookings[0].starts_at).toISOString().slice(0,10)===new Date(bookings[1].starts_at).toISOString().slice(0,10)) {
    throw new Error('Несколько записей на продуктивность в один день — требуется выбор оператора');
  }
  return bookings[0] || null;
}

export async function syncInterviewAppointment(candidateId) {
  const {init,transaction}=await import('../api/_core.js');
  const {initFunnel}=await import('./funnel-store.js');
  await init(); await initFunnel();
  return transaction(async db=>{
    // Booking and cancellation use this same candidate lock. A stale event reads current data.
    const candidate=(await db`SELECT id FROM candidates WHERE id=${Number(candidateId)} FOR UPDATE`).rows[0];
    if(!candidate)throw new Error('Кандидат не найден');
    const folder=(await db`SELECT folder_id FROM candidate_drive WHERE candidate_id=${candidate.id}`).rows[0];
    if(!folder?.folder_id)throw new Error('Папка ещё не создана; повторить адресное обновление после создания бланка');
    const booking=await readProductivityAppointment(db,candidate.id);
    const url=process.env.GOOGLE_DRIVE_BRIDGE_URL || 'https://script.google.com/macros/s/AKfycbyUI5L871jnAwoExsqOTFbcBL5K37UYv_Z0RzpA3ZuTaE_Ovp69jpgNbZGkK_vkosa6Xg/exec';
    const secret=process.env.GOOGLE_DRIVE_BRIDGE_SECRET || process.env.OPERATOR_ACCESS_KEY;
    if(!secret)throw new Error('Канал Google Drive ещё не подключён');
    const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(15000),
      body:JSON.stringify({secret,action:'interview_appointment_048',existingFolderId:folder.folder_id,
        candidateId:String(candidate.id),bookingKey:booking?.key || 'no-active-booking',fields:appointmentFields(booking)})});
    const result=await response.json();
    if(!response.ok || !result?.ok || !result.appointment048)throw new Error(result.error || 'Нужно обновить Google-мост: INTERVIEW-APPOINTMENT-048');
    return result;
  });
}

export async function queueInterviewAppointment(candidateId) {
  // Do not activate against the older bridge. No new timer until both sides are released.
  if(process.env.INTERVIEW_APPOINTMENT_048!=='true')return {disabled:true};
  const {createTask}=await import('./funnel-store.js');
  try { return {taskId:await createTask('interview_appointment_048',{candidateId:Number(candidateId)})}; }
  catch(error) { console.error('[interview-appointment-048] task requires attention',candidateId,error.message);return {warning:error.message}; }
}
