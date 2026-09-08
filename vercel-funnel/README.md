# Воронка найма тренеров Академии Стратег

Публичная страница кандидата, Telegram-бот, Zoom, защищённая операторская панель, история сообщений, рассылки и аналитика каналов.

Каноническая рабочая модель этапов, событий, слотов и шаблонов: [`docs/FUNNEL-OPERATING-MODEL.md`](../docs/FUNNEL-OPERATING-MODEL.md).

Секреты задаются только в Environment Variables Vercel: `POSTGRES_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `ZOOM_MEETING_URL`, `HR_BRIEF_CHAT_ID`, `OPERATOR_ACCESS_KEY`, `CRON_SECRET`.

После первого развёртывания Telegram webhook: `https://<домен>/api/telegram` с заголовком-secret `TELEGRAM_WEBHOOK_SECRET`.

Read-only диагностика Telegram и брифа: `GET /api/telegram-diagnostic`. Endpoint
возвращает только агрегаты без имён, текстов, chat_id, thread_id, candidate_id и
telegram_message_id. Он показывает состояние очереди брифа (`queued`, `sending`,
`sent`, `attention`, `uncertain`), зависшие попытки, состояние webhook Telegram,
обработанные updates, сообщения и фоновые задачи.

Ошибка HTTP Telegram сохраняется как `attention`; сетевой timeout — как
`uncertain` и не переотправляется автоматически. Следующая попытка разрешена
только для `attention` после паузы. Поэтому `sent` означает принятие сообщения
Telegram API, а не прочтение сообщения человеком.
