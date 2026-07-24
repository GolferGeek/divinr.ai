#!/usr/bin/env bash
set -euo pipefail

network="${DIVINR_BITCOIN_NETWORK:-regtest}"
[[ "$network" == "regtest" ]] || { echo "Refusing non-regtest miner" >&2; exit 78; }

bitcoin_cli=(bitcoin-cli -conf=/run/divinr/bitcoin.conf -rpcconnect=bitcoind)
wallet=divinr-miner

until "${bitcoin_cli[@]}" getblockchaininfo >/dev/null 2>&1; do sleep 1; done
if ! "${bitcoin_cli[@]}" listwallets | grep -q "\"$wallet\""; then
  "${bitcoin_cli[@]}" createwallet "$wallet" >/dev/null 2>&1 ||
    "${bitcoin_cli[@]}" loadwallet "$wallet" >/dev/null
fi
address="$("${bitcoin_cli[@]}" -rpcwallet="$wallet" getnewaddress)"
height="$("${bitcoin_cli[@]}" getblockcount)"
if (( height < 101 )); then
  "${bitcoin_cli[@]}" -rpcwallet="$wallet" generatetoaddress "$((101 - height))" "$address" >/dev/null
fi

while true; do
  pending="$("${bitcoin_cli[@]}" getmempoolinfo | sed -nE 's/.*"size":[[:space:]]*([0-9]+).*/\1/p')"
  if [[ "${pending:-0}" -gt 0 ]]; then
    "${bitcoin_cli[@]}" -rpcwallet="$wallet" generatetoaddress 6 "$address" >/dev/null
  fi
  sleep 5
done
