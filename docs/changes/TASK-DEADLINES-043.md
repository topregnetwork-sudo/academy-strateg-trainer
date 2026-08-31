# TASK-DEADLINES-043

Baseline eb19c40; rollback/task-deadlines-before-043.
Scope: new post-primary cohort starting 2026-08-31 08:00 Moscow; first qualified entry no earlier than07:45 that day, first Questionnaire2 issuance no earlier than that. Old candidates never enrolled retroactively.
Successful issuance of Questionnaire2 or Test1 creates ONE exact +72h task for that candidate and stage. Repeat issuance cannot extend deadline. No warning/reminder, no recurring all-candidate scan. Completed stage/advanced/manual outcome is protected. Productivity invitation/booking has no inactivity timer and stays under operator control.
Deadline: reread only that candidate, completion and membership, send approved farewell (correct missing task), remove, mark existing test_1_incomplete_removed, staff report topic30; service cleanup existing webhook. Preserve answers/history. Nadezhda45/internal30/admins protected. Unanswered message or technical/scheduling error => staff attention, no blind removal.
No change to initial Zoom reminders, booking slots, bot keyword, website, invitations already approved, or042 cohort.
Tests: +72h, no repeat extension, old cohort excluded, completed protected, sequential closure, idempotency, task errors. Runtime actual deadline remains future; never claim live delayed execution has already happened.
Rollback: revert043 code, disable/cancel pending tasks kind stage_deadline043, preserve ledger/messages/candidate data. Do not undo042.
