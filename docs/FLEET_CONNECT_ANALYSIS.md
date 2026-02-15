# Анализ connect-fleet и tryDiscoverParkId

## 1. Где вызывается tryDiscoverParkId и обработка 404

- **Вызов:** в `api/src/routes/manager.ts`, POST `/api/manager/connect-fleet`, только когда в теле запроса **нет** `parkId` (строка ~321):
  - `if (!parkId) { const discovered = await tryDiscoverParkId(apiKey); ... }`
- **tryDiscoverParkId** (в `api/src/lib/yandex-fleet.ts`):
  - Сначала запрос **POST /v1/parks/info**, затем при неудаче **POST /v1/parks/list**.
  - При `!res.ok` (в т.ч. 404) вызывается `captureFleetError(bodyText)` — в ответ сохраняются `lastFleetCode` и `lastFleetMessage`. Отдельной обработки 404 нет.
  - Если оба метода не вернули парк, возвращается `{ parkId: null, fleetMessage, fleetCode }`.
- **В connect-fleet:** при `!discovered.parkId` возвращается **400** с `code: "parkId required"` и текстом про ввод ID парка вручную — из-за этого показывается форма «Введите ID парка» (в т.ч. после 404 от parks/info или parks/list).

## 2. Можно ли отключить автоопределение парка

Да. Автоопределение можно полностью убрать и использовать только:
- **env:** `YANDEX_PARK_ID`, `YANDEX_CLIENT_ID`, `YANDEX_API_KEY` (через `ensureDefaultFleetPark()`);
- **БД:** уже сохранённые creds у менеджера (`fleetParkId` или legacy-поля).

Тогда при отсутствии `parkId` в теле запроса берётся парк по умолчанию из env; если в env тоже нет — только в этом случае возвращать 400 и показывать форму ввода ID парка.

## 3. Какие эндпоинты Yandex Fleet мы вызываем

| Эндпоинт | Назначение | Нужен для |
|----------|------------|-----------|
| **POST /v1/parks/driver-profiles/list** | Список водителей, проверка ключа | Список водителей, `validateFleetCredentials` |
| **POST /v2/parks/contractors/driver-profile** | Создание профиля водителя | Драфт регистрации водителя |
| **POST /v1/parks/info** | Один парк по ключу | Только `tryDiscoverParkId` (можно убрать) |
| **POST /v1/parks/list** | Список парков по ключу | Только `tryDiscoverParkId` (можно убрать) |

После отключения автоопределения парка используются только **driver-profiles/list** и **contractors/driver-profile**; зависимость от прав на parks/info и parks/list исчезает.

## 4. Внесённые изменения (кратко)

- **connect-fleet:** в начале проверка: если у менеджера уже есть creds (`getManagerFleetCreds`), сразу возвращать успех без запросов к Fleet.
- **connect-fleet:** при отсутствии `parkId` не вызывать `tryDiscoverParkId`; подставлять парк из env (`ensureDefaultFleetPark`). Форма «Введите ID парка» только если нет ни `parkId` в запросе, ни парка по умолчанию в env.
- **yandex-fleet:** функция `tryDiscoverParkId` и запросы к `/v1/parks/info` и `/v1/parks/list` удалены (или закомментированы), чтобы не зависеть от прав на эти эндпоинты.
