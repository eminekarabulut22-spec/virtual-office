#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${KYAANI_OFFICE_PORT:-3001}"
BOTS_PROXY_PORT="${KYAANI_GATEWAY_FRONT_PORT:-9122}"
GATEWAY_UPSTREAM="${KYAANI_GATEWAY_UPSTREAM:-http://127.0.0.1:9123}"
PLAN_JSON="$ROOT/data/company-office.json"
BOTS_PROXY_PID=""

listeners() {
  lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true
}

wait_port_free() {
  local i
  for i in $(seq 1 60); do
    [[ -z "$(listeners)" ]] && return 0
    sleep 0.25
  done
  return 1
}

free_port() {
  local pid
  for pid in $(listeners); do
    kill "$pid" 2>/dev/null || true
  done
  wait_port_free || { echo "Port $PORT still busy"; exit 1; }
}

stop_bots_proxy() {
  [[ -n "$BOTS_PROXY_PID" ]] && kill "$BOTS_PROXY_PID" 2>/dev/null || true
}

start_bots_proxy() {
  [[ -f "$ROOT/scripts/kyaani-gateway-bots-proxy.ts" ]] || return 0
  (cd "$ROOT" && npm install --no-audit --no-fund >/dev/null 2>&1 || true)
  KYAANI_GATEWAY_FRONT_PORT="$BOTS_PROXY_PORT" \
    KYAANI_GATEWAY_UPSTREAM="$GATEWAY_UPSTREAM" \
    KYAANI_OFFICE_URL="http://127.0.0.1:$PORT" \
    KYAANI_COMPANY_OFFICE_JSON="$PLAN_JSON" \
    npm run bots-proxy --silent &
  BOTS_PROXY_PID=$!
}

trap stop_bots_proxy EXIT

free_port
cd "$ROOT"
npm run build
start_bots_proxy
cd server
export KYAANI_OFFICE_PORT="$PORT"
export KYAANI_LAB_HOST="${KYAANI_LAB_HOST:-company-devops}"
export KYAANI_HERMES_REMOTE_HOME="${KYAANI_HERMES_REMOTE_HOME:-$HOME/.hermes}"
export HERMES_BIN="${HERMES_BIN:-$HOME/.local/bin/hermes}"
export KYAANI_CHAT_URL="${KYAANI_CHAT_URL:-http://127.0.0.1:8790/v1/chat}"
echo "Virtual Office http://127.0.0.1:$PORT"
exec python3 office_server.py
