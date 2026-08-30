# REVIEW-STATUS-040

Baseline86af60a; rollback/review-status-before-040. Fix event-to-status projection, not messages or meeting configuration. Legacy confirmed invitation -> productivity_invited, persisted booked slot -> productivity_booked. Booking wins over invitation; only unfinished pre-review stages advance. Preserve manual outcomes, finalist/Nadezhda45, rejected/declined/hired, all cities, click window039, reminder/brief timing, text/links/UI. No resend.

Install transactional database triggers on legacy invitation/booking journals so event persistence and stage update cannot split. Repair existing confirmed records once with per-candidate before/after snapshot. Never mark attendance/pass from booking. Audit adjacent event status assignments and guard repeat events against regressing manual outcomes. Validate trigger transitions and replay with local SQL tests, existing regression suite, production repair counts and zero remaining repairable mismatches.
# Historical cohort and audit

User additionally authorized restoring productivity_failed for Minsk Aug28–29 attendees who already received delivered offline_outcome_invite_20260829. IDs verified from live journal:64,82,88,92,102,107;45 explicitly excluded. Reply evidence:4 no,1 yes,1 absent. Preserve consent, outreach choices, messages and memberships. Historical failure projection takes precedence over older booking. Run failed repair before invited/booked repair. Future Yes/No handlers retain productivity_failed while saving collaboration choice separately.

Adjacent audit found repeat group code could regress a late candidate with unfinished questionnaire; guarded to pre-questionnaire stages. Both old/new slot buttons cannot book again after productivity outcome or final decision. Test submission SQL already protects higher stages. New constructor already updates invite/book stages. Minus30/+60 and039 click gating untouched.

Rollback: revert all040 commits together before publishing (never publish the intermediate maintenance route), then execute REVIEW-STATUS-040-rollback.sql with project DB authority. Snapshot guards prevent overriding subsequent operator edits. SQL triggers are persistent DB objects: git revert alone is insufficient. Future event-generated stages remain historical facts, not globally reset.
# Production verification 2026-08-30

Implementation2371eca, cohort/UIcf7f4e3: preview success then main deployed; operator.html040 HTTP200. Live repair: failed6 [64,82,88,92,102,107]; booked6 [4,26,46,77,97,108]; invited3 [137,139,173]. Remaining repairable mismatches0. Exact old/new statuses + timestamps saved in review_status_repair040. No messages, consent or group membership changed.25 local regression tests passed, including SQL-trigger rollback, idempotency, no manual result regression and cohort exclusions. No live synthetic candidate/event/send used; no authenticated visual browser check or production log scan available. Maintenance endpoint closed in cleanup.
