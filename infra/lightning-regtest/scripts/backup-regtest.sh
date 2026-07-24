#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
infra_dir="$(cd "$script_dir/.." && pwd)"
compose=(docker compose -f "$infra_dir/compose.yml")
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
destination="$infra_dir/backups/$stamp"
mkdir -p "$destination"
chmod 700 "$infra_dir/backups" "$destination"

for role in payer merchant; do
  "${compose[@]}" exec -T "$role-lnd" lncli --network=regtest exportchanbackup --all \
    > "$destination/$role-channel-backup.json"
  chmod 600 "$destination/$role-channel-backup.json"
done
sha256sum "$destination"/*.json > "$destination/SHA256SUMS"
printf 'Wrote protected regtest channel backups to %s\n' "$destination"
