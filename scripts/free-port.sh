#!/usr/bin/env sh
# Освобождает порт (по умолчанию 3001). Убивает процесс, слушающий этот порт.
# Использование: ./scripts/free-port.sh [PORT]
# Или: npm run free-port
# Или: npm run free-port -- 3002
set -e
PORT="${1:-3001}"
PID=$(lsof -ti :"$PORT" 2>/dev/null || true)
if [ -z "$PID" ]; then
  echo "Port $PORT is already free."
  exit 0
fi
echo "Killing process $PID on port $PORT..."
kill "$PID" 2>/dev/null || kill -9 "$PID" 2>/dev/null || true
echo "Port $PORT freed."
