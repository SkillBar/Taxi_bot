# Проблема: список исполнителей (водителей) не показывается

## Формулировка

В мини-приложении «Кабинет агента такси» на экране «Исполнители» список водителей пустой: отображается «Исполнители не найдены», хотя в парке Яндекс.Такси (Fleet) по данному API-ключу водители есть. Нужно понять причину и добиться отображения списка водителей парка.

## Что есть в системе

- **Фронт (webapp):** запрос `GET /api/manager/drivers` при открытии главной. Ожидается ответ `{ drivers: [...], meta?: { source, count, hint } }`. При пустом списке показывается блок «В чём причина» с текстом из `meta.hint` или подсказкой по источнику.
- **Бэкенд (api):** маршрут `GET /api/manager/drivers`:
  - Определяет менеджера по `x-telegram-init-data` (telegram user id).
  - Если у менеджера есть учётные данные Fleet (apiKey, parkId, clientId) — запрос к **Yandex Fleet API**: `POST https://fleet-api.taxi.yandex.net/v1/parks/driver-profiles/list` с телом `{ query: { park: { id: parkId } }, fields: { driver_profile: [...], account: [...] }, limit: 500, offset: 0 }`, заголовки `X-Client-ID`, `X-API-Key`, `X-Park-Id`.
  - Ответ Fleet разбирается так: список водителей ищем в `data.driver_profiles`, или в `data.parks[].driver_profiles`, или в `data.parks` как объект по ключам парков.
  - Если учётных данных Fleet нет — возвращаются только привязки по телефону из БД (DriverLink), обычно пусто.
- **Онбординг:** пользователь вводит API-ключ и (при необходимости) ID парка; вызывается `POST /api/manager/connect-fleet`, данные сохраняются в таблице Manager (yandexApiKey, yandexParkId, yandexClientId). После этого при запросе списка водителей должны подставляться эти учётные данные.
- **Логи на бэкенде (Vercel):** при запросе списка пишется `step: "drivers_list"`, `hasCreds`, `parkId` (префикс), при успехе Fleet — `source: "fleet"`, `parkDriversCount`; при пустом ответе Fleet — `fleetResponseTopLevelKeys` (ключи верхнего уровня ответа); при ошибке — `listParkDrivers_failed`, `message`.

## Возможные причины (для проверки)

1. **Парк не подключён:** у менеджера в БД нет `yandexApiKey` / `yandexParkId` (онбординг не завершён или другой пользователь). В логах: `hasCreds: false`, в ответе `meta.source: "driver_link"`, `meta.hint` про отсутствие подключения парка.
2. **Fleet возвращает пустой или другой формат:** запрос к Fleet успешен (200), но мы извлекаем 0 водителей. В логах: `parkDriversCount: 0`, при пустом ответе — `fleetResponseTopLevelKeys`. Нужно сверить структуру ответа Fleet с документацией (https://fleet.yandex.ru/docs/api/ru/) и при необходимости доработать разбор (другой ключ или вложенность).
3. **Ошибка Fleet (401/403/404/5xx):** неверный ключ, неверный park_id, нет прав. В логах: `listParkDrivers_failed`, `message` с текстом от Fleet. В ответе клиенту — 502, `code: "FLEET_DRIVERS_ERROR"`, в UI — текст ошибки.
4. **Несовпадение менеджера:** список запрашивается от имени другого telegram user id (другое устройство/аккаунт), у которого нет сохранённого Fleet. Проверить: один и тот же аккаунт в онбординге и при открытии списка.

## Что передать для диагностики

- Скрин экрана с блоком «В чём причина» (если после деплоя он показывается).
- Фрагменты логов Vercel по запросу `GET /api/manager/drivers`: строки с `drivers_list`, `hasCreds`, `source`, `parkDriversCount`, при наличии — `fleetResponseTopLevelKeys` или `listParkDrivers_failed` и `message`.
- Подтверждение: в кабинете fleet.yandex.ru для этого парка и API-ключа действительно есть водители и ключ имеет права на чтение списка водителей.
