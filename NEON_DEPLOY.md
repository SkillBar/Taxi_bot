# Деплой API с базой данных Neon (PostgreSQL)

Mini App обращается к API (агенты, черновики, тарифы). Здесь — пошаговый деплой **бэкенда** с БД в **Neon** и хостингом API на **Railway** (или Render / Fly.io).

**Альтернатива:** развернуть API на **Vercel** как serverless-функцию (один репо — два проекта: WebApp + API). См. **[VERCEL_API_DEPLOY.md](VERCEL_API_DEPLOY.md)**.

**Управление схемой из GitHub:** если Neon связан с репозиторием (добавлены секреты `NEON_API_KEY`, `NEON_PROJECT_ID`), при каждом пуше в ветки `main` или `vercel` запускается workflow **Neon — Prisma db push** (`.github/workflows/neon-prisma-push.yml`): он получает connection URI через Neon API и выполняет `prisma db push`. Запуск вручную: **Actions** → **Neon — Prisma db push** → **Run workflow**.

---

## Часть 1. База данных в Neon

### 1.1. Создать проект в Neon

1. Зайдите на [console.neon.tech](https://console.neon.tech) и войдите (или зарегистрируйтесь).
2. **New Project** → укажите имя (например `taxi-bot`) и регион.
3. Создайте проект — Neon создаст БД и выдаст строки подключения.

### 1.2. Получить строки подключения

1. В проекте откройте **Dashboard** → вкладка **Connection details** (или **Connect**).
2. Скопируйте **две** строки:
   - **Pooled connection** (в хосте есть `-pooler`) — для приложения (много коротких подключений).
   - **Direct connection** (без `-pooler`) — для миграций и `prisma db push`.

Формат:

- **Pooled (для API в проде):**
  ```text
  postgresql://USER:PASSWORD@ep-xxxxx-pooler.REGION.aws.neon.tech/neondb?sslmode=require
  ```
- **Direct (для Prisma CLI):**
  ```text
  postgresql://USER:PASSWORD@ep-xxxxx.REGION.aws.neon.tech/neondb?sslmode=require
  ```

При необходимости добавьте таймаут для «холодного» старта (Neon может засыпать):

```text
?sslmode=require&connect_timeout=15
```

---

## Часть 2. Деплой API на Railway

### 2.1. Создать проект и сервис API

1. [railway.app](https://railway.app) → войдите через GitHub.
2. **New Project** → **Deploy from GitHub repo** → выберите репозиторий (например **SkillBar/Taxi_bot**).
3. В настройках **сервиса** (не проекта):
   - **Root Directory:** `api`
   - **Build Command:** `npm ci && npx prisma generate && npm run build`
   - **Start Command:** `npx prisma db push && node dist/index.js`  
     (или только `node dist/index.js`, если схему уже применили вручную один раз).

### 2.2. Переменные окружения (Variables)

В Railway у сервиса API откройте **Variables** и добавьте:

| Переменная      | Значение |
|-----------------|----------|
| `DATABASE_URL`  | **Pooled** строка из Neon (с `-pooler` в хосте). |
| `DIRECT_URL`    | **Direct** строка из Neon (без `-pooler`) — для `prisma db push` при деплое. |
| `BOT_TOKEN`     | Токен от @BotFather. |
| `WEBAPP_URL`    | URL Mini App со слэшем, например `https://ваш-проект.vercel.app/`. |
| `API_SECRET`    | Любая строка-секрет для запросов бота к API. |
| `PORT`          | По желанию; Railway обычно задаёт сам (например `3000`). |

Важно: для Neon в проде используйте именно **pooled** URL в `DATABASE_URL`, чтобы не упираться в лимиты подключений.

### 2.3. Деплой и URL API

1. Сохраните переменные — Railway пересоберёт и запустит сервис.
2. В настройках сервиса включите **Generate Domain** (или добавьте свой домен).
3. Скопируйте **публичный URL API**, например: `https://api-xxx.up.railway.app` (без слэша в конце).

После первого деплоя таблицы создадутся за счёт `npx prisma db push`. При необходимости один раз можно выполнить сид:

- Локально: задайте в `.env` те же `DATABASE_URL` и `DIRECT_URL` (Neon), затем:
  ```bash
  cd api && npx prisma db push && npm run db:seed
  ```
- Либо добавьте в Start Command перед `node`: `npx prisma db push` (уже указано выше) и при необходимости сидите один раз вручную через Prisma Studio или скрипт.

---

## Часть 3. Указать API в Vercel (Mini App)

Чтобы Mini App с Vercel ходил в ваш API:

1. Vercel → проект → **Settings** → **Environment Variables**.
2. Добавьте:
   - **Name:** `VITE_API_URL`
   - **Value:** URL API **без** слэша в конце, например `https://api-xxx.up.railway.app`.
3. Сохраните и сделайте **Redeploy** (Deployments → … → Redeploy).

---

## Часть 4. Запуск бота

Бот должен знать URL API и Mini App.

**На Railway (в том же проекте):**

1. **New** → **GitHub Repo** → тот же репо.
2. У сервиса бота:
   - **Root Directory:** `bot`
   - **Build Command:** `npm ci`
   - **Start Command:** `npx tsx src/index.ts` (или `node dist/index.js`, если есть build).
3. **Variables:** `BOT_TOKEN`, `API_URL` (URL API из шага 2.3), `WEBAPP_URL`, `API_SECRET`.

**Локально:** в `.env` задайте `BOT_TOKEN`, `API_URL`, `WEBAPP_URL`, `API_SECRET` и запускайте `cd bot && npm run dev`.

---

## Краткий чек-лист (Neon + Railway)

| # | Действие |
|---|----------|
| 1 | Neon: создать проект, скопировать **pooled** и **direct** connection strings. |
| 2 | Railway: New Project → Deploy from GitHub, Root Directory `api`. |
| 3 | Variables: `DATABASE_URL` (pooled), `DIRECT_URL` (direct), `BOT_TOKEN`, `WEBAPP_URL`, `API_SECRET`. |
| 4 | Build: `npm ci && npx prisma generate && npm run build`. Start: `npx prisma db push && node dist/index.js`. |
| 5 | Взять публичный URL API → в Vercel задать `VITE_API_URL` → Redeploy. |
| 6 | Запустить бота (Railway или локально) с `API_URL` и остальными переменными. |

---

## Локальная разработка с Neon

Если хотите разрабатывать локально, но использовать БД в Neon:

1. В корне проекта скопируйте `.env.example` в `.env`.
2. В `.env` задайте:
   - `DATABASE_URL` — **pooled** строка Neon.
   - `DIRECT_URL` — **direct** строка Neon.
3. В `api/`:
   ```bash
   cd api && npm install && npx prisma generate && npx prisma db push
   npm run db:seed   # при необходимости
   npm run dev
   ```

Для локального PostgreSQL оставьте `DATABASE_URL` и `DIRECT_URL` указывающими на localhost (или одинаковые); схема поддерживает оба варианта.
