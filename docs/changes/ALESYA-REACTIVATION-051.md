# ALESYA-REACTIVATION-051

Date: 2026-09-01

## Scope

Point correction for candidate `@slkpwr` only. The rest of the funnel, candidates, slots, templates, reminders, statuses and content were preserved.

## Result

- Candidate ID: `131` (`@slkpwr`, Minsk).
- The requested `13:15` slot was verified as occupied by another candidate and was not overwritten.
- Alesya was restored to the active `productivity_invited` stage with consent enabled.
- Telegram received an invitation containing only the free Minsk slots available at the moment of sending.
- The invitation retained the approved Academy Goals and PDF buttons from the standard Minsk productivity keyboard.
- The standard booking callback was expanded narrowly: a candidate may choose a slot either after submitted Test 1 or after an exact, recorded operator invitation for the same event date. Closed statuses and missing consent remain blocked.
- A one-time maintenance endpoint was removed after the operation.

## Idempotency

Candidate message effect: `alesya-book-051:free-slots:131`.

Staff log effect: `alesya-book-051:free-slots-staff:131`.

Repeated execution cannot send a second copy under these keys.

## Rollback

Code rollback branch: `rollback/alesya-reactivation-before-051`.

The branch restores code only. It cannot retract a Telegram message already delivered. Reversing candidate state requires an explicit operator decision and must not be done automatically.
