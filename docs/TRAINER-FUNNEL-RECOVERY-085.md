# TRAINER-FUNNEL-RECOVERY-085

- Change ID: `TRAINER-FUNNEL-RECOVERY-085`.
- Production baseline: `35859b0b97e38fec26365e6bdde5ba6baf70c371`.
- Rollback branch: `rollback/trainer-funnel-recovery-before-085`.
- Requested behavior: primary Zoom entry must work without a Telegram callback round-trip; the host-issued word `Кандидат` after the scheduled Zoom must advance the candidate instead of returning them to booking; a saved application must show a usable recovery instruction when Telegram is unavailable.
- Preserved behavior: cities, slots, consent, application fields, professional-trainer routing, status names, Questionnaire 2 and Test 1 ordering, candidate-group invite, reminders, briefs, operator panel, Drive integration, existing callback path, and all unrelated messages remain unchanged.
- Checks: direct entry URL is bound to a random 20-character application code; it records the same time-window evidence and redirects with `Referrer-Policy: no-referrer`; callback entry still works; a post-session `Кандидат` signal is accepted only for the candidate's current booked session and only in a bounded window; duplicated public scripts stay byte-identical; targeted and full tests pass; preview is checked before production.
- Rollback target: revert only the final `TRAINER-FUNNEL-RECOVERY-085` commit or reset the deployment alias to baseline `35859b0b97e38fec26365e6bdde5ba6baf70c371`. External messages and evidence rows are not deleted automatically.

Production publication and any real candidate interaction require a separate live approval immediately before release.
