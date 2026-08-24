import { createHash, timingSafeEqual } from 'node:crypto';
import { body, init, json, telegram, telegramApi, sql } from './_core.js';

const EXPECTED_KEY_HASH = '43b58a75612d7b30c584352d82fad62245603b5b4628787b2ae6d64f4b6725c2';
const updateText = '🔗 <b>Ссылка Zoom для вашего собеседования обновлена.</b>\n\nИспользуйте кнопку ниже.';

function authorized(req) {
  const supplied = String(req.headers['x-zoom-update-key'] || '');
  const actual = createHash('sha256').update(supplied).digest();
  const expected = Buffer.from(EXPECTED_KEY_HASH, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function validZoomUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'zoom.us' || url.hostname.endsWith('.zoom.us')) && url.pathname.startsWith('/j/');
  } catch {
    return false;
  }
}

async function sendFallback(candidate, zoomUrl) {
  const existing = await sql`SELECT 1 FROM messages WHERE candidate_id=${candidate.id} AND direction='out' AND kind='zoom_update' AND text=${updateText} LIMIT 1`;
  if (existing.rows.length) return 'skipped';
  const messageId = await telegram(candidate.chat_id, updateText, { reply_markup: { inline_keyboard: [[{ text: 'Открыть Zoom', url: zoomUrl }]] } });
  await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id) VALUES(${candidate.id},'out','zoom_update',${updateText},'delivered',${String(messageId || '')})`;
  return 'sent';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false });
  if (!authorized(req)) return json(res, 404, { ok: false });

  try {
    const payload = await body(req);
    const zoomUrl = String(payload.zoom_url || '').trim();
    if (!validZoomUrl(zoomUrl)) return json(res, 400, { ok: false, error: 'invalid_zoom_url' });

    await init();
    await sql`INSERT INTO app_settings(key,value,updated_at) VALUES('zoom_meeting_url',${zoomUrl},NOW()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`;

    const candidates = await sql`
      SELECT c.id,c.chat_id,
        (SELECT m.telegram_message_id FROM messages m
         WHERE m.candidate_id=c.id
           AND m.direction='out'
           AND m.telegram_message_id IS NOT NULL
           AND m.text LIKE '✅ <b>Вы записаны на собеседование</b>%'
         ORDER BY m.created_at DESC LIMIT 1) AS telegram_message_id
      FROM candidates c
      WHERE c.status='interview_booked' AND c.interview_at>NOW()
      ORDER BY c.interview_at,c.id
    `;

    let edited = 0;
    let notified = 0;
    let skipped = 0;
    let failed = 0;
    for (const candidate of candidates.rows) {
      try {
        if (candidate.telegram_message_id) {
          try {
            await telegramApi('editMessageReplyMarkup', {
              chat_id: candidate.chat_id,
              message_id: Number(candidate.telegram_message_id),
              reply_markup: { inline_keyboard: [[{ text: 'Открыть Zoom', url: zoomUrl }]] }
            });
            edited += 1;
            continue;
          } catch (error) {
            console.error('[zoom] existing button edit failed; sending update', { candidateId: candidate.id, message: String(error) });
          }
        }
        const fallback = await sendFallback(candidate, zoomUrl);
        if (fallback === 'sent') notified += 1;
        else skipped += 1;
      } catch (error) {
        failed += 1;
        console.error('[zoom] candidate update failed', { candidateId: candidate.id, message: String(error) });
      }
    }

    return json(res, 200, { ok: true, configured: true, upcoming: candidates.rows.length, edited, notified, skipped, failed });
  } catch (error) {
    console.error('[zoom] one-time link update failed', { message: String(error), stack: error?.stack });
    return json(res, 500, { ok: false, error: 'zoom_update_failed' });
  }
}
