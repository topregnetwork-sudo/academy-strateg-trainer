# STALE-FUNNEL-FOLLOWUPS-081

## Preservation contract

- Baseline: `243797357d9c117c7852ab9a835f83838fbde12f`.
- Rollback branch: `rollback/stale-funnel-followups-before-081`.
- Scope: trainer funnel only.
- Requested behaviour:
  1. remove the visible board column `Ждёт продуктивность` and keep future invitations in the productivity booking column;
  2. move the current `productivity_invited` backlog to the existing reserve offer route, with the approved personal reserve message;
  3. repair old `productivity_failed` candidates missing that offer and its three-day response control;
  4. for a new application, Questionnaire 2 and Test 1: send one personal reminder after three days, then move an inactive candidate to an existing inactive/refused status after another three days;
  5. do not close a candidate who has sent a human message after the reminder; mark that route for attention instead.
- Preserved: primary Zoom mechanics, candidate group, personal links, tests, Drive, schedule, current productivity bookings, candidate data, existing messages, and no unrelated funnel changes.
- Planned one-time reconciliation: only the exact audit cohorts are addressed; every delivery and status change is idempotently recorded.
- Verification: dry-run counts, focused tests, preview, production route check, then one live reconciliation report with exact delivered/skipped/closed counts.
- Rollback: revert only the implementation commit and publish; delivered Telegram messages and live status changes are not undone automatically.
