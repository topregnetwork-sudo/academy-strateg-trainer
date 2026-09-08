# TELEGRAM-DIAGNOSTIC-079

## Scope

Trainer funnel only. Baseline: `0b1e9b09c876e0d1296bdf3ee579082a328b3d6d`.
Fix commit: `a12b92f`.
Rollback branch: `rollback/telegram-diagnostic-before-079`.
Production deployment: not run in this change.

## Requested result

- Hermes can read a safe aggregate diagnostic for Telegram, the interview brief,
  queue state, webhook health, incoming update processing and background tasks.
- A failed interview brief is not erased from the delivery ledger.
- A definite Telegram API rejection becomes `attention` and can be retried by a
  later scheduled run after a five-minute cooldown.
- A network timeout becomes `uncertain` and is not automatically resent, because
  Telegram may have accepted the message before the timeout.
- `sent` means Telegram API accepted the message; it does not claim recipient
  delivery or read status.

## Implementation

- `lib/brief-delivery.js` adds idempotent delivery-state columns and the guarded
  claim/success/failure transitions for `interview_brief_deliveries`.
- `api/reminders.js` keeps the queue row on failure and records the failure class.
- `api/telegram-diagnostic.js` exposes an aggregate-only GET endpoint with no
  candidate names, message text, IDs, chat IDs or thread IDs.
- `telegramApi('getWebhookInfo')` is used only for a sanitized health summary.
- `tests/telegram-diagnostic.test.js` covers stale sends, failure states and
  removal of sensitive webhook fields.

## Preserved

Candidate statuses, slots, candidate messages, existing Telegram webhook
handling, Google Drive, Calendar, operator panel, productivity outcomes,
historical messages and protected candidate 45 are unchanged. No Telegram
message was sent by this change and no delivery was replayed.

## Verification

- Targeted diagnostic tests: 2/2 passed.
- Syntax checks passed for the changed JavaScript files.
- `git diff --check` passed for the changed files.
- Full repository suite: 60 passed / 4 existing failures. The failures are the
  known Node 24 mock/schema/date-fixture issues (`candidate-progress-store`,
  `evidence-038`, `funnel-integration` historical date fixture and
  `primary-followup-039`); none was introduced by the diagnostic tests.
- Preview deployment `dpl_BJwF9FoDvqGpwqwwncSi95EKjNrs` is `READY` at
  `https://academy-strateg-trainer-g6n7bktv3-topregnetwork-sudos-projects.vercel.app`.
  Live preview readback confirmed Telegram API health, webhook state and the
  aggregate brief ledger. Hermes read-only run through the same preview endpoint
  also passed. Production deployment was not run.

## Rollback

Before release, compare the changed files with this document and use the
rollback branch `rollback/telegram-diagnostic-before-079`. If a committed
release is made, revert only the commit(s) for this change; do not delete
delivery rows or already-sent Telegram messages.
