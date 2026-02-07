# Проверка ключей перед деплоем

Перед деплоем запусти:

```bash
npm run check-keys
```

Скрипт читает `.env` в корне и проверяет наличие обязательных переменных. **Значения секретов не выводятся.**

---

## Частые причины «Не удалось загрузить интерфейс»

1. **VITE_API_URL при сборке webapp**  
   В Vercel в настройках **проекта Webapp** (не API) в Environment Variables для **Production** и **Preview** должна быть переменная:
   - `VITE_API_URL` = точный URL твоего API, например `https://your-api.vercel.app`  
   Без слэша в конце. Если не задана или задан `http://localhost:3001`, в проде Mini App будет слать запросы не туда и получит ошибку сети / CORS.

2. **BOT_TOKEN на API не совпадает с ботом**  
   API проверяет подпись initData через `BOT_TOKEN`. Токен на Vercel (проект API) должен быть **тот же**, что у бота, из которого открывают Mini App. Иначе `/api/agents/me` вернёт 401.

3. **В BotFather URL Mini App**  
   Должен совпадать с тем, куда задеплоен webapp (тот же домен, что в `WEBAPP_URL` у бота). Иначе откроется не та страница или не тот origin.

4. **API_SECRET**  
   Должен совпадать у бота и у API, иначе `link-from-bot` после шаринга контакта вернёт 401 (привязка по номеру не пройдёт).

---

## Где что задавать (Vercel)

| Проект в Vercel | Переменная    | Назначение |
|-----------------|---------------|------------|
| **API**         | BOT_TOKEN     | Токен бота (тот же, что в BotFather) |
| **API**         | DATABASE_URL  | PostgreSQL (Neon) |
| **API**         | API_SECRET    | Секрет для link-from-bot |
| **API**         | WEBAPP_URL    | URL Mini App (опционально) |
| **Webapp**      | VITE_API_URL  | **URL API** (обязательно для прода, без слэша) |

У бота (Railway / свой хостинг): `BOT_TOKEN`, `API_URL`, `WEBAPP_URL`, `API_SECRET`.
