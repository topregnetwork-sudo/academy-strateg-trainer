# INTERVIEW-AUTOMATION-049

## Актуальное состояние — выпуск после подтверждения пользователя

**Выпущено и проверено:** production c1d0a43, deployment6189590290 success, https://academy-strateg-trainer.vercel.app/operator.html —200; protected /api/drive —401 без авторизации; временный checker —404. Адресная задача fb508b8e-e2b3-4d13-8a85-484b2ed0c17a candidate94 прошла через штатный планировщик и production обработчик: state=done,error=null. Это проверка реального событийного обновления без сообщений кандидату. Обновление уже существующего бланка не создаёт дубль. Предыдущие формулировки «готово к выпуску/ждём публикации» ниже оставлены только как история.

Откат кода всего пакета047–049, опубликованного одним выпуском: из чистого рабочего дерева выполнить git revert --no-commit db8188316468a19fc5fb9af71153e29686467123..c1d0a43, затем git commit -m "Rollback interview automation 049", затем git push origin main. При конфликтах остановиться, не сбрасывать дерево. Это не откат данных: Google-файлы, ручные ответы, даты, добавленный лист и таблица событий сохраняются. Для аварийного отключения только новых обновлений использовать INTERVIEW_APPOINTMENT_048=false. Старый мост не требуется возвращать: он совместим с прежним экспортом. Состояния кандидатов не восстанавливать из старых снимков.

Cloud bridge confirmed `049-checked-1`. Existing candidate94 workbook updated in place: F9/F10/F12 plus automatic notes; neighboring values/formats/validation unchanged. Timeline tab added with actual stored dates, no invented end. Historical invitation timestamp now remains visible when invite status becomes booked. New native template creation verified in technical-only folder 1_jldLAlKSvU0o7JAgIFmM6m32HcqhAF5, file18W1NlRgziatIe6TZKiCpefLGUYEjiy72GWlNMi4vhX8; eight tabs, Q2 answer in assigned field, no formula errors. No candidate messages, status or Test1 export changes.

All26 regressions pass. Event sync enabled by default; `INTERVIEW_APPOINTMENT_048=false` disables it. `GOOGLE_DRIVE_INTERVIEW_SHEET_047=false` disables new interview creation and restores old card path. Older entries below are historical, not current activation instructions. Existing25 sheets are NOT migrated/recreated; current layouts apply to newly created sheets. Existing sheets receive appointment/timeline only, preserving manual interview data.

Temporary check route removed before production. Ready for final preview and production; production/task result must be recorded after verification. Parallel template-copy and appointment test hit15s timeout once; never blindly repeat non-idempotent actions. Appointment update is idempotent and its durable task retries the same candidate; no all-candidate polling. Technical test workbook retained explicitly outside candidate folders.

## Проверка по скриншоту SyntaxError file already declared

Весь локальный Code.gs компилировался до изменений; ошибка на скриншоте в нём не воспроизведена. Текст редактора Apps Script не прочитан, поэтому точная причина его отличия неизвестна. В updateInterviewAppointment048_ локальные переменные названы entryFile/appointmentFile вместо повторного file в разных областях. Проверено26 сценариев, включая компиляцию цельного исходника и doPost. Полная копия для вставки Code-049-checked.txt должна совпадать с Code.gs. Метка capabilities bridgeVersion=049-checked-1. Вставлять целиком через Ctrl+A в редакторе, не дописывать. Сохранить, затем новую версию прежнего deployment. Не нажимать Выполнить authorizeNativeFiles. Production ещё не активирован; новое разрешение пользователя не требуется, требуется публикация без ошибки и проверка capability.

Authorization: user confirmed bridge048 update and requested activation. Baseline production db8188316468a19fc5fb9af71153e29686467123. Remote rollback/interview-automation-before-049 preserves baseline.

Scope: activate Q1/Q2-only interview sheets, separate contacts/Russian experience, new Final and extra-Q2 tabs, event-based appointment fields from DB, stage durations. Preserve candidate data/statuses/messages/group membership/booking capacity/reminders/Test1 exporter/manual interview answers. Existing files must not be replaced.

Before production: bridge capabilities, fixture regressions, preview, single-candidate document check. Temporary release-check049 is keyed, expires, returns capabilities only; remove before final release. No mass messages.

Current state: prepared, waiting for corrected bridge publication, not activated.

Live bridge048 confirmed ok/interviewSheet048/appointment048, but no timeline049. Actual single-candidate94 appointment call failed safely with «Неизвестная структура бланка»: old B9 label is «Дата проведения», rather than «Дата интервью». No document fields changed; no messages sent. Fixed both known labels in Code.gs without changing the sheet's labels.

Code.gs now supports timeline049, copies only missing timeline tab into an existing interview, preserves other tabs, manual dates/formulas and notes, clears only automatic planned appointment on cancellation. readInterviewTimeline reads timestamps for one candidate; no test answers. Creation/invitation/booking/cancellation/manual productivity-result events queue an addressable sync. New result timestamps have a dedicated RLS-enabled table; historical result dates are not invented. End remains undefined. 24 local tests pass including a real PostgreSQL-compatible fixture for timeline and booking, bridge repeat/manual preservation, legacy label.

Cloud bridge still048; updated source must be pasted and published once by user. Server flag INTERVIEW_APPOINTMENT_048 remains OFF. After cloud timeline049 confirmed: test candidate94, deploy preview, verify one new clean-template creation without candidate messages, remove temporary checker, activate server and flag, then verify production and record commit. Never claim full automation before this. Existing 25 sheets must not be recreated. Rollback branch already pushed. Release preparation itself needs no production rollback.
