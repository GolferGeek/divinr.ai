#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${AGENT_HTTP_BASE:-http://127.0.0.1:7198}"
CANONICAL_A2A_URI="${DPOP_HTU:-https://divinr.ai/a2a}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP_DIR="$(mktemp -d)"
HARNESS_PID=""
cleanup() {
  if [[ -n "$HARNESS_PID" ]]; then
    kill "$HARNESS_PID" 2>/dev/null || true
    wait "$HARNESS_PID" 2>/dev/null || true
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

node -e '
const { generateKeyPairSync } = require("node:crypto");
const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
process.stdout.write(JSON.stringify({
  privateJwk: pair.privateKey.export({ format: "jwk" }),
  publicJwk: pair.publicKey.export({ format: "jwk" })
}));
' > "$TMP_DIR/client.json"
node -e '
const { generateKeyPairSync } = require("node:crypto");
const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
process.stdout.write(JSON.stringify({
  privateJwk: pair.privateKey.export({ format: "jwk" }),
  publicJwk: pair.publicKey.export({ format: "jwk" })
}));
' > "$TMP_DIR/wrong-client.json"

if ! curl -fsS "$BASE_URL/_test/status" >/dev/null 2>&1; then
  OAUTH_DPOP_HARNESS_PORT="${BASE_URL##*:}" \
  OAUTH_DPOP_CLIENT_PUBLIC_JWK="$(jq -c .publicJwk "$TMP_DIR/client.json")" \
    pnpm --filter @divinr/api exec tsx tests/http/oauth-dpop-harness.ts \
      >"$TMP_DIR/harness.log" 2>&1 &
  HARNESS_PID="$!"
  for _ in {1..40}; do
    if curl -fsS "$BASE_URL/_test/status" >/dev/null 2>&1; then break; fi
    sleep 0.1
  done
  if ! curl -fsS "$BASE_URL/_test/status" >/dev/null; then
    sed -n '1,160p' "$TMP_DIR/harness.log" >&2
    exit 1
  fi
fi

issue() {
  local expired="${1:-false}"
  local endpoint="issue"
  if [[ "$expired" == "true" ]]; then endpoint="issue-expired"; fi
  curl -fsS -H 'Content-Type: application/json' \
    --data-binary '{}' "$BASE_URL/_test/$endpoint" > "$TMP_DIR/issued.json"
  jq -e '.access_token | length > 64' "$TMP_DIR/issued.json" >/dev/null
}

proof() {
  local material="$1"
  local nonce="$2"
  local method="$3"
  local uri="$4"
  local ath_mode="$5"
  local jti="$6"
  node "$SCRIPT_DIR/oauth-dpop-proof.mjs" \
    "$material" \
    "$(jq -r .access_token "$TMP_DIR/issued.json")" \
    "$nonce" "$method" "$uri" "$ath_mode" "$jti"
}

call_a2a() {
  local compact="$1"
  curl -sS -D "$TMP_DIR/headers.txt" -o "$TMP_DIR/body.json" \
    -w '%{http_code}' \
    -H 'Content-Type: application/json' \
    -H 'A2A-Version: 1.0' \
    -H "Authorization: DPoP $(jq -r .access_token "$TMP_DIR/issued.json")" \
    -H "DPoP: $compact" \
    --data-binary '{"jsonrpc":"2.0","id":"curl-1","method":"GetTask","params":{"id":"task-1"}}' \
    "$BASE_URL/a2a"
}

issue false
no_nonce="$(proof "$TMP_DIR/client.json" '' POST "$CANONICAL_A2A_URI" valid proof-no-nonce)"
test "$(call_a2a "$no_nonce")" = "401"
nonce="$(awk 'tolower($1) == "dpop-nonce:" {gsub("\\r","",$2); print $2}' "$TMP_DIR/headers.txt")"
if [[ "${#nonce}" -lt 32 ]]; then
  sed -n '1,80p' "$TMP_DIR/headers.txt" >&2
  jq . "$TMP_DIR/body.json" >&2
  exit 1
fi

valid_proof="$(proof "$TMP_DIR/client.json" "$nonce" POST "$CANONICAL_A2A_URI" valid proof-valid)"
test "$(call_a2a "$valid_proof")" = "200"
jq -e '.error.data.code == "AUTH_REQUIRED"' "$TMP_DIR/body.json" >/dev/null

test "$(call_a2a "$valid_proof")" = "401"
jq -e '.code == "DPOP_REPLAY"' "$TMP_DIR/body.json" >/dev/null

wrong_ath="$(proof "$TMP_DIR/client.json" '' POST "$CANONICAL_A2A_URI" wrong proof-wrong-ath)"
test "$(call_a2a "$wrong_ath")" = "401"

wrong_method="$(proof "$TMP_DIR/client.json" '' GET "$CANONICAL_A2A_URI" valid proof-wrong-method)"
test "$(call_a2a "$wrong_method")" = "401"

wrong_url="$(proof "$TMP_DIR/client.json" '' POST "$BASE_URL/not-a2a" valid proof-wrong-url)"
test "$(call_a2a "$wrong_url")" = "401"

wrong_key="$(proof "$TMP_DIR/wrong-client.json" '' POST "$CANONICAL_A2A_URI" valid proof-wrong-key)"
test "$(call_a2a "$wrong_key")" = "401"

issue true
expired="$(proof "$TMP_DIR/client.json" '' POST "$CANONICAL_A2A_URI" valid proof-expired)"
test "$(call_a2a "$expired")" = "401"

issue false
curl -fsS -H 'Content-Type: application/json' \
  --data-binary '{}' "$BASE_URL/_test/revoke" >/dev/null
revoked="$(proof "$TMP_DIR/client.json" '' POST "$CANONICAL_A2A_URI" valid proof-revoked)"
test "$(call_a2a "$revoked")" = "401"

echo "OAuth DPoP curl checks passed"
