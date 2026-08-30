# PRIMARY-FOLLOWUP-039

Baseline aa369a6; rollback/primary-followup-before-039 pushed before edits.

Only event PRIMARY.NO_ENTRY_FOLLOWUP changes: +60 minutes from scheduled start, no click for this appointment, still booked/consenting, not already notified. Keywords and group membership are not absence criteria. Preserve message, reschedule/decline buttons, all-city reminders/briefs at minus30, first-ever click duration, applications/tests/manual decisions and visual layout.

Add per-appointment click evidence without overwriting first-ever click. Reschedule only existing future no-show tasks, same IDs, no historical sends. Verify repeated dispatch, click/no keyword, other session click, other city, rescheduled date, cancellation, late click, transient persistence failure. Record deployment and exact rollback after verification.
# Latest scope

Qualified click window: appointment minus15 to plus60 minutes, server time. Early/late clicks still expose URL but never record qualified entry or grant access. Historical raw clicks preserved; access/duration/counts filter by window. Manual stage selector moved before long evidence, inline save/error feedback; server already accepts both productivity statuses. No live candidate statuses changed.
