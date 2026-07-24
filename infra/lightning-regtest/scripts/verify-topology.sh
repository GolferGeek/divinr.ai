#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
infra_dir="$(cd "$script_dir/.." && pwd)"
compose=(docker compose -f "$infra_dir/compose.yml")

for role in payer merchant; do
  info="$("${compose[@]}" exec -T "$role-lnd" lncli --network=regtest getinfo)"
  grep -q '"network": "regtest"' <<<"$info"
  grep -q '"synced_to_chain": true' <<<"$info"
  channels="$("${compose[@]}" exec -T "$role-lnd" lncli --network=regtest listchannels)"
  grep -q '"active": true' <<<"$channels"
  printf '%s LND is synchronized with an active channel\n' "$role"
done
