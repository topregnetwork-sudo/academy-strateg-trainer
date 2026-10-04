# APPLICATION-CODE-SINGLE-BIND-091

Status: `CODE_COMPLETE / NOT_DEPLOYED / INDEPENDENT_ACCEPTANCE_REQUIRED`
Date: 2026-10-04
Scope: Trainer Form 1 application-code ownership only
Baseline and rollback commit: `f0930f039fcb2c4176c13a4cf924f669cd4d00b4`
Rollback branch: `rollback/trainer-application-code-single-bind-before-091`

## Proven incident

One valid Form 1 application code could be replayed by two Telegram identities. Every valid `/start trainer_app_<code>` overwrote `applications.candidate_id`, so the last identity became the owner and buttons already delivered to the first identity stopped resolving to its candidate.

## Required behavior

- the first valid Telegram chat atomically owns an unclaimed application code;
- replay by the same chat returns the same candidate and preserves its current status, source, booking and downstream stage;
- replay by another chat does not insert or update its candidate profile and does not alter the application owner;
- simultaneous claims by different chats produce exactly one winner;
- the losing chat receives a clear safe reply without disclosure of the winning identity;
- the winning chat's existing schedule buttons remain valid;
- the five approved weekday slots and all downstream Trainer stages remain unchanged.

## Implementation

- the application row is selected inside one database transaction with `FOR UPDATE`;
- candidate upsert and guarded `candidate_id IS NULL` bind occur while that row lock is held;
- an already bound code resolves its current candidate before any candidate write;
- same-chat replay reuses that candidate without updating it;
- cross-chat replay exits before candidate insert/update, application update, schedule work or downstream work;
- the prior same-chat booked, advanced-stage, experienced-trainer and new-candidate responses are preserved.

## Verification contract

1. first bind creates or reuses one candidate and writes one application binding;
2. same-chat replay performs no candidate or binding write and preserves the stage;
3. cross-chat replay performs no candidate or binding write and preserves a pre-existing loser profile byte-for-byte;
4. two simultaneous chat claims yield one `first_bind`, one `claimed_elsewhere`, one candidate and one binding;
5. callback ownership check still requires both bound candidate ID and the same Telegram chat;
6. schedule regression remains exactly five Monday-Friday slots;
7. production, Telegram, databases and real candidate data are not touched before an independently accepted live package.

## Local verification result

- bind-once behavioral regression: `4/4 PASS`;
- combined application-claim, schedule, Form 2 and operator preservation suite: `17/17 PASS`;
- concurrent two-chat simulation: one winner, one rejected replay, one candidate write and one binding write;
- cross-chat replay with a pre-existing loser profile: profile, status and source preserved byte-for-byte;
- JavaScript syntax and `git diff --check`: `PASS`;
- source scan confirms one transactional `FOR UPDATE`, one guarded `candidate_id IS NULL` bind and no former last-writer-wins update;
- production, Telegram, database rows, webhook and deployment were not changed.

## Rollback

Before deployment, return to `f0930f039fcb2c4176c13a4cf924f669cd4d00b4` or branch `rollback/trainer-application-code-single-bind-before-091`. After a future deployment, revert only the accepted 091 implementation commit and redeploy; do not rewrite existing application or candidate rows automatically.
