# OWNER-CITY-CAMPAIGN-089

Дата: 2026-09-23. Режим: owner-only bounded live E2E. Текущая версия: `zoom_keyword_v2`.

## Preservation contract

- Baseline production source: `97629ef`.
- Rollback branch: `rollback/trainer-owner-city-campaign-before-089`.
- Новый маршрут существует только для `/start owner_city_089_minsk` и `/start owner_city_089_chelyabinsk` и только для Telegram username владельца `TopregStrateg`.
- Минск и Челябинск — две независимые кампании: разные campaign ID, Zoom session ID, active assignment, event announcement и delivery evidence. Ни одного city chooser нет.
- Используется текущая настройка `app_settings.zoom_meeting_url` с fallback на уже настроенный `ZOOM_MEETING_URL`; ссылка в код не копируется.
- Первое сообщение содержит только city-scoped Zoom-приглашение. Анкеты, согласия и квалификации на этом этапе нет.
- После фактического Zoom или просмотра записи человек сам пишет точное кодовое слово `28 сентября` и получает анонс только active city campaign.
- Оба мероприятия — 28 сентября. Для участника Zoom/записи посещение бесплатно. Для приглашённых собственников Минск: дословно `20 рублей`; Челябинск: `PENDING_OWNER`.
- Общий `/start`, приложения, кандидаты, статусы, записи, вместимость, напоминания, группы, анкеты Trainer, тесты, массовые отправки и сообщения другим людям остаются неизменными.
- Ошибочная версия `295100b` с вопросами отозвана. Старые callback-кнопки обезвреживаются и снимаются; существующие evidence rows не удаляются.

## Observable checks

1. Обычный `/start` по-прежнему возвращает прежнее legacy-сообщение.
2. Минский payload показывает только Минск; челябинский — только Челябинск.
3. Каждый city entry создаёт не более одного corrected Zoom message ID; повтор не отправляет дубль.
4. Точное `28 сентября` создаёт не более одного city announcement message ID.
5. Старые вопросы больше не принимают ответы.
6. Trainer candidate status не меняется; второй маршрут имеет отдельную строку.

## Rollback

Вернуть production на baseline `97629ef` либо сделать `git revert` единственного implementation commit 089 и новый production deploy. Таблицу evidence и уже доставленные owner-only тестовые сообщения автоматически не удалять.
