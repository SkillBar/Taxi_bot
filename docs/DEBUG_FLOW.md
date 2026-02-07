# Поток лида и отладка: что происходит и как понять причину

Документ описывает **цепочку онбординга** (лид: пользователь → агент → менеджер → Fleet) и **что смотреть в логах**, чтобы точно понять, на каком шаге и почему что-то пошло не так.

---

## 1. Общая схема потока

```
Пользователь открывает Mini App из Telegram
        │
        ▼
GET /api/agents/me  (x-telegram-init-data)
        │
        ├─ linked: true  → GET /api/manager/me
        │                       │
        │                       ├─ hasFleet: true  → открыть кабинет (AgentHomeScreen)
        │                       └─ hasFleet: false  → экран «Подключите Yandex Fleet»
        │
        └─ linked: false → экран «Подтвердите номер» → requestContact
                                    │
                                    ▼
                    Бот получает контакт (message:contact)
                                    │
                                    ▼
                POST /api/agents/link-from-bot  (X-Api-Secret, phone, telegramUserId)
                                    │
                                    ├─ 200 → агент привязан к Telegram
                                    └─ 404 → номер не найден в системе
                                    │
                                    ▼
                Mini App снова вызывает GET /api/agents/me → linked: true
                                    │
                                    ▼
                GET /api/manager/me → hasFleet: false → экран Fleet (API-ключ + ID парка)
                                    │
                                    ▼
                POST /api/manager/connect-fleet  (apiKey, parkId)
                                    │
                                    ├─ 200 → парк подключён → открыть кабинет
                                    └─ 400 → ошибка валидации Fleet (см. fleetStatus и message)
```

---

## 2. Что логируется (по шагам)

Все логи — **структурированные** (объекты с полями `step`, и др.). В Vercel → Project → Logs ищи по `step` или по тексту ниже.

| Шаг | Лог | Что значит |
|-----|-----|------------|
| **agents/me** | `step: "agents/me"`, `telegramUserId`, `linked`, `agentId` | Пользователь открыл Mini App; привязан ли он к агенту. Если `result: "initData_invalid"` или `"user_missing"` — проблема с initData или BOT_TOKEN. |
| **link-from-bot** | `step: "link-from-bot"`, `result: "success" \| "agent_not_found" \| "invalid_secret"`, `agentId`, `telegramUserId`, `phoneSuffix` | Бот привязал контакт к агенту. `agent_not_found` — номер нет в БД или во внешней проверке (AGENT_CHECK_URL). `invalid_secret` — неверный X-Api-Secret. |
| **manager/me** | `step: "manager/me"`, `telegramUserId`, `managerId`, `hasFleet` | Запрос кабинета менеджера; есть ли уже подключённый Fleet. |
| **connect-fleet:start** | `step: "connect-fleet:start"`, `managerId`, `parkId`, `clientId`, `apiKeyPrefix` | Начало попытки подключить Fleet (ключ только префикс, не целиком). |
| **connect-fleet:fleet_validation_failed** | `step: "connect-fleet:fleet_validation_failed"`, `managerId`, `parkId`, `fleetStatus`, `message` | Fleet API вернул ошибку (например 403, 400). `fleetStatus` — HTTP-код ответа Fleet; `message` — начало тела ответа Fleet. |
| **connect-fleet:success** | `step: "connect-fleet:success"`, `managerId`, `parkId` | Ключ и парк приняты, данные сохранены в Manager. |

---

## 3. Что видит пользователь при ошибке Fleet

На экране «Подключите Yandex Fleet» при ошибке теперь показывается:

- **Fleet API ответил: HTTP &lt;код&gt;.**  
  Затем полный текст сообщения от бэкенда (в т.ч. обрезанный ответ от Fleet API до 300 символов).

Коды Fleet, которые чаще всего видны:

- **403** — ключ не подходит к парку, нет прав или неверный Client ID.
- **400** — неверный формат запроса (тело/заголовки).
- **404** — парк не найден или неверный park_id.
- **401** — неверный или не принятый API-ключ.

В логах в этом случае будет `connect-fleet:fleet_validation_failed` с тем же `fleetStatus` и фрагментом `message`.

---

## 4. Типичные сценарии

- **«Номер не найден в системе»**  
  Смотри логи `link-from-bot` с `result: "agent_not_found"`. Проверь: номер есть в БД (Agent) или во внешнем API (AGENT_CHECK_URL); `phone` нормализован одинаково (например +79...).

- **«Ошибка подключения. Проверьте API-ключ и ID парка» без HTTP-кода**  
  Запрос до бэкенда не дошёл (сеть, CORS, 401 по initData). Смотри, есть ли в логах вообще `connect-fleet:start`. Если его нет — ошибка до маршрута (например 401 от preHandler manager).

- **Fleet API ответил: HTTP 403**  
  Смотри лог `connect-fleet:fleet_validation_failed` и поле `message` — там фрагмент ответа Fleet. Проверь: ключ из кабинета Fleet для этого парка; при необходимости укажи Client ID из кабинета (сейчас подставляется `taxi/park/{parkId}`).

---

## 5. Где смотреть логи

- **Vercel (API):** Dashboard → выбранный проект (api) → Logs. Фильтр по времени и по тексту, например `connect-fleet` или `agents/me`.
- **Локально:** вывод `npm run dev` в папке `api/` — те же логи в stdout. При подключении Fleet смотри строки `[tryDiscoverParkId]`, `connect-fleet:start`, `connect-fleet:fleet_validation_failed`, `connect-fleet:fleet_error_details`.

---

## 6. Автоопределение Park ID

Эндпоинты `/v1/parks/info` и `/v1/parks/list` в Fleet API возвращают **404 Path not found** — у Yandex эти пути не реализованы (или отличаются). Поэтому **park ID нельзя получить по одному ключу**; пользователь должен ввести его вручную из кабинета Fleet (Настройки → Общая информация → ID парка). В форме онбординга поле «ID парка» подставляется по умолчанию; при другом парке его нужно изменить.

---

## 7. Быстрый тест Fleet по ключу (curl)

Проверка ключа и park_id напрямую (подставь свой ключ и ID парка):

```bash
curl -X POST \
  https://fleet-api.taxi.yandex.net/v1/parks/driver-profiles/list \
  -H "X-API-Key: ВАШ_API_КЛЮЧ" \
  -H "X-Client-ID: taxi/park/ВАШ_PARK_ID" \
  -H "X-Park-Id: ВАШ_PARK_ID" \
  -H "Content-Type: application/json" \
  -d '{"query":{"park":{"id":"ВАШ_PARK_ID"}},"limit":1}'
```

Если в ответе JSON с `"driver_profiles": [...]` — ключ и парк рабочие. Если ошибка — по коду и телу ответа смотри таблицу ниже.

| Код HTTP | Что значит | Что проверить |
|----------|------------|----------------|
| **401** | Ключ невалидный или просрочен | Скопировать ключ заново из fleet.yandex.ru → Настройки → API. Копировать значение ключа, а не его номер. |
| **403** | Ключ валидный, нет прав | В кабинете включить доступ к Driver Profiles (список водителей). При необходимости создать новый ключ с нужными правами. |
| **404** | Park ID неверный | Убедиться, что park_id из Настройки → Общая информация → ID парка. |
| **429** | Rate limit | Подождать 1–2 минуты. В коде уже есть retry. |
| **500 / 502 / 503** | Ошибка на стороне Yandex | Повторить позже (5–15 минут). |

Эти изменения (логи + код ответа Fleet на экране) дают возможность **однозначно понять**, на каком шаге и по какой причине падает поток лида.
