# Yandex OAuth для водителя (логин через Яндекс)

Чтобы получать данные от имени водителя в Fleet API (баланс, заказы, статус), водитель должен авторизоваться через свой Яндекс-аккаунт (Yandex ID). После этого бэкенд сохраняет `access_token` и `refresh_token` и может делать запросы к API от имени водителя.

## Регистрация OAuth-приложения

1. Зайти в [OAuth Яндекс](https://oauth.yandex.com/).
2. Создать приложение, тип: **Web services**.
3. В **Redirect URI** указать публичный URL callback вашего API, например:
   - `https://your-api.vercel.app/api/yandex-oauth/callback`
4. В настройках доступа (Permissions) при необходимости запросить scopes для Fleet (если доступны в вашем приложении):
   - `login:email`, `login:info` — базовые (достаточно для начала).
   - Для Fleet API от имени водителя в документации Яндекс указывают scopes вида `fleet:driver-profile`, `fleet:driver-balance` и т.д. — проверить в [документации Fleet](https://fleet.yandex.ru/docs/) и в кабинете OAuth.
5. Сохранить **Client ID** и **Client secret** (Secret key).

## Переменные окружения (API)

| Переменная | Описание |
|------------|----------|
| `YANDEX_OAUTH_CLIENT_ID` | ID приложения из кабинета OAuth Яндекс |
| `YANDEX_OAUTH_CLIENT_SECRET` | Secret key приложения |
| `YANDEX_OAUTH_REDIRECT_URI` | Точный URL callback, совпадающий с указанным в настройках приложения (например `https://your-api.vercel.app/api/yandex-oauth/callback`) |
| `WEBAPP_URL` | URL Mini App (нужен для редиректа после успешного логина, например `https://your-webapp.vercel.app`) |

## Поток для водителя

1. В Mini App водитель нажимает «Подключить Яндекс Про» / «Войти через Яндекс».
2. Фронт вызывает `GET /api/yandex-oauth/authorize-url` с заголовком `x-telegram-init-data`.
3. API возвращает `{ url: "https://oauth.yandex.com/authorize?..." }` с `state`, содержащим идентификатор пользователя Telegram.
4. Фронт открывает этот URL (например, через `Telegram.WebApp.openLink(url)` или `window.location.href = url`).
5. Водитель входит в Яндекс и разрешает доступ приложению.
6. Яндекс перенаправляет на `YANDEX_OAUTH_REDIRECT_URI` с параметрами `code` и `state`.
7. API в маршруте `GET /api/yandex-oauth/callback` обменивает `code` на токены (`POST https://oauth.yandex.com/token`), сохраняет их в таблице `DriverYandexOAuth` по `telegramUserId` из `state` и редиректит на `WEBAPP_URL?yandex_oauth=linked`.
8. Mini App при загрузке с `?yandex_oauth=linked` может показать сообщение «Яндекс подключён».

## Обновление токена (refresh_token)

Токен имеет срок жизни (`expires_in`). Перед истечением нужно обновлять его через `refresh_token`:

- Метод: `POST https://oauth.yandex.com/token`
- Тело: `application/x-www-form-urlencoded`  
  `grant_type=refresh_token&refresh_token=...&client_id=...&client_secret=...`

В ответе придут новый `access_token`, `refresh_token` и `expires_in`. Сохранить в `DriverYandexOAuth` для данного `telegramUserId`.

Рекомендуется реализовать фоновое обновление (cron или при первом запросе после истечения) и хранить `refresh_token` в БД (при необходимости — в зашифрованном виде).

## Модель БД

`DriverYandexOAuth`:

- `telegramUserId` (unique) — Telegram user ID водителя
- `accessToken`, `refreshToken`, `expiresAt`, `scope`

После применения схемы выполнить `npx prisma db push` (или миграцию) в папке `api/`.
