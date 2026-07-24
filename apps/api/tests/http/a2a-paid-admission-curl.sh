#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${AGENT_HTTP_BASE:-http://127.0.0.1:7199}"
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

if ! curl -fsS "$BASE_URL/_test/status" >/dev/null 2>&1; then
  A2A_ADMISSION_HARNESS_PORT="${BASE_URL##*:}" \
    pnpm --filter @divinr/api exec tsx tests/http/a2a-paid-admission-harness.ts \
      >"$TMP_DIR/harness.log" 2>&1 &
  HARNESS_PID="$!"
  for _ in {1..50}; do
    if curl -fsS "$BASE_URL/_test/status" >/dev/null 2>&1; then break; fi
    sleep 0.1
  done
fi
if ! curl -fsS "$BASE_URL/_test/status" >/dev/null; then
  sed -n '1,200p' "$TMP_DIR/harness.log" >&2
  exit 1
fi

post_a2a() {
  local request_file="$1"
  shift
  curl -fsS \
    -H 'Content-Type: application/json' \
    -H 'A2A-Version: 1.0' \
    -H 'A2A-Extensions: urn:golfergeek:a2a:x402-lightning-regtest:v0.2' \
    "$@" \
    --data-binary "@$request_file" \
    "$BASE_URL/a2a"
}

curl -fsS "$BASE_URL/_test/request/general_updates/general-1" \
  >"$TMP_DIR/general.json"
post_a2a "$TMP_DIR/general.json" >"$TMP_DIR/general-response.json" &
RACE_PID_ONE="$!"
post_a2a "$TMP_DIR/general.json" >"$TMP_DIR/general-race-response.json" &
RACE_PID_TWO="$!"
wait "$RACE_PID_ONE"
wait "$RACE_PID_TWO"
jq -e '
  .result.status.state == "TASK_STATE_INPUT_REQUIRED"
  and .result.status.message.metadata["x402.payment.status"] == "payment-required"
  and .result.status.message.metadata["golfergeek.quote"].price.minorUnits == 1
  and .result.status.message.metadata["golfergeek.quote"].settlement.amount == "10000"
  and (.result.artifacts | length) == 0
' "$TMP_DIR/general-response.json" >/dev/null
GENERAL_TASK="$(jq -r .result.id "$TMP_DIR/general-response.json")"
GENERAL_QUOTE="$(jq -r '.result.status.message.metadata["golfergeek.quote"].quoteId' "$TMP_DIR/general-response.json")"
test "$(jq -r .result.id "$TMP_DIR/general-race-response.json")" = "$GENERAL_TASK"
test "$(jq -r '.result.status.message.metadata["golfergeek.quote"].quoteId' "$TMP_DIR/general-race-response.json")" = "$GENERAL_QUOTE"

post_a2a "$TMP_DIR/general.json" >"$TMP_DIR/general-retry.json"
test "$(jq -r .result.id "$TMP_DIR/general-retry.json")" = "$GENERAL_TASK"
test "$(jq -r '.result.status.message.metadata["golfergeek.quote"].quoteId' "$TMP_DIR/general-retry.json")" = "$GENERAL_QUOTE"

curl -fsS "$BASE_URL/_test/request/general_updates/general-1?pageSize=11" \
  >"$TMP_DIR/idempotency-conflict.json"
post_a2a "$TMP_DIR/idempotency-conflict.json" \
  >"$TMP_DIR/idempotency-conflict-response.json"
jq -e '.error.data.code == "IDEMPOTENCY_CONFLICT"' \
  "$TMP_DIR/idempotency-conflict-response.json" >/dev/null

curl -fsS "$BASE_URL/_test/request/personal_updates/personal-1" \
  >"$TMP_DIR/personal.json"
post_a2a "$TMP_DIR/personal.json" -H 'Authorization: DPoP missing-scope' \
  >"$TMP_DIR/missing-scope-response.json"
jq -e '.error.data.code == "SCOPE_INSUFFICIENT"' \
  "$TMP_DIR/missing-scope-response.json" >/dev/null
post_a2a "$TMP_DIR/personal.json" >"$TMP_DIR/personal-response.json"
jq -e '
  .result.status.message.metadata["golfergeek.quote"].price.minorUnits == 2
  and .result.status.message.metadata["golfergeek.quote"].settlement.amount == "20000"
  and (.result.artifacts | length) == 0
' "$TMP_DIR/personal-response.json" >/dev/null

printf '%s' '{"jsonrpc":"2.0","id":"rpc-list","method":"ListTasks","params":{"pageSize":50}}' \
  >"$TMP_DIR/list.json"
post_a2a "$TMP_DIR/list.json" >"$TMP_DIR/list-response.json"
jq -e '.result.tasks | length == 2' "$TMP_DIR/list-response.json" >/dev/null

curl -fsS "$BASE_URL/_test/request/general_updates/general-2" \
  >"$TMP_DIR/third.json"
post_a2a "$TMP_DIR/third.json" >"$TMP_DIR/third-response.json"
jq -e '.error.data.code == "COUNT_LIMIT_EXCEEDED"' \
  "$TMP_DIR/third-response.json" >/dev/null

printf '{"jsonrpc":"2.0","id":"rpc-get","method":"GetTask","params":{"id":"%s"}}' \
  "$GENERAL_TASK" >"$TMP_DIR/get.json"
post_a2a "$TMP_DIR/get.json" >"$TMP_DIR/get-response.json"
test "$(jq -r .result.id "$TMP_DIR/get-response.json")" = "$GENERAL_TASK"

post_a2a "$TMP_DIR/get.json" -H 'Authorization: DPoP cross-user' \
  >"$TMP_DIR/cross-user.json"
jq -e '.error.data.code == "RESOURCE_NOT_FOUND"' "$TMP_DIR/cross-user.json" >/dev/null

printf '{"jsonrpc":"2.0","id":"rpc-cancel","method":"CancelTask","params":{"id":"%s"}}' \
  "$GENERAL_TASK" >"$TMP_DIR/cancel.json"
post_a2a "$TMP_DIR/cancel.json" >"$TMP_DIR/cancel-response.json"
jq -e '.result.status.state == "TASK_STATE_CANCELED"' \
  "$TMP_DIR/cancel-response.json" >/dev/null

echo "A2A paid-admission curl checks passed"
