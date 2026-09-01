# INTERVIEW-SHEET-TUNING-052

Status: tuning, not frozen.

Baseline: b7f5e60c7cd0635f22b8a5bba6b3964d62d60870.

Rollback branch: rollback/interview-sheet-tuning-before-052.

The productivity interview workbook remains under active configuration. It must not be described as final, immutable or fully rolled out until the user explicitly approves and freezes it.

This release adds an idempotent migration for existing 047 workbooks. Before changing a workbook it makes a full backup in the candidate folder. The former first sheet remains inside the working file as `Архив — Начало 047`. The current `Начало`, `Анкета 2 — сведения`, `Финал` and `Сроки воронки` sheets come from template 048. Known old values are copied to their new locations, then the normal Q1/Q2 importer and appointment/timeline synchronizer fill only permitted fields. Existing manual answers are not deleted.

No candidate messages, statuses, slots, reminders, group membership or Test 1 exports are changed by this migration.
