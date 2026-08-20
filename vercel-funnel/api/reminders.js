import { init, json, telegram, sql } from './_core.js';

const reminderText = '⏰ Напоминаем: ваше собеседование с Академией Стратег начнётся примерно через 30 минут. Пожалуйста, проверьте связь и подготовьтесь к встрече.';

export default async function handler(req, res) {
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return json(res, 401, { error: 'Unauthorized' });
  }

  try {
    await init();
    const due = (await sql`
      UPDATE candidates
      SET reminded_30m=true,updated_at=NOW()
      WHERE id IN (
        SELECT id FROM candidates
        WHERE status='interview_booked'
          AND consent=true
          AND reminded_30m=false
          AND interview_at BETWEEN NOW() + INTERVAL '20 minutes' AND NOW() + INTERVAL '40 minutes'
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `).rows;

    let sent = 0;
    let failed = 0;
    for (const candidate of due) {
      try {
        const messageId = await telegram(candidate.chat_id, reminderText);
        await sql`
          INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id)
          VALUES(${candidate.id},'out','text',${reminderText},'delivered',${String(messageId || '')})
        `;
        sent++;
      } catch (error) {
        await sql`UPDATE candidates SET reminded_30m=false,updated_at=NOW() WHERE id=${candidate.id}`;
        failed++;
        console.error('[reminders] candidate failed', { candidateId: candidate.id, message: String(error) });
      }
    }

    return json(res, 200, { ok: true, due: due.length, sent, failed });
  } catch (error) {
    console.error('[reminders] run failed', { message: String(error) });
    return json(res, 500, { error: 'Reminder failed' });
  }
}
