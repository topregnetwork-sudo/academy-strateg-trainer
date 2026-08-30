# PRODUCTIVITY-ORDER-034
Baseline 1667adf; rollback/productivity-order-before-034.
User rule: Test 1 collects data → productivity interview → if passed, decode Test 1.
Add productivity_passed (await decoding), clarify completed stage and next step; old test_passed invitation action remains compatible but no longer sets decoded-test status.
Preserve all existing candidates, answers, bookings, timers, messages already sent. No campaign launched. Manual status remains without sending.
Verify labels, accepted status, repeated test cannot reset productivity_passed, tests and deployed script.
