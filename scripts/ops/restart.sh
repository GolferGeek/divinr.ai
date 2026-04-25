#!/usr/bin/env bash
# Restart the divinr API + Stripe listener on spark via systemd.
#
# Usage (on spark):
#   pnpm restart
#   # or, equivalently:
#   bash scripts/ops/restart.sh
#
# Does NOT pull or rebuild — for a code update, do:
#   git pull && pnpm install && pnpm --filter @divinr/api run build && pnpm restart
set -e

if [ "$(uname -s)" != "Linux" ]; then
  echo "× This script restarts spark's systemd units. On macOS, use:" >&2
  echo "    pnpm --filter @divinr/api run dev:up" >&2
  exit 1
fi

UNITS=(divinr-api.service divinr-stripe-listen.service)

echo "→ Restarting: ${UNITS[*]}"
sudo systemctl restart "${UNITS[@]}"

echo
echo "── Status ──"
for u in "${UNITS[@]}"; do
  sudo systemctl status "$u" --no-pager --lines=3 || true
  echo
done
