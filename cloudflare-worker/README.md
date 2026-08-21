# Academy Strateg fallback

Изолированный резервный маршрут. Он не меняет основной GitHub Pages-сайт,
Vercel-проект, базу данных или Telegram webhook.

- `/` и публичные файлы берутся с GitHub Pages.
- `/operator.html`, `/operator.css`, `/operator.js` и `/api/*` берутся через Vercel.
- `/_health` проверяет сам резервный маршрут.
- Для панели и API кэширование отключено.

Откат: удалить только Worker `academy-strateg-trainer-fallback`. Основные
адреса и данные при этом остаются без изменений.
