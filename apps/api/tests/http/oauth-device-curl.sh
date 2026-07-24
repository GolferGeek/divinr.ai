#!/usr/bin/env bash
set -euo pipefail

BASE="${AGENT_HTTP_BASE:-http://127.0.0.1:7100}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

node --input-type=module >"$TMP_DIR/key.json" <<'NODE'
import { generateKeyPairSync } from 'node:crypto';
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
process.stdout.write(JSON.stringify({
  privateJwk: privateKey.export({ format: 'jwk' }),
  publicJwk: publicKey.export({ format: 'jwk' }),
}));
NODE

make_proof() {
  local method="$1"
  local uri="$2"
  node --input-type=module - "$TMP_DIR/key.json" "$method" "$uri" <<'NODE'
import { readFileSync } from 'node:fs';
import { randomUUID, sign } from 'node:crypto';
const [keyPath, method, uri] = process.argv.slice(2);
const keys = JSON.parse(readFileSync(keyPath, 'utf8'));
const header = { typ: 'dpop+jwt', alg: 'ES256', jwk: keys.publicJwk };
const payload = {
  htm: method,
  htu: uri,
  iat: Math.floor(Date.now() / 1000),
  jti: randomUUID(),
};
const enc = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const protectedValue = enc(header);
const payloadValue = enc(payload);
const signature = sign(
  'sha256',
  Buffer.from(`${protectedValue}.${payloadValue}`),
  {
    key: keys.privateJwk,
    format: 'jwk',
    dsaEncoding: 'ieee-p1363',
  },
).toString('base64url');
process.stdout.write(`${protectedValue}.${payloadValue}.${signature}`);
NODE
}

curl --fail --silent --show-error \
  "$BASE/.well-known/oauth-authorization-server" \
  | jq -e '
      .issuer == "https://divinr.ai"
      and .device_authorization_endpoint == "https://divinr.ai/oauth/device_authorization"
      and .dpop_signing_alg_values_supported == ["ES256"]
    ' >/dev/null

DEVICE_URI="$BASE/oauth/device_authorization"
DEVICE_PROOF="$(make_proof POST "$DEVICE_URI")"
curl --fail --silent --show-error \
  -H 'content-type: application/json' \
  -H "dpop: $DEVICE_PROOF" \
  --data '{
    "client_id":"apple-assistant-native-v1",
    "scope":"updates:read commerce:purchase receipts:read",
    "resource":"https://divinr.ai/a2a",
    "installation_id":"curl-installation-demo-001",
    "installation_name":"Curl Apple Assistant"
  }' \
  "$DEVICE_URI" >"$TMP_DIR/device.json"

jq -e '
  (.device_code | length) >= 32
  and (.user_code | test("^[A-Z0-9]{4}-[A-Z0-9]{4}$"))
  and .expires_in == 600
  and .interval == 5
' "$TMP_DIR/device.json" >/dev/null

TOKEN_URI="$BASE/oauth/token"
TOKEN_PROOF="$(make_proof POST "$TOKEN_URI")"
HTTP_STATUS="$(
  curl --silent --show-error \
    -o "$TMP_DIR/token.json" \
    -w '%{http_code}' \
    -H 'content-type: application/json' \
    -H "dpop: $TOKEN_PROOF" \
    --data "$(
      jq -cn --arg code "$(jq -r .device_code "$TMP_DIR/device.json")" '{
        grant_type:"urn:ietf:params:oauth:grant-type:device_code",
        device_code:$code,
        client_id:"apple-assistant-native-v1"
      }'
    )" \
    "$TOKEN_URI"
)"
test "$HTTP_STATUS" = "400"
jq -e '.error == "authorization_pending"' "$TMP_DIR/token.json" >/dev/null

BAD_PROOF="$(make_proof POST "$DEVICE_URI")"
BAD_STATUS="$(
  curl --silent --show-error \
    -o "$TMP_DIR/bad-scope.json" \
    -w '%{http_code}' \
    -H 'content-type: application/json' \
    -H "dpop: $BAD_PROOF" \
    --data '{
      "client_id":"apple-assistant-native-v1",
      "scope":"updates:read admin:write",
      "resource":"https://divinr.ai/a2a",
      "installation_id":"curl-installation-demo-002",
      "installation_name":"Curl Excess Scope"
    }' \
    "$DEVICE_URI"
)"
test "$BAD_STATUS" = "400"
jq -e '.error == "invalid_scope"' "$TMP_DIR/bad-scope.json" >/dev/null

echo "OAuth device curl checks passed"
