#!/usr/bin/env bash
set -euo pipefail

network="${DIVINR_BITCOIN_NETWORK:-regtest}"
[[ "$network" == "regtest" ]] || { echo "Refusing non-regtest PKI" >&2; exit 78; }

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
infra_dir="$(cd "$script_dir/.." && pwd)"
runtime_root="${DIVINR_AGENT_COMMERCE_ROOT:-$infra_dir/.runtime}"
pki_dir="$runtime_root/pki"
mkdir -p "$pki_dir"
chmod 700 "$pki_dir"
umask 077

if [[ ! -f "$pki_dir/ca.key" ]]; then
  openssl ecparam -name prime256v1 -genkey -noout -out "$pki_dir/ca.key"
  openssl req -x509 -new -sha256 -key "$pki_dir/ca.key" -days 3650 \
    -subj "/CN=Divinr Agent Commerce Regtest CA" -out "$pki_dir/ca.crt"
fi

issue_leaf() {
  local name="$1"
  local uri="$2"
  local extra_sans="$3"
  local usage="$4"
  local ext="$pki_dir/$name.ext"
  [[ -f "$pki_dir/$name.crt" ]] && return
  openssl ecparam -name prime256v1 -genkey -noout -out "$pki_dir/$name.key"
  openssl req -new -sha256 -key "$pki_dir/$name.key" \
    -subj "/CN=$name" -out "$pki_dir/$name.csr"
  {
    printf 'basicConstraints=critical,CA:FALSE\n'
    printf 'keyUsage=critical,digitalSignature,keyAgreement\n'
    printf 'extendedKeyUsage=%s\n' "$usage"
    printf 'subjectAltName=URI:%s%s\n' "$uri" "$extra_sans"
  } > "$ext"
  openssl x509 -req -sha256 -in "$pki_dir/$name.csr" \
    -CA "$pki_dir/ca.crt" -CAkey "$pki_dir/ca.key" -CAcreateserial \
    -days 397 -extfile "$ext" -out "$pki_dir/$name.crt"
  chmod 600 "$pki_dir/$name.key"
}

issue_leaf spark-payer \
  spiffe://golfergeek.local/spark/payer \
  ",DNS:spark-51e5.tail126196.ts.net,IP:100.120.203.62,IP:127.0.0.1" \
  serverAuth
issue_leaf spark-merchant \
  spiffe://golfergeek.local/spark/merchant \
  ",IP:127.0.0.1" serverAuth
issue_leaf apple-assistant-macstudio \
  spiffe://golfergeek.local/apple-assistant/macstudio "" clientAuth
issue_leaf divinr-payer-verifier \
  spiffe://golfergeek.local/divinr/payer-verifier "" clientAuth
issue_leaf divinr-api \
  spiffe://golfergeek.local/divinr/api "" clientAuth
