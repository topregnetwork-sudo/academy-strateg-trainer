import { sql } from '../api/_core.js';
import { removeFromCandidateGroup } from './candidate-group-removal-078.js';

const declineRe = /\b(?:не\s*актуальн|отмена|отказ|не\s*интересно|нет,\s*спасибо)\b/iu;
const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;

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
    SELECT c.*,q.submitted_at AS q2_submitted_at,t.submitted_at AS test_submitted_at,t.status AS test_status
    FROM candidates c
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
      if ((out && dueAfter(out.created_at)) || (!out && dueAfter(candidate.updated_at))) {
        if (apply) await move(candidate, 'reserve_no_response', 'new_no_response_083');
        result.newClosed++;
      } else if (!out) result.primaryAttention++;
      else result.keptFresh++;
      continue;
    }

    if (candidate.status === 'interview_booked') {
      const out = await latestOutgoing(candidate.id, ['no_show_followup']);
      if (out && dueAfter(out.created_at)) {
        if (apply) await move(candidate, 'reserve_no_response', 'primary_attention_closed_083');
        result.primaryClosed++;
      } else if (incoming && dueAfter(incoming.created_at) && candidate.interview_at && new Date(candidate.interview_at) < new Date()) {
        if (apply) await move(candidate, 'reserve_no_response', 'primary_old_attention_closed_083');
        result.primaryClosed++;
      } else if (out && incoming && new Date(incoming.created_at) > new Date(out.created_at)) {
        result.primaryAttention++;
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
      if ((out && dueAfter(out.created_at)) || (!out && dueAfter(candidate.updated_at))) {
        if (apply) {
          const closed = await closeGroupCandidate(candidate, `${kind}_no_response_083`);
          if (!closed.removal.removed && closed.removal.reason !== 'already_outside') result.removalsAttention++;
        }
        if (kind === 'q2') result.q2Closed++; else result.test1Closed++;
      } else if (!out) result.dataAttention++;
      else result.keptFresh++;
    }
  }
  result.samples = samples.slice(0, 25);
  return result;
}
