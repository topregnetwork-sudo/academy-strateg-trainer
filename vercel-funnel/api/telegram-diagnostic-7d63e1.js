import { init, json, sql, telegram, telegramApi } from './_core.js';

const DIAGNOSTIC_KEY = '0d91b6f4-45a8-4f2c-9f74-2b6a11554a62-24aug';

function errorMessage(error) {
  return String(error?.message || error || 'unknown error').slice(0, 500);
}

export default async function handler(req, res) {
  if (req.headers['x-diagnostic-key'] !== DIAGNOSTIC_KEY) return json(res, 404, { error: 'Not found' });

  const report = { checkedAt: new Date().toISOString() };
  let bot;
  try {
    bot = await telegramApi('getMe');
    const webhook = await telegramApi('getWebhookInfo');
    report.bot = { id: bot.id, username: bot.username, canJoinGroups: bot.can_join_groups, supportsInlineQueries: bot.supports_inline_queries };
    report.webhook = {
      url: webhook.url,
      pendingUpdateCount: webhook.pending_update_count,
      lastErrorDate: webhook.last_error_date || null,
      lastErrorMessage: webhook.last_error_message || null,
      maxConnections: webhook.max_connections,
      allowedUpdates: webhook.allowed_updates || []
    };
  } catch (error) {
    report.telegramError = errorMessage(error);
  }

  let destination;
  try {
    await init();
    const settings = await sql`SELECT key,value,updated_at FROM app_settings WHERE key IN ('hr_brief_chat_id','hr_brief_thread_id') ORDER BY key`;
    const values = Object.fromEntries(settings.rows.map(row => [row.key, row.value]));
    const chatId = values.hr_brief_chat_id || process.env.HR_BRIEF_CHAT_ID || '';
    const threadId = values.hr_brief_thread_id || '';
    destination = chatId ? { chatId: String(chatId), threadId: String(threadId) } : null;
    const candidates = await sql`SELECT COUNT(*)::int AS count FROM candidates WHERE interview_at IS NOT NULL`;
    const deliveries = await sql`SELECT COUNT(*)::int AS count FROM hr_brief_deliveries`;
    report.database = {
      settings: settings.rows.map(row => ({ key: row.key, value: row.value, updatedAt: row.updated_at })),
      interviewCandidateCount: candidates.rows[0]?.count || 0,
      deliveryCount: deliveries.rows[0]?.count || 0
    };
  } catch (error) {
    report.databaseError = errorMessage(error);
  }

  if (destination) {
    try {
      const chat = await telegramApi('getChat', { chat_id: destination.chatId });
      report.chat = { id: chat.id, title: chat.title, type: chat.type, isForum: chat.is_forum === true, threadId: destination.threadId || null };
      if (bot?.id) {
        const membership = await telegramApi('getChatMember', { chat_id: destination.chatId, user_id: bot.id });
        report.botMembership = {
          status: membership.status,
          canPostMessages: membership.can_post_messages ?? null,
          canManageTopics: membership.can_manage_topics ?? null
        };
      }
    } catch (error) {
      report.chatError = errorMessage(error);
    }
  }

  if (req.query?.send === '1') {
    if (!destination?.chatId || !destination?.threadId) report.testDelivery = { ok: false, error: 'Topic destination is not saved' };
    else {
      try {
        const messageId = await telegram(destination.chatId, '🧪 Служебная проверка: тема «Тренеры собеседования» принимает уведомления бота.', { message_thread_id: Number(destination.threadId) });
        report.testDelivery = { ok: true, messageId };
      } catch (error) {
        report.testDelivery = { ok: false, error: errorMessage(error) };
      }
    }
  }

  return json(res, 200, report);
}
