#!/usr/bin/env bash
set -euo pipefail

network="${DIVINR_BITCOIN_NETWORK:-regtest}"
[[ "$network" == "regtest" ]] || { echo "Refusing non-regtest bootstrap" >&2; exit 78; }

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
infra_dir="$(cd "$script_dir/.." && pwd)"
compose=(docker compose -f "$infra_dir/compose.yml")

for role in payer merchant; do
  until "${compose[@]}" exec -T "$role-lnd" lncli --network=regtest getinfo >/dev/null 2>&1; do sleep 2; done
done

btc() {
  "${compose[@]}" exec -T bitcoind bitcoin-cli \
    -conf=/run/divinr/bitcoin.conf -datadir=/data "$@"
}

if ! btc listwallets | grep -q '"divinr-miner"'; then
  btc loadwallet divinr-miner >/dev/null
fi
miner_address="$(btc -rpcwallet=divinr-miner getnewaddress)"

for role in payer merchant; do
  confirmed="$("${compose[@]}" exec -T "$role-lnd" lncli --network=regtest walletbalance |
    sed -nE 's/.*"confirmed_balance":[[:space:]]*"([0-9]+)".*/\1/p' | head -1)"
  if [[ "${confirmed:-0}" -lt 100000000 ]]; then
    address="$("${compose[@]}" exec -T "$role-lnd" lncli --network=regtest newaddress p2wkh |
      sed -nE 's/.*"address":[[:space:]]*"([^"]+)".*/\1/p')"
    btc -rpcwallet=divinr-miner sendtoaddress "$address" 2 >/dev/null
  fi
done
btc -rpcwallet=divinr-miner generatetoaddress 6 "$miner_address" >/dev/null

payer_pub="$("${compose[@]}" exec -T payer-lnd lncli --network=regtest getinfo |
  sed -nE 's/.*"identity_pubkey":[[:space:]]*"([^"]+)".*/\1/p')"
merchant_pub="$("${compose[@]}" exec -T merchant-lnd lncli --network=regtest getinfo |
  sed -nE 's/.*"identity_pubkey":[[:space:]]*"([^"]+)".*/\1/p')"

"${compose[@]}" exec -T payer-lnd lncli --network=regtest \
  connect "$merchant_pub@merchant-lnd:9735" >/dev/null 2>&1 || true

channel_count="$("${compose[@]}" exec -T payer-lnd lncli --network=regtest listchannels |
  grep -c '"chan_id"' || true)"
pending_count="$("${compose[@]}" exec -T payer-lnd lncli --network=regtest pendingchannels |
  grep -c '"channel_point"' || true)"
if [[ "$channel_count" -eq 0 && "$pending_count" -eq 0 ]]; then
  "${compose[@]}" exec -T payer-lnd lncli --network=regtest \
    openchannel --node_key="$merchant_pub" --local_amt=10000000 >/dev/null
  btc -rpcwallet=divinr-miner generatetoaddress 6 "$miner_address" >/dev/null
fi

runtime_root="${DIVINR_AGENT_COMMERCE_ROOT:-$infra_dir/.runtime}"
mkdir -p "$runtime_root/secrets/lnd"
chmod 700 "$runtime_root/secrets/lnd"
for role in payer merchant; do
  "${compose[@]}" exec -T "$role-lnd" lncli --network=regtest bakemacaroon \
    info:read onchain:read offchain:read offchain:write \
    invoices:read invoices:write 2>/dev/null |
    sed -nE 's/.*"macaroon":[[:space:]]*"([^"]+)".*/\1/p' |
    xxd -r -p > "$runtime_root/secrets/lnd/$role.facade.macaroon"
  chmod 600 "$runtime_root/secrets/lnd/$role.facade.macaroon"
  "${compose[@]}" cp "$role-lnd:/root/.lnd/tls.cert" \
    "$runtime_root/secrets/lnd/$role.tls.cert"
  chmod 600 "$runtime_root/secrets/lnd/$role.tls.cert"
done

printf 'Topology bootstrapped: payer=%s merchant=%s\n' "$payer_pub" "$merchant_pub"
