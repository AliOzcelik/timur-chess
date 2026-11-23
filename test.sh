#!/usr/bin/env bash
# Run Timur's tests.
#   ./test.sh             everything: Python tests, then the web interface tests
#   ./test.sh backend     only the Python tests (pytest)
#   ./test.sh frontend    only the web interface: type check and tests (vitest)
# Anything after the first word goes to the test runner, for example:
#   ./test.sh backend -k review       ./test.sh frontend src/lib
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(pwd)"
WHAT="${1:-all}"
[ $# -gt 0 ] && shift

say() { printf '\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

backend() {
  local venv="$ROOT/backend/.venv"
  if [ ! -x "$venv/bin/python" ]; then
    say "Creating the Python environment (first run only)..."
    python3 -m venv "$venv" || fail "Could not create a Python environment. Is python3 installed?"
  fi
  local stamp="$venv/.dev-requirements-installed"
  if [ ! -f "$stamp" ] || [ "$ROOT/backend/requirements-dev.txt" -nt "$stamp" ] || [ "$ROOT/backend/requirements.txt" -nt "$stamp" ]; then
    say "Installing Python test packages..."
    "$venv/bin/pip" install --quiet -r "$ROOT/backend/requirements-dev.txt"
    touch "$stamp"
  fi
  if [ -z "${STOCKFISH_PATH:-}" ] && ! command -v stockfish >/dev/null 2>&1 && [ ! -x /opt/homebrew/bin/stockfish ]; then
    say "Stockfish is not installed, so the tests that need the engine will be skipped."
  fi
  say "Python tests"
  (cd "$ROOT/backend" && "$venv/bin/python" -m pytest ${1+"$@"})
}

frontend() {
  local front="$ROOT/frontend"
  command -v npm >/dev/null 2>&1 || fail "Node.js is not installed. Install it with: brew install node"
  if [ ! -d "$front/node_modules" ] || [ "$front/package-lock.json" -nt "$front/node_modules/.package-lock.json" ]; then
    say "Installing web packages..."
    (cd "$front" && npm install --silent)
  fi
  say "Type check"
  (cd "$front" && npx tsc --noEmit)
  say "Web interface tests"
  (cd "$front" && npx vitest run ${1+"$@"})
}

case "$WHAT" in
  backend) backend ${1+"$@"} ;;
  frontend) frontend ${1+"$@"} ;;
  all)
    failed=""
    backend || failed="$failed Python"
    frontend || failed="$failed web"
    [ -z "$failed" ] || fail "Some tests failed:$failed."
    ;;
  *) fail "Unknown option '$WHAT'. Use: ./test.sh, ./test.sh backend or ./test.sh frontend" ;;
esac
say "All tests passed."
