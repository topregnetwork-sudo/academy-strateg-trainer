# PRIMARY-FOLLOWUP-039

Baseline aa369a6; rollback/primary-followup-before-039 pushed before edits.

Only event PRIMARY.NO_ENTRY_FOLLOWUP changes: +60 minutes from scheduled start, no click for this appointment, still booked/consenting, not already notified. Keywords and group membership are not absence criteria. Preserve message, reschedule/decline buttons, all-city reminders/briefs at minus30, first-ever click duration, applications/tests/manual decisions and visual layout.

Add per-appointment click evidence without overwriting first-ever click. Reschedule only existing future no-show tasks, same IDs, no historical sends. Verify repeated dispatch, click/no keyword, other session click, other city, rescheduled date, cancellation, late click, transient persistence failure. Record deployment and exact rollback after verification.
# Latest scope

Qualified click window: appointment minus15 to plus60 minutes, server time. Early/late clicks still expose URL but never record qualified entry or grant access. Historical raw clicks preserved; access/duration/counts filter by window. Manual stage selector moved before long evidence, inline save/error feedback; server already accepts both productivity statuses. No live candidate statuses changed.
# Verification / release

2026-08-30: 23 regression tests passed (mock Telegram / real local PGlite SQL). Additional UI assertions verify candidate45 manual PATCH success, failure recovery, no other request. Preview build success, production 5c3c02a assets039 HTTP200. Exactly five existing future no-entry tasks rearmed to +60 on Aug31/Sep1/Sep2/Sep3/Sep4; scheduler accepted all. Existing minus30 tasks untouched. No messages/statuses/group members changed during release. Temporary migration route removed after use.

Limitations: actual future delivery not yet observed; no authenticated visual browser run. Testing validated DOM and simulated saving, not a real change to Nadezhda. Cloudflare static mirrors updated in source only; main Vercel production is the published panel.

Rollback: baseline rollback/primary-followup-before-039. Revert ALL 039 code + cleanup commits together locally and push only the final result; never expose intermediate maintenance endpoint. Preserve click evidence tables, messages and candidates. Five persisted no-entry task due times are external state: restoring old +90 requires targeted rearming of those future IDs separately, not deleting/recreating candidates or tasks. No messages can be unsent by git rollback.
