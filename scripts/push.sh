#!/usr/bin/env sh
# Коммит и пуш в GitHub. Сообщение коммита: первый аргумент или "Update".
# Использование: npm run push
# Или: npm run push -- "описание изменений"
set -e
MSG="${1:-Update}"
git add -A
if git diff --staged --quiet; then
  echo "Nothing to commit."
  exit 0
fi
git commit -m "$MSG"
git push
