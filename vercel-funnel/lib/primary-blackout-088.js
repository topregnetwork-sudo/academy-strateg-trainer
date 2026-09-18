export const PRIMARY_BLACKOUT_PREVIEW = /^\/primary_blackout_preview(?:@stazherskaya_bot)?(?:\s|$)/i;
export const BLACKOUT_DATES = ['2026-09-18', '2026-09-19'];

export async function nextAllowedPrimary(slotId, nextInterview, sql, now = new Date()) {
  let cursor = now;
  for (let attempt = 0; attempt < 8; attempt++) {
    const at = nextInterview(slotId, cursor);
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
    if (!BLACKOUT_DATES.includes(day)) return at;
    cursor = new Date(new Date(at).getTime() + 60000);
  }
  throw new Error('Не удалось найти доступную дату после разового исключения');
}

const esc = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');

function moscowParts(value) {
  const date = new Date(value);
  return {
    day: new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric' }).format(date),
    time: new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit', hour12: false }).format(date),
  };
}

export function candidateBlackoutMessage(candidate) {
  const { day, time } = moscowParts(candidate.interview_at);
  const name = String(candidate.first_name || '').trim() || 'Здравствуйте';
  return `${name === 'Здравствуйте' ? name : `Здравствуйте, ${name}`}! Первичные собеседования 18 и 19 сентября проводиться не будут. Ваша прежняя запись на ${day} в ${time} МСК сохранена в истории, но встреча в это время не состоится. Пожалуйста, выберите другое доступное время начиная с понедельника, 21 сентября.`;
}

export async function primaryBlackoutPreview(sql) {
  const candidates = (await sql`
    SELECT id,chat_id,first_name,last_name,username,city,status,slot_id,interview_at,
           reminded_30m,no_show_followup_sent,updated_at
    FROM candidates
    WHERE (interview_at AT TIME ZONE 'Europe/Moscow')::date
          IN ('2026-09-18'::date,'2026-09-19'::date)
    ORDER BY interview_at,id
  `).rows;
  const tasks = (await sql`
    SELECT id,state,due_at,payload
    FROM funnel_tasks
    WHERE kind='primary_session'
      AND (payload->>'at')::timestamptz IN (
        SELECT DISTINCT interview_at FROM candidates
        WHERE (interview_at AT TIME ZONE 'Europe/Moscow')::date
              IN ('2026-09-18'::date,'2026-09-19'::date)
      )
    ORDER BY due_at,id
  `).rows;
  return { candidates, tasks, readAt: new Date().toISOString() };
}

export function renderPrimaryBlackoutPreview(data) {
  const lines = [
    '🔎 <b>READ-ONLY: первичные собеседования 18–19.09.2026</b>',
    `Прочитано: ${esc(data.readAt)}`,
    `Кандидатов: <b>${data.candidates.length}</b>`,
    `Связанных задач: <b>${data.tasks.length}</b>`,
  ];
  for (const candidate of data.candidates) {
    const { day, time } = moscowParts(candidate.interview_at);
    const fullName = [candidate.first_name, candidate.last_name].filter(Boolean).join(' ') || `Кандидат ${candidate.id}`;
    lines.push('', `<b>${esc(fullName)}</b> · ID ${candidate.id}`, `${esc(day)} · ${esc(time)} МСК · ${esc(candidate.slot_id)}`, `Статус: ${esc(candidate.status)} · reminded_30m=${Boolean(candidate.reminded_30m)} · no_show=${Boolean(candidate.no_show_followup_sent)}`, candidate.username ? `Telegram: @${esc(candidate.username)}` : 'Telegram: username отсутствует', '', '<b>Точный текст:</b>', esc(candidateBlackoutMessage(candidate)));
  }
  lines.push('', '⚠️ Это только чтение. Даты, записи, статусы, задачи и сообщения не изменены.');
  return lines.join('\n');
}
