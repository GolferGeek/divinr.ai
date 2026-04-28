#!/usr/bin/env bash
# Pull, install, build, and restart the divinr stack on spark from this Mac.
# Equivalent to SSHing into spark and running:
#   git pull && <pnpm> install && <pnpm> --filter @divinr/api run build && <pnpm> --filter @divinr/web run build && bash scripts/ops/restart.sh
#
# Override defaults via env:
#   SPARK_SSH=golfergeek@spark-51e5      (Tailscale MagicDNS name; works on or off-LAN)
#   SPARK_REPO_DIR=~/projects/divinr.ai
set -e

SPARK_SSH="${SPARK_SSH:-golfergeek@spark-51e5}"
SPARK_REPO_DIR="${SPARK_REPO_DIR:-~/projects/divinr.ai}"

REMOTE_CMD='
set -e
export PATH="$HOME/.local/share/pnpm:$PATH"
if command -v pnpm >/dev/null 2>&1; then
  PNPM_BIN="pnpm"
elif command -v corepack >/dev/null 2>&1; then
  PNPM_BIN="corepack pnpm"
else
  echo "× Neither pnpm nor corepack is available on spark." >&2
  exit 1
fi
git pull
$PNPM_BIN install
$PNPM_BIN --filter @divinr/api run build
$PNPM_BIN --filter @divinr/web run build
sudo mkdir -p /var/www/divinr.ai
sudo rsync -a --delete apps/web/dist/ /var/www/divinr.ai/
sudo chown -R www-data:www-data /var/www/divinr.ai
sudo chmod -R a+rX /var/www/divinr.ai
sudo cp scripts/ops/nginx/divinr.ai.conf /etc/nginx/sites-enabled/divinr.ai
sudo nginx -t
sudo systemctl reload nginx
bash scripts/ops/restart.sh
'

echo "→ ssh $SPARK_SSH"
echo "  cd $SPARK_REPO_DIR"
echo "  $REMOTE_CMD"
echo
ssh -t "$SPARK_SSH" "cd $SPARK_REPO_DIR && $REMOTE_CMD"
