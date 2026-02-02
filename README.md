# Telegram Mini App: регистрация исполнителей (водители / курьеры)

Бот + WebApp для агентов: онбординг по телефону и почте Яндекс, регистрация исполнителей (условия работы, данные исполнителя и авто, тарифы, брендирование), итоговая карточка и подтверждение.

## Стек

- **Бот:** Node.js, TypeScript, [grammY](https://grammy.dev)
- **API:** Fastify, PostgreSQL, Prisma
- **WebApp:** Vite, React, TypeScript

## Структура

```
Bot2/
├── api/          # Fastify API (агенты, черновики, тарифы, статистика)
├── bot/          # Grammy бот (онбординг, меню, открытие WebApp)
├── webapp/       # Mini App (форма регистрации)
├── .env.example
└── README.md
```

## Быстрый старт

### 1. Переменные окружения

Скопируйте `.env.example` в `.env` и заполните:

- `BOT_TOKEN` — токен от @BotFather
- `DATABASE_URL` — PostgreSQL (например `postgresql://user:pass@localhost:5432/executor_bot`)
- `API_URL` — URL API (для бота), например `http://localhost:3001`
- `WEBAPP_URL` — полный URL WebApp (HTTPS в проде), например `https://your-domain.com/webapp`
- `API_SECRET` — секрет для вызова API ботом (статистика по agentId)

**Настройка Mini App в BotFather (по гайдлайнам Telegram):** в @BotFather → Settings → **Mini Apps** укажите URL приложения (HTTPS). Подробно: **[TELEGRAM_SETUP.md](TELEGRAM_SETUP.md)**.

### 2. База данных

```bash
cd api && npm install
npx prisma db push   # или migrate dev
npx prisma generate
```

### 3. Создание тестового агента

Чтобы бот принял контакт, в базе должен быть агент с нужным номером телефона (без привязки Telegram до первого входа):

```sql
INSERT INTO "Agent" (id, "telegramUserId", phone, "isActive", "createdAt", "updatedAt")
VALUES (
  'clxxxxxxxxxxxxxxxxxxx',
  NULL,
  '+79991234567',
  true,
  NOW(),
  NOW()
);
```

Или через Prisma Studio: `npx prisma studio` — создать запись в Agent с `phone = +79991234567`, `telegramUserId = NULL`.

### 4. Запуск

Три процесса (в разных терминалах):

```bash
# API
cd api && npm run dev

# Бот
cd bot && npm run dev

# WebApp (для разработки с HTTPS используйте туннель, например ngrok)
cd webapp && npm run dev
```

В BotFather: **Bot Settings → Menu Button** или кнопки в меню задайте URL WebApp: `https://your-domain.com/webapp` (в разработке — URL туннеля, например `https://xxx.ngrok.io/webapp`).

## Сценарий

1. **Старт:** `/start` → запрос контакта (кнопка «Отправить контакт»).
2. **Проверка:** бот вызывает `GET /api/agents/check?phone=...`, затем `POST /api/agents/link` (phone + telegramUserId).
3. **Почта:** ввод email вида `*@yandex.ru`, сохранение через `PATCH /api/agents/:id/email`.
4. **Меню:** «Посмотреть статистику», «Зарегистрировать водителя», «Зарегистрировать курьера» (открывают WebApp с `?type=driver` / `?type=courier`).
5. **WebApp:** условие работы (выбор или создание комиссии) → данные исполнителя → данные авто → тарифы исполнителя (мультивыбор) → брендирование → карточка → «Данные верны — зарегистрировать» / «Внести корректировки».
6. **Отправка:** WebApp вызывает `POST /api/drafts/:id/submit`; при успехе отправляет данные боту через `Telegram.WebApp.sendData()`.

## API (кратко)

- `GET /api/agents/check?phone=...` — проверка агента по телефону (бот).
- `POST /api/agents/link` — привязка telegramUserId к агенту (бот).
- `GET /api/agents/by-telegram/:id` — агент по Telegram ID (бот).
- `PATCH /api/agents/:id/email` — сохранение почты Яндекс.
- `GET /api/agents/me/tariffs` — список условий работы агента (заголовок `X-Telegram-Init-Data`).
- `POST /api/agents/me/tariffs` — создание условия (комиссия %).
- `GET /api/drafts/current` — текущий черновик (initData).
- `POST /api/drafts` — создать черновик (body: `{ type: "driver"|"courier" }`).
- `PATCH /api/drafts/:id` — обновить черновик.
- `POST /api/drafts/:id/submit` — финальная регистрация.
- `GET /api/executor-tariffs?type=...` — тарифы исполнителя (driver/courier).
- `GET /api/stats` — статистика (initData или `X-Api-Secret` + `?agentId=...`).

## Интеграции (внешние системы)

- **Проверка агента:** при необходимости вызывайте ваш CRM/Яндекс в `GET /check` перед поиском в локальной БД.
- **Регистрация исполнителя:** задайте `REGISTRATION_SUBMIT_URL` и при необходимости `REGISTRATION_SUBMIT_API_KEY`; API вызовет ваш endpoint при `POST .../submit`.
- **Ссылки:** после успешной регистрации в ответе возвращаются `linkExecutor` и `linkStats` (сейчас из `WEBAPP_URL`; можно подставить URL личного кабинета).

## Деплой

- **WebApp на Vercel:** в корне есть `vercel.json`, `.vercelignore` и инструкция **[VERCEL_DEPLOY.md](VERCEL_DEPLOY.md)**. Подключите репо к Vercel, задайте `VITE_API_URL` (URL вашего API), задеплойте — URL вида `https://xxx.vercel.app/` укажите в BotFather → Mini Apps и в `WEBAPP_URL` у бота/API.
- **API:** сборка не обязательна (запуск через `tsx`); для продакшена: `npm run build` и `node dist/index.js`. PostgreSQL должен быть доступен (Railway, Render, Fly.io и т.д.).
- **Бот:** переменные `BOT_TOKEN`, `API_URL`, `API_SECRET`, `WEBAPP_URL`. Запуск на Railway, Render, VPS и т.д.

## Чек-лист тестирования

- [ ] `/start` → запрос контакта; отправка контакта с номером из БД → запрос почты.
- [ ] Ввод почты `*@yandex.ru` → главное меню.
- [ ] «Посмотреть статистику» → цифры (или 0).
- [ ] «Зарегистрировать водителя» → открытие WebApp, тип driver.
- [ ] Выбор/создание условия работы → данные исполнителя → данные авто → тарифы → бренд → карточка.
- [ ] «Внести корректировки» → изменение блока → снова карточка.
- [ ] «Данные верны — зарегистрировать» → успех, сообщение в чате с ботом.
- [ ] Повторное открытие WebApp → продолжение черновика или «Начать заново».
