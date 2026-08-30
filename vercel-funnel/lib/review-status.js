// A persisted journal event updates its projection in the SAME database transaction.
// No timers, messages, or candidate scans in normal operation.
export async function installReviewStatus(sql){
  await sql`CREATE OR REPLACE FUNCTION project_review_stage040() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
  DECLARE target text;
  BEGIN
    IF TG_TABLE_NAME='offline_interview_bookings' AND NEW.status='booked' THEN target:='productivity_booked';
    ELSIF TG_TABLE_NAME='offline_interview_invites' AND NEW.status IN ('sent','booked') AND NEW.telegram_message_id IS NOT NULL THEN
      IF EXISTS(SELECT 1 FROM offline_interview_bookings WHERE candidate_id=NEW.candidate_id AND status='booked') THEN target:='productivity_booked'; ELSE target:='productivity_invited'; END IF;
    ELSE RETURN NEW; END IF;
    UPDATE candidates SET status=target,updated_at=NOW() WHERE id=NEW.candidate_id AND consent=true AND (status='test_1_completed' OR (status='productivity_invited' AND target='productivity_booked'));
    RETURN NEW;
  END $$`;
  await sql`DO $$ BEGIN
    IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='review_invite_stage040') THEN CREATE TRIGGER review_invite_stage040 AFTER INSERT OR UPDATE ON offline_interview_invites FOR EACH ROW EXECUTE FUNCTION project_review_stage040(); END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='review_booking_stage040') THEN CREATE TRIGGER review_booking_stage040 AFTER INSERT OR UPDATE ON offline_interview_bookings FOR EACH ROW EXECUTE FUNCTION project_review_stage040(); END IF;
  END $$`;
}

export async function reconcileReviewStatus(sql,transaction,apply=false){
  // Called only by the single-use maintenance operation, not on panel load.
  const read=tx=>tx`SELECT c.id,c.status AS old_status,CASE WHEN EXISTS(SELECT 1 FROM offline_interview_bookings b WHERE b.candidate_id=c.id AND b.status='booked') OR EXISTS(SELECT 1 FROM funnel_bookings b JOIN funnel_sessions s ON s.id=b.session_id WHERE b.candidate_id=c.id AND s.active) THEN 'productivity_booked' ELSE 'productivity_invited' END AS target
    FROM candidates c WHERE c.consent=true AND c.status IN ('test_1_completed','productivity_invited') AND (
      EXISTS(SELECT 1 FROM offline_interview_bookings b WHERE b.candidate_id=c.id AND b.status='booked') OR
      EXISTS(SELECT 1 FROM offline_interview_invites i WHERE i.candidate_id=c.id AND i.status IN ('sent','booked') AND i.telegram_message_id IS NOT NULL) OR
      EXISTS(SELECT 1 FROM funnel_bookings b JOIN funnel_sessions s ON s.id=b.session_id WHERE b.candidate_id=c.id AND s.active) OR
      EXISTS(SELECT 1 FROM funnel_recipients r JOIN funnel_jobs j ON j.id=r.job_id WHERE r.candidate_id=c.id AND r.state='sent' AND j.config->>'action' IN ('invite','test_passed'))
    ) ORDER BY c.id`;
  const before=(await read(sql)).rows.filter(r=>r.old_status!==r.target);
  if(!apply)return {mismatches:before};
  await sql`CREATE TABLE IF NOT EXISTS review_status_repair040(candidate_id bigint PRIMARY KEY,old_status text,new_status text,changed_at timestamptz)`;
  await sql`ALTER TABLE review_status_repair040 ENABLE ROW LEVEL SECURITY`;
  const changed=await transaction(async tx=>{
    const changes=[];
    for(const r of (await read(tx)).rows.filter(r=>r.old_status!==r.target)){
      const updated=(await tx`UPDATE candidates SET status=${r.target},updated_at=NOW() WHERE id=${r.id} AND status=${r.old_status} AND consent=true RETURNING updated_at`).rows[0];
      if(!updated)continue;
      await tx`INSERT INTO review_status_repair040(candidate_id,old_status,new_status,changed_at) VALUES(${r.id},${r.old_status},${r.target},${updated.updated_at}) ON CONFLICT DO NOTHING`;
      changes.push(r);
    }return changes;
  });
  return {changed,remaining:(await read(sql)).rows.filter(r=>r.old_status!==r.target)};
}

// Explicit user decision for the historical cohort; never inferred from mere attendance.
export async function reconcileFailedCohort(sql,transaction,apply=false){
  const read=tx=>tx`SELECT c.id,c.status AS old_status,'productivity_failed'::text AS target FROM candidates c WHERE c.id<>45 AND LOWER(TRIM(c.city))='минск'
    AND c.status IN ('test_1_completed','productivity_invited','productivity_booked','selection_closed','academy_contact','rejected','cancelled')
    AND EXISTS(SELECT 1 FROM offline_interview_bookings b WHERE b.candidate_id=c.id AND b.event_date BETWEEN '2026-08-28'::date AND '2026-08-29'::date)
    AND EXISTS(SELECT 1 FROM messages m WHERE m.candidate_id=c.id AND m.kind='offline_outcome_invite_20260829' AND m.direction='out' AND m.delivery_status='delivered') ORDER BY c.id`;
  if(!apply)return {mismatches:(await read(sql)).rows};
  await sql`CREATE TABLE IF NOT EXISTS review_status_repair040(candidate_id bigint PRIMARY KEY,old_status text,new_status text,changed_at timestamptz)`;
  await sql`ALTER TABLE review_status_repair040 ENABLE ROW LEVEL SECURITY`;
  const changed=await transaction(async tx=>{
    const changes=[];for(const r of (await read(tx)).rows){
      const updated=(await tx`UPDATE candidates SET status='productivity_failed',updated_at=NOW() WHERE id=${r.id} AND status=${r.old_status} RETURNING updated_at`).rows[0];if(!updated)continue;
      await tx`INSERT INTO review_status_repair040(candidate_id,old_status,new_status,changed_at) VALUES(${r.id},${r.old_status},'productivity_failed',${updated.updated_at}) ON CONFLICT DO NOTHING`;changes.push(r);
    }return changes;
  });return {changed,remaining:(await read(sql)).rows};
}
