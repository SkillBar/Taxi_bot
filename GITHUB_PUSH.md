# Как запушить проект на GitHub

Локально уже сделано:
- репозиторий инициализирован (`git init`);
- добавлен `.gitignore` (в коммит не попадают `.env`, `node_modules`, `dist`);
- первый коммит на ветке **main**;
- создана ветка **vercel** (для деплоя на Vercel можно пушить её).

---

## 1. Создать репозиторий на GitHub

1. Зайдите на [github.com](https://github.com) → **New repository** (или **+** → **New repository**).
2. Имя репозитория, например: `Bot2` или `telegram-executor-bot`.
3. **Не** добавляйте README, .gitignore и лицензию — репозиторий создайте пустым.
4. Нажмите **Create repository**.

---

## 2. Привязать удалённый репозиторий и запушить

В терминале из папки проекта выполните (подставьте свой логин и имя репо):

```bash
cd /Users/home/Desktop/Bot2

# Привязать GitHub-репозиторий (один раз)
git remote add origin https://github.com/ВАШ_ЛОГИН/ИМЯ_РЕПОЗИТОРИЯ.git

# Запушить ветку main
git push -u origin main
```

Если хотите пушить ветку **vercel** (например, для деплоя только WebApp):

```bash
git push -u origin vercel
```

Дальше при изменениях:

```bash
git add .
git commit -m "описание изменений"
git push
```

---

## 3. Если репозиторий уже был создан с README

Если при создании репо вы добавили README или другие файлы:

```bash
git pull origin main --allow-unrelated-histories
# при необходимости разрешить конфликты
git push -u origin main
```

---

## SSH вместо HTTPS

Если используете SSH-ключ:

```bash
git remote add origin git@github.com:ВАШ_ЛОГИН/ИМЯ_РЕПОЗИТОРИЯ.git
git push -u origin main
```
