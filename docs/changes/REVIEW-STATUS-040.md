# REVIEW-STATUS-040

Baseline86af60a; rollback/review-status-before-040. Fix event-to-status projection, not messages or meeting configuration. Legacy confirmed invitation -> productivity_invited, persisted booked slot -> productivity_booked. Booking wins over invitation; only unfinished pre-review stages advance. Preserve manual outcomes, finalist/Nadezhda45, rejected/declined/hired, all cities, click window039, reminder/brief timing, text/links/UI. No resend.

Install transactional database triggers on legacy invitation/booking journals so event persistence and stage update cannot split. Repair existing confirmed records once with per-candidate before/after snapshot. Never mark attendance/pass from booking. Audit adjacent event status assignments and guard repeat events against regressing manual outcomes. Validate trigger transitions and replay with local SQL tests, existing regression suite, production repair counts and zero remaining repairable mismatches.
