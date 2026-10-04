# PRIMARY-NO-ENTRY-PLUS11-092

Date: 2026-10-04
Status: `DEPLOYED / AUTOMATED_READBACK_PASS / OWNER_PHYSICAL_T30_AND_ENTRY_PROOF_PENDING`
Baseline: `b6773c9db953f5998180d1cf5be26650865b3664`
Rollback branch: `rollback/trainer-no-entry-plus11-before-092`
Resource lock: `WRITE:trainer_no_entry_plus11_runtime_v1`

## Owner-approved outcome

For a primary Trainer Zoom scheduled at 08:00 MSK, the valid entry window includes 08:10. If no qualified click exists for that exact appointment, send the existing no-entry follow-up once at 08:11 and offer the existing five choices for a new time. The earlier `PRIMARY-FOLLOWUP-039` wait until +60 is `EVOLVED_BY_092`.

## Changed

- one dependency-free timing source defines T-30, the inclusive +10 entry cutoff and no-entry +11;
- new bookings schedule T-30 and +11 exact tasks;
- the exact no-entry handler becomes eligible at +11;
- self-service rebooking becomes available at +11;
- entry and no-entry decisions serialize on the exact candidate appointment row before an external delivery; the no-entry path locks first, then performs its evidence check in a separate fresh READ COMMITTED statement;
- the protected operator endpoint accepts one exact appointment for rearming its existing deterministic no-entry task;
- current event map, operating model and roadmap now use the same −60/+10 inclusive entry window and +11 follow-up rule.

## Preserved

- current five-slot Monday-Friday schedule and labels;
- valid-click window `−60/+10` and exact appointment binding;
- T-30 reminder, host brief and confirmation;
- current candidate follow-up text, rebook keyboard and decline path;
- one candidate/profile/booking, existing statuses and downstream stages;
- no keyword or group-membership inference for absence;
- deterministic task and effect IDs, replay protection and ambiguous-send protection;
- no broadcast, historical resend, n8n runtime or periodic candidate scan.

## Regression contract

- through +10 minutes inclusive: no follow-up and no rebook;
- +11 minutes: one follow-up for the exact appointment;
- qualified click suppresses follow-up;
- a concurrent qualified boundary click and +11 worker produce exactly one outcome; the regression forces the +11 worker to wait on the row lock before the entry evidence commits, then proves the fresh post-lock check suppresses every no-entry effect/message;
- a click outside the exact appointment/window does not suppress it;
- replay creates no duplicate message or state transition;
- rebook opens at +11 and uses the current slot registry;
- T-30 remains T-30;
- excluded/advanced/declined/future records do not move.

## Exact RUN04 live package — executed 2026-10-04

Target appointment: `2026-10-05T05:00:00.000Z`, slot `mon-0800` (08:00 MSK). The no-entry task is session-scoped and must retain the same deterministic ID and payload.

1. Action-time approval covered only commit `3d5dc9fb51de1382f2ce26f15adaaa8d8eb23c84` and the one existing RUN04 no-entry task.
2. Preflight proved task `aeb2a300-e20f-ae64-12cf-c18ee202f7d2` had the exact appointment and slot, state `pending`, `error=NULL` and old due time `2026-10-05T06:00:00.000Z` (09:00 MSK). The T-30 task `8354306e-4182-40c4-dacd-004902edfd3a` was due at `04:30Z` (07:30 MSK).
3. Vercel production deployment `dpl_AAdjLe9Mbro6CT6vD9ui9A8pb8Xd` is `READY`, targets production and serves the aliases `academy-strateg-trainer.vercel.app` and `academy-strateg-trainer-topregnetwork-sudos-projects.vercel.app`. Build evidence identifies exact commit `3d5dc9f`.
4. The protected `migrate_primary_no_entry_092` action was invoked exactly once for the exact appointment and slot. It returned `HTTP 200`, `ok=true` and updated exactly one existing task.
5. Postflight proved the same task ID and payload remain `pending`, `error=NULL`, now due at `2026-10-05T05:11:00.000Z` (08:11 MSK). No second task was created.
6. The T-30 task remained unchanged at `04:30Z`; one candidate, one active booking and one application remained. Status, source, appointment, message counts, click evidence and effect evidence remained unchanged. No candidate message was sent during deployment or maintenance.
7. Production readback passed: landing and public config `200`; write-only candidate endpoints `405` on GET; protected operator/funnel endpoints `401` without a key; Telegram diagnostic `ok`, webhook present, pending updates `0`, and two exact primary-session tasks pending.
8. Remaining physical proof is intentionally time-bound: at 07:30 MSK observe one operator brief listing the one expected participant; at a valid entry click observe one same-topic identity notice; at 08:11 confirm that a qualified click no later than 08:10 suppresses the follow-up, otherwise exactly one follow-up is delivered.

If deployment or task rearm differs before 08:11, restore the captured task row/due time and rearm the same scheduler object before returning production to baseline. Never create a second task or delete candidate, booking, message or click evidence. After a real delivery, rollback cannot unsend it; preserve evidence and stop further retries.

## Rollback

Return source to baseline `b6773c9db953f5998180d1cf5be26650865b3664` or branch `rollback/trainer-no-entry-plus11-before-092`. If rollback is needed before the scheduled action, restore the same task ID to the captured due time `06:00Z` and rearm that scheduler object; never create a replacement task. No message from the completed maintenance step needs undoing because none was sent.

## Local verification

- focused 090/091/092 regression: `20/20 PASS`, including deterministic concurrent-boundary coverage;
- independent Acceptance 90 for exact runtime commit `3d5dc9fb51de1382f2ce26f15adaaa8d8eb23c84`: `PASS`;
- changed JavaScript syntax: `PASS`;
- `git diff --check`: `PASS`;
- the serial full-suite audit still contains unrelated pre-existing stale assertions outside 092; every changed runtime path and its preserved 090/091 neighbors pass in the focused set.
