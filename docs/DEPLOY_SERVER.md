# Обновление и запуск на сервере

## Вариант А: Vercel + Railway (облако)

Код уже закоммичен. Осталось отправить его в репозиторий — деплой подхватится автоматически.

### 1. Отправить изменения на GitHub

```bash
cd /Users/home/Desktop/Bot2
git push origin main
```

### 2. Что обновится само

- **Vercel (API):** проект с Root Directory `api` — при пуше в `main` пересоберётся и задеплоится. Убедитесь, что в настройках API-проекта заданы переменные: `DATABASE_URL`, `DIRECT_URL`, `BOT_TOKEN`, `WEBAPP_URL`, `API_SECRET`, при необходимости `YANDEX_PARK_ID`, `YANDEX_CLIENT_ID`, `YANDEX_API_KEY`.
- **Vercel (WebApp):** проект фронта — пересоберётся с актуальным `VITE_API_URL` (из настроек проекта). После пуша при необходимости сделайте Redeploy.
- **Railway (бот):** если бот задеплоен через GitHub — пересоберётся после пуша. Проверьте переменные: `BOT_TOKEN`, `API_URL`, `WEBAPP_URL`, `API_SECRET`.

### 3. Проверка

- API: откройте `https://taxi-api-zeta.vercel.app/health` (или ваш URL API).
- WebApp: откройте бота в Telegram → «Регистрация исполнителя» / «Кабинет менеджера».
- Бот: отправьте /start в Telegram.

---

## Вариант Б: Свой сервер (VPS)

Если API, бот или WebApp крутятся на вашем сервере (не Vercel/Railway):

### 1. На своей машине — отправить код

```bash
git push origin main
```

### 2. На сервере — обновить и перезапустить

```bash
cd /path/to/Bot2   # путь к репозиторию на сервере
git pull origin main
npm ci             # в корне, если есть общие зависимости
cd api && npm ci && npx prisma generate && npm run build
cd ../bot && npm ci
# Перезапуск (пример для pm2):
pm2 restart api    # или как у вас назван процесс
pm2 restart bot
```

Если используете systemd или скрипты — перезапустите соответствующие сервисы после `git pull` и сборки.

### 3. Миграции БД

Если меняли схему Prisma:

```bash
cd api && npx prisma db push
```

(На сервере в `.env` должны быть `DATABASE_URL` и `DIRECT_URL`.)

---

## Краткий чек-лист

| Шаг | Действие |
|-----|----------|
| 1 | Локально: `git push origin main` |
| 2 | Vercel: дождаться деплоя (или Redeploy вручную) |
| 3 | Проверить API (health), WebApp в Telegram, бота |

Если бот/API на своём сервере — после `git push` зайти на сервер, выполнить `git pull`, пересобрать и перезапустить сервисы.
