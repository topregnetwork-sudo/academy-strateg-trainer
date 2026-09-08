import { init, json, sql, telegramApi } from './_core.js';
import { initFunnel } from '../lib/funnel-store.js';
import { ensureBriefDeliveryStore, summarizeDeliveryStates, sanitizeWebhookInfo } from '../lib/brief-delivery.js';

const MAX_DAYS = 14;
const VERSION = 'telegram-diagnostic-1';

function moscowDate(value) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}

function addWarning(warnings, value) {
  if (value && !warnings.includes(value)) warnings.push(value);
}

async function telegramHealth() {
  if (!process.env.TELEGRAM_BOT_TOKEN) return { api: 'not_configured', hasWebhook: false, pendingUpdateCount: null, hasLastError: null, lastErrorDate: null };
  try {
    return sanitizeWebhookInfo(await telegramApi('getWebhookInfo'));
  } catch (error) {
    return { api: 'error', hasWebhook: null, pendingUpdateCount: null, hasLastError: true, lastErrorDate: null, errorClass: error?.definite ? 'telegram_api_rejected' : 'network_or_timeout' };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  res.setHeader?.('Cache-Control', 'no-store');
  res.setHeader?.('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader?.('X-Hermes-Diagnostic-Version', VERSION);
  try {
    await init();
    await initFunnel();
    await ensureBriefDeliveryStore(sql);
    await sql`CREATE TABLE IF NOT EXISTS telegram_update_events050(update_id BIGINT PRIMARY KEY,state TEXT NOT NULL DEFAULT 'processing',kind TEXT,chat_id TEXT,error TEXT,attempts INT NOT NULL DEFAULT 1,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
    const [deliveries, hrDeliveries, messages, updates, tasks, sessions, telegram] = await Promise.all([
      sql`SELECT state,attempt_count,last_attempt_at,last_error,interview_at,slot_id,telegram_message_id FROM interview_brief_deliveries WHERE interview_at >= NOW()-INTERVAL '7 days' AND interview_at <= NOW()+INTERVAL '14 days' ORDER BY interview_at`,
      sql`SELECT state,attempt_count,last_attempt_at,last_error,telegram_message_id FROM hr_brief_deliveries WHERE updated_at >= NOW()-INTERVAL '7 days'`,
      sql`SELECT direction,delivery_status,count(*)::int AS count FROM messages WHERE created_at >= NOW()-INTERVAL '7 days' GROUP BY direction,delivery_status`,
      sql`SELECT state,error_class,stale,count(*)::int AS count FROM (SELECT state,CASE WHEN error IS NULL THEN 'none' WHEN LOWER(error) LIKE '%timeout%' OR LOWER(error) LIKE '%timed out%' THEN 'timeout' WHEN LOWER(error) LIKE '%forbidden%' OR LOWER(error) LIKE '%unauthorized%' OR LOWER(error) LIKE '%bad request%' THEN 'telegram_rejected' WHEN LOWER(error) LIKE '%database%' OR LOWER(error) LIKE '%column%' OR LOWER(error) LIKE '%relation%' THEN 'database' ELSE 'other' END AS error_class,(state='processing' AND updated_at<NOW()-INTERVAL '2 minutes') AS stale FROM telegram_update_events050 WHERE created_at >= NOW()-INTERVAL '7 days') events GROUP BY state,error_class,stale`,
      sql`SELECT kind,state,count(*)::int AS count FROM funnel_tasks WHERE updated_at >= NOW()-INTERVAL '7 days' GROUP BY kind,state`,
      sql`SELECT interview_at,slot_id,count(*)::int AS participant_count FROM candidates WHERE status='interview_booked' AND consent=true AND interview_at > NOW()-INTERVAL '1 hour' AND interview_at <= NOW()+INTERVAL '14 days' GROUP BY interview_at,slot_id ORDER BY interview_at LIMIT 50`,
      telegramHealth()
    ]);

    const now = new Date();
    const brief = summarizeDeliveryStates(deliveries.rows, now);
    const hr = summarizeDeliveryStates(hrDeliveries.rows, now);
    const bySession = new Map();
    for (const row of deliveries.rows) {
      const key = `${new Date(row.interview_at).toISOString()}|${row.slot_id}`;
      const current = bySession.get(key) || [];
      current.push(row);
      bySession.set(key, current);
    }
    let dueSessions = 0;
    let dueWithoutRecord = 0;
    const upcomingSessions = sessions.rows.map(session => {
      const at = new Date(session.interview_at);
      const minutes = Math.round((at.getTime() - now.getTime()) / 60000);
      const rows = bySession.get(`${at.toISOString()}|${session.slot_id}`) || [];
      const state = rows.some(row => row.state === 'sent') ? 'sent' : (rows[0]?.state || 'not_scheduled');
      const due = minutes >= 20 && minutes <= 40;
      if (due) {
        dueSessions += 1;
        if (!rows.length) dueWithoutRecord += 1;
      }
      return { date_msk: moscowDate(at), slot_id: session.slot_id, participants: session.participant_count, state, due_window: due };
    }).slice(0, 20);

    const messageStatus = {};
    for (const row of messages.rows) messageStatus[`${row.direction}:${row.delivery_status}`] = row.count;
    const updateStatus = {};
    const updateErrors = {};
    let staleProcessing = 0;
    for (const row of updates.rows) {
      updateStatus[row.state] = Number(updateStatus[row.state] || 0) + Number(row.count || 0);
      if (row.error_class !== 'none') updateErrors[row.error_class] = Number(updateErrors[row.error_class] || 0) + Number(row.count || 0);
      if (row.stale) staleProcessing += Number(row.count || 0);
    }
    const taskStatus = {};
    for (const row of tasks.rows) taskStatus[`${row.kind}:${row.state}`] = row.count;
    const warnings = [];
    if (brief.counts.attention || brief.counts.uncertain || brief.counts.stale_sending) addWarning(warnings, 'Есть брифы, требующие внимания или проверки результата Telegram.');
    if (dueWithoutRecord) addWarning(warnings, `В окне отправки нет записи очереди для ${dueWithoutRecord} встречи(встреч).`);
    if (telegram.api !== 'ok') addWarning(warnings, 'Telegram API не подтвердил состояние webhook.');
    if (telegram.hasLastError) addWarning(warnings, 'Telegram сообщает о последней ошибке webhook.');
    if (updateStatus.attention || staleProcessing) addWarning(warnings, 'Есть необработанные или зависшие Telegram updates.');
    if (Object.entries(taskStatus).some(([key, count]) => /:attention$/.test(key) && count)) addWarning(warnings, 'Есть фоновые задачи в состоянии attention.');

    return json(res, 200, {
      ok: true,
      version: VERSION,
      generated_at: now.toISOString(),
      mode: 'aggregate_read_only',
      privacy: 'Без имён, текстов, chat_id, thread_id, candidate_id и telegram_message_id.',
      window: { past_days: 7, future_days: MAX_DAYS },
      telegram,
      interview_brief: { ...brief, due_sessions: dueSessions, due_without_record: dueWithoutRecord, upcoming_sessions: upcomingSessions },
      trainer_topic_brief: hr,
      message_status_7d: messageStatus,
      telegram_updates_7d: { states: updateStatus, error_classes: updateErrors, stale_processing_upper_bound: staleProcessing },
      funnel_tasks_7d: taskStatus,
      warnings
    });
  } catch (error) {
    console.error('[telegram-diagnostic] failed', { message: String(error?.message || error) });
    return json(res, 503, { ok: false, version: VERSION, error: 'Диагностика временно недоступна' });
  }
}
