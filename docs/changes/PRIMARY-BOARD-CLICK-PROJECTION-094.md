# PRIMARY-BOARD-AND-FORM2-PROJECTION-094

Date: 2026-10-05
Status: `LOCAL_PATCH_READY / PRODUCTION_NOT_CHANGED`

## Preservation contract

- Production runtime inspected: `3d5dc9fb51de1382f2ce26f15adaaa8d8eb23c84`.
- Release implementation baseline: `3d5dc9fb51de1382f2ce26f15adaaa8d8eb23c84`.
- Local rollback branch: `rollback/trainer-board-form2-projection-before-094`.
- Requested behavior: the board must distinguish a past appointment with a qualified Zoom click from a true no-click appointment, and a submitted Form 2 from a form still waiting.
- Evidence source: the server derives the first qualified click from both primary-entry tables for the candidate's exact current `interview_at + slot_id`; the browser receives only `primary_zoom_clicked_at`.
- The label states only that Zoom was clicked. It never infers attendance.

## Production truth and affected population

Authenticated read-only inspection found 21 current `interview_booked` candidates whose primary appointment is in the past. Two have a qualified click for the exact current appointment:

- candidate `263`: `thu-1800`, appointment `2026-09-17T15:00:00Z`, click `2026-09-17T14:58:28.339Z`;
- candidate `210`: `fri-1800`, appointment `2026-09-11T15:00:00Z`, click `2026-09-11T14:47:29.745Z`.

The other 19 have no exact matching qualified click and must keep the warning. RUN04 candidate `1555` has already advanced to `questionnaire`, so it is no longer in the primary column; its earlier contradictory heading exposed this shared projection defect.

## Minimal delta

1. `GET /api/operator` adds a lateral read-only projection, `primary_zoom_clicked_at`, from both click tables using the exact appointment, exact slot and canonical `-60/+10` window.
2. The board keeps future appointments under `Ожидают назначенного времени`.
3. A past appointment with the projected click is grouped under `Zoom нажат · присутствие подтверждается отдельно`.
4. Only a past appointment without the projected click remains under `Zoom не нажат`.
5. The list API projects `questionnaire_two_submitted_at`; `questionnaire + submitted_at` is grouped under `Анкета 2 получена · ожидает Тест 1`.
6. Each list/board refresh re-fetches and re-renders the currently selected candidate detail.
7. A first successful future Form 2 submission appends exactly one `questionnaire_two_submitted` event in the same RPC, even when the candidate already has status `questionnaire`. Replay appends nothing. No historical event is backfilled.
8. Both candidate-facing post-Test1 messages use neutral wording: the completion notice says `Следующий этап — ещё одно интервью.`, and the rolling invitation says `Приглашаем вас на следующее интервью в Академии Стратег.` Neither candidate-facing body discloses the internal productivity-stage term.
9. The operator column covering `test_1_passed`, `productivity_invited`, and `productivity_booked` is factually titled `Интервью на продуктивность`; its existing subgroups remain `Ожидают приглашения`, `Ожидают выбора времени`, and booked appointment dates. A `productivity_invited` candidate is never represented by the column heading as already booked.

## Preserved behavior

- no candidate status changes;
- no attendance inference or persistence;
- no event-history backfill; RUN04 remains an explicit historical gap;
- no Telegram send, scheduler, booking, Form 2, Test 1 or productivity state/flow change;
- candidate-facing post-Test1 copy changes only in the two requested phrases; all remaining message text, goals links/PDF, slots/buttons, and internal/operator terminology remain unchanged;
- no candidate or application row write;
- no board-stage or conversion-count change;
- no productivity subgroup, individual status label, status code, or operator decision terminology change; only the mixed column heading is corrected;
- the two click tables remain append-only evidence sources.

## Acceptance and rollback

- focused projection, atomic Form 2 event and adjacent primary Zoom tests pass;
- full discovered test suite passes with the repository's required Node module-mock flag;
- a preview deployment must show candidates `263` and `210` in the neutral clicked group and the remaining 19 in the warning group;
- a synthetic future Form 2 submit must add one event, replay must keep the count at one, and the selected detail must update on refresh;
- focused copy regression must prove that both candidate-facing post-Test1 bodies omit `продуктивност` while the exact neutral phrases are present;
- board regression must prove that the mixed productivity column has the factual title and `productivity_invited` remains in `Ожидают выбора времени`, not a booked label;
- production deployment requires a new action-time gate and post-deploy API/UI readback;
- rollback only change 094 by reverting its patch commit, or restore the exact pre-094 release tree. Candidate data and click evidence must not be edited or deleted.
