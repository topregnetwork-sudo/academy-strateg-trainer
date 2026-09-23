# OWNER-CITY-CAMPAIGN-089

Дата: 2026-09-23. Режим: owner-only bounded live E2E.

## Preservation contract

- Baseline production source: `97629ef`.
- Rollback branch: `rollback/trainer-owner-city-campaign-before-089`.
- Новый маршрут существует только для `/start owner_city_089_minsk` и `/start owner_city_089_chelyabinsk` и только для Telegram username владельца `TopregStrateg`.
- Минск и Челябинск — две независимые кампании: разные campaign ID, Zoom session ID, строки журнала, ответы и Batman start payload. Ни одного city chooser нет.
- Используется текущая настройка `app_settings.zoom_meeting_url` с fallback на уже настроенный `ZOOM_MEETING_URL`; ссылка в код не копируется.
- Короткая анкета состоит из двух owner-only вопросов. Ответы пишутся идемпотентно в отдельную таблицу `owner_city_campaign_entries089`.
- Общий `/start`, приложения, кандидаты, статусы, записи, вместимость, напоминания, группы, анкеты Trainer, тесты, массовые отправки и сообщения другим людям остаются неизменными.
- Переход в Batman-бот не активирует Batman и не выдаёт `btm_id`.

## Observable checks

1. Обычный `/start` по-прежнему возвращает прежнее legacy-сообщение.
2. Минский payload показывает только Минск; челябинский — только Челябинск.
3. Каждый первый вход создаёт одну строку и одно intro message ID; повтор не отправляет второе сообщение.
4. Два ответа сохраняются только в строке своей кампании; Trainer candidate status не меняется.
5. Completion message содержит переход в `@batman_strateg_bot` с отдельным city payload.
6. Второй маршрут тем же аккаунтом создаёт отдельную строку и не изменяет первый.

## Rollback

Вернуть production на baseline `97629ef` либо сделать `git revert` единственного implementation commit 089 и новый production deploy. Таблицу evidence и уже доставленные owner-only тестовые сообщения автоматически не удалять.
