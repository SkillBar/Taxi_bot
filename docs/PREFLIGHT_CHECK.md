# Чек-лист перед запуском (Pre-flight check)

Проверь эти пункты перед тестом Mini App (особенно кабинета менеджера) в Telegram.

---

## 1. VITE_API_URL и HTTPS

**Проблема:** Telegram открывает Mini App только по **HTTPS**. Если фронт в Telegram (https://...), а бэкенд локальный (`http://localhost:3001`), браузер заблокирует запросы (**Mixed Content**).

**Решение:**

- **Продакшен:** `VITE_API_URL` = URL задеплоенного API (например `https://taxi-botapi.vercel.app`). Сборка webapp на Vercel уже использует HTTPS.
- **Локальная разработка с Telegram:** оберни бэкенд в туннель (ngrok, localtunnel) и укажи этот URL при сборке фронта:
  ```bash
  # Пример с ngrok
  ngrok http 3001
  # В .env для сборки webapp:
  VITE_API_URL=https://xxxx.ngrok-free.app
  cd webapp && npm run build
  ```
  Либо тестируй только на задеплоенных фронте и API (оба по HTTPS).

---

## 2. CORS

**Проблема:** WebView Telegram блокирует запросы с фронта на бэкенд, если на бэкенде не разрешён origin фронта.

**Текущая настройка в API (Fastify):** `origin: true` — принимаются запросы с **любого** origin. Этого достаточно для разработки и теста.

**Продакшен (по желанию):** в `api/src/app.ts` можно ограничить origin, например:
```ts
origin: process.env.WEBAPP_ORIGIN ?? true, // например https://taxi-bot-rouge.vercel.app
```

---

## 3. Валидация initData на бэкенде

**Роуты `/api/manager/*`:**

- Требуют заголовок `x-telegram-init-data`.
- Если заголовок **пустой** или **невалидный** — ответ **401** с телом `{ "error": "Invalid or missing initData" }` (без падения).
- initData парсится через `validateInitData` (HMAC по BOT_TOKEN) и `parseInitData` (user.id).

**При тесте:**

- Открывай Mini App **из Telegram** — тогда заголовок будет заполнен.
- Локальный запуск в браузере (localhost) без Telegram даст пустой initData и 401 — это ожидаемо.
- Срок жизни initData ограничен; при долгой разработке при необходимости перезапусти Mini App в Telegram.

---

## Краткий чек-лист

| # | Проверка |
|---|----------|
| 1 | API доступен по HTTPS (продакшен или туннель). `VITE_API_URL` при сборке webapp указывает на этот URL. |
| 2 | CORS в API разрешает origin фронта (`origin: true` — разрешены все). |
| 3 | Кабинет менеджера открыт из Telegram (чтобы был валидный initData). При 401 — проверить заголовок и BOT_TOKEN на бэкенде. |
