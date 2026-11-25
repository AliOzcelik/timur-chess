#!/usr/bin/env bash
# Start Timur.
#   ./start.sh        build the interface if needed, start the AI coach (Ollama) and the server,
#                     then open the analysis board with the coach in the browser
#   ./start.sh dev    for working on the code: auto-reloading UI on :5173, server on :8000
#
# Settings (optional environment variables):
#   PORT=8010 ./start.sh          use another port
#   STOCKFISH_PATH=/path/to/sf    use a specific Stockfish binary
#   TIMUR_NO_BROWSER=1            don't open the browser
#   TIMUR_NO_AI=1                 don't start Ollama or load the coach's model
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(pwd)"
HOST=127.0.0.1
PORT="${PORT:-8000}"
MODE="${1:-run}"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*" >&2; }
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

# 4. The AI coach: a model served by Ollama on this Mac. Timur works without it; the coach just says it's offline.
DATA_DIR="${TIMUR_DATA_DIR:-$ROOT/data}"
start_coach() {
  [ "${TIMUR_NO_AI:-}" = "1" ] && return 0
  # The model and server address chosen in Settings → AI coach (defaults until changed there).
  local cfg enabled base model api
  cfg="$("$VENV/bin/python" - "$DATA_DIR/timur.db" <<'PY'
import json, sqlite3, sys
values = {"llm_enabled": True, "llm_base_url": "http://localhost:11434/v1", "llm_model": "gemma4:12b-mlx"}
try:
    con = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
    for key, value in con.execute("SELECT key, value FROM settings WHERE key LIKE 'llm_%'"):
        if key in values:
            values[key] = json.loads(value)
except Exception:
    pass  # no database yet: the defaults apply
print("1" if values["llm_enabled"] else "0", values["llm_base_url"], values["llm_model"])
PY
)" || return 0
  read -r enabled base model <<<"$cfg"
  if [ "$enabled" != "1" ]; then
    say "AI coach is turned off (Settings → AI coach)."
    return 0
  fi
  api="${base%/}"; api="${api%/v1}"

  if ! curl -fs -m 2 "$api/api/version" >/dev/null 2>&1; then
    case "$api" in
      http://localhost*|http://127.0.0.1*) ;;
      *) warn "AI coach: the model server at $api isn't answering. The coach is offline until it is."; return 0 ;;
    esac
    if [ -d /Applications/Ollama.app ]; then
      say "Starting Ollama for the AI coach..."
      open -g -a Ollama
    elif command -v ollama >/dev/null 2>&1; then
      say "Starting Ollama for the AI coach (log: data/ollama.log)..."
      mkdir -p "$DATA_DIR"
      nohup ollama serve >>"$DATA_DIR/ollama.log" 2>&1 &
    else
      warn "AI coach: Ollama is not installed, so the coach is offline. Install it with: brew install ollama"
      return 0
    fi
    for _ in $(seq 1 60); do
      curl -fs -m 1 "$api/api/version" >/dev/null 2>&1 && break
      sleep 0.25
    done
    if ! curl -fs -m 2 "$api/api/version" >/dev/null 2>&1; then
      warn "AI coach: Ollama didn't start. The coach is offline; the rest of Timur works."
      return 0
    fi
  fi

  if ! curl -fs -m 3 "$api/api/tags" 2>/dev/null | grep -q "\"$model\""; then
    warn "AI coach: the model $model isn't downloaded yet. Get it with: ollama pull $model"
    return 0
  fi
  # Load the model now, in the background, so the first answer doesn't wait for it.
  curl -fs -m 300 "$api/api/generate" -d "{\"model\": \"$model\", \"keep_alive\": \"30m\"}" >/dev/null 2>&1 &
  say "AI coach ready: $model"
}
start_coach

if [ "$MODE" = "dev" ]; then
  say "Development mode: open http://$HOST:5173/#/analysis (reloads on save). Server on port $PORT."
  (cd "$ROOT/backend" && exec "$VENV/bin/uvicorn" app.main:app --host "$HOST" --port "$PORT" --reload) &
  API_PID=$!
  trap 'kill $API_PID 2>/dev/null || true' EXIT
  cd "$FRONT" && TIMUR_BACKEND="http://$HOST:$PORT" npx vite
  exit 0
fi

# 5. Build the interface when the source changed since the last build
if [ ! -f "$FRONT/dist/index.html" ] || [ -n "$(find "$FRONT/src" "$FRONT/index.html" "$FRONT/package.json" "$FRONT/public" -newer "$FRONT/dist/index.html" -print -quit)" ]; then
  say "Building the web interface..."
  (cd "$FRONT" && npm run build --silent) || fail "The web interface failed to build."
fi

URL="http://$HOST:$PORT"
say "Timur is running at $URL (press Ctrl+C to stop). AI coach: $URL/#/analysis"
(
  for _ in $(seq 1 60); do
    if curl -fs "$URL/api/health" >/dev/null 2>&1; then
      if [ "${TIMUR_NO_BROWSER:-}" != "1" ]; then
        if command -v open >/dev/null 2>&1; then open "$URL/#/analysis"; elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL/#/analysis"; fi
      fi
      break
    fi
    sleep 0.25
  done
) &
cd "$ROOT/backend"
exec "$VENV/bin/uvicorn" app.main:app --host "$HOST" --port "$PORT"
