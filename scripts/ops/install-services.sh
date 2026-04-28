#!/usr/bin/env bash
# Install the divinr.ai API + Stripe-listener systemd units on spark (Linux).
# Idempotent — re-run after a git pull to update the unit files.
#
# Usage (on spark):
#   git pull
#   pnpm install && pnpm --filter @divinr/api run build   # if dist/ is stale
#   bash scripts/ops/install-services.sh
#
# After install, manage the services with systemd, NOT dev-up.sh:
#   sudo systemctl restart divinr-api
#   sudo systemctl restart divinr-stripe-listen
#   journalctl -u divinr-api -f
set -euo pipefail

if [ "$(uname -s)" != "Linux" ]; then
  echo "× This script is for spark (Linux). On macOS, use 'pnpm --filter @divinr/api run dev:up' instead." >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEMPLATE_DIR="$REPO_ROOT/scripts/ops/systemd"
TARGET_DIR=/etc/systemd/system
ENV_FILE="$REPO_ROOT/.env"

# 1. Locate node — explicit env var wins, else PATH, else newest nvm install.
NODE_BIN="${NODE_BIN:-}"
if [ -z "$NODE_BIN" ]; then
  NODE_BIN="$(command -v node || true)"
fi
if [ -z "$NODE_BIN" ] && [ -d "$HOME/.nvm/versions/node" ]; then
  NODE_BIN="$(find "$HOME/.nvm/versions/node" -mindepth 3 -maxdepth 3 -name node -type f 2>/dev/null | sort -V | tail -1 || true)"
fi
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  echo "× Could not find node. Set NODE_BIN explicitly:" >&2
  echo "    NODE_BIN=/full/path/to/node bash $0" >&2
  exit 1
fi

# 2. Locate stripe CLI.
STRIPE_BIN="${STRIPE_BIN:-$(command -v stripe || true)}"
if [ -z "$STRIPE_BIN" ] || [ ! -x "$STRIPE_BIN" ]; then
  echo "× Could not find the stripe CLI." >&2
  echo "  Install: download Linux ARM64 binary from https://github.com/stripe/stripe-cli/releases into ~/.local/bin/" >&2
  echo "  Then:    stripe login" >&2
  exit 1
fi

# 2b. Locate cloudflared CLI.
CLOUDFLARED_BIN="${CLOUDFLARED_BIN:-$(command -v cloudflared || true)}"
if [ -z "$CLOUDFLARED_BIN" ] || [ ! -x "$CLOUDFLARED_BIN" ]; then
  echo "× Could not find the cloudflared CLI." >&2
  echo "  Install: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/" >&2
  exit 1
fi
TUNNEL_CRED_FILE="$HOME/.cloudflared/8a8fd2a7-e848-406b-add7-38ed132f0df0.json"
if [ ! -f "$TUNNEL_CRED_FILE" ]; then
  echo "× $TUNNEL_CRED_FILE missing — needed to authenticate the divinr Cloudflare Tunnel." >&2
  echo "  Run 'cloudflared tunnel login' and 'cloudflared tunnel create ...' to provision," >&2
  echo "  or copy the credentials file from another spark." >&2
  exit 1
fi

# 3. Sanity checks.
if [ ! -f "$ENV_FILE" ]; then
  echo "× $ENV_FILE missing — the API needs an env file before it can boot." >&2
  exit 1
fi
if [ ! -f "$REPO_ROOT/apps/api/dist/src/main.js" ]; then
  echo "× $REPO_ROOT/apps/api/dist/src/main.js missing — run 'pnpm --filter @divinr/api run build' first." >&2
  exit 1
fi
if [ ! -f "$HOME/.config/stripe/config.toml" ]; then
  echo "× ~/.config/stripe/config.toml missing — run 'stripe login' once before starting the listener service." >&2
  exit 1
fi

echo "── Installing divinr.ai systemd units ──"
echo "REPO_ROOT       = $REPO_ROOT"
echo "NODE_BIN        = $NODE_BIN"
echo "STRIPE_BIN      = $STRIPE_BIN"
echo "CLOUDFLARED_BIN = $CLOUDFLARED_BIN"
echo "TARGET          = $TARGET_DIR"
echo

# 4. Stop and disable any prior broken unit so it doesn't fight for port 7100.
if systemctl list-unit-files 2>/dev/null | awk '{print $1}' | grep -qx divinr-dev.service; then
  echo "→ Stopping & disabling legacy divinr-dev.service..."
  sudo systemctl stop divinr-dev.service 2>/dev/null || true
  sudo systemctl disable divinr-dev.service 2>/dev/null || true
fi

# 5. Install Cloudflare Tunnel ingress config.
echo "→ Installing /etc/cloudflared/config-divinr.yml..."
sudo mkdir -p /etc/cloudflared
sudo cp "$REPO_ROOT/scripts/ops/cloudflared/config-divinr.yml" /etc/cloudflared/config-divinr.yml

# 6. Render templates and install.
for unit in divinr-api.service divinr-stripe-listen.service divinr-cloudflared.service; do
  echo "→ Installing $unit..."
  sed \
    -e "s|__NODE_BIN__|$NODE_BIN|g" \
    -e "s|__STRIPE_BIN__|$STRIPE_BIN|g" \
    -e "s|__CLOUDFLARED_BIN__|$CLOUDFLARED_BIN|g" \
    -e "s|__REPO_ROOT__|$REPO_ROOT|g" \
    "$TEMPLATE_DIR/$unit" | sudo tee "$TARGET_DIR/$unit" >/dev/null
done

sudo systemctl daemon-reload

# 7. Enable + start (idempotent — no-op if already enabled).
for unit in divinr-api.service divinr-stripe-listen.service divinr-cloudflared.service; do
  sudo systemctl enable --now "$unit"
done

echo
echo "── Status ──"
sudo systemctl status divinr-api.service          --no-pager --lines=5 || true
echo
sudo systemctl status divinr-stripe-listen.service --no-pager --lines=5 || true
echo
sudo systemctl status divinr-cloudflared.service  --no-pager --lines=5 || true
echo
echo "── Done ──"
echo "  Manage from now on with systemd, NOT dev-up.sh:"
echo "    sudo systemctl restart divinr-api"
echo "    sudo systemctl restart divinr-stripe-listen"
echo "    sudo systemctl restart divinr-cloudflared"
echo "    journalctl -u divinr-api -f"
echo "    journalctl -u divinr-stripe-listen -f"
echo "    journalctl -u divinr-cloudflared -f"
