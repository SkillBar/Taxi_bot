# Архитектура проекта (техническое описание для AI)

Монорепозиторий: **Telegram Mini App** для регистрации исполнителей (водитель/курьер) + **Backend API** + **Telegram-бот**. Один репозиторий, три деплоя. Все три части уже задеплоены; Mini App протестирован.

---

## 1. Структура репозитория (дерево)

```
/
├── api/                    # Backend API (отдельный проект Vercel, Root Directory: api)
│   ├── index.js            # Vercel Serverless entry: handler(req,res) → app.ready() + app.server.emit
│   ├── vercel.json         # rewrites: (.*) → /index.js (без builds — настройки из Project Settings)
│   ├── package.json        # type:module, main:_dist/index.js, build: tsc --outDir ./_dist, public создаётся в build
│   ├── public/             # пустая папка (.gitkeep) — нужна Vercel Output Directory
│   ├── prisma/
│   │   ├── schema.prisma   # PostgreSQL (Neon), модели Agent, Draft, ExecutorTariff и др.
│   │   └── seed.ts
│   └── src/
│       ├── app.ts          # Fastify app: buildApp(), export default app, listen только при !process.env.VERCEL
│       ├── index.ts        # re-export app из app.js
│       ├── config.ts       # port, host, env (DATABASE_URL, DIRECT_URL, AGENT_CHECK_URL…)
│       ├── db.ts           # Prisma client
│       ├── routes/
│       │   ├── agent.ts    # Агенты: check, me, link, link-from-bot
│       │   ├── draft.ts    # CRUD черновиков регистрации
│       │   ├── executor-tariffs.ts
│       │   ├── manager.ts  # Менеджер/Fleet: me, drivers, link-driver, connect-fleet
│       │   ├── stats.ts
│       │   └── yandex-oauth.ts # OAuth для водителей
│       └── lib/
│           ├── telegram.ts # Валидация initData
│           └── yandex-fleet.ts # Fleet API: парки, водители, валидация ключа
├── webapp/                 # Mini App (отдельный проект Vercel, Root: webapp)
│   ├── index.html
│   ├── package.json        # React 18, Vite 5, react-router-dom
│   ├── public/
│   │   └── test-api.html   # Страница проверки связи с API (без Telegram)
│   ├── vite.config.ts
│   └── src/
│       ├── main.tsx        # React root, Telegram WebApp ready()
│       ├── App.tsx         # Роутинг: онбординг → главный экран → регистрация/менеджер
│       ├── api.ts          # Базовый fetch к VITE_API_URL
│       ├── lib/api.ts      # API-клиент: agents, manager, drafts
│       ├── telegramWebApp.ts
│       ├── RegistrationFlow.tsx  # Многошаговая форма регистрации
│       └── components/
│           ├── OnboardingScreen.tsx  # Контакт + подключение Fleet (API-ключ)
│           ├── SimpleHomeScreen.tsx  # Главный экран агента (список водителей, добавить)
│           ├── AgentHomeScreen.tsx   # Альтернативный главный экран
│           ├── ManagerDashboard.tsx  # Кабинет менеджера
│           └── DriverDetails.tsx     # Карточка водителя
├── bot/                    # Telegram-бот (задеплоен, напр. Railway)
│   ├── package.json        # Grammy, dotenv
│   └── src/
│       ├── index.ts        # Обработка /start, контакт, email, кнопка «Регистрация исполнителя» → open WebApp URL
│       └── config.ts       # BOT_TOKEN, API_URL, WEBAPP_URL, API_SECRET
├── .env                    # Локальные переменные (не в git): DATABASE_URL, DIRECT_URL, BOT_TOKEN, API_URL, WEBAPP_URL, API_SECRET, VITE_API_URL…
├── .env.example
├── vercel.json             # Для проекта WebApp: buildCommand, outputDirectory: webapp/dist, rewrites для assets
└── .github/workflows/      # neon-prisma-push.yml — при push в main/vercel: Prisma db push в Neon по API
```

---

## 2. API (Backend)

- **Стек:** Node.js, **Fastify 4**, **Prisma 5**, PostgreSQL (Neon). TypeScript, ESM (`"type": "module"`).
- **Сборка:** `npm run build` → `mkdir -p public && rm -rf dist && tsc --outDir ./_dist`. Исходники в `api/src/`, артефакты в `api/_dist/`. Папка `_dist` — чтобы Vercel не сканировал её как отдельные serverless-функции.
- **Точка входа на Vercel:** `api/index.js` (не из `_dist`). Это обычный JS-файл: `import app from "./_dist/index.js"`, `export default async function handler(req, res) { await app.ready(); app.server.emit("request", req, res); }`. Vercel вызывает эту функцию; Fastify обрабатывает запрос.
- **Маршруты:** `/health`; `/api/agents/*` (check, me, link, link-from-bot); `/api/drafts/*`; `/api/manager/*` (me, drivers, link-driver, **POST connect-fleet** — сохранение API-ключа Fleet и parkId); `/api/executor-tariffs/*`; `/api/stats/*`; `/api/yandex-oauth/*`. CORS включён.
- **Данные:** Prisma, схема в `api/prisma/schema.prisma`. Для Neon: `DATABASE_URL` (pooled), `DIRECT_URL` (direct, для миграций). Опционально: внешняя проверка агента (`AGENT_CHECK_URL`).
- **Деплой:** Отдельный проект Vercel, **Root Directory: `api`**. Build/Install команды задаются в Project Settings (не в `api/vercel.json`). Output Directory: `public` (пустая папка создаётся в build). В `api/vercel.json` только `rewrites`, без `builds`.

---

## 3. Webapp (Mini App)

- **Стек:** **React 18**, **Vite 5**, TypeScript. Одна страница (SPA), роутинг при необходимости через react-router-dom.
- **Вход:** `index.html` → `main.tsx` → `App.tsx`. В `main.tsx` вызывается `Telegram.WebApp.ready()`.
- **Логика:**
  1. **Онбординг (OnboardingScreen):** `GET /api/agents/me` → при `linked: false` шаг «Подтвердить номер» (requestContact → бот линкует через link-from-bot → опрос me до linked). Затем `GET /api/manager/me`: при `hasFleet: false` шаг «Подключите Fleet» — ввод API-ключа → **POST /api/manager/connect-fleet**; при успехе переход на главный экран.
  2. **Главный экран (SimpleHomeScreen):** приветствие, список исполнителей из `GET /api/manager/drivers`, добавление водителя по телефону (`POST /api/manager/link-driver`), кнопки «Зарегистрировать водителя», «Регистрация доставка/курьер», «Кабинет менеджера».
  3. **Регистрация:** выбор типа → getCurrentDraft/createDraft → многошаговая форма в `RegistrationFlow.tsx`.
- Запросы к API: `src/api.ts` (базовый URL из `VITE_API_URL`) и `src/lib/api.ts` (axios с `x-telegram-init-data`).
- **Сборка:** `npm run build` в папке webapp → `vite build`, выход в `webapp/dist`.
- **Деплой:** Отдельный проект Vercel (или корень с настройками в корневом `vercel.json`): buildCommand/outputDirectory указывают на webapp. В Production переменные задают `VITE_API_URL` = URL API-проекта.

---

## 4. Bot (Telegram)

- **Стек:** Node.js, **Grammy**, TypeScript, ESM.
- **Роль:** Принимает /start, запрашивает контакт и email, показывает кнопку «Регистрация исполнителя». По нажатию открывает Mini App: `openWebApp(WEBAPP_URL)` (URL WebApp с Vercel).
- **Конфиг:** `BOT_TOKEN`, `API_URL` (куда бот шлёт запросы, например проверка агента), `WEBAPP_URL` (URL Mini App со слэшем), `API_SECRET` (общий с API). **Бот уже задеплоен** (например, на Railway); локально: `npm run dev` в `bot/`.

---

## 5. Связи между частями

- **Mini App ↔ API:** браузер в Telegram открывает WebApp (Vercel); WebApp дергает `VITE_API_URL` (тот же API на Vercel).
- **Bot ↔ API:** бот вызывает API по `API_URL` (линковка агента по контакту: `POST /api/agents/link-from-bot` с `X-Api-Secret`).
- **Bot ↔ Mini App:** бот открывает WebApp по `WEBAPP_URL` (в BotFather задан тот же URL).
- **API ↔ БД:** Prisma, Neon PostgreSQL. Схема применяется через `prisma db push` (вручную или через GitHub Actions с секретами Neon).

### 5.1. Схема: онбординг по контакту и список исполнителей

1. **Запрос контакта в Mini App**  
   Пользователь нажимает «Подтвердить номер» → вызывается `Telegram.WebApp.requestContact(callback)`. Номер в Mini App **не приходит** — его получает только бот.

2. **Бот получает контакт**  
   Telegram шлёт боту `message:contact` (номер телефона). Бот обрабатывает **любой** контакт (не только после /start): нормализует номер → `GET /api/agents/check?phone=...` → при `found: true` вызывает `POST /api/agents/link-from-bot` с заголовком `X-Api-Secret` и телом `{ phone, telegramUserId }`.

3. **API привязывает агента**  
   `link-from-bot` проверяет секрет, ищет/создаёт агента по номеру (в т.ч. через AGENT_CHECK_URL), обновляет `Agent.telegramUserId`. После этого `GET /api/agents/me` с initData возвращает `linked: true`.

4. **Mini App узнаёт о привязке**  
   После `requestContact(callback(true))` Mini App опрашивает `GET /api/agents/me` каждые 1.5 с; при `linked: true` переходит на главный экран.

5. **Список исполнителей на фронте**  
   Главный экран с заголовком `x-telegram-init-data` вызывает `GET /api/manager/drivers`. API по initData определяет пользователя, создаёт/находит Manager по `telegramId`, возвращает список DriverLink (из БД) с актуальными статусами/балансами из Yandex Fleet API. Фронт отображает список; при отсутствии водителей — «Исполнители не найдены». Добавление водителя — `POST /api/manager/link-driver` с `{ phone }`, поиск по Yandex Fleet и создание DriverLink.

---

## 6. Переменные окружения (кратко)

| Переменная       | Где        | Назначение |
|------------------|------------|------------|
| DATABASE_URL     | API        | PostgreSQL (pooled, Neon) |
| DIRECT_URL       | API        | PostgreSQL direct (миграции) |
| BOT_TOKEN        | Bot, API   | Telegram Bot API |
| WEBAPP_URL       | API, Bot   | URL Mini App (со слэшем) |
| API_SECRET       | API, Bot   | Секрет для запросов бота к API |
| VITE_API_URL     | Webapp build | Базовый URL API (без слэша) |
| API_URL          | Bot        | URL API для запросов бота |

---

## 7. Документация и скрипты

| Путь | Назначение |
|------|------------|
| **docs/DEBUG_FLOW.md** | Отладка онбординга и Fleet (шаги, типичные ошибки). |
| **docs/DEPLOY_SERVER.md** | Деплой API/бота на свой сервер (не Vercel). |
| **docs/PREFLIGHT_CHECK.md** | Чеклист перед деплоем (переменные, URL). |
| **docs/YANDEX_FLEET_ОТВЕТ.md** | Ответы Fleet API и коды ошибок (русский текст). |
| **docs/YANDEX_OAUTH_DRIVER.md** | OAuth для водителей (Яндекс). |
| **VERCEL_DEPLOY.md**, **VERCEL_API_DEPLOY.md** | Деплой WebApp и API на Vercel. |
| **NEON_DEPLOY.md**, **POSTGRES_SETUP.md** | БД: Neon и локальный PostgreSQL. |
| **scripts/check-keys-before-deploy.mjs** | Проверка env перед деплоем (API, Bot, Webapp). |
| **scripts/test-fleet-key.mjs** | Проверка API-ключа Fleet (parks/info, parks/list, drivers). |
| **webapp/public/test-api.html** | Страница проверки связи с API (открыть после деплоя webapp). |

---

Итого: **API** — Fastify + Prisma на Vercel (serverless, entry `api/index.js` → `_dist`). **Webapp** — React + Vite на Vercel, ходит в API по `VITE_API_URL`. **Bot** — Grammy (напр. Railway), открывает WebApp и дергает API для link-from-bot.
