# INTERVIEW-AUTOMATION-049

Authorization: user confirmed bridge048 update and requested activation. Baseline production db8188316468a19fc5fb9af71153e29686467123. Remote rollback/interview-automation-before-049 preserves baseline.

Scope: activate Q1/Q2-only interview sheets, separate contacts/Russian experience, new Final and extra-Q2 tabs, event-based appointment fields from DB, stage durations. Preserve candidate data/statuses/messages/group membership/booking capacity/reminders/Test1 exporter/manual interview answers. Existing files must not be replaced.

Before production: bridge capabilities, fixture regressions, preview, single-candidate document check. Temporary release-check049 is keyed, expires, returns capabilities only; remove before final release. No mass messages.

Current state: prepared, waiting for corrected bridge publication, not activated.

Live bridge048 confirmed ok/interviewSheet048/appointment048, but no timeline049. Actual single-candidate94 appointment call failed safely with «Неизвестная структура бланка»: old B9 label is «Дата проведения», rather than «Дата интервью». No document fields changed; no messages sent. Fixed both known labels in Code.gs without changing the sheet's labels.

Code.gs now supports timeline049, copies only missing timeline tab into an existing interview, preserves other tabs, manual dates/formulas and notes, clears only automatic planned appointment on cancellation. readInterviewTimeline reads timestamps for one candidate; no test answers. Creation/invitation/booking/cancellation/manual productivity-result events queue an addressable sync. New result timestamps have a dedicated RLS-enabled table; historical result dates are not invented. End remains undefined. 24 local tests pass including a real PostgreSQL-compatible fixture for timeline and booking, bridge repeat/manual preservation, legacy label.

Cloud bridge still048; updated source must be pasted and published once by user. Server flag INTERVIEW_APPOINTMENT_048 remains OFF. After cloud timeline049 confirmed: test candidate94, deploy preview, verify one new clean-template creation without candidate messages, remove temporary checker, activate server and flag, then verify production and record commit. Never claim full automation before this. Existing 25 sheets must not be recreated. Rollback branch already pushed. Release preparation itself needs no production rollback.
