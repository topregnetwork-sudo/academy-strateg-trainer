# TRAINER-FORM2-DIRECT-BOT-HANDOFF-087 — production preservation contract

Date: 2026-10-04
Status: APPROVED FOR PRODUCTION AND ONE OWNER-ONLY TEST

## Baseline and rollback

- production baseline: `35859b0`;
- rollback branch: `rollback/trainer-form2-direct-bot-production-before-087`;
- rollback restores the code only and never deletes submitted answers, events or Telegram messages.

## Exact requested behavior

1. Form 2 saves all ten answers before any navigation.
2. The existing `questionnaire_2_completed` event asks the Trainer bot to send «Анкета 2 получена» and its next instruction.
3. The browser immediately opens `https://t.me/stazherskaya_bot` after the successful event.
4. If the event is temporarily unavailable, the browser opens the same bot through `/start questionnaire_done`.
5. No intermediary web success screen remains.

## Preserved behavior

- production Supabase and production progression endpoint;
- Trainer candidate identity and current status;
- Form 2 question names, validation and answer payload;
- post-Zoom `КАНДИДАТ → группа → Form 2 сразу`;
- primary Zoom, booking and `Изменить время`;
- group membership, Test 1, productivity interview and Google Drive chain;
- other candidates, campaigns and message history;
- no batch send and no candidate status change outside the single owner-only test.

## Acceptance evidence

- source copies remain equal;
- syntax and targeted regression suite pass;
- production deployment serves the new asset marker;
- one owner-only physical test proves save → bot confirmation → Telegram open;
- readback proves one completed Form 2 and no sends to other candidates.
