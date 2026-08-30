# MINSK-AUTO-037
Baseline b6a0fd5; rollback/minsk-auto-before-037.
User says initial review (первичный разбор) after Test1, Minsk Sep1 Zoom link from036. Implement candidate-scoped invitation after completed test event, catch up eligible missing invites once. No daily scans. Preserve city, statuses/manual decision, slots/deadlines, no reschedule, primary pre-test Zoom.
No duplicates on existing sent/booked/pending; uncertain delivery held for review. Temporary bounded maintenance preview/one candidate action expires and removed after execution. Test candidate isolation, failed/protected city excludes, retry same event no double send, stop if no slots.

Implementation d880439. Thirteen tests passed; preview+production success. Live catch-up preview found only candidate46 (@Bild_Black), sent1 failed0. Second preview empty, six open slots unchanged. Maintenance entry removed after send. Automatic future event uses same scoped function; no periodic all-candidate scan.
