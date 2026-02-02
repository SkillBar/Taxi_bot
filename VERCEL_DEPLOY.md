# Деплой на Vercel

На Vercel деплоится **только WebApp** (Mini App). API и бот нужно запускать отдельно (Railway, Render, свой сервер или другой проект Vercel).

---

## 1. Подключение репозитория

1. Зайдите на [vercel.com](https://vercel.com) и войдите (GitHub/GitLab/Bitbucket).
2. **Add New** → **Project** → выберите репозиторий с проектом Bot2.
3. **Root Directory** оставьте **.** (корень репозитория).

---

## 2. Настройки сборки (уже в `vercel.json`)

В корне проекта уже есть **`vercel.json`**:

- **buildCommand:** `cd webapp && npm ci && npm run build`
- **outputDirectory:** `webapp/dist`
- **installCommand:** `cd webapp && npm ci`
- **rewrites:** `/webapp/assets/*` → `/assets/*` (чтобы работал `base: "/webapp/"`)

В панели Vercel можно не менять Build Command и Output Directory — они берутся из файла.

---

## 3. Переменные окружения (Environment Variables)

В **Project → Settings → Environment Variables** добавьте:

| Переменная       | Значение                    | Где использовать |
|------------------|-----------------------------|-------------------|
| `VITE_API_URL`   | URL вашего API (HTTPS)      | Production, Preview |

Пример: если API задеплоен на Railway по адресу `https://your-api.up.railway.app`, укажите:

```text
VITE_API_URL=https://your-api.up.railway.app
```

Без этой переменной запросы из Mini App пойдут на пустой URL и не сработают.

Остальные переменные (BOT_TOKEN, DATABASE_URL и т.д.) нужны **на стороне API и бота**, не в проекте Vercel с WebApp.

---

## 4. Деплой

- **Deploy** в панели или пуш в ветку, к которой подключён Vercel.
- После сборки Vercel выдаст URL вида `https://your-project.vercel.app`.

---

## 5. URL Mini App и BotFather

- **URL вашего Mini App** будет: **`https://your-project.vercel.app/`**  
  (приложение отдаётся с корня, assets — по `/webapp/assets/` благодаря rewrites).

В **@BotFather → Settings → Mini Apps** укажите (с завершающим слэшем):

```text
https://your-project.vercel.app/
```

В **`.env`** у бота и API (там, где они запускаются) задайте тот же URL:

```env
WEBAPP_URL=https://your-project.vercel.app/
```

В корне репозитория есть **`.vercelignore`**: в деплой не попадают папки `api/`, `bot/` и т.д., чтобы сборка была быстрее.

---

## 6. API и бот (не на Vercel в этом репо)

- **API** (Fastify + Prisma) лучше деплоить на **Railway**, **Render**, **Fly.io** или отдельный проект Vercel (тогда нужна отдельная конфигурация под Node.js API).
- **Бот** (grammY) — на **Railway**, **Render**, **Fly.io** или VPS (долгий polling или webhook).

В их `.env` укажите:

- `WEBAPP_URL=https://your-project.vercel.app/`
- `API_URL=https://your-api-host/` (для бота — куда ходить за агентами/черновиками/статистикой).

---

## Краткий чек-лист

1. Репозиторий подключён к Vercel, корень — корень репо.
2. В Environment Variables задан `VITE_API_URL` (URL вашего API).
3. Деплой прошёл, есть URL вида `https://xxx.vercel.app`.
4. В BotFather → Mini Apps указан `https://xxx.vercel.app/`.
5. У бота и API в `.env` прописан тот же `WEBAPP_URL`.
