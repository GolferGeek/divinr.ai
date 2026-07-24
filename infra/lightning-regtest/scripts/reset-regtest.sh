#!/usr/bin/env bash
set -euo pipefail

network="${DIVINR_BITCOIN_NETWORK:-regtest}"
[[ "$network" == "regtest" ]] || { echo "Refusing non-regtest reset" >&2; exit 78; }
[[ "${CONFIRM_DIVINR_REGTEST_RESET:-}" == "DELETE-DIVINR-REGTEST-ONLY" ]] ||
  { echo "Set CONFIRM_DIVINR_REGTEST_RESET=DELETE-DIVINR-REGTEST-ONLY" >&2; exit 64; }

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
infra_dir="$(cd "$script_dir/.." && pwd)"
project="$(
  docker compose -f "$infra_dir/compose.yml" config --format json |
    sed -nE 's/.*"name":"([^"]+)".*/\1/p' | head -1
)"
[[ "$project" == "divinr-lightning-regtest" ]] ||
  { echo "Unexpected Compose project: $project" >&2; exit 78; }

docker compose -f "$infra_dir/compose.yml" down --volumes
printf 'Deleted only the disposable %s volumes\n' "$project"
