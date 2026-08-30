-- Use ONLY after reverting all040 code commits together, including cleanup.
-- Restores only repaired rows that have not been changed again since repair.
BEGIN;
DROP TRIGGER IF EXISTS review_invite_stage040 ON offline_interview_invites;
DROP TRIGGER IF EXISTS review_booking_stage040 ON offline_interview_bookings;
DROP FUNCTION IF EXISTS project_review_stage040();
UPDATE candidates c SET status=r.old_status,updated_at=NOW()
FROM review_status_repair040 r
WHERE c.id=r.candidate_id AND c.status=r.new_status AND c.updated_at=r.changed_at;
COMMIT;
-- Keep snapshot table and event journals for audit. Do not delete any messages.
