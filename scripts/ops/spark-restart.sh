#!/usr/bin/env bash
# Bounce the API + stripe-listener services on spark from this Mac.
# Wraps `ssh -t spark "bash scripts/ops/restart.sh"`. The TTY ensures sudo's
# password prompt comes through interactively if passwordless sudo isn't set up.
#
# Override defaults via env:
#   SPARK_SSH=golfergeek@spark-51e5      (Tailscale MagicDNS name; works on or off-LAN)
#   SPARK_REPO_DIR=~/projects/divinr.ai
set -e

SPARK_SSH="${SPARK_SSH:-golfergeek@spark-51e5}"
SPARK_REPO_DIR="${SPARK_REPO_DIR:-~/projects/divinr.ai}"

REMOTE_CMD='
set -e
bash scripts/ops/restart.sh
'

echo "→ ssh $SPARK_SSH"
echo "  cd $SPARK_REPO_DIR"
echo "  bash scripts/ops/restart.sh"
ssh -t "$SPARK_SSH" "cd $SPARK_REPO_DIR && $REMOTE_CMD"
