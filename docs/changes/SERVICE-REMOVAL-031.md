# SERVICE-REMOVAL-031

Baseline: 5a42e65. Rollback branch: rollback/service-removal-before-031.

Scope: delete only the departure service message authored by our bot in the configured candidate group. No new participant removals, messages, status transitions, UI edits or scheduled scans. Existing removal action is unchanged.

Implementation: Telegram service event → configured group and bot actor check → deleteMessage. Failed isolated service webhook returns 503 for Telegram redelivery; normal funnel webhook behavior remains unchanged. A duplicate deletion is safe. No new plugin or credentials required.

Checks: node tests for exact message, unrelated messages/exits/admins/groups, old events, idempotency and visible failures; syntax and diff checks. Live end-to-end removal not performed: no new candidate is authorized for removal as a test. Next legitimate bot removal verifies live permissions and service-event delivery.

Rollback: revert the single commit containing SERVICE-REMOVAL-031, then push main. This disables cleanup only; already removed service messages cannot be restored. No candidate data is deleted.

Source: https://core.telegram.org/bots/api#deletemessage
