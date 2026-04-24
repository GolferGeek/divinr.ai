#!/usr/bin/env bash
# Start the Divinr API + (when Stripe is configured) the Stripe webhook
# forwarder as a single command. Idempotent — kills any prior instance first.
#
# Usage:
#   bash apps/api/scripts/dev-up.sh
#   pnpm --filter @divinr/api run dev:up
set -e

API_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$API_DIR/../.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"
LOG_API=/tmp/divinr-api.log
LOG_STRIPE=/tmp/divinr-stripe-listen.log
API_PORT="${PORT:-7100}"

echo "── divinr api dev-up ──"
echo "API_DIR    = $API_DIR"
echo "REPO_ROOT  = $REPO_ROOT"
echo "API_PORT   = $API_PORT"

# 1. Kill prior API + stripe listen
pkill -f "node dist/src/main.js" 2>/dev/null || true
pkill -f "stripe listen.*billing/webhooks/stripe" 2>/dev/null || true
sleep 1

# 2. Start the API (assumes dist/ is built; run `pnpm run build` first if not)
if [ ! -f "$API_DIR/dist/src/main.js" ]; then
  echo "× $API_DIR/dist/src/main.js missing — run \`pnpm --filter @divinr/api run build\` first" >&2
  exit 1
fi
cd "$API_DIR"
nohup node dist/src/main.js > "$LOG_API" 2>&1 &
API_PID=$!
echo "✓ API started   pid=$API_PID  logs=$LOG_API"

# 3. Wait for API health (up to 30s)
for i in $(seq 1 30); do
  if curl -sS --max-time 1 "http://localhost:$API_PORT/api/config/public" > /dev/null 2>&1; then
    echo "✓ API healthy after ${i}s"
    break
  fi
  sleep 1
  if [ "$i" -eq 30 ]; then
    echo "× API failed to come up in 30s — see $LOG_API" >&2
    exit 1
  fi
done

# 4. If Stripe is configured, start the webhook forwarder
HAS_STRIPE_KEY=false
if [ -n "${STRIPE_SECRET_KEY:-}" ]; then
  HAS_STRIPE_KEY=true
elif [ -f "$ENV_FILE" ] && grep -qE "^STRIPE_SECRET_KEY=sk_(test|live)_" "$ENV_FILE"; then
  HAS_STRIPE_KEY=true
fi

if [ "$HAS_STRIPE_KEY" = true ]; then
  STRIPE_BIN=""
  if command -v stripe >/dev/null 2>&1; then
    STRIPE_BIN="$(command -v stripe)"
  elif [ -x "$HOME/.local/bin/stripe" ]; then
    STRIPE_BIN="$HOME/.local/bin/stripe"
  fi
  if [ -n "$STRIPE_BIN" ]; then
    nohup "$STRIPE_BIN" listen --forward-to "localhost:$API_PORT/billing/webhooks/stripe" > "$LOG_STRIPE" 2>&1 &
    STRIPE_PID=$!
    echo "✓ stripe listen pid=$STRIPE_PID  logs=$LOG_STRIPE"
    # Wait for the "Ready!" line so the script doesn't exit before the secret is logged
    for i in $(seq 1 10); do
      if grep -q "Ready!" "$LOG_STRIPE" 2>/dev/null; then
        WHSEC="$(grep -oE 'whsec_[a-z0-9]+' "$LOG_STRIPE" | head -1)"
        echo "✓ stripe listen ready, signing secret: ${WHSEC:0:14}…"
        break
      fi
      sleep 1
    done
  else
    echo "○ stripe CLI not found — skipping webhook listener (install: https://docs.stripe.com/stripe-cli)"
  fi
else
  echo "○ STRIPE_SECRET_KEY not set — skipping webhook listener"
fi

echo "── done ──"
