import { telegram, sql } from '../api/_core.js';
import { removeFromCandidateGroup } from './candidate-group-removal-078.js';
import { createTask, effect } from './funnel-store.js';
import { slots } from '../api/_core.js';
import crypto from 'node:crypto';

const declineRe = /\b(?:не\s*актуальн|отмена|отказ|не\s*интересно|нет,\s*спасибо)\b/iu;
const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;
const stableId = key => { const s = crypto.createHash('sha256').update(key).digest('hex').slice(0,32); return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`; };

async function latestIncoming(candidateId) {
  return (await sql`
    SELECT text,created_at FROM messages
    WHERE candidate_id=${Number(candidateId)} AND direction='in' AND kind<>'link_open'
    ORDER BY created_at DESC,id DESC LIMIT 1
  `).rows[0] || null;
}

async function latestOutgoing(candidateId, kinds) {
  return (await sql`
    SELECT kind,text,created_at FROM messages
    WHERE candidate_id=${Number(candidateId)} AND direction='out' AND kind=ANY(${kinds})
    ORDER BY created_at DESC,id DESC LIMIT 1
  `).rows[0] || null;
}

async function move(candidate, status, trigger) {
  const changed = (await sql`
    UPDATE candidates SET status=${status},consent=FALSE,updated_at=NOW()
    WHERE id=${candidate.id} AND status=${candidate.status}
    RETURNING id
  `).rows[0];
  if (!changed) return false;
  await sql`INSERT INTO funnel_stage_events(candidate_id,project_id,from_status,to_status,trigger,actor)
    SELECT ${candidate.id},id,${candidate.status},${status},${trigger},'system'
    FROM funnel_projects WHERE project_key='academy-trainer'`;
  return true;
}

const rebookKeyboard = () => ({ reply_markup: { inline_keyboard: Object.entries(slots).map(([slotId, title]) => [{ text: title, callback_data: `trainer_rebook_${slotId}` }]) } });
const slotKeyboard = code => ({ reply_markup: { inline_keyboard: Object.entries(slots).map(([slotId, title]) => [{ text: title, callback_data: `trainer_slot_${code}_${slotId}` }]) } });

function primaryAttentionText() {
  return `Добрый день!

Спасибо, что подождали.

Если вакансия тренера Академии Стратег для вас ещё актуальна, выберите новое удобное время первого Zoom-собеседования по кнопке ниже.

Если сейчас не актуально, напишите в ответ: не актуально.`;
}

function dataAttentionText(kind) {
  return kind === 'q2'
    ? `Добрый день!

Спасибо, что подождали.

Если участие в отборе тренеров Академии Стратег для вас ещё актуально, заполните Анкету 2 по персональной ссылке, которую бот присылал выше.

Если сейчас не актуально, напишите в ответ: не актуально.`
    : `Добрый день!

Спасибо, что подождали.

Если участие в отборе тренеров Академии Стратег для вас ещё актуально, завершите Тест 1 по персональной ссылке, которую бот присылал выше.

Если сейчас не актуально, напишите в ответ: не актуально.`;
}

async function sendAttention(candidate, route, text, keyboard = null) {
  const kind = `attention_${route}_084`;
  const old = await latestOutgoing(candidate.id, [kind]);
  if (old) return { sent: false, existing: true };
  const messageId = await effect(`attention-084:${route}:${candidate.id}`, () => telegram(candidate.chat_id, text, keyboard || undefined));
  await sql`INSERT INTO messages(candidate_id,direction,kind,text,delivery_status,telegram_message_id)
    VALUES(${candidate.id},'out',${kind},${text},'delivered',${String(messageId || '')})`;
  try {
    await createTask('attention_backlog_close_084', { candidateId: Number(candidate.id), route }, new Date(Date.now() + THREE_DAYS), stableId(`attention-backlog-close-084:${candidate.id}:${route}`));
  } catch (error) {
    console.error('[attention-close-084]', candidate.id, route, String(error?.message || error));
  }
  return { sent: true, messageId };
}

async function closeGroupCandidate(candidate, trigger) {
  let removal = { removed: false, reason: 'not_attempted' };
  try { removal = await removeFromCandidateGroup(candidate); }
  catch (error) { removal = { removed: false, reason: String(error?.message || error).slice(0, 160) }; }
  const status = await move(candidate, 'test_1_incomplete_removed', trigger);
  return { status, removal };
}

function dueAfter(date) {
  return date && new Date(date).getTime() + THREE_DAYS <= Date.now();
}

export async function resolveUnprocessedBacklog083(apply = false) {
  const candidates = (await sql`
    SELECT c.*,a.code AS app_code,q.submitted_at AS q2_submitted_at,t.submitted_at AS test_submitted_at,t.status AS test_status
    FROM candidates c
    LEFT JOIN LATERAL (
      SELECT code FROM applications WHERE candidate_id=c.id ORDER BY created_at DESC LIMIT 1
    ) a ON TRUE
    LEFT JOIN candidate_questionnaire_two q ON q.candidate_id=c.id
    LEFT JOIN LATERAL (
      SELECT submitted_at,status FROM candidate_tests
      WHERE candidate_id=c.id ORDER BY created_at DESC LIMIT 1
    ) t ON TRUE
    WHERE c.consent=true AND c.status IN ('new','interview_booked','questionnaire')
    ORDER BY c.id
  `).rows;
  const result = {
    explicitDeclines: 0,
    newClosed: 0,
    q2Closed: 0,
    test1Closed: 0,
    primaryClosed: 0,
    primarySent: 0,
    dataSent: 0,
    primaryAttention: 0,
    dataAttention: 0,
    keptFresh: 0,
    removalsAttention: 0,
    reviewed: candidates.length,
  };
  const samples = [];

  for (const candidate of candidates) {
    const incoming = await latestIncoming(candidate.id);
    if (incoming && declineRe.test(incoming.text || '')) {
      if (apply) {
        if (candidate.status === 'questionnaire') {
          const out = await closeGroupCandidate(candidate, 'explicit_decline_083');
          if (!out.removal.removed && out.removal.reason !== 'already_outside') result.removalsAttention++;
        } else await move(candidate, 'rejected', 'explicit_decline_083');
      }
      result.explicitDeclines++;
      samples.push({ id: candidate.id, status: candidate.status, action: 'explicit_decline', text: incoming.text });
      continue;
    }

    if (candidate.status === 'new') {
      const out = await latestOutgoing(candidate.id, ['followup081_primary_reminder']);
      const attentionOut = await latestOutgoing(candidate.id, ['attention_new_084']);
      if (attentionOut && dueAfter(attentionOut.created_at)) {
        if (apply) await move(candidate, 'reserve_no_response', 'new_attention_no_response_084');
        result.newClosed++;
        continue;
      }
      if ((out && dueAfter(out.created_at)) || (!out && dueAfter(candidate.updated_at))) {
        if (apply) await move(candidate, 'reserve_no_response', 'new_no_response_083');
        result.newClosed++;
      } else if (!out) {
        if (apply && candidate.app_code) {
          await sendAttention(candidate, 'new', primaryAttentionText(), slotKeyboard(candidate.app_code));
          result.primarySent++;
        } else {
          result.primaryAttention++;
        }
      }
      else result.keptFresh++;
      continue;
    }

    if (candidate.status === 'interview_booked') {
      const out = await latestOutgoing(candidate.id, ['no_show_followup']);
      const attentionOut = await latestOutgoing(candidate.id, ['attention_primary_084']);
      if (attentionOut && dueAfter(attentionOut.created_at)) {
        if (apply) await move(candidate, 'reserve_no_response', 'primary_attention_no_response_084');
        result.primaryClosed++;
        continue;
      }
      if (out && dueAfter(out.created_at)) {
        if (apply) await move(candidate, 'reserve_no_response', 'primary_attention_closed_083');
        result.primaryClosed++;
      } else if (incoming && dueAfter(incoming.created_at) && candidate.interview_at && new Date(candidate.interview_at) < new Date()) {
        if (apply) {
          await sql`UPDATE candidates SET no_show_followup_sent=true,updated_at=NOW() WHERE id=${candidate.id}`;
          await sendAttention(candidate, 'primary', primaryAttentionText(), rebookKeyboard());
        }
        result.primarySent++;
      } else if (out && incoming && new Date(incoming.created_at) > new Date(out.created_at)) {
        if (apply) await sendAttention(candidate, 'primary', primaryAttentionText(), rebookKeyboard());
        result.primarySent++;
      } else if (!out && candidate.interview_at && new Date(candidate.interview_at) < new Date()) {
        if (dueAfter(candidate.interview_at)) {
          if (apply) await move(candidate, 'reserve_no_response', 'primary_missed_no_followup_083');
          result.primaryClosed++;
        } else result.primaryAttention++;
      } else result.keptFresh++;
      continue;
    }

    if (candidate.status === 'questionnaire') {
      const testDone = candidate.test_submitted_at || candidate.test_status === 'completed';
      const kind = candidate.q2_submitted_at && !testDone ? 'test1' : !candidate.q2_submitted_at ? 'q2' : null;
      if (!kind) { result.keptFresh++; continue; }
      const out = await latestOutgoing(candidate.id, kind === 'q2' ? ['followup081_q2_reminder'] : ['followup081_test1_reminder']);
      const attentionOut = await latestOutgoing(candidate.id, [`attention_${kind}_084`]);
      if (attentionOut && dueAfter(attentionOut.created_at)) {
        if (apply) {
          const closed = await closeGroupCandidate(candidate, `${kind}_attention_no_response_084`);
          if (!closed.removal.removed && closed.removal.reason !== 'already_outside') result.removalsAttention++;
        }
        if (kind === 'q2') result.q2Closed++; else result.test1Closed++;
        continue;
      }
      if ((out && dueAfter(out.created_at)) || (!out && dueAfter(candidate.updated_at))) {
        if (apply) {
          const closed = await closeGroupCandidate(candidate, `${kind}_no_response_083`);
          if (!closed.removal.removed && closed.removal.reason !== 'already_outside') result.removalsAttention++;
        }
        if (kind === 'q2') result.q2Closed++; else result.test1Closed++;
      } else if (!out || (incoming && out && new Date(incoming.created_at) > new Date(out.created_at))) {
        if (apply) await sendAttention(candidate, kind, dataAttentionText(kind));
        result.dataSent++;
      }
      else result.keptFresh++;
    }
  }
  result.samples = samples.slice(0, 25);
  return result;
}

export async function runAttentionBacklogClose084(candidateId, route) {
  const candidate = (await sql`SELECT * FROM candidates WHERE id=${Number(candidateId)} LIMIT 1`).rows[0];
  if (!candidate) return { done: true, skipped: 'missing' };
  if (!['new','interview_booked','questionnaire'].includes(candidate.status)) return { done: true, skipped: 'stage_changed' };
  const out = await latestOutgoing(candidate.id, [`attention_${route}_084`]);
  const incoming = await latestIncoming(candidate.id);
  if (!out) return { done: true, skipped: 'no_attention_message' };
  if (incoming && new Date(incoming.created_at) > new Date(out.created_at)) return { done: true, skipped: 'incoming_after_message' };
  if (!dueAfter(out.created_at)) return { done: false };
  if (candidate.status === 'questionnaire') {
    const closed = await closeGroupCandidate(candidate, `${route}_attention_task_no_response_084`);
    return { done: true, closed: closed.status, removal: closed.removal };
  }
  const closed = await move(candidate, 'reserve_no_response', `${route}_attention_task_no_response_084`);
  return { done: true, closed };
}
