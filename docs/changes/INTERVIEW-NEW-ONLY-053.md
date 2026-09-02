# INTERVIEW-NEW-ONLY-053

Status: deployed for new candidates only; template remains editable.

Baseline: `6762150`.

Rollback branch: `rollback/interview-new-only-before-053`.

Requested behavior:

- candidates who already have a Google Drive candidate folder keep every existing interview workbook exactly as it is;
- replayed Test 1, Drive sync and retry events return the existing folder link without opening, migrating or autofilling the workbook;
- the temporary `interview-migrate-052` production route is removed, so the previous mass-migration runner cannot be invoked;
- a candidate who completes Questionnaire 2 and Test 1 for the first time, and has no `candidate_drive` folder, receives the current productivity-interview workbook;
- the new workbook is populated only from Questionnaire 1 and Questionnaire 2; Test 1 answers are not copied into it;
- after first creation, the existing event mechanism may write the saved productivity appointment and timeline into that newly created workbook.

Preserved behavior: candidate statuses, Telegram messages, slots, reminders, briefs, operator filters, Test 1 answers/export, manually completed sheets and all historical Drive files.

Rollback: revert only the implementation commit for this change or reset production to branch `rollback/interview-new-only-before-053`. Never mass-update candidate workbooks as part of rollback.
