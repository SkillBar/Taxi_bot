# Настройка Mini App в Telegram (BotFather)

Чтобы приложение работало по гайдлайнам Telegram и открывалось как в интерфейсе AntonyTaxi (Settings → Mini Apps), настройте бота в **@BotFather**.

---

## Как получить HTTPS при локальном запуске

Telegram открывает Mini App **только по HTTPS**. Локально у вас `http://localhost:5173` — его в BotFather указать нельзя. Нужен **туннель**: он даёт вашему localhost публичный HTTPS-адрес.

### Вариант 1: ngrok (проще всего)

1. Установите [ngrok](https://ngrok.com/download) (или `brew install ngrok`).
2. Запустите WebApp в одном терминале:
   ```bash
   npm run dev:webapp
   ```
3. В **другом** терминале поднимите туннель на порт 5173:
   ```bash
   ngrok http 5173
   ```
4. В консоли ngrok появится строка вида:
   ```text
   Forwarding   https://abc123.ngrok-free.app -> http://localhost:5173
   ```
5. Ваш URL для Mini App:
   ```text
   https://abc123.ngrok-free.app/webapp
   ```
   (путь `/webapp` — из `base` в `vite.config.ts`)

Этот URL вставьте в **BotFather → Settings → Mini Apps** и в **`.env`**:
```env
WEBAPP_URL=https://abc123.ngrok-free.app/webapp
```

При каждом новом запуске ngrok (бесплатный план) адрес меняется — нужно заново обновить URL в BotFather и в `.env`.

**Если Mini App ходит в API (наш бэкенд на порту 3001):** с телефона запросы на `http://localhost:3001` не дойдут (localhost — это уже устройство пользователя). Варианты: поднять второй туннель на API (`ngrok http 3001`) и в `.env` для WebApp указать `VITE_API_URL=https://второй-id.ngrok-free.app`, либо тестировать с эмулятора/компьютера, где API доступен по localhost.

### Вариант 2: Cloudflare Tunnel (бесплатно, свой поддомен)

1. Установите [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/).
2. Туннель на 5173:
   ```bash
   cloudflared tunnel --url http://localhost:5173
   ```
3. В выводе будет HTTPS-URL — используйте его с путём `/webapp`, как выше.

### Вариант 3: Деплой на сервер

Разместите собранное приложение (`npm run build` в `webapp/`, папка `dist/`) на любом хостинге с HTTPS (Vercel, Netlify, свой сервер с nginx). Тогда URL будет постоянным, например `https://ваш-домен.com/webapp`.

---

## 1. Откройте бота в BotFather

Напишите **@BotFather** → выберите вашего бота (например AntonyTaxi).

---

## 2. Зайдите в Settings → Mini Apps

- Нажмите **Settings** (Настройки).
- Выберите пункт **Mini Apps** (иконка сетки из девяти квадратов).

---

## 3. Включите Mini App и укажите URL

- Включите Mini App, если ещё не включено.
- Укажите **URL приложения** — полный HTTPS-адрес, по которому открывается ваше приложение.

Примеры:

- Локальная разработка через туннель: `https://ваш-id.ngrok-free.app/webapp`
- Продакшен: `https://ваш-домен.com/webapp`

**Важно:** URL должен быть **HTTPS**. Путь `/webapp` должен совпадать с тем, как раздаётся собранное приложение (в `vite.config.ts` задан `base: "/webapp/"`).

---

## 4. (Опционально) Main Mini App

Если в разделе Mini Apps есть настройка **Main Mini App** (главное Mini App):

- Включите её и укажите тот же URL.
- Тогда у бота в профиле появится кнопка **«Launch app»** / **«Открыть приложение»**, и приложение можно будет открыть по ссылке вида `https://t.me/ваш_бот?startapp`.

---

## 5. Соответствие гайдлайнам Telegram

В проекте уже учтено:

- Подключён скрипт **telegram-web-app.js** в `index.html`.
- Вызывается **ready()** при загрузке (скрывает загрузчик Telegram).
- Вызывается **expand()** (раскрытие на полную высоту).
- Цвета интерфейса берутся из **themeParams** (светлая/тёмная тема).
- Учитываются **safe area** (вырезы, индикатор).
- Используются CSS-переменные Telegram: `--tg-theme-bg-color`, `--tg-theme-text-color`, `--tg-theme-button-color` и др.

Дополнительно в BotFather можно настроить:

- **Menu Button** — кнопка внизу чата с ботом, открывающая Mini App (часто настраивается там же или в Bot Settings → Menu Button).
- В новом интерфейсе — пункт **Mini Apps** в Settings, как на скриншоте с AntonyTaxi.

После сохранения URL приложение будет открываться по гайдлайнам Telegram: из меню бота, из профиля (если включён Main Mini App) или по ссылке `t.me/ваш_бот?startapp`.
