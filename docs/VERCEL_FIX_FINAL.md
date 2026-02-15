# Один раз настроить прод: автоматический вход без ввода API

Сделай эти два шага — после этого вход по номеру будет автоматическим.

---

## 1. Схема БД в продакшен (убрать ошибку `Manager.fleetParkId does not exist`)

**Вариант А — из терминала (подставь свой URL из Vercel):**

```bash
cd api
DATABASE_URL="postgresql://USER:PASS@ep-XXX.region.aws.neon.tech/neondb?sslmode=require" npx prisma db execute --file prisma/vercel-production-apply.sql
```

Где взять URL: **Vercel** → проект → **Settings** → **Environment Variables** → **DATABASE_URL** → скопировать (Reveal → Copy). Вставляй в кавычки вместо `postgresql://...`.

**Вариант Б — вручную в Neon:**

1. [Neon](https://console.neon.tech) → ветка **production** (та, что в DATABASE_URL у Vercel).
2. **SQL Editor** → вставить весь текст из `api/prisma/vercel-production-apply.sql` → **Run**.

Проверка: в логах Vercel не должно быть 500 и текста про `fleetParkId`.

---

## 2. Парк по умолчанию в Vercel (чтобы не просило API-ключ)

В **Vercel** → проект → **Settings** → **Environment Variables** добавь три переменные (как в `api/.env`):

| Name             | Value |
|------------------|--------|
| `YANDEX_PARK_ID` | `28499fad6fb246c6827dcd3452ba1384` |
| `YANDEX_CLIENT_ID` | `taxi/park/28499fad6fb246c6827dcd3452ba1384` |
| `YANDEX_API_KEY` | твой ключ (тот же, что в .env) |

Сохрани. Сделай **Redeploy** последнего деплоя (Deployments → … → Redeploy).

---

## Итог

- Твой номер уже в базе (seed) → в мини-аппе вводишь номер или делишься контактом → парк подставляется сам, кабинет открывается.
- Если переменные из шага 2 не заданы — после номера покажется форма API-ключа; после того как добавишь их и задеплоишь, форма не понадобится.
