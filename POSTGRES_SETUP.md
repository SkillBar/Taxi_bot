# Настройка PostgreSQL для проекта

У вас уже установлен PostgreSQL 16 (Homebrew). Нужно только **запустить сервер** и **создать базу**.

---

## Шаг 1. Запустить PostgreSQL

В терминале выполните **одну** из команд:

```bash
# Вариант А: запустить и держать в фоне (рекомендуется)
brew services start postgresql@16
```

или, если у вас установлен просто `postgresql`:

```bash
brew services start postgresql
```

Проверить, что сервер запущен:

```bash
pg_isready -h localhost -p 5432
```

Должно вывести: `localhost:5432 - accepting connections`.

---

## Шаг 2. Создать базу данных

Создаём базу `executor_bot`:

```bash
createdb executor_bot
```

Если команда `createdb` не найдена, укажите полный путь (у вас PostgreSQL 16):

```bash
/opt/homebrew/opt/postgresql@16/bin/createdb executor_bot
```

Если появится ошибка вроде *«role "home" does not exist»*, создайте пользователя и базу так:

```bash
/opt/homebrew/opt/postgresql@16/bin/psql postgres -c "CREATE USER home WITH CREATEDB;"
/opt/homebrew/opt/postgresql@16/bin/createdb -O home executor_bot
```

---

## Шаг 3. Проверить строку в .env

В корне проекта в файле **`.env`** должна быть строка:

```env
DATABASE_URL=postgresql://home@localhost:5432/executor_bot
```

Если ваш логин в macOS **не** `home`, замените: `postgresql://ВАШ_ЛОГИН@localhost:5432/executor_bot`.

---

## Шаг 4. Применить схему и тестовые данные

Из корня проекта:

```bash
cd api
npx prisma db push
npm run db:seed
cd ..
```

После этого таблицы созданы и в базе есть тестовый агент с номером **+79991234567**.

---

## Если что-то пошло не так

| Ошибка | Что сделать |
|--------|-------------|
| `connection refused` | Запустите PostgreSQL: `brew services start postgresql@16`. |
| `role "home" does not exist` | Выполните команды из Шага 2 с `CREATE USER home ...`. |
| `database "executor_bot" does not exist` | Выполните `createdb executor_bot` (или с полным путём к `createdb`). |
| `password authentication failed` | Для localhost пароль обычно не нужен. Если спрашивает — в `.env` укажите: `postgresql://home:ПАРОЛЬ@localhost:5432/executor_bot`. Пароль пользователя postgres можно задать/сбросить в настройках PostgreSQL. |
