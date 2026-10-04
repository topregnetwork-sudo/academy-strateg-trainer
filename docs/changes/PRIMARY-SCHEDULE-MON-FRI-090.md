# PRIMARY-SCHEDULE-MON-FRI-090

Status: `DEPLOYED / AUTOMATED_READBACK_PASS / OWNER_FRESH_MENU_PROOF_PENDING`
Date: 2026-10-04
Scope: Trainer primary Zoom schedule only
Baseline production commit: `c6ba7dfab8602f29bc3ad0fbf5c005860c004c11`
Rollback branch: `rollback/trainer-primary-schedule-mon-fri-before-090`

## Owner-approved behavior

The primary Trainer Zoom schedule contains exactly five occurrences:

- Monday, Tuesday and Wednesday at 08:00 MSK;
- Thursday and Friday at 18:00 MSK.

Saturday is cancelled. No candidate, operator or stale-followup surface may show a Saturday occurrence, and a stale `sat-0600` callback must be rejected without changing candidate, booking, reminder or message state.

## Preservation contract

Unchanged:

- the five approved slot IDs, labels and MSK times;
- initial booking and self-rebooking behavior;
- atomic preservation of the old booking until a new occurrence succeeds;
- Zoom link, reminders, no-entry follow-up, HR briefs, candidate statuses and message text;
- Form 1, Trainer bot identity, group, Form 2, Test 1, productivity flow, operator data and existing bookings;
- production deployment, environment variables, Telegram webhook and real candidate data.

## Implementation

- moved the five approved occurrences into one dependency-free primary schedule registry and removed `sat-0600` from its slot and weekday maps;
- made booking and rebooking callbacks use the same explicit allowlist check;
- made stale primary follow-ups use the canonical server slot registry instead of a duplicated keyboard;
- synchronized the three maintained operator mappings;
- added `primary-schedule-mon-fri-090.test.js` covering exact five-slot parity, MSK calculation, callback rejection, follow-up parity and operator-copy parity.

## Verification required before deployment

1. `node --test tests/primary-schedule-mon-fri-090.test.js`;
2. relevant Trainer regression suite;
3. syntax checks for every changed JavaScript file;
4. `git diff --check` and baseline diff review;
5. independent preview confirms no Saturday button in new application, rebook, stale follow-up and operator surfaces;
6. stale `sat-0600` callback produces no write or Telegram effect;
7. only after independent acceptance may production deployment be proposed under the exact live lock.

## Local verification result

- focused preservation and schedule suite: `13/13 PASS`;
- new schedule regression: `5/5 PASS`;
- syntax checks for all eight changed JavaScript files: `PASS`;
- `git diff --check`: `PASS`;
- runtime scan of API, follow-up and all maintained operator copies: no `sat-0600`, `Сб 06:00`, Saturday weekday branch or Saturday primary label remains;
- generated preview exposes exactly the five owner-approved labels;
- the callback allowlist is evaluated before chat lookup, database read/write or candidate message send; a stale `sat-0600` callback is explicitly acknowledged once with an unavailable-time alert and exits with zero SQL and zero candidate-message effects;
- the sequential full legacy suite reports `54/70 PASS`; its 16 failures are pre-existing Node 24 `mock.module` incompatibilities or stale baseline assertions in untouched tests. No previously tracked test file was changed; the focused preservation suite above is green.

During local implementation and independent acceptance, production, environment variables, webhook, messages and real candidate rows were not changed. The later approved schedule-only deployment is recorded below.

## Production release

- deployment: `dpl_FZG6Cmnyd6gq4oSxyC4xSNVYUYWT`;
- deployed runtime commit: `f79507c0ca2408710eb27b96deef59c9f4f3ae5e`;
- canonical documentation commit: `3028c162a4db71958807a19ff2108b794133a40d` before this release-record update;
- the deployed Vercel subtree is byte-identical to the independently accepted canonical code tree;
- production alias: `https://academy-strateg-trainer.vercel.app`;
- provider status: `READY` and production alias assigned;
- automated readback: landing `200`; application, Telegram and progression GET probes `405` as expected for method-protected endpoints; operator without key `401`; Telegram diagnostic `200`;
- runtime code, environment variables, webhook, Telegram messages and candidate data were not changed after the approved deployment;
- rollback target remains exactly `c6ba7dfab8602f29bc3ad0fbf5c005860c004c11`.

The remaining release proof is one owner-controlled physical run that opens a fresh schedule menu after deployment and confirms that it contains only the five approved Monday-Friday buttons. Historical Telegram messages are intentionally not rewritten and may still display the former Saturday button; pressing that stale button must show the unavailable-time alert without changing data or sending a candidate message.

## Rollback

Before deployment: discard/revert only the implementation commit or return to baseline `c6ba7dfab8602f29bc3ad0fbf5c005860c004c11`.

After a future deployment: revert only `PRIMARY-SCHEDULE-MON-FRI-090`, redeploy the resulting commit, and do not rewrite existing bookings, reminders, statuses or delivered messages automatically.
