# Что сделать сейчас — по шагам

Ниже порядок действий. Выполняйте по очереди.

---

## Шаг 1. База данных Neon

1. Зайдите на **[console.neon.tech](https://console.neon.tech)** и войдите (или зарегистрируйтесь).
2. **New Project** → имя (например `taxi-bot`) → Create.
3. В проекте откройте **Connection details** (или **Connect**).
4. Скопируйте **две** строки подключения:
   - **Pooled** (в адресе есть `-pooler`) — сохраните как `DATABASE_URL`.
   - **Direct** (без `-pooler`) — сохраните как `DIRECT_URL`.

Пока не закрывайте Neon — строки понадобятся в шагах 2 и 3.

---

## Шаг 2. Создать таблицы в Neon (один раз)

Локально в проекте:

1. В корне создайте/откройте файл **`.env`**.
2. Добавьте (подставьте свои строки из Neon):
   ```env
   DATABASE_URL="postgresql://...-pooler....neon.tech/neondb?sslmode=require"
   DIRECT_URL="postgresql://....neon.tech/neondb?sslmode=require"
   ```
3. В терминале выполните:
   ```bash
   cd api && npm install && npx prisma db push && npm run db:seed
   ```
   Так в Neon появятся таблицы и тестовый агент (для проверки бота).

---

## Шаг 3. Задеплоить API на Vercel (второй проект)

1. Зайдите на **[vercel.com](https://vercel.com)** → **Add New** → **Project**.
2. Импортируйте **тот же репозиторий**, что и для WebApp (например SkillBar/Taxi_bot).
3. В настройках проекта **перед деплоем**:
   - **Root Directory:** нажмите **Edit** → укажите **`api`** → Save.
   - **Framework Preset:** Other (или оставить авто).
   - **Build Command:** `npm ci && npx prisma generate && npm run build`.
   - **Install Command:** `npm ci`.
4. **Environment Variables** (обязательно до первого Deploy):
   - `DATABASE_URL` = pooled-строка из Neon
   - `DIRECT_URL` = direct-строка из Neon
   - `BOT_TOKEN` = токен от @BotFather
   - `WEBAPP_URL` = URL вашего WebApp **со слэшем**, например `https://ваш-веб-проект.vercel.app/`
   - `API_SECRET` = любая строка (например `my-secret-123`)
5. Нажмите **Deploy**.
6. После деплоя скопируйте **URL проекта API** (например `https://ваш-api.vercel.app`) — **без слэша в конце**. Он понадобится в шагах 4 и 6.

---

## Шаг 4. Подключить API к WebApp (Vercel)

1. В Vercel откройте **проект WebApp** (тот, где уже задеплоен фронт).
2. **Settings** → **Environment Variables**.
3. Добавьте переменную:
   - **Name:** `VITE_API_URL`
   - **Value:** URL API из шага 3 (без слэша), например `https://ваш-api.vercel.app`
4. Сохраните.
5. **Deployments** → у последнего деплоя нажмите **⋯** → **Redeploy**, чтобы новая переменная попала в сборку.

---

## Шаг 5. URL Mini App в BotFather

1. В Telegram откройте **@BotFather**.
2. Выберите вашего бота.
3. **Settings** → **Mini Apps**.
4. Укажите **URL приложения** — адрес WebApp **со слэшем в конце**, например:
   ```text
   https://ваш-веб-проект.vercel.app/
   ```

---

## Шаг 6. Запустить бота

Бот должен работать и знать URL API и WebApp.

**Вариант А — локально (проще для проверки):**

1. В корневом **`.env`** задайте (если ещё не задано):
   ```env
   BOT_TOKEN=ваш_токен_от_BotFather
   API_URL=https://ваш-api.vercel.app
   WEBAPP_URL=https://ваш-веб-проект.vercel.app/
   API_SECRET=та_же_строка_что_в_API
   ```
2. В терминале:
   ```bash
   cd bot && npm install && npm run dev
   ```
   Оставьте терминал открытым — бот работает, пока процесс запущен.

**Вариант Б — на Railway:** см. [NEXT_STEPS.md](NEXT_STEPS.md) (Шаг 4, Вариант А).

---

## Шаг 7. Проверить

1. В Telegram откройте бота → отправьте **/start**.
2. Отправьте **контакт** (номер телефона) — должен быть тот, что добавлен сидом (например +79991234567).
3. Введите почту на **@yandex.ru**.
4. В меню нажмите **«Регистрация исполнителя»** — должен открыться Mini App (экран с выбором «Водитель» / «Доставка/курьер»).
5. Пройдите форму до конца и убедитесь, что всё сохраняется (при необходимости проверьте логи API на Vercel и данные в Neon).

---

## Краткий чек-лист

| # | Действие |
|---|----------|
| 1 | Neon: создать проект, скопировать pooled и direct URL. |
| 2 | Локально: в `.env` добавить DATABASE_URL, DIRECT_URL → `cd api && npx prisma db push && npm run db:seed`. |
| 3 | Vercel: New Project → тот же репо, Root Directory `api`, переменные (DATABASE_URL, DIRECT_URL, BOT_TOKEN, WEBAPP_URL, API_SECRET) → Deploy → скопировать URL API. |
| 4 | В проекте WebApp на Vercel: добавить VITE_API_URL = URL API → Redeploy. |
| 5 | BotFather → Mini Apps → URL WebApp со слэшем. |
| 6 | Запустить бота локально (`cd bot && npm run dev`) или на Railway, с API_URL, WEBAPP_URL, API_SECRET в .env / Variables. |
| 7 | Проверить: /start → контакт → почта → «Регистрация исполнителя» → Mini App. |

Если что-то не получается — напишите, на каком шаге и какая ошибка (в логах, в Telegram или в Vercel).
