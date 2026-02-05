# Запуск локально

## 1. Переменные окружения

Создайте файл **`.env`** в корне проекта (рядом с `package.json`), если его ещё нет:

```bash
cp .env.example .env
```

Откройте `.env` и задайте:

- **BOT_TOKEN** — вставьте свой токен от @BotFather (замените `your_bot_token_here`).
- **DATABASE_URL** — строка подключения к PostgreSQL, например:
  ```text
  postgresql://USER:PASSWORD@localhost:5432/executor_bot
  ```
  Если PostgreSQL ещё не установлен:
  - **macOS (Homebrew):** `brew install postgresql@16` → `brew services start postgresql@16` → создайте БД: `createdb executor_bot`
  - **Windows:** установите [PostgreSQL](https://www.postgresql.org/download/windows/), создайте БД через pgAdmin или `psql -c "CREATE DATABASE executor_bot;"`

Остальные переменные в `.env` для локального запуска можно не менять:

- `API_URL=http://localhost:3001`
- `API_SECRET=local-secret` (любая строка, чтобы бот мог запрашивать статистику)
- `WEBAPP_URL=` — пока пусто (WebApp из Telegram будет работать после настройки туннеля, см. ниже)
- `VITE_API_URL=http://localhost:3001`

---

## 2. Установка зависимостей и база данных

В корне проекта выполните:

```bash
# Зависимости (уже установлены в api и bot)
cd api && npm install && cd ..
cd bot && npm install && cd ..
cd webapp && npm install && cd ..

# Схема БД и тестовый агент (нужен запущенный PostgreSQL и правильный DATABASE_URL в .env)
cd api
npx prisma generate
npx prisma db push
npm run db:seed
cd ..
```

Либо одной командой из корня (после настройки `.env`):

```bash
npm run setup
```

После `db:seed` в базе появится тестовый агент с номером **+79991234567**. Чтобы бот принял контакт, при первом входе отправьте контакт с этим номером (или с номером, который вы укажете в `SEED_AGENT_PHONE` в `.env` перед сидом).

---

## 3. Запуск трёх сервисов

Нужно держать запущенными **API**, **бот** и (по желанию) **WebApp**.

### Вариант А: три терминала

**Терминал 1 — API:**
```bash
npm run dev:api
```
Должно появиться: `Server listening at http://0.0.0.0:3001`.

**Терминал 2 — бот:**
```bash
npm run dev:bot
```
Бот должен запуститься без ошибок.

**Терминал 3 — WebApp (для разработки интерфейса):**
```bash
npm run dev:webapp
```
Откроется http://localhost:5173. В Telegram WebApp будет работать только по HTTPS (см. ниже).

### Вариант Б: один терминал (concurrently)

```bash
npm install -g concurrently
concurrently "npm run dev:api" "npm run dev:bot" "npm run dev:webapp"
```

---

## 4. Проверка бота

1. Откройте бота в Telegram (по ссылке из @BotFather).
2. Отправьте **/start**.
3. Нажмите **«Отправить контакт»** и выберите номер **+79991234567** (или тот, что добавлен сидом).
4. Введите почту Яндекс, например `test@yandex.ru`.
5. Должно появиться главное меню: «Посмотреть статистику», «Зарегистрировать водителя», «Зарегистрировать курьера».

Кнопки регистрации откроют WebApp только если задан **WEBAPP_URL** (HTTPS). Локально без туннеля можно проверять онбординг и статистику.

---

## 5. WebApp в Telegram (HTTPS при локальном запуске)

Telegram открывает Mini App **только по HTTPS**. Локальный `http://localhost:5173` в BotFather указать нельзя — нужен туннель.

**Кратко:**

1. В одном терминале: `npm run dev:webapp` (порт 5173).
2. В другом терминале: `ngrok http 5173`.
3. В выводе ngrok возьмите HTTPS-URL, например `https://abc123.ngrok-free.app`.
4. URL вашего Mini App: **`https://abc123.ngrok-free.app/webapp`** (обязательно с путём `/webapp`).
5. В **`.env`** в корне проекта:
   ```env
   WEBAPP_URL=https://abc123.ngrok-free.app/webapp
   ```
6. В **@BotFather → Settings → Mini Apps** укажите тот же URL.
7. Перезапустите бота — кнопка «Регистрация исполнителя» откроет Mini App.

Подробнее (ngrok, Cloudflare Tunnel, деплой): **[TELEGRAM_SETUP.md](TELEGRAM_SETUP.md)** — раздел «Как получить HTTPS при локальном запуске».

---

## Возможные ошибки

| Ошибка | Что сделать |
|--------|-------------|
| `listen EADDRINUSE: address already in use 0.0.0.0:3001` | API сам попробует порты 3002, 3003, … до 3010. Либо освободите порт: `npm run free-port` (убивает процесс на 3001), затем снова `npm run dev:api`. Либо задайте в `.env`: `PORT=3002`. |
| `BOT_TOKEN` undefined | Проверьте, что в корне проекта есть `.env` с `BOT_TOKEN=...`. |
| `DATABASE_URL` / Prisma | Проверьте, что PostgreSQL запущен и строка в `.env` верная; повторите `npx prisma db push`. |
| «Ваш номер не найден в системе» | Выполните сид: `cd api && npm run db:seed` и отправьте контакт с номером +79991234567. |
| Статистика не загружается | В `.env` задайте `API_SECRET=любая-строка` и перезапустите бота. |
