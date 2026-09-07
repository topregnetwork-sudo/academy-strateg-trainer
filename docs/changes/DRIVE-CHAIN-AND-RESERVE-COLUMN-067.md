# DRIVE-CHAIN-AND-RESERVE-COLUMN-067

## Scope

Trainer funnel only. Baseline: `c80d2e7`. Production commits: `f1cf338`, `9d8e229`, `03416ac`, `598948b`. Rollback branch: `rollback/trainer-drive-chain-and-reserve-column-before-067`.

## Requested result

- One board column: **«Кадровый резерв — сотрудничество»**. It contains the accepted reserve route and the existing collaboration / Academy-contact statuses. The separate waiting-for-answer column remains unchanged.
- A completed Test 1 must not lose the Google Drive chain when the bridge is slow: the candidate folder, answer sheet and productivity interview sheet are created by an addressable durable task with retries.
- Internal topic test messages use the same unified reserve wording.

## Durable Drive rule

Test completion stays fast: it sends the existing completion and productivity-invitation flow, then schedules exactly one candidate-specific Drive task. The task creates the folder and files. If the bridge is unavailable or slow, it schedules the next addressable attempt after 2, 5, 10, 20, 40 and 60 minutes. It never sends the candidate another message, never changes a candidate stage and uses the existing idempotent Drive save path. After the final failed attempt, `candidate_drive_sync_067` records `attention` and the error for operator follow-up.

`reconcile_drive_sync_067` is an operator-only repair action. It finds only consented candidates who have both Questionnaire 2 and Test 1 completed but no Drive folder, then schedules their addressable Drive tasks. It does not send a broadcast or alter statuses.

## Preserved

Candidate messages, Test 1, Questionnaire 2, existing folders, productivity appointments, existing booked times, event-based reserve path, topics 1071/1073 and no mass candidate delivery remain unchanged.

## Verification required after deploy

1. Trigger the repair action once and confirm that all eligible missing folders have been queued.
2. Confirm Maria Faleychik has a folder, Test 1 answer sheet and productivity interview sheet.
3. Open the board and confirm only one unified reserve-collaboration column is visible.
4. Send the authorized internal samples to topics 1071 and 1073; do not message candidates.

## Rollback

`git revert 598948b 03416ac 9d8e229 f1cf338 && git push origin main` restores the prior direct Drive attempt and separate collaboration column. Already-created Drive folders, tables, tasks and internal sample messages must remain as audit evidence; do not delete them automatically.
