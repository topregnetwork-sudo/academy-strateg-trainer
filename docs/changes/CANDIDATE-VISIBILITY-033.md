# CANDIDATE-VISIBILITY-033

Baseline bfb0d45; rollback/ candidate-visibility-before-033 (branch: rollback/candidate-visibility-before-033).
Scope: read-only candidate progress evidence, invitation/booking history, understandable status labels, nonoverlapping list. Audit and tracking guide.
Preserve: all candidate values, campaigns, automation, reminder migration, group access, message wording, slots, chat and broadcast controls. Do not send messages during verification.
Checks: absent evidence must not imply delivery; pending/failed not sent; primary Zoom distinct from productivity; old invitations distinct from future bookings; mobile single-column list; no automatic status writes from display.
Rollback: revert only this change commit and push main. No data deletion or Worker migration required.
