# Промпт: интеграция Yandex Fleet API (валидировано)

Технический промпт для реализации связки «менеджер → водители» через Yandex Fleet API. Наша БД хранит связи; Яндекс — источник правды о статусах и деньгах.

---

## 1. Официальная документация

- **Портал:** [API Яндекс.Такси для партнеров](https://fleet.yandex.ru/docs/api/ru/)
- **Базовый URL API:** `https://fleet-api.taxi.yandex.net` ✅ (именно этот хост в актуальной документации)
- **Авторизация:** [Авторизация](https://fleet.yandex.ru/docs/api/ru/authorization) — park_id, X-Client-ID (вида `taxi/park/...`), X-API-Key. Получить: Диспетчерская → Настройки → API (роль «Директор»).

---

## 2. Validation: URL и заголовки

| Элемент | Статус | Примечание |
|--------|--------|------------|
| Базовый URL | ✅ | `https://fleet-api.taxi.yandex.net` (не сокращённый fleet-api.yandex.net) |
| X-Client-ID | Обязательно | Идентификатор клиента из кабинета (обычно вида `taxi/park/{park_id}`). Берётся в Настройки → API при создании ключа. |
| X-API-Key | Обязательно | Секретный API-ключ |
| ID парка | В теле запроса | В методе `driver-profiles/list` передаётся в `query.park.id`. В заголовках по официальной документации только X-Client-ID и X-API-Key (X-Park-ID не используется). |

---

## 3. Метод POST /v1/parks/driver-profiles/list

**Полный URL:** `https://fleet-api.taxi.yandex.net/v1/parks/driver-profiles/list`

### А. Поиск по телефону (query.text)

- Параметр **`query.text`** существует и работает.
- Поиск по вхождению строки в: **ФИО**, **номер ВУ**, **номер телефона** (любой формат; лучше нормализовать в `+7...`, как в диспетчерской).

### Б. Список «моих водителей» (батч по ID)

- **Не делать** цикл с `query.text` по каждому водителю — долго и лимиты.
- Использовать **`query.park.driver_profile.id`** — массив из 50–100 `driver_profile_id` за один запрос (в OpenAPI поле фильтра называется `id`, не `ids`).

Пример тела для списка по ID:

```json
{
  "query": {
    "park": {
      "id": "PARK_ID",
      "driver_profile": {
        "id": ["id_voditelya_1", "id_voditelya_2", "id_voditelya_3"]
      }
    }
  },
  "fields": { ... }
}
```

### В. Проекция (fields)

- **account** → в ответе **`accounts`** (массив; обычно берём первый счёт).
- **driver_profile** → **`id`**, **`work_status`**, **`first_name`**, **`last_name`**, **`phones`** (имя и телефон в профиле; в ответе нет блока `person`, только `driver_profile`).

---

## 4. Схема БД (Prisma)

Явная связь менеджер ↔ водители (одна модель Agent недостаточна, если один менеджер ведёт много водителей):

```prisma
model Manager {
  id         String   @id @default(uuid())
  telegramId String?  @unique  // Telegram user ID менеджера
  name       String?
  drivers    DriverLink[]
}

model DriverLink {
  id             String   @id @default(uuid())
  managerId      String
  manager        Manager  @relation(fields: [managerId], references: [id], onDelete: Cascade)
  yandexDriverId String   // driver_profile_id из Яндекса
  driverPhone    String   // Для поиска, если ID сменится
  cachedName     String?  // Кэш имени, чтобы не дергать API каждый раз
  createdAt      DateTime @default(now())

  @@unique([managerId, yandexDriverId])
  @@index([managerId])
}
```

---

## 5. Итоговый план реализации

1. **`api/src/lib/yandex-fleet.ts`**
   - **`findDriverByPhone(phone: string)`** — запрос с `query.text` (телефон в формате +7…), возврат `{ yandexId, name, phone, balance, workStatus }` или `null`.
   - **`getDriversStatus(driverIds: string[])`** — запрос с `query.park.driver_profile.ids` (до 50–100 ID), возврат массива данных по водителям (статус, баланс и т.д.).

2. **API Route `POST /api/manager/link-driver`**
   - Принимает телефон водителя (и идентификатор менеджера, например из сессии/initData).
   - Вызывает `findDriverByPhone(phone)`.
   - Если водитель найден в Яндексе → создаёт запись в `DriverLink` (managerId, yandexDriverId, driverPhone, cachedName).
   - Возвращает успех и данные водителя.

3. **API Route `GET /api/manager/drivers`**
   - По текущему менеджеру (telegramUserId или session) выбирает все `DriverLink`.
   - Собирает массив `yandexDriverId`.
   - Один вызов `getDriversStatus(driverIds)`.
   - Мерджит: имя из БД (cachedName) + статус/баланс из API → отдаёт фронту.

4. **Конфиг и безопасность**
   - В config/env: `YANDEX_PARK_ID`, `YANDEX_CLIENT_ID`, `YANDEX_API_KEY`.
   - Ключи только на бэкенде; не логировать и не отдавать на фронт.

---

## 6. Ссылки

- [Введение](https://fleet.yandex.ru/docs/api/ru/)
- [Авторизация](https://fleet.yandex.ru/docs/api/ru/authorization)
- [Взаимодействие](https://fleet.yandex.ru/docs/api/ru/interaction)
- [Ресурсы API (driver-profiles/list и др.)](https://fleet.yandex.ru/docs/api/ru/all-resources)
