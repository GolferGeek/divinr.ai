#!/usr/bin/env bash
# Pull, install, build, and restart the divinr stack on spark from this Mac.
# Equivalent to SSHing into spark and running:
#   git pull && pnpm install && pnpm --filter @divinr/api run build && pnpm restart
#
# Override defaults via env:
#   SPARK_SSH=golfergeek@spark-51e5.local
#   SPARK_REPO_DIR=~/projects/divinr.ai
set -e

SPARK_SSH="${SPARK_SSH:-golfergeek@spark-51e5.local}"
SPARK_REPO_DIR="${SPARK_REPO_DIR:-~/projects/divinr.ai}"

REMOTE_CMD='set -e; git pull && pnpm install && pnpm --filter @divinr/api run build && pnpm restart'

echo "→ ssh $SPARK_SSH"
echo "  cd $SPARK_REPO_DIR"
echo "  $REMOTE_CMD"
echo
ssh -t "$SPARK_SSH" "cd $SPARK_REPO_DIR && $REMOTE_CMD"
