# Деплой API на Vercel (Serverless Functions)

> **Используется один проект API** (например `taxi-botapi`). Проект **taxi-bot-api-v2** в Vercel не нужен — его можно удалить или отвязать от репо, чтобы не было лишних деплоев и писем об ошибках. Подробнее: [docs/VERCEL_PROJECTS.md](docs/VERCEL_PROJECTS.md).

API (Fastify) можно развернуть на Vercel как **одну serverless-функцию** (Fluid Compute). Тогда не нужен отдельный хостинг (Railway и т.д.) — и WebApp, и API могут быть на Vercel (в двух проектах или в одном с разными настройками).

## Как это устроено

- В **api/** точка входа — `src/index.ts`: создаётся Fastify-приложение и **export default app**.
- Локально приложение слушает порт (`npm run dev` в `api/`).
- На Vercel переменная `VERCEL` задана — **listen** не вызывается, Vercel сам передаёт запросы в приложение (zero-config Fastify).

База данных — **Neon** (или любой PostgreSQL). Переменные `DATABASE_URL` и `DIRECT_URL` задаются в настройках проекта Vercel.

---

## Вариант 1: Отдельный проект Vercel для API (рекомендуется)

Один репозиторий — **два проекта** в Vercel:

1. **Проект «WebApp»** — уже настроен: Root Directory не задан (или корень), сборка `webapp/`, output `webapp/dist`. Домен: `https://ваш-проект.vercel.app`.
2. **Проект «API»** — новый:
   - **New Project** → импорт того же репо (например SkillBar/Taxi_bot).
   - **Root Directory:** `api`.
   - **Framework Preset:** Other (или оставить авто).
   - **Build Command:** `npm ci && npx prisma generate && npm run build`.
   - **Output Directory:** оставить пустым или `dist` (для Vercel Functions выход не обязателен).
   - **Install Command:** `npm ci`.

### Переменные окружения (API-проект)

В **Settings → Environment Variables** добавьте:

| Переменная     | Значение |
|----------------|----------|
| `DATABASE_URL` | Pooled-строка Neon (с `-pooler` в хосте). |
| `DIRECT_URL`   | Direct-строка Neon (для сборки/миграций). |
| `BOT_TOKEN`    | Токен от @BotFather. |
| `WEBAPP_URL`   | URL Mini App со слэшем, например `https://ваш-проект.vercel.app/`. |
| `API_SECRET`   | Секрет для запросов бота к API. |

После деплоя возьмите **URL проекта API**, например: `https://taxi-bot-api.vercel.app`. Все маршруты API будут под этим доменом:

- `https://taxi-bot-api.vercel.app/health`
- `https://taxi-bot-api.vercel.app/api/agents/...`
- `https://taxi-bot-api.vercel.app/api/drafts/...`
- и т.д.

### Схема БД при первом деплое

Таблицы в Neon нужно создать один раз. Варианты:

- **Локально:** в `.env` в корне задайте те же `DATABASE_URL` и `DIRECT_URL`, затем:
  ```bash
  cd api && npx prisma db push && npm run db:seed
  ```
- **Или** добавьте в Build Command перед `npm run build`: `npx prisma db push` (тогда при каждой сборке будет применяться схема; для продакшена часто достаточно одного ручного запуска).

### Mini App и бот

- В **WebApp-проекте** Vercel в переменных задайте `VITE_API_URL` = URL API **без** слэша, например `https://taxi-bot-api.vercel.app`, и сделайте Redeploy.
- Бот (Railway или локально) в `API_URL` укажите тот же URL API.

---

## Вариант 2: Один проект Vercel (WebApp + API в одном домене)

Если хотите один домен, например `https://ваш-проект.vercel.app` для статики и `https://ваш-проект.vercel.app/api` для бэкенда, нужно собрать и статику, и API в одном проекте.

1. **Сборка:** в корне собирать и `webapp`, и `api` (например два шага в Build Command или отдельные скрипты).
2. **Точка входа Fastify для Vercel** должна быть на верхнем уровне (например `api/index.ts` в корне репо), потому что Vercel ищет entrypoint в корне или в `src/`. Либо оставить структуру и в **vercel.json** явно указать функции из папки `api/`.

Текущая конфигурация репозитория (сборка только `webapp/`) рассчитана на **два проекта** (WebApp и API). Для одного проекта с API потребуется доработать `vercel.json` и, возможно, вынести общий entrypoint — при необходимости это можно описать отдельно.

---

## Краткий чек-лист (API на Vercel + Neon)

| # | Действие |
|---|----------|
| 1 | Neon: создать проект, скопировать pooled и direct connection strings. |
| 2 | Vercel: New Project → тот же репо, **Root Directory: `api`**. |
| 3 | Build: `npm ci && npx prisma generate && npm run build`. |
| 4 | Variables: `DATABASE_URL`, `DIRECT_URL`, `BOT_TOKEN`, `WEBAPP_URL`, `API_SECRET`. |
| 5 | Один раз применить схему: локально `cd api && npx prisma db push` (и при необходимости `npm run db:seed`). |
| 6 | В проекте WebApp задать `VITE_API_URL` = URL API-проекта → Redeploy. |
| 7 | Бот: `API_URL` = URL API-проекта. |

Лимиты Vercel Functions (время выполнения, размер) см. в [документации Vercel](https://vercel.com/docs/functions). Для типичного Mini App API этого достаточно.
