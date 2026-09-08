# EXPERIENCE-ROUTING-AND-LATER-STAGES-080

## Preservation contract

- Baseline: `046e772b092ec6de41a35944cc7983ec48c7704b`.
- Rollback branch: `rollback/experience-routing-and-stages-before-080`.
- Scope: trainer funnel only.
- New behaviour:
  1. a newly registered experienced trainer receives the collaboration offer immediately in the Telegram bot;
  2. the offer has only `Да, интересно` and `Нет, спасибо` buttons;
  3. `Да, интересно` moves the candidate to `talent_pool` / `Кадровый резерв — сотрудничество`; `Нет, спасибо` moves the candidate to `rejected`;
  4. candidates who did not pass productivity appear in the same reserve column under `Ожидаем ответ` and move to `reserve_no_response` after three days without an answer;
  5. the operator panel has ready statuses and stages for `Офлайн-тестирование` and `Финал / договорённости`.
- Preserved behaviour: ordinary trainer applications, primary Zoom booking, candidate group entry, questionnaires, Test 1, productivity interview booking, productivity results, reserve flow after productivity, Google Drive, existing candidates, schedules and all existing messages.
- No backfill: existing experienced candidates receive nothing from this deployment. Their first batch is a separate approved send.
- Verification: syntax checks, focused static checks, a production API check, and a single real new experienced-candidate path only after explicit user approval.
- Rollback: revert only the implementation commit; do not retract already delivered Telegram messages or move candidates back automatically.
