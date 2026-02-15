# Обновление продакшен-БД для Vercel

Ошибка **`The column Manager.fleetParkId does not exist`** значит: в базе, к которой ходит API на Vercel, нет новых таблиц/колонок. Из-за этого падают все запросы к `/api/manager/*` (в т.ч. «Подключение к парку») и вместо автомата может показываться экран ввода API. Нужно применить схему **именно к той БД**, чей URL прописан в Vercel.

**Надёжный способ** — выполнить скрипт в **Neon SQL Editor** (в браузере), чтобы точно попасть в ту же БД, что использует Vercel.

## Шаг 1: Узнать продакшен DATABASE_URL

1. Vercel → твой проект (api) → **Settings** → **Environment Variables**.
2. Найди **DATABASE_URL** (Production).
3. Скопируй значение (или нажми Reveal). В URL будет хост вида `ep-xxx-xxx.region.aws.neon.tech` — это твой продакшен-хост в Neon.

## Шаг 2: Открыть эту БД в Neon

1. Зайди в [Neon](https://console.neon.tech).
2. Выбери проект и **ветку (branch)**, для которой в Vercel прописан DATABASE_URL.  
   Хост из URL (например `ep-summer-poetry-a1iudl29.ap-southeast-1.aws.neon.tech`) привязан к конкретной ветке.
3. В левом меню открой **SQL Editor** для этой ветки/БД.

## Шаг 3: Выполнить SQL

1. Открой в репозитории файл **`api/prisma/vercel-production-apply.sql`**.
2. Скопируй **весь** его текст и вставь в SQL Editor в Neon.
3. Нажми **Run**.

Должны создаться таблица **FleetPark** и колонки у **Manager** (phone, telegramUsername, createdAt, fleetParkId + внешний ключ).

## Шаг 4: Проверить

Сделай в приложении снова «Подключить парк» или обнови мини-апп. Ошибка 500 должна пропасть.

---

**Важно:** если в Vercel и в локальном `api/.env` разные DATABASE_URL (разные хосты или ветки в Neon), то `npx prisma migrate deploy` из терминала применяет миграции к той БД, что в .env. Чтобы обновить прод — либо выполни SQL вручную в нужной БД (шаги выше), либо запусти:

```bash
cd api
DATABASE_URL="<вставь сюда URL из Vercel>" npx prisma migrate deploy
```

Подставь **реальный** URL из Vercel (не плейсхолдер).
