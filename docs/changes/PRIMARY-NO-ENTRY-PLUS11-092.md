# PRIMARY-NO-ENTRY-PLUS11-092

Date: 2026-10-04
Status: `LOCAL_ACCEPTANCE_PASS / INDEPENDENT_REVIEW_PENDING / NO_LIVE_ACTIONS`
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

## Exact RUN04 live package — not executed

Target appointment: `2026-10-05T05:00:00.000Z`, slot `mon-0800` (08:00 MSK). The no-entry task is session-scoped and must retain the same deterministic ID and payload.

1. Obtain one action-time approval covering the exact production commit, deployment and this one task rearm.
2. Read back the existing no-entry task: exact appointment/slot, non-done state and old due time 09:00 MSK. Stop if any field differs.
3. Deploy the independently accepted 092 commit; verify READY, production alias, exact SHA and read-only health.
4. Authenticated `POST /api/funnel` with action `migrate_primary_no_entry_092`, the exact ISO appointment and slot. Do not send a candidate message.
5. Require exactly one updated task with the same ID/payload, `pending`, no error and due `2026-10-05T05:11:00.000Z` (08:11 MSK).
6. Confirm the T-30 task remains due at 07:30 MSK and no `no_show_followup` exists through 08:10 inclusive.
7. Read back the exact appointment at 08:11: a qualified click no later than 08:10 suppresses the follow-up; otherwise exactly one follow-up is delivered and the same candidate can choose a new time.

If deployment or task rearm differs before 08:11, restore the captured task row/due time and rearm the same scheduler object before returning production to baseline. Never create a second task or delete candidate, booking, message or click evidence. After a real delivery, rollback cannot unsend it; preserve evidence and stop further retries.

## Local rollback

Return source to baseline `b6773c9db953f5998180d1cf5be26650865b3664` or branch `rollback/trainer-no-entry-plus11-before-092`. This local package has not deployed, rearmed tasks or sent messages.

## Local verification

- focused 090/091/092 regression: `20/20 PASS`, including deterministic concurrent-boundary coverage;
- changed JavaScript syntax: `PASS`;
- `git diff --check`: `PASS`;
- the serial full-suite audit still contains unrelated pre-existing stale assertions outside 092; every changed runtime path and its preserved 090/091 neighbors pass in the focused set.
