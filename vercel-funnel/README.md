# Воронка найма тренеров Академии Стратег

Публичная страница кандидата, Telegram-бот, Zoom, защищённая операторская панель, история сообщений, рассылки и аналитика каналов.

Секреты задаются только в Environment Variables Vercel: `POSTGRES_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `ZOOM_MEETING_URL`, `HR_BRIEF_CHAT_ID`, `OPERATOR_ACCESS_KEY`, `CRON_SECRET`.

После первого развёртывания Telegram webhook: `https://<домен>/api/telegram` с заголовком-secret `TELEGRAM_WEBHOOK_SECRET`.
