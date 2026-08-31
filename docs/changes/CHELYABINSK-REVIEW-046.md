# CHELYABINSK-REVIEW-046

User correction before launch: both Change time and Cancel booking enabled for this Chelyabinsk session. Cancellation is NOT withdrawal: free only selected booking, archive details in exact review_booking_cancelled task, status returns productivity_invited, confirmation+updated635 summary, old reminder becomes no-op. Other candidates see refreshed availability. Slot moves remain atomic; obsolete cancellation button cannot cancel a newer version. This supersedes the no-reschedule requirement below. Minsk remains unchanged.

Baseline537e642; rollback/chelyabinsk-review-before-046 pushed before edits.

Authorized: invite current consenting Chelyabinsk Test1-completed candidates waiting for productivity to Sep1 2026 online meeting. Eight slots14:00..16:20 MSK every20min, capacity1; last ends16:40. Cutoff60min preserved. Zoom supplied by user. Goals/PDF preserved. Candidate-equivalent safe sample, campaign results, booking briefs, summaries, minus30 notices in staff topic635. Minsk remains619. No candidate test bookings.

Preserve: primaryZoom, Minsk calendar/content, existing statuses/answers/Drive, manual productivity decisions, protected45, closed/declined/advanced excluded, deadlines043, other UI/functions. No periodic scans. Current recipient snapshot frozen before delivery; reuse existing event campaign/task engine. No reschedule button for this online session; server rejects old slot changes for it.

Checks:8slots/timezone/capacity; recipient city/consent/completion/current-stage; test buttons no booking; Zoom+Goals/PDF; correct635 routing of session messages; confirmation/reminder tasks; no duplicates. Tests then preview then production; verify API delivery/history and remove temporary scoped setup endpoint.

Rollback: deactivate only session with config.campaignKey=chelyabinsk-review-046, stop its pending invitations/reminders; revert046 commits together. Retain delivery/effect/bookings history; never undo already sent messages or candidate decisions blindly. Old Minsk/primary tasks untouched.
