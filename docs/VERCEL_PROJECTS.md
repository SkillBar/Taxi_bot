# Какие проекты Vercel использовать

Один репозиторий — **два нужных проекта** в Vercel:

| Проект | Назначение | Root Directory | Домен (пример) |
|--------|------------|----------------|----------------|
| **API** | Backend (Fastify, Prisma) | `api` | https://taxi-botapi.vercel.app |
| **WebApp** | Mini App (React, Vite) | корень или `webapp` | https://taxi-bot-rouge.vercel.app |

Код **нигде не ссылается** на второй API (taxi-bot-api-v2). Это отдельный проект в Vercel, который привязан к тому же репо и при каждом пуше тоже запускает деплой — из‑за этого приходят письма об ошибках.

## Если есть проект taxi-bot-api-v2

Он **не нужен** для текущего приложения. Рекомендация:

1. Зайти в [Vercel Dashboard](https://vercel.com) → проект **taxi-bot-api-v2**.
2. **Settings** → внизу **Delete Project** (или отвязать репозиторий в **Git** → Disconnect).

После удаления (или отвязки) пуши в `main` будут деплоить только **taxi-botapi** (API) и **taxi-bot-rouge** (WebApp), письма об ошибках v2 прекратятся.

В коде и переменных окружения везде используется один API: **taxi-botapi** (или тот URL, который задан в `VITE_API_URL` / `API_URL`).
