# PRIMARY-BACKLOG-CLEANUP-082

Scope: trainer funnel only.

Baseline: `16e576f1d2ccbc6051d02629ffe494d466b3e64c`.

Rollback branch: `rollback/primary-backlog-cleanup-before-082`.

Requested behavior:

- Existing experienced trainers receive one delayed collaboration offer with an apology for the late reply.
- Existing ordinary new applications continue through the approved gentle follow-up rule.
- Missed primary Zoom candidates receive the existing rebooking message if no qualified Zoom entry was recorded.
- Candidates who already received a missed-primary follow-up and did not answer within three days move to `reserve_no_response`.
- If Telegram reports that the bot was blocked, the candidate moves immediately to `reserve_no_response`.
- Existing Questionnaire 2 and Test 1 follow-up records that already passed the close deadline are closed during the protected reconciliation; these closures remove the candidate from the active group.

Preserved behavior:

- First Zoom booking, reminders, rebooking buttons, candidate group entry, Questionnaire 2, Test 1, Google Drive sync, productivity interviews, productivity outcomes, reserve buttons and historical messages.
- No broad scan runs automatically without the protected operator action.

Verification:

- `node --check` passed for changed files.
- `git diff --check` passed.
- Focused tests passed except `tests/primary-followup-039.test.js`, which fails before this change because the current Node 24 runtime does not provide `mock.module`.

Rollback:

- `git revert <fix_commit> && git push origin main`.
- Do not delete delivered Telegram messages or candidate history automatically.
