# PRODUCTIVITY-RESERVE-MANAGEMENT-066

## Scope

Only the Academy Strateg trainer funnel: the operator board, the individual Telegram reserve route, and its event log.

## What changes

- The former combined board column `Решение по продуктивности` is replaced in the active board view by three separate operational columns:
  1. `Прошёл продуктивность`;
  2. `Кадровый резерв — ожидается ответ`;
  3. `Кадровый резерв`.
- Conversion values use the recorded stage-event history for the current filters, so the two branches are not counted as one linear path.
- The candidate card exposes the reserve offer/result, next control time, and the result of removal from the active candidate group.
- A reserve offer now schedules one personal reminder after 3 days. If there is still no answer after another 3 days, the candidate receives a polite closing message and gets the distinct status `Не ответил на кадровый резерв`.
- After a candidate clicks `Да, в кадровый резерв`, the bot records the answer, changes the status to `talent_pool`, safely removes that candidate from the current active-selection group, records the outcome, and posts the internal notice to topic 1073.
- The confirmation explains that the current group is for the active selection flow and that a future dedicated reserve format will be announced separately.

## Preserved

- No mass messages.
- Personal messages only follow the individual operator/candidate event or the exact scheduled reminder.
- Existing candidates, schedules, interviews, forms, tests, Google Drive folders, history, and prior messages are not changed by deployment.
- A failed group-removal attempt does not lose the candidate: the candidate stays in `talent_pool` and the operator sees `Требует проверки`.

## Verification

- Syntax checks passed for changed API, bot, funnel, and operator files.
- Nine focused tests passed: reserve copy, board columns, group-removal guard, closed statuses, operator progress, and existing productivity status regressions.
- A legacy integration test requires a Node mock API unavailable in the currently installed Node runtime; it is unrelated to this change and was not treated as a success signal.

## Rollback

Baseline: `34d825c`.

Dedicated rollback branch: `rollback/productivity-board-visibility-before-066`.

Code-only rollback after deployment:

```text
git revert <PRODUCTIVITY-RESERVE-MANAGEMENT-066-commit>
git push origin main
```

Do not automatically restore a person to the active candidate group or undo an already delivered private Telegram message. Those are separate, explicit personnel actions.
