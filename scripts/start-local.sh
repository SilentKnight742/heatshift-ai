#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VENV_DIR="$PROJECT_DIR/.venv"
ENV_FILE="$PROJECT_DIR/.env"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "HeatShift needs $1, but it was not found on PATH." >&2
    exit 1
  fi
}

require_command python3
require_command npm

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$PROJECT_DIR/.env.example" "$ENV_FILE"
  echo "Created .env from .env.example. The app can run in simulated fallback mode without provider keys."
fi

while IFS='=' read -r key value; do
  [[ -z "$key" || "$key" == \#* ]] && continue
  if [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
    value="${value%$'\r'}"
    value="${value#\"}"; value="${value%\"}"
    value="${value#\'}"; value="${value%\'}"
    export "$key=$value"
  fi
done < "$ENV_FILE"

if [[ ! -x "$VENV_DIR/bin/python" ]]; then
  echo "Creating the isolated Python environment…"
  python3 -m venv "$VENV_DIR"
fi

echo "Preparing backend dependencies…"
"$VENV_DIR/bin/python" -m pip install --disable-pip-version-check -q -r "$PROJECT_DIR/backend/requirements.txt"

if [[ ! -x "$PROJECT_DIR/frontend/node_modules/.bin/next" ]]; then
  echo "Preparing frontend dependencies…"
  (cd "$PROJECT_DIR/frontend" && npm ci)
fi

cleanup() {
  trap - EXIT INT TERM
  [[ -n "${BACKEND_PID:-}" ]] && kill "$BACKEND_PID" 2>/dev/null || true
  [[ -n "${FRONTEND_PID:-}" ]] && kill "$FRONTEND_PID" 2>/dev/null || true
  wait "${BACKEND_PID:-}" "${FRONTEND_PID:-}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Starting HeatShift…"
echo "  Product: http://127.0.0.1:3000"
echo "  API:     http://127.0.0.1:8000"
echo "Press Ctrl+C to stop both services."

(cd "$PROJECT_DIR/backend" && exec "$VENV_DIR/bin/python" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload --env-file "$ENV_FILE") &
BACKEND_PID=$!
(cd "$PROJECT_DIR/frontend" && exec npm run dev -- --hostname 127.0.0.1) &
FRONTEND_PID=$!

while kill -0 "$BACKEND_PID" 2>/dev/null && kill -0 "$FRONTEND_PID" 2>/dev/null; do
  sleep 1
done

wait "$BACKEND_PID" 2>/dev/null || BACKEND_STATUS=$?
wait "$FRONTEND_PID" 2>/dev/null || FRONTEND_STATUS=$?
exit "${BACKEND_STATUS:-${FRONTEND_STATUS:-0}}"
