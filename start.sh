#!/usr/bin/env bash
# Start Timur.
#   ./start.sh        build the interface if needed, start the server, open the browser
#   ./start.sh dev    for working on the code: auto-reloading UI on :5173, server on :8000
#
# Settings (optional environment variables):
#   PORT=8010 ./start.sh          use another port
#   STOCKFISH_PATH=/path/to/sf    use a specific Stockfish binary
#   TIMUR_NO_BROWSER=1            don't open the browser
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(pwd)"
HOST=127.0.0.1
PORT="${PORT:-8000}"
MODE="${1:-run}"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

# 1. Stockfish
if [ -z "${STOCKFISH_PATH:-}" ] && ! command -v stockfish >/dev/null 2>&1 && [ ! -x /opt/homebrew/bin/stockfish ]; then
  fail "Stockfish is not installed. Install it with: brew install stockfish"
fi

# 2. Python environment (created on the first run)
VENV="$ROOT/backend/.venv"
if [ ! -x "$VENV/bin/python" ]; then
  say "Creating the Python environment (first run only)..."
  python3 -m venv "$VENV" || fail "Could not create a Python environment. Is python3 installed?"
fi
STAMP="$VENV/.requirements-installed"
if [ ! -f "$STAMP" ] || [ "$ROOT/backend/requirements.txt" -nt "$STAMP" ]; then
  say "Installing Python packages..."
  "$VENV/bin/pip" install --quiet --upgrade pip
  "$VENV/bin/pip" install --quiet -r "$ROOT/backend/requirements.txt"
  touch "$STAMP"
fi

# 3. Web interface packages
FRONT="$ROOT/frontend"
command -v npm >/dev/null 2>&1 || fail "Node.js is not installed. Install it with: brew install node"
if [ ! -d "$FRONT/node_modules" ] || [ "$FRONT/package-lock.json" -nt "$FRONT/node_modules/.package-lock.json" ]; then
  say "Installing web packages..."
  (cd "$FRONT" && npm install --silent)
fi

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  fail "Port $PORT is already in use. Is Timur already running? To use another port: PORT=8010 ./start.sh"
fi

if [ "$MODE" = "dev" ]; then
  say "Development mode: open http://$HOST:5173 (reloads on save). Server on port $PORT."
  (cd "$ROOT/backend" && exec "$VENV/bin/uvicorn" app.main:app --host "$HOST" --port "$PORT" --reload) &
  API_PID=$!
  trap 'kill $API_PID 2>/dev/null || true' EXIT
  cd "$FRONT" && TIMUR_BACKEND="http://$HOST:$PORT" npx vite
  exit 0
fi

# 4. Build the interface when the source changed since the last build
if [ ! -f "$FRONT/dist/index.html" ] || [ -n "$(find "$FRONT/src" "$FRONT/index.html" "$FRONT/package.json" "$FRONT/public" -newer "$FRONT/dist/index.html" -print -quit)" ]; then
  say "Building the web interface..."
  (cd "$FRONT" && npm run build --silent) || fail "The web interface failed to build."
fi

URL="http://$HOST:$PORT"
say "Timur is running at $URL (press Ctrl+C to stop)"
(
  for _ in $(seq 1 60); do
    if curl -fs "$URL/api/health" >/dev/null 2>&1; then
      if [ "${TIMUR_NO_BROWSER:-}" != "1" ]; then
        if command -v open >/dev/null 2>&1; then open "$URL"; elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"; fi
      fi
      break
    fi
    sleep 0.25
  done
) &
cd "$ROOT/backend"
exec "$VENV/bin/uvicorn" app.main:app --host "$HOST" --port "$PORT"
