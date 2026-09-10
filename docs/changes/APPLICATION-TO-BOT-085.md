# APPLICATION-TO-BOT-085

- Baseline: `b4df5fcfb3f6fdc75d00f39e96b618e5a8eaf881`.
- Rollback branch: `rollback/application-transition-before-085`.
- Requested behavior: a submitted first application reliably returns and opens its personal Telegram deep link; experienced trainers receive the existing collaboration offer, while ordinary candidates receive primary interview slots.
- Changed: the public page tries the production application API first, waits up to 20 seconds for a cold request, and application saving no longer waits for redundant Telegram webhook registration.
- Preserved: application fields, experience classification, candidate statuses, approved collaboration text and buttons, ordinary primary booking, reminders, logs, existing candidates, and all later funnel stages.
- Verification: syntax checks, production API latency probe, CORS check, deployment check, and a non-mutating Telegram diagnostic. A real candidate submission remains the final end-to-end event.
- Rollback: restore only `APPLICATION-TO-BOT-085` from `rollback/application-transition-before-085`; do not roll back later approved campaigns or Telegram callbacks.
