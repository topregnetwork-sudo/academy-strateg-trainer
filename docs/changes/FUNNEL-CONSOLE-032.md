# FUNNEL-CONSOLE-032 — preservation contract

Baseline f3a48d2; rollback branch rollback/funnel-console-before-032.
Scope: authenticated operator console for explicit candidate selection, versioned editable templates, preview/frozen recipients, event delivery ledger, configurable productivity sessions and atomic booking/rescheduling, exact-time tasks. No live campaigns are sent during deployment.
Preserve: existing public applications/tests, candidate identities and answers, Drive folders, chats, filters, approved historic campaigns (including protected Nadezhda), September 1 offline bookings, current Zoom URL, service-message cleanup.
Tests: validation, authorization, duplicate events, booking capacity/concurrency, failures without repeat delivery, responsive console, exact tasks. Production delivery to candidates is not a test.
Rollback: revert the implementation commit, push main, and restore previous Cloudflare Worker version if changed. New tables remain for audit; do not delete data. Delivered messages/participant removals cannot be undone by code rollback.
