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
│       │   ├── agent.ts    # GET /api/agents/check?phone, POST /api/agents/link (telegramUserId)
│       │   ├── draft.ts    # CRUD черновиков регистрации
│       │   ├── executor-tariffs.ts
│       │   └── stats.ts
│       └── lib/
├── webapp/                 # Mini App (отдельный проект Vercel, сборка из корня или Root: webapp)
│   ├── index.html
│   ├── package.json        # React 18, Vite 5, react-router-dom
│   ├── vite.config.ts
│   └── src/
│       ├── main.tsx        # React root, Telegram WebApp ready()
│       ├── App.tsx         # Экраны: welcome → выбор driver/courier → getCurrentDraft/createDraft → RegistrationFlow
│       ├── RegistrationFlow.tsx  # Многошаговая форма регистрации
│       ├── api.ts          # fetch к VITE_API_URL (api/agents, api/drafts)
│       └── telegramWebApp.ts # Обёртка над window.Telegram.WebApp
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
- **Маршруты:** `/health`, `/api/agents/*` (в т.ч. `GET /me` — имя + linked, `POST /link` — привязка по телефону, initData в заголовке), `/api/drafts/*`, `/api/manager/*` (при настроенном Yandex Fleet: `GET /me`, `GET /drivers`, `POST /link-driver`), `/api/executor-tariffs/*`, `/api/stats/*`. CORS включён.
- **Данные:** Prisma, схема в `api/prisma/schema.prisma`. Для Neon: `DATABASE_URL` (pooled), `DIRECT_URL` (direct, для миграций). Опционально: внешняя проверка агента (`AGENT_CHECK_URL`).
- **Деплой:** Отдельный проект Vercel, **Root Directory: `api`**. Build/Install команды задаются в Project Settings (не в `api/vercel.json`). Output Directory: `public` (пустая папка создаётся в build). В `api/vercel.json` только `rewrites`, без `builds`.

---

## 3. Webapp (Mini App)

- **Стек:** **React 18**, **Vite 5**, TypeScript. Одна страница (SPA), роутинг при необходимости через react-router-dom.
- **Вход:** `index.html` → `main.tsx` → `App.tsx`. В `main.tsx` вызывается `Telegram.WebApp.ready()`.
- **Логика:**
  1. **Онбординг:** при первом входе вызывается `GET /api/agents/me`; если `linked: false` — показывается экран подключения по номеру Telegram (`OnboardingScreen`). Пользователь вводит телефон → `POST /api/agents/link` (initData в заголовке, телефон в body) → при успехе переход на главный экран.
  2. **Главный экран (AgentHomeScreen):** приветствие «{Имя}, добро пожаловать в кабинет агента такси!», блок «Исполнители» — список из `GET /api/manager/drivers` (Yandex Fleet API). Если список пуст — «Исполнители не найдены». Ниже: добавление водителя по телефону, кнопки «Зарегистрировать водителя», «Регистрация доставка/курьер», «Кабинет менеджера».
  3. **Регистрация:** выбор «Водитель» / «Доставка/курьер» → `getCurrentDraft()` / `createDraft(type)` → многошаговая форма в `RegistrationFlow.tsx`.
- Все запросы к бэкенду идут через `src/api.ts` и `src/lib/api.ts` (axios с `x-telegram-init-data`) на базовый URL из `import.meta.env.VITE_API_URL`.
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
- **Bot ↔ API:** бот может вызывать API по `API_URL` (например, линковка агента по телефону).
- **Bot ↔ Mini App:** бот открывает WebApp по `WEBAPP_URL` (в BotFather задан тот же URL).
- **API ↔ БД:** Prisma, Neon PostgreSQL. Схема применяется через `prisma db push` (вручную или через GitHub Actions с секретами Neon).

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

Итого: **API** — Fastify + Prisma на Vercel (serverless, entry `api/index.js` → `_dist`). **Webapp** — React + Vite на Vercel, ходит в API по `VITE_API_URL`, уже протестирован. **Bot** — Grammy, задеплоен (напр. Railway), открывает WebApp и при необходимости дергает API.
