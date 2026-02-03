# Что делать дальше после деплоя WebApp на Vercel

WebApp уже на Vercel. Чтобы бот и Mini App работали в Telegram, сделайте по шагам ниже.

---

## Шаг 1. URL Mini App в BotFather

1. Откройте **@BotFather** в Telegram.
2. Выберите вашего бота (например AntonyTaxi).
3. **Settings** → **Mini Apps**.
4. Укажите **URL приложения** — ваш адрес Vercel **со слэшем в конце**:
   ```text
   https://ваш-проект.vercel.app/
   ```
   (точный URL смотрите в панели Vercel → проект → **Domains**.)

После этого кнопка «Регистрация исполнителя» в боте будет открывать ваш Mini App.

---

## Шаг 2. Задеплоить API (бэкенд)

Mini App ходит в API (агенты, черновики, тарифы). API нужно поднять отдельно.

**Деплой с базой Neon (PostgreSQL в облаке)** — пошагово: **[NEON_DEPLOY.md](NEON_DEPLOY.md)** (Neon + Railway, переменные, Vercel, бот).  
**API на Vercel (Serverless)** — отдельный проект Vercel для API: **[VERCEL_API_DEPLOY.md](VERCEL_API_DEPLOY.md)** (Neon + переменные, один репо — два проекта).

**Вариант А: Railway + встроенная PostgreSQL**

1. [railway.app](https://railway.app) → войдите через GitHub.
2. **New Project** → **Deploy from GitHub repo** → выберите **SkillBar/Taxi_bot**.
3. В настройках сервиса:
   - **Root Directory:** `api`
   - **Build Command:** `npm ci && npx prisma generate && npm run build`
   - **Start Command:** `npx prisma db push && node dist/index.js`
4. В проекте **New** → **Database** → **PostgreSQL**; Railway выдаст `DATABASE_URL`. В **Variables** сервиса API добавьте `DATABASE_URL` и `DIRECT_URL` (можно тот же URL), плюс `BOT_TOKEN`, `WEBAPP_URL`, `API_SECRET`.
5. Возьмите **публичный URL** API (например `https://taxi-bot-api.up.railway.app`).

**Вариант Б: Render, Fly.io, VPS** — развернуть папку `api/`, задать `DATABASE_URL`, `DIRECT_URL` (для Neon — pooled и direct), `BOT_TOKEN`, `WEBAPP_URL`, получить HTTPS-URL API.

---

## Шаг 3. Указать API в Vercel (для Mini App)

Чтобы Mini App с Vercel ходил в ваш API:

1. Vercel → ваш проект → **Settings** → **Environment Variables**.
2. Добавьте переменную:
   - **Name:** `VITE_API_URL`
   - **Value:** URL вашего API **без** слэша в конце, например:
     ```text
     https://taxi-bot-api.up.railway.app
     ```
3. Сохраните и сделайте **Redeploy** (Deployments → … → Redeploy), чтобы новый `VITE_API_URL` попал в сборку.

После этого приложение на Vercel будет отправлять запросы на ваш API.

---

## Шаг 4. Запустить бота

Бот (папка `bot/`) должен работать 24/7 и знать URL API и Mini App.

**Вариант А: тот же Railway**

1. В том же проекте Railway **New** → **GitHub Repo** → снова **SkillBar/Taxi_bot**.
2. У сервиса бота:
   - **Root Directory:** `bot`
   - **Build Command:** `npm ci` (или `npm run build`, если есть).
   - **Start Command:** `npx tsx src/index.ts` или `node dist/index.js`.
3. **Variables:**
   - `BOT_TOKEN` — токен BotFather.
   - `API_URL` — URL вашего API (как в шаге 2), например `https://taxi-bot-api.up.railway.app`.
   - `WEBAPP_URL` — `https://ваш-проект.vercel.app/`
   - `API_SECRET` — та же строка, что и в API.

**Вариант Б: локально**

В корне проекта в `.env` задайте `BOT_TOKEN`, `API_URL`, `WEBAPP_URL`, `API_SECRET` и запускайте:

```bash
cd bot && npm run dev
```

---

## Шаг 5. Проверка

1. Откройте бота в Telegram → **/start**.
2. Отправьте контакт с номером, который есть в БД (например +79991234567 после сида).
3. Введите почту `*@yandex.ru`.
4. В меню нажмите **«Регистрация исполнителя»** — должен открыться Mini App с Vercel (первый экран: лого и выбор «Водитель» / «Доставка/курьер»).
5. Пройдите форму до конца и убедитесь, что данные доходят до API (проверьте логи API и БД).

---

## Краткий чек-лист

| # | Действие |
|---|----------|
| 1 | В BotFather → Mini Apps указать `https://ваш-проект.vercel.app/` |
| 2 | Задеплоить API (Railway/Render и т.д.), подключить PostgreSQL, задать BOT_TOKEN, WEBAPP_URL, DATABASE_URL |
| 3 | В Vercel → Environment Variables добавить `VITE_API_URL` = URL API → Redeploy |
| 4 | Запустить бота (Railway или локально) с BOT_TOKEN, API_URL, WEBAPP_URL, API_SECRET |
| 5 | Проверить: /start → контакт → почта → «Регистрация исполнителя» → открывается Mini App |

Если на каком-то шаге что-то не работает — напишите, на каком шаге и что именно происходит (ошибка в логах, в Telegram и т.д.).
