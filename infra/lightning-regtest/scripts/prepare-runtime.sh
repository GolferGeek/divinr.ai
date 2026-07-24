#!/usr/bin/env bash
set -euo pipefail

network="${DIVINR_BITCOIN_NETWORK:-regtest}"
if [[ "$network" != "regtest" ]]; then
  echo "Refusing non-regtest network: $network" >&2
  exit 78
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
infra_dir="$(cd "$script_dir/.." && pwd)"
runtime_root="${DIVINR_AGENT_COMMERCE_ROOT:-$infra_dir/.runtime}"
secrets_dir="$runtime_root/secrets"
pki_dir="$runtime_root/pki"
mkdir -p "$secrets_dir" "$pki_dir"
chmod 700 "$runtime_root" "$secrets_dir" "$pki_dir"

rpc_user="divinr_regtest"
if [[ ! -f "$secrets_dir/bitcoin-rpc-password" ]]; then
  openssl rand -hex 32 > "$secrets_dir/bitcoin-rpc-password"
fi
chmod 600 "$secrets_dir/bitcoin-rpc-password"
rpc_password="$(<"$secrets_dir/bitcoin-rpc-password")"

umask 077
{
  printf 'regtest=1\nserver=1\nlisten=1\ndnsseed=0\nfixedseeds=0\n'
  printf 'txindex=1\nfallbackfee=0.00001000\n'
  printf '[regtest]\n'
  printf 'rpcbind=0.0.0.0\nrpcallowip=172.16.0.0/12\n'
  printf 'rpcuser=%s\nrpcpassword=%s\n' "$rpc_user" "$rpc_password"
  printf 'zmqpubrawblock=tcp://0.0.0.0:28332\n'
  printf 'zmqpubrawtx=tcp://0.0.0.0:28333\n'
} > "$secrets_dir/bitcoin.conf"

write_lnd_config() {
  local role="$1"
  {
    printf 'noseedbackup=1\nbitcoin.active=1\nbitcoin.regtest=1\n'
    printf 'bitcoin.node=bitcoind\nbitcoind.rpchost=bitcoind:18443\n'
    printf 'bitcoind.rpcuser=%s\nbitcoind.rpcpass=%s\n' "$rpc_user" "$rpc_password"
    printf 'bitcoind.zmqpubrawblock=tcp://bitcoind:28332\n'
    printf 'bitcoind.zmqpubrawtx=tcp://bitcoind:28333\n'
    printf 'alias=divinr-%s-regtest\n' "$role"
    printf 'rpclisten=0.0.0.0:10009\nrestlisten=0.0.0.0:8080\n'
    printf 'listen=0.0.0.0:9735\n'
    printf 'tlsextradomain=%s-lnd\n' "$role"
  } > "$secrets_dir/$role-lnd.conf"
  chmod 600 "$secrets_dir/$role-lnd.conf"
}

write_lnd_config payer
write_lnd_config merchant
"$script_dir/prepare-pki.sh"

printf 'Prepared regtest runtime beneath %s\n' "$runtime_root"
