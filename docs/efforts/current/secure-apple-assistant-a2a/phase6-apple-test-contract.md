# Phase 6 Apple Assistant Test Contract

This is the executable handoff for Apple Assistant ↔ Divinr Phase 6 testing.
The frozen profile and schemas in `contracts/apple-divinr/v0.2/` remain
authoritative.

## Discovery and authentication

1. Fetch `GET https://divinr.ai/.well-known/agent-card.json`.
2. Verify its detached ES256 Agent Card signature with
   `GET https://divinr.ai/.well-known/jwks.json`.
3. Select `general_updates` or `personal_updates`, its exact product ID,
   required scopes, and the required project extension from the verified card.
4. Complete Device Authorization once, then use the sender-constrained access
   token and the installation's non-exportable P-256 DPoP key.
5. Every protected call sends:

   - `Content-Type: application/json`
   - `A2A-Version: 1.0`
   - `A2A-Extensions: urn:golfergeek:a2a:x402-lightning-regtest:v0.2`
     for `SendMessage`
   - `Authorization: DPoP <access-token>`
   - `DPoP: <fresh-proof-with-ath-and-current-one-use-nonce>`

The first protected attempt may return `401` with `DPoP-Nonce`. Recreate and
resign the proof with that nonce; never replay the first proof.

## Initial `SendMessage`

The single data part is an `updatesRequest`. The message metadata is an
`a2aRequestMetadata`. Apple Assistant constructs the base canonical intent,
then computes all hashes over RFC 8785 canonical UTF-8 JSON with SHA-256 and
base64url output.

```json
{
  "jsonrpc": "2.0",
  "id": "rpc-unique-001",
  "method": "SendMessage",
  "params": {
    "message": {
      "messageId": "message-unique-001",
      "contextId": "context-owner-updates-001",
      "role": "ROLE_USER",
      "parts": [
        {
          "data": {
            "schemaVersion": 2,
            "requestId": "request-unique-001",
            "idempotencyKey": "idempotency-stable-for-this-intent",
            "pageSize": 10
          },
          "mediaType": "application/json"
        }
      ],
      "metadata": {
        "golfergeek.requestId": "request-unique-001",
        "golfergeek.idempotencyKey": "idempotency-stable-for-this-intent",
        "golfergeek.skillId": "general_updates",
        "golfergeek.inputSchema": "urn:golfergeek:schema:apple-divinr-integration:v0.2#/$defs/updatesRequest",
        "golfergeek.intent": {
          "schemaVersion": 2,
          "intentPhase": "base",
          "installationId": "<credential-bound-installation-id>",
          "originClass": "owner_private",
          "profileId": "urn:golfergeek:profile:apple-divinr-commerce:v0.2",
          "destinationId": "divinr",
          "a2aUrl": "https://divinr.ai/a2a",
          "agentCardVersion": "1.0",
          "agentCardHash": "<verified-agent-card-canonical-hash>",
          "skillId": "general_updates",
          "productId": "divinr.general-updates.demo.v2",
          "businessInputHash": "<canonical-hash-of-the-data-object>",
          "openAuthorityId": "<approved-owner-authority-id>",
          "openAuthorityVersion": 1,
          "constraintHashes": ["<approved-constraint-hash>"]
        },
        "golfergeek.baseIntentHash": "<canonical-hash-of-golfergeek.intent>",
        "golfergeek.currentIntentHash": "<same-hash-at-base-phase>"
      }
    }
  }
}
```

For `personal_updates`, change both bindings:

- skill: `personal_updates`
- product: `divinr.personal-updates.demo.v2`

Never copy a user ID into this request. Divinr derives the effective user only
from the DPoP-bound credential.

## Expected Phase 6 response

The JSON-RPC result is an A2A task with:

- `status.state = TASK_STATE_INPUT_REQUIRED`
- no artifacts
- `x402.payment.status = payment-required`
- a schema-valid, ES256-signed `golfergeek.quote`
- a schema-valid `x402.payment.required`
- an exact quoted canonical intent and its hash

Exact amounts:

| Skill | Demo price | Regtest amount |
|---|---:|---:|
| `general_updates` | 1¢ | `10000` msat |
| `personal_updates` | 2¢ | `20000` msat |

Phase 6's isolated test provider deliberately emits a non-payable invoice.
Phase 7 replaces it with a real, economically valueless Spark Lightning-regtest
invoice. Apple Assistant must not infer settlement from receiving a quote.

## Retry, poll, list, and cancellation

- Retry the identical base intent with the identical idempotency key after an
  ambiguous timeout. Divinr must return the same task and quote.
- Reusing that key with a different canonical base intent returns
  `IDEMPOTENCY_CONFLICT`.
- Poll with:

```json
{"jsonrpc":"2.0","id":"rpc-poll-001","method":"GetTask","params":{"id":"<task-id>"}}
```

- List with `ListTasks`; `pageSize` is 1–50 and `pageToken` is opaque.
- Cancel an unsettled task with:

```json
{"jsonrpc":"2.0","id":"rpc-cancel-001","method":"CancelTask","params":{"id":"<task-id>"}}
```

All task operations remain bound to the original effective user, installation,
grant, and skill scopes. An inaccessible task returns the same
`RESOURCE_NOT_FOUND` envelope as an unknown task.

## Local conformance command

This isolated command exercises concurrent idempotency, exact prices, no
prepayment release, missing scope, cross-user polling, outstanding-task limits,
polling, and cancellation without changing Spark:

```bash
AGENT_HTTP_BASE=http://127.0.0.1:7100 \
  bash apps/api/tests/http/a2a-paid-admission-curl.sh
```

The production-origin test begins only after the relevant phase is deployed and
the Spark schema, role-separated signing keys, and Phase 7 facades pass
readiness.
