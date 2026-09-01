# EVENT-RELIABILITY-050

Production baseline: `77aed8f`. Rollback branch: `rollback/event-reliability-before-050` (pushed before changes).

Root cause verified on candidate `@slkpwr`: Telegram messages were received and stored, but the candidate already had the manually established closed status `test_1_incomplete_removed`; the old handler returned success without a reply. Questionnaire 2 could still be submitted after closure, which produced a contradictory completion notice, while the later Test 1 command was blocked. Separately, webhook exceptions returned HTTP 200, so Telegram considered unfinished updates complete and did not retry them. Durable timer tasks stopped permanently after six attempts.

Released behavior:

- every Telegram update has a durable `update_id` ledger with `processing`, `done` or `attention`, attempt count and error;
- an unfinished update returns 503 so Telegram retries it; a completed duplicate returns 200 without repeating the action;
- incoming message history is idempotent by Telegram message id;
- Test 1 commands accept normal spelling variants (`тест`, `Тест 1`, `Тест-1`, `«ТЕСТ»`);
- Test 1 and Questionnaire 2 sends use stable effects and do not duplicate after replay;
- closed candidates are not silently reactivated: recognized commands receive an explicit closed-stage explanation;
- late Questionnaire 2/Test 1 submissions cannot advance a closed candidate;
- exact timer events retry indefinitely with bounded backoff (maximum one attempt per 30 minutes), without scanning all candidates;
- operator panel shows the latest bot event state and error for the selected candidate;
- canonical webhook registration always targets the production Vercel endpoint, never a preview/fallback hostname.

Preserved: all candidate statuses and records, approved message templates except the new closed-stage explanation, slots, Zoom links, content, Google Drive files, reminders and city routing. `@slkpwr` remains excluded and was not messaged or reactivated during this release.

Verification: 53/53 scoped regression tests passed; Vercel production deployment succeeded; primary and fallback operator assets both return the event-health marker; temporary diagnostic endpoint returns 404. Cloudflare fallback version: `cd2b7a2e-fb52-4f6b-93d0-daf6659fd92d`.

Rollback code with a clean worktree: revert commits `b9cad46` and `d17a47c`, then push `main`, or restore the tree from `rollback/event-reliability-before-050`. A rollback does not delete the append-only event ledger and does not undo candidate data. Do not reset or delete candidate records.
