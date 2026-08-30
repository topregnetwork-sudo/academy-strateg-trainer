# MINSK-ZOOM-036
Baseline 457ccec; rollback/minsk-zoom-before-036.
Authorized: Minsk Sep1 legacy productivity slots only. Preserve times/capacity/bookings/statuses; switch to supplied Zoom, remove and disable reschedule; notify current booked participants and send sample to coordination thread30. Future invites/confirmations online.
Do not touch primary Zoom or Chelyabinsk. Delivery ledger per candidate, no blind retries. Temporary bounded maintenance entry accepts random256bit secret hash, expires2h, removed after operation. No unrestricted admin endpoint.
Verify exact recipient preview before sending; stored message IDs and edit counts; test callback cannot mutate bookings. Rollback code doesn't undo delivered notifications.

Result: 5 confirmed September1 Minsk bookings notified (IDs97/77/26/108/4; Telegram1433–1437), slots unchanged 11:00/12:00/12:45/13:15/13:30. Coordination sample thread30 message598. Fourteen prior September1 invitation/confirmation messages updated for eight candidates, no errors. Three unbooked people retain first-time slot choices; booked people have Zoom only. No Chelyabinsk/primary Zoom updates.
Implementation f904b89; maintenance endpoint removed in cleanup commit. `funnel_effects` stores one-time sends, messages stores delivery evidence. User-approved Zoom URL scoped to this legacy event only.
