#!/usr/bin/env bash
# Prune testing artifacts older than 7 days.
# Idempotent: safe to run repeatedly; no-op when the dir is empty or missing.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ART_DIR="${REPO_ROOT}/apps/e2e/.testing-artifacts"

if [[ ! -d "${ART_DIR}" ]]; then
  echo "prune-artifacts: ${ART_DIR} does not exist — nothing to prune."
  exit 0
fi

# Files older than 7 days, then empty dirs.
find "${ART_DIR}" -type f -mtime +7 -print -delete
find "${ART_DIR}" -mindepth 1 -type d -empty -print -delete

echo "prune-artifacts: done."
