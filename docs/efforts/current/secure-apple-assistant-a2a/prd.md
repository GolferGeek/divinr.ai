# Secure Apple Assistant A2A Integration — Product Requirements Document

## 1. Overview

This effort replaces Divinr's preliminary A2A prototype with a standards-grounded, fail-closed A2A 1.0 service for Apple Assistant. It adds OAuth Device Authorization, DPoP-bound credentials, deterministic skill admission, AP2 purchasing authority, a project-defined A2A-carried x402 Lightning-regtest exchange, exactly-once paid result release, receipts, refunds, audit evidence, and connected-agent controls.

Divinr production, its API, the two Lightning facades, and all payment state run on Spark. The Mac Studio is a separate trust domain that hosts Apple Assistant and owner-side controls; it is not a Divinr production host. All Lightning value is economically valueless Bitcoin regtest value and must be labeled that way.

The governing boundary is deterministic: models may propose a skill call and interpret a result, but may not authenticate callers, derive the effective user, approve scopes or mandates, reserve budgets, sign protocol objects, move value, mutate tournaments, release paid results, or write authoritative audit evidence.

The implementation targets the frozen shared profile `urn:golfergeek:profile:apple-divinr-commerce:v0.2`. It pins A2A `1.0.0` at commit `173695755607e884aa9acf8ce4feed90e32727a1`, AP2 `v0.2.0` at `b4587ac1d055888a73b4b21750973cffba961793`, and x402 core-v2 semantics at `21a2e489c7ba17c2b04e4cd9ea7015da1cb4aa99`. Because the pinned x402 A2A transport is not wire-compatible with A2A 1.0, the integration advertises only project extension `urn:golfergeek:a2a:x402-lightning-regtest:v0.2`; it makes no broader standards-conformance claim.

## 2. Goals & Success Criteria

### Goals

1. Publish a signed, schema-valid A2A 1.0 Agent Card and accept `SendMessage`, `GetTask`, `ListTasks`, and `CancelTask` at `POST /a2a`.
2. Connect an existing Divinr user to one Apple Assistant installation through RFC 8628 without sharing browser tokens, service API keys, or client secrets.
3. Require RFC 9449 DPoP proofs for device authorization, token, refresh, revocation, and every protected A2A call.
4. Offer the seven frozen paid skills at their exact 1¢–5¢ catalog prices and independent `10000`–`50000` msat regtest settlement vectors.
5. Enforce exact OAuth scope, resource ownership, AP2 authority, cumulative count/amount limits, idempotency, replay protection, and paid-result release in deterministic services and atomic database transactions.
6. Operate two separate synchronized LND identities on Spark: the personal-agent payer and Divinr merchant/payee, sharing only one Bitcoin Core regtest chain backend.
7. Produce linked signed quote, Checkout Receipt, Payment Receipt verification, service receipt, settlement evidence, before/after balance snapshots, refund evidence, and append-oriented audit history.
8. Give users typed browser controls to approve, inspect, and revoke connected agents and grants.
9. Prove the boundary through conformance, concurrency, adversarial, recovery, browser, and cross-system tests.

### Measurable success criteria

- `GET /.well-known/agent-card.json` validates against the pinned A2A/profile schemas, verifies under the dedicated Agent Card ES256 public key, and contains no private topology or credentials.
- All six shared v0.2 JSON files and required AP2 schemas are vendored byte-for-byte and verified against `manifest.v0.2.json` during tests and CI.
- Every protected request without a valid token plus matching DPoP proof fails before JSON-RPC dispatch; caller-provided user identifiers never affect the effective user.
- A device code and user code are short-lived, single-use, rate-limited, bound to the proposed installation DPoP thumbprint, and can only be approved by the authenticated resource owner.
- Access tokens live no longer than 600 seconds; refresh families no longer than 30 days; reuse of a rotated refresh token revokes the family and records an audit event.
- All seven skills reject unknown fields, wrong scopes, product/skill mismatches, wrong prices or msat amounts, and missing required profile-extension negotiation.
- Same idempotency key plus same canonical intent returns the existing task/result/receipts; same key plus a different canonical intent returns `IDEMPOTENCY_CONFLICT`.
- Two concurrent requests cannot overspend the same AP2 or payer counter. No read-then-write authorization tally is accepted.
- No artifact is released before an independently verified merchant settlement and single-use release authorization are committed.
- A completed retry cannot create a second payment, action, artifact release, or push side effect.
- Both Spark LND nodes report regtest, chain synchronization, wallet readiness, and an active funded channel before payment acceptance tests run.
- The payer can pay the merchant's exact invoice; both restricted facades report the same payment hash, amount, state, and linked before/after evidence.
- Post-settlement non-delivery, duplicate charge, product mismatch, or amount mismatch opens one exact-principal refund case; routing fees are not refunded.
- Revocation immediately blocks new A2A calls and refreshes for the installation/grant.
- API and web lint, typecheck, build, unit/integration tests, contract tests, security tests, and relevant Playwright tests pass with no request-time DDL.

## 3. User Stories / Use Cases

### Connected Divinr user

- As a user, I can begin a connection on Apple Assistant, enter or follow the device verification flow in Divinr, inspect the installation thumbprint, scopes, and spending authority, and explicitly approve or deny it.
- As a user, I can list connected agents, inspect last use plus relevant audit/receipt history, revoke an installation or grant, and require fresh approval for expanded scopes or authority.
- As a user, my Apple Assistant can request paid general updates, personal updates, tournament listings/context, analysis, tournament join, or a simulated tournament trade without receiving browser credentials or unrestricted Divinr access.
- As a user, I can see the exact demo price, regtest amount, task state, payment/receipt state, and matching balance evidence.
- As a user, I cannot be charged twice because a request timed out or was retried.

### Apple Assistant

- As an A2A client, Apple Assistant can discover the exact Divinr capabilities and schemas from a signed Agent Card.
- As a public native OAuth client, it can enroll a stable non-exportable P-256 DPoP key and obtain short-lived, sender-constrained credentials after owner approval.
- As an agent, it can submit a typed A2A request and receive protocol-native task states, artifacts, and frozen error envelopes.
- As an owner-constrained purchaser, it can present minimum-disclosure AP2 authority and payment evidence while Divinr independently enforces the received critical constraints.
- As a recovering client, it can poll the existing task after a timeout and determine the authoritative state without creating a duplicate charge.

### Divinr operator

- As an operator, I can verify that protected calls cannot pass through the legacy optional service-key guard or caller-selected user context.
- As an operator, I can rotate each cryptographic role independently, retain old public verification keys for 90 days, revoke installations, reconcile unknown payment outcomes, and audit every privileged transition without exposing secrets.
- As an operator, I can reset disposable regtest state and restore the two-node topology without coupling it to OrchestratorAI's lifecycle.

### Course/demo participant

- As a participant, I can inspect a complete agent-to-agent discovery, authorization, purchase, regtest settlement, result release, receipt, and adversarial-denial flow.
- As a participant, I can see that A2A transports agent work, OAuth/DPoP binds the caller, AP2 carries purchasing authority, and x402/Lightning carries payment exchange and settlement evidence; none substitutes for the others.

## 4. Technical Requirements

### 4.1 Architecture

#### Trust domains and ownership

```text
Mac Studio: Apple Assistant + owner controls
    |
    | HTTPS A2A/OAuth with DPoP
    | mTLS to payer authority over Tailscale
    v
Spark: Divinr production
    |- Divinr API and deterministic A2A/OAuth/AP2 state machines
    |- payer facade + personal-agent LND identity
    |- loopback payer verifier view for Divinr
    |- merchant facade + Divinr LND identity
    `- one Bitcoin Core regtest backend
```

- Apple Assistant reaches Divinr only through the public HTTPS origin `https://divinr.ai`; it never receives database, LND, signing-key, or internal service credentials.
- Divinr's model-facing/business services receive only a `VerifiedAgentPrincipal` and schema-validated command. Raw headers, caller context, mandate claims, payment proofs, and caller-supplied user IDs do not reach skill handlers.
- The existing `/.well-known/agent.json` and custom `invoke` contract are superseded. Separately approved legacy service API keys may remain for non-personal integrations but cannot authorize this surface.
- Public discovery has an explicit public policy. Every business method has a separate fail-closed DPoP guard and deterministic admission pipeline; no guard fall-through is permitted.

#### Required modules

- `contracts/apple-divinr/v0.2/`: byte-for-byte shared profile, schemas, fixtures, manifest, pinned AP2 base/reference schemas, and provenance metadata.
- `A2AProtocolModule`: Agent Card construction/signing, JSON-RPC parsing, A2A method mapping, task state serialization, extension negotiation, schema validation, and error normalization.
- `ConnectedAgentsModule`: device authorization, owner approval/denial, grants, installations, refresh families, revocation, operator/user queries, and audit.
- `DpopModule`: JWK thumbprints, proof validation, nonce challenge/consumption, proof replay storage, access-token validation, refresh rotation/reuse detection, and key registry resolution.
- `AgentCommerceModule`: catalog, signed quotes, canonical intent, AP2 verification, constraint engine, counter reservations, payment requirements/submissions, settlement verification, artifact release, receipts, reconciliation, and refunds.
- `AgentSkillsModule`: seven schema-specific adapters into existing updates, markets, analysis, and tournament services. It contains no authorization or payment policy.
- `AgentPushModule`: transactional outbox consumption, RFC 9421/RFC 9530 signing, retries, acknowledgments, and deduplication.
- `SparkPaymentFacade` and `SparkMerchantFacade`: separately deployed, mTLS-only services with separate databases/roles and least-privilege LND credentials.
- `AgentCommerceSchemaService`: explicit bootstrap/readiness verification and immutable catalog/key metadata seeding; it is never called from request handlers.

#### Atomic transaction support

The current `DatabaseService.rawQuery()` executes each call independently through a pool and does not expose a reserved connection. The state machines require multi-statement atomicity. Add a provider-neutral transaction callback:

```ts
interface DatabaseTransaction {
  rawQuery(sql: string, params?: unknown[]): Promise<QueryResult>;
}

interface DatabaseService {
  // existing methods
  withTransaction<T>(
    work: (transaction: DatabaseTransaction) => Promise<T>,
    options?: { isolationLevel?: 'serializable' | 'repeatable read' | 'read committed' },
  ): Promise<T>;
}
```

Both PostgreSQL and Supabase implementations must reserve one `pg` client, issue `BEGIN` with the selected isolation level, commit on success, roll back on error, and release the client. Agent-commerce mutations use `serializable` where counters, idempotency, settlement, release, or refunds can race. Tests cover rollback, connection release, retryable serialization failures, and provider parity.

#### Canonicalization, validation, and cryptography

- JSON schemas compile with strict unknown-keyword and format handling. The frozen v0.2 schemas use valid JSON Schema presence/branch shorthand that requires Ajv's optional `strictRequired` and `strictTypes` authoring lints to be disabled; this does not relax runtime keywords. Unknown properties fail wherever the shared schema says `additionalProperties:false`, and manifest hashing makes every profile byte immutable.
- Canonical payload hashes use RFC 8785 UTF-8 bytes and SHA-256, never `JSON.stringify()` or PostgreSQL display serialization.
- All application amounts are decimal strings mapped to PostgreSQL `numeric(78,0)`; JavaScript `number` is forbidden for atomic amounts.
- A key-provider interface resolves private signing operations from external custody references. Private keys never enter the database, contract bundle, repository, logs, model context, or general API configuration.
- Distinct P-256/ES256 keys are required for Agent Card, OAuth access tokens, AP2 merchant checkout, quote, checkout receipt, service receipt, refund receipt, push signing, facade mTLS, payer receipt, merchant settlement, and Lightning wallet roles.
- Published JWKS includes active and retiring public keys. Retired verification keys remain published for 90 days; compromised keys are revoked immediately with explicit recovery state.
- Receipt verification is deterministic library code in the Apple broker, Divinr ingress/release, and each applicable Spark facade. It is not an agent skill and does not create a separate public receipt-verification endpoint.

#### A2A task and paid-work state machines

- Supported JSON-RPC methods are exactly `SendMessage`, `GetTask`, `ListTasks`, and `CancelTask`.
- Business `SendMessage` requires `A2A-Version: 1.0` and the frozen project URI in `A2A-Extensions`.
- Admission creates the task, initial event, idempotency record, audit event, and outbox record in one transaction.
- Paid tasks move through schema-defined canonical phases: admitted → quoted/`payment-required` → checkout submitted → checkout approved/input required → payment submitted → settlement verified → executing → artifact generated → release authorized → released/completed. Refund and reconciliation substates follow the shared schemas.
- `GetTask`, `ListTasks`, `CancelTask`, and continuations always bind `(effectiveUserId, installationId, grantId, originalSkillScope)`.
- Charge commits exactly once at independent settlement verification. Result release occurs later and exactly once through the merchant release authorization.
- Cancellation before settlement releases reservations and is uncharged. Cancellation after verified settlement cannot erase the obligation to deliver or refund.

#### Frozen catalog

| Skill | Scopes | Product | USD minor units | Regtest msat | Input / output schema |
|---|---|---|---:|---:|---|
| `general_updates` | `updates:read commerce:purchase receipts:read` | `divinr.general-updates.demo.v2` | 1 | `10000` | `updatesRequest` / `updatesResult` |
| `personal_updates` | `updates:read commerce:purchase receipts:read` | `divinr.personal-updates.demo.v2` | 2 | `20000` | `updatesRequest` / `updatesResult` |
| `tournaments_list` | `tournaments:read commerce:purchase receipts:read` | `divinr.tournaments-list.demo.v2` | 1 | `10000` | `tournamentsListRequest` / `tournamentsListResult` |
| `tournament_context` | `tournaments:read commerce:purchase receipts:read` | `divinr.tournament-context.demo.v2` | 2 | `20000` | `tournamentContextRequest` / `tournamentContextResult` |
| `analysis_request` | `analysis:purchase commerce:purchase receipts:read` | `divinr.analysis.demo.v2` | 5 | `50000` | `analysisRequest` / `analysisResult` |
| `tournament_join` | `tournaments:join commerce:purchase receipts:read` | `divinr.tournament-join.demo.v2` | 3 | `30000` | `tournamentJoinRequest` / `tournamentJoinResult` |
| `tournament_trade` | `tournaments:trade commerce:purchase receipts:read` | `divinr.tournament-trade.demo.v2` | 4 | `40000` | `tournamentTradeRequest` / `tournamentTradeResult` |

Every product is paid. Discovery, OAuth, JWKS, task poll/list/cancel, errors, receipt retrieval, refund, reconciliation, and balance inspection are uncharged. There is no `result_get` skill; artifacts are retrieved through `GetTask`.

#### Tournament invariants

- Wire status maps repository `upcoming` → `open`, `active` → `active`, and `completed` → `completed`; archived tournaments are excluded.
- Join input is only `tournamentId`; a fresh typed action approval is separate from payment approval.
- Trade requires matching UUID `instrumentId` and uppercase `symbol`, `long|short`, integer quantity 1–100, a verified analysis artifact ID/hash, current tournament entitlement, and current returned tournament rules.
- At most five successful state-changing tournament actions may commit within the one-hour authority window.

### 4.2 Data Model Changes

Use normal versioned migrations under `apps/api/db/migrations/`; add required relations to bootstrap readiness. Application bootstrap may seed immutable clients, catalog entries, schema hashes, and public key metadata idempotently. Request handlers never create or alter schema.

All primary keys are UUID; external protocol IDs are separate unique text. Timestamps are UTC `timestamptz`. User-owned rows have `user_id NOT NULL` and RLS/service-authorization policies. Mutable state rows use `lock_version`. Evidence/audit rows do not cascade-delete. Status and amount constraints fail closed.

#### Divinr connected-agent and credential tables

| Table | Required data and constraints |
|---|---|
| `oauth_clients` | Public `client_id`, type, software/display IDs, grants/auth methods, allowed scopes/audiences, status/timestamps; unique `client_id`; `apple-assistant-native-v1` has no secret. |
| `agent_installations` | External installation ID, user, client, display name, `dpop_jkt`, algorithm, status, approved scopes, lifecycle metadata; unique external ID and active `(user_id,dpop_jkt)`. |
| `oauth_device_authorizations` | Client, installation request, proposed `dpop_jkt`, hashed device code, keyed hash of normalized user code, requested scopes/audiences, URI, interval, status and lifecycle timestamps, approving user; codes unique and single-consumption. |
| `agent_grants` | User, installation, scopes, status, validity, owner/open-authority refs and approval/revocation metadata; one active user-installation grant. |
| `oauth_refresh_token_families` | Grant, `dpop_jkt`, status, generation, lifecycle/compromise timestamps; unique family. |
| `oauth_refresh_tokens` | Family, generation, token hash, issue/expiry/use/revoke times, replacement; unique hash and `(family,generation)`. |
| `oauth_access_token_jtis` | JTI/hash, grant, audience, scope hash, `dpop_jkt`, issue/expiry/revoke times; unique JTI. |
| `dpop_proof_replays` | `dpop_jkt`, proof JTI, method, canonical URI hash, optional token hash, seen/expiry; unique `(dpop_jkt,proof_jti)`. |
| `dpop_nonces` | Nonce hash, installation/key, purpose, issue/expiry/consume times; unique and one-use; at most four active per installation. |
| `cryptographic_key_registry` | Key ID, owner/service, distinct role including dedicated Agent Card signing, algorithm, public JWK/cert hash, external custody ref, status/validity/supersession; no private material. |

#### Divinr A2A, AP2, payment, result, push, and audit tables

| Table | Required data and constraints |
|---|---|
| `a2a_products` | Product/version, skill, status, description, schema hashes, pricing policy, AP2/payment class, artifact type, effective dates; unique product/version. |
| `a2a_tasks` | Protocol/context/request IDs, user/installation/grant, skill/product/version, idempotency and canonical intent hashes/phases, A2A/payment/result states, refs, expiry, lock, terminal metadata; unique protocol and request IDs. |
| `a2a_task_events` | Task, monotonic sequence, event/state, canonical hash, safe data, time; unique task/sequence. |
| `a2a_idempotency` | Scope hash/key, immutable base-intent hash, task, current intent/phase/response hashes, first/last seen, expiry; unique `(scope_hash,key)`. |
| `checkout_quotes` | Quote/task/user/installation/product/merchant, exact amount/asset/unit/network/method, checkout JWT/hash, one-use checkout/payment nonces, signed quote/ref/hash, time/status/requirement hash; unique IDs, hashes, and nonces. |
| `ap2_mandates` | Task/user/installation, kind/VCT, issuer/subject/audience, parent, payload/leaf JWT/disclosure hashes, signed reference, validity and verification state/reason; unique IDs/hashes. |
| `ap2_constraints` | Mandate/constraint ID, namespace/type/version/scope, critical, canonical value/hash, enforcement state/verifier/result; unique mandate/constraint. |
| `ap2_counters` | User, authority/merchant/product/constraint/window, asset/unit, limits and reserved/committed amount/count, lock; one counter per authority/constraint/window with non-negative and within-limit checks. |
| `ap2_reservations` | Counter/task/quote/mandate, amount/count, state, expiry/commit/release, settlement; unique counter/task; settled reservations cannot release. |
| `payment_requirements` | Task/quote, profile/extension, canonical x402 requirement/hash, exact payment tuple, invoice/reference hash, lifecycle/status; unique ID/hash. |
| `payment_submissions` | Task/requirement/mandate, checkout/receipt/payment hashes, idempotency, canonical evidence/hash/ref, payer authority, state/times/failure; one accepted submission per task/requirement. |
| `settlements` | Submission, Spark merchant observation, invoice/payment hash, exact amount/asset/unit/fee, state/evidence/times; unique settlement and payment hash. |
| `result_artifacts` | Task/product, content hash, storage ref, media/schema metadata, generation/release state, release settlement/receipt, times; no released artifact without verified links. |
| `receipt_records` | Type and task/quote/mandate/submission/settlement/artifact refs, issuer/signer/key, canonical hash, signed ref, verification/supersession; unique ID/hash. |
| `reconciliation_cases` | Subject refs, reason/state, expected/observed state, attempts/lease/next attempt/owner/resolution/times; one active subject/reason. |
| `refund_cases` | Original task/submission/settlement/payment, reason, payer invoice/refund hash, exact principal tuple, payer/merchant observations, state/receipt/lease/times; one active original settlement/reason and unique refund hash. |
| `agent_push_subscriptions` | User/installation, approved exact callback, auth key/profile, allowed events, status/lifecycle; one active installation/callback. |
| `agent_push_deliveries` | Event/subscription/task/receipt, type, payload hash/ref, attempt/state/schedule/lease/response/ack/times; no duplicate successful delivery. |
| `transactional_outbox` | Aggregate/version/type, payload hash/ref, state/attempt/schedule/lease/published; unique aggregate/version/type. |
| `security_audit_events` | Ordered ID, principal and subject refs, action/outcome/reason, redacted detail, previous/event hash, time; append-only application permissions. |

Task admission/idempotency, quote/requirement creation, AP2 reservation, settlement commit, artifact release, refund transitions, and state/event/outbox/audit writes each have documented single-transaction boundaries.

#### Spark payer database

The payer uses a restricted database role. Seeds and admin macaroons are forbidden.

| Table | Required data and constraints |
|---|---|
| `payer_key_registry` | Role, algorithm, public key/certificate hash, custody ref, status/validity/supersession; unique role/key; no private material. |
| `payer_client_identities` | Authority/installation, cert serial/SPKI, required SPIFFE SAN, CA, allowed operations, status/validity/revocation; unique cert/SPKI and active authority/SAN. |
| `payer_wallets` | Node public key/alias, `regtest` network, restricted LND credential ref, signing key, health/sync/height/lifecycle; unique node/network; no seed/admin macaroon. |
| `payer_policies` | Versioned wallet policy, owner/open-payment-authority hash, accepted mandate/constraint versions, canonical hash/status/effective dates; immutable versions and one active wallet version. |
| `payer_counters` | Wallet/policy/constraint/window, asset/unit, limits and reserved/committed amount/count, lock; unique policy/constraint/window and within-limit checks. |
| `payer_reservations` | Counter/request/mandate/invoice, amount/count, state and expiry/commit/release/settlement; unique counter/request; settled cannot release. |
| `payer_payment_requests` | Apple authority/installation, idempotency, canonical request/quote/Checkout Receipt/Payment Mandate/invoice hashes, wallet, exact payment tuple, state/expiry/lock/terminal metadata; unique authority/key and accepted invoice. |
| `payer_payment_attempts` | Request, attempt number, LND payment ID/hash, state/failure/times; unique request/attempt and non-null LND payment ID. |
| `payer_settlements` | Request/attempt, payment hash, protected proof/preimage ref or hash, exact amount, routing fee, final state/times; unique payment hash and successful request. |
| `payer_balance_snapshots` | Wallet/request/settlement, before/after phase, node/channel, balances, height, time/evidence hash; unique settlement/phase/channel. |
| `payer_receipts` | Request/settlement/mandate, issuer/key, canonical payload/hash, signed ref, verification/issue time; unique ID/hash and successful-settlement receipt. |
| `payer_refund_invoices` | Original request/settlement/payment, reason, protected BOLT11 ref/hash, refund hash, exact amount, state/times/lock; unique original/reason and refund hash. |
| `payer_refund_observations` | Refund/payment, LND event sequence, observed state/amount/evidence/time; unique event and refund/evidence. |
| `payer_reconciliation` | Request/payment, reason/state, attempts/schedule/lease/evidence/resolution; one active request/reason. |
| `payer_outbox` | Aggregate/version/type, payload hash/ref, state/attempt/schedule/lease/published; unique aggregate/version/type. |
| `payer_audit_events` | Ordered ID, actor and subject refs, action/outcome/reason, redacted detail, previous/event hash/time; append-only. |

#### Spark merchant database

The merchant uses a different restricted database role. Payer and merchant databases do not share mutable policy rows, unrestricted roles, wallet credentials, or signing keys.

| Table | Required data and constraints |
|---|---|
| `merchant_key_registry` | Role, algorithm, public key/certificate hash, custody ref, status/validity/supersession; unique role/key; no private material. |
| `merchant_client_identities` | Service, cert serial/SPKI, required SPIFFE SAN, CA, allowed operations, status/validity/revocation; unique cert/SPKI and active service/SAN. |
| `merchant_wallets` | Node public key/alias, `regtest` network, restricted LND credential ref, signing key, health/sync/height/lifecycle; unique node/network; no seed/admin macaroon. |
| `merchant_invoices` | Task/quote/product, wallet, protected BOLT11 ref/hash, payment hash, exact tuple, lifecycle/state/lock; unique invoice/payment hash and active task/quote. |
| `merchant_payment_observations` | Wallet/invoice/payment, node event sequence, state/amount/evidence/time; unique wallet/event and invoice/evidence. |
| `merchant_settlements` | Invoice/payment, exact amount, independently verified state, payer ref hash, settlement/reconcile times/evidence; unique payment hash and successful invoice. |
| `merchant_release_authorizations` | Task/artifact/invoice/settlement, canonical hash, signer/key, state/lifecycle/consumption; unique task/artifact and settlement; single use. |
| `merchant_balance_snapshots` | Wallet/invoice/settlement, before/after phase, node/channel balances, height/time/evidence; unique settlement/phase/channel. |
| `merchant_receipts` | Invoice/settlement/task, issuer/key, canonical payload/hash, signed ref, issue/verify times; unique ID/hash and settlement receipt. |
| `merchant_refund_requests` | Original invoice/settlement/payment, reason, Apple refund invoice/ref/hash, exact tuple, idempotency, state/expiry/lock/times; unique original/reason and refund hash. |
| `merchant_refund_attempts` | Refund, attempt number, LND payment ID/hash, state/failure/times; unique refund/attempt and non-null LND payment ID. |
| `merchant_refund_settlements` | Refund/attempt, refund payment hash, exact amount/routing fee/state/evidence/times; unique refund hash and successful refund. |
| `merchant_reconciliation` | Invoice/payment, reason/state, attempts/schedule/lease/evidence/resolution; one active invoice/reason. |
| `merchant_outbox` | Aggregate/version/type, payload hash/ref, state/attempt/schedule/lease/published; unique aggregate/version/type. |
| `merchant_audit_events` | Ordered ID, actor and subject refs, action/outcome/reason, redacted detail, previous/event hash/time; append-only. |

### 4.3 API Changes

All shared-schema references below resolve to `urn:golfergeek:schema:apple-divinr-integration:v0.2`. Boundary validation occurs before business logic. Authentication errors occur before JSON-RPC; invalid params use `-32602`; standard A2A errors retain their mapping; deterministic pre-task denials use `-32050` with `error.data=errorEnvelope`.

#### Public and OAuth endpoints

| Method/path | Authentication | Request | Success response |
|---|---|---|---|
| `GET /.well-known/agent-card.json` | Public HTTPS | None | Signed `agentCardResponse`, A2A 1.0 `supportedInterfaces`, implemented input/output modes, seven typed skills/examples/schema URIs, OAuth/DPoP metadata, and global optional extension with seven required skill IDs; streaming/push flags appear only when implemented. |
| `GET /.well-known/jwks.json` | Public HTTPS | None | `jwksResponse` with active/retiring role-specific public keys. |
| `GET /.well-known/oauth-authorization-server` | Public HTTPS | None | `oauthAuthorizationServerMetadata`. |
| `GET /.well-known/oauth-protected-resource` | Public HTTPS | None | `oauthProtectedResourceMetadata`. |
| `POST /oauth/device_authorization` | DPoP proof, public client | `deviceAuthorizationRequest`; `client_id`, requested scopes/resource, installation identity, proposed `dpop_jkt` | `deviceAuthorizationResponse`; opaque device code, user code, verification URI, 600-second expiry, 5-second interval. |
| `POST /oauth/token` | DPoP proof | `tokenRequest` for device grant or refresh | `tokenResponse`; 600-second ES256 `at+jwt`, opaque rotating refresh token, scope, `cnf.jkt`; RFC pending/slow/denied/expired errors. |
| `POST /oauth/revoke` | DPoP proof | `revocationRequest` | `emptyResponse`; idempotent token/family/grant revocation as authorized. |

Token claims are exactly `iss`, `sub`, `aud`, `client_id`, `installation_id`, `scope`, `cnf.jkt`, `iat`, `nbf`, `exp`, and `jti`. Protected requests require `Authorization: DPoP <token>` and `DPoP: <proof>`. Proofs validate ES256 signature/JWK, thumbprint, `typ`, `htm`, canonical `htu`, `ath`, `iat` within 60 seconds, unique `jti`, one-use nonce when challenged, issuer/audience/scope, and installation/grant/token state.

Each catalog record also freezes public/authenticated/paid classification, AP2 requirement, quote behavior, idempotency requirement, timeout/task lifetime, data classification/redaction, retry-safe and terminal errors, audit fields, and exact input/output schema hashes. A catalog record missing any field is not activatable.

#### A2A endpoint

`POST /a2a` accepts A2A 1.0 JSON-RPC with at most 256 KiB, requires `A2A-Version: 1.0`, and for all business `SendMessage` calls requires `A2A-Extensions: urn:golfergeek:a2a:x402-lightning-regtest:v0.2`.

- `SendMessage`: input uses the A2A message/task shape plus `a2aRequestMetadata` and exactly one skill request definition. Initial requests create a task or return the idempotent existing task. Continuations carry exactly one of `checkoutSubmittedMetadata`, `paymentSubmittedMetadata`, or `refundSubmittedMetadata` for the stored task.
- `GetTask`: accepts only a task ID and optional history length allowed by A2A; returns the bound A2A task, artifacts, payment/refund metadata, and receipt references.
- `ListTasks`: accepts bound filters/cursor and page size 1–50; returns only tasks in the caller's stored tuple.
- `CancelTask`: accepts a bound task ID; returns the authoritative task state. It cannot cancel already committed settlement/release effects.

Response size is at most 1 MiB. Rate limits are 60 requests/minute/installation, 30/source, and 1,200/global, with the strictest limit winning. Each installation has at most four concurrent tasks and two outstanding paid tasks.

#### Connected-agent browser APIs

These endpoints use Divinr's existing browser authentication and derive the user from that session:

| Method/path | Purpose |
|---|---|
| `GET /connected-agents/device/:userCode` | Resolve a normalized active user code into safe installation, scope, and spending-authority review data; never return device code/token material. |
| `POST /connected-agents/device/:userCode/approve` | Typed approval with expected installation/scopes/authority/version; atomically bind the authenticated user, grant, installation, and approval audit. |
| `POST /connected-agents/device/:userCode/deny` | Typed denial and audit; idempotent for an already denied request. |
| `GET /connected-agents` | List the user's installations/grants, thumbprints, scopes, status, last use, and aggregate safe evidence. |
| `GET /connected-agents/:installationId` | Inspect one owned installation's grants, safe audit timeline, and receipt references. |
| `POST /connected-agents/:installationId/revoke` | Revoke an owned installation and all active token families/JTIs. |
| `POST /connected-agents/:installationId/grants/:grantId/revoke` | Revoke one owned grant without affecting unrelated installations. |

Unknown, expired, consumed, or cross-user codes and IDs return the frozen error envelope without revealing existence.

#### Spark private APIs

- Payer full API: `https://spark-51e5.tail126196.ts.net:7443/v1`, reachable only from the Mac Studio Tailscale identity with mTLS. It supports schema-defined prepare, execute, status/receipt, balance evidence, reconciliation, and refund-invoice operations.
- Payer verifier API: `https://127.0.0.1:7443/v1`, reachable only by `spiffe://golfergeek.local/divinr/payer-verifier`; it exposes only JWKS/status/payment receipt reads.
- Merchant API: `https://127.0.0.1:7444/v1`, reachable only by the Divinr API mTLS identity; it supports exact invoice creation/status, settlement verification, release-authorization consumption, refund payment/status, receipt, and balance evidence operations.
- Requests and responses use the shared definitions `payerPrepareRequest`, `payerPrepareResponse`, `payerExecuteRequest`, `payerReconcileRequest`, `payerPaymentStatus`, `merchantInvoiceRequest`, `merchantInvoiceResponse`, `merchantInvoiceStatus`, `merchantSettlementStatus`, `releaseAuthorizationConsumeRequest/Response`, `refundInvoiceRequest/Response`, `refundPayRequest`, `refundStatusResponse`, `balanceResponse`, `settlementResponse`, and `signedReceiptResponse`.
- There is no bearer/API-key/source-address fallback and no raw LND endpoint exposure.

#### Trusted push

`POST https://agent.golfergeek.com/v1/trusted/divinr/events` uses `pushEvent`, RFC 9530 `Content-Digest`, and RFC 9421 `ecdsa-p256-sha256` signatures covering `@method`, `@target-uri`, `content-digest`, `content-type`, `x-divinr-event-id`, and `x-divinr-issued-at`. Events expire after five minutes and retry after 5, 30, 120, 600, 1800, 7200, 21600, and 86400 seconds, at most eight attempts. A push can only notify; it cannot approve or trigger spending, joins, trades, or paid work.

### 4.4 Frontend Changes

- Add public-but-session-aware `/connect/device` view. If unauthenticated, preserve the user code through login; after login, show the exact agent display name, installation ID, DPoP thumbprint, requested scopes, requested catalog/authority, expiry, and typed Approve/Deny controls.
- Add authenticated `/settings/connected-agents` list and `/settings/connected-agents/:installationId` detail views.
- The detail view shows status, key thumbprint, grants/scopes, approved spending authority, last use, safe audit entries, linked receipt/payment evidence, and explicit grant/installation revocation actions.
- Expanded scopes, changed installation keys, or increased spending authority always require reauthorization; no inline auto-approval.
- Model text, Markdown, HTML, email, or push content cannot invoke approval controls.
- User-facing copy uses “analysis” or “signal,” never prediction/advice/recommendation language. Reuse `LegalDisclaimer` if a financial-context disclaimer is present.
- Add `useFirstTouch`/`FirstTouchPanel` entries for device connection and connected-agent settings.
- Extend an appropriate settings/authoring deep browser skill or create a dedicated connected-agents six-file deep skill, register its Playwright project, and add green desktop/mobile tests.

### 4.5 Infrastructure Requirements

#### Spark production topology

- Divinr production remains on Spark at API port `7100`; no deployment step targets the Mac Studio.
- Add repository-owned `infra/lightning-regtest/` with pinned images/binaries, one Bitcoin Core regtest service, two LND services with distinct volumes/identities, deterministic miner, payer facade, merchant facade, health checks, backup/reset scripts, and non-secret configuration.
- Do not disrupt the existing OrchestratorAI-named Lightning instance until the replacement has synchronized nodes, an active funded channel, and passing acceptance tests. Migration/cutover must be reversible.
- Runtime secrets, leaf private keys, wallet state, macaroons, databases, and protected evidence live beneath `/var/lib/divinr-agent-commerce/` with separate service users and permissions; never in Git or iCloud.
- The payer and merchant receive least-privilege macaroons that allow only required operations. No seed or admin macaroon is in the API/model/general environment.

#### Network and certificate policy

- Payer full API binds Spark Tailscale address/hostname at port 7443; its verifier listener binds loopback only. Merchant binds loopback only at 7444.
- TLS 1.3 mutual authentication uses the project private CA. Required URI SANs are:
  - `spiffe://golfergeek.local/apple-assistant/macstudio`
  - `spiffe://golfergeek.local/divinr/payer-verifier`
  - `spiffe://golfergeek.local/spark/payer`
  - `spiffe://golfergeek.local/divinr/api`
  - `spiffe://golfergeek.local/spark/merchant`
- Payer server DNS SAN is `spark-51e5.tail126196.ts.net`; IP SANs are `100.120.203.62` and `127.0.0.1`. Merchant has IP SAN `127.0.0.1`.
- Tailscale/network policy permits only the approved Mac Studio identity to call payer-mutating operations. Certificate chain, validity, DNS/IP SAN, URI SAN, SPKI/serial revocation, and operation mapping are all checked.

#### Operations

- Health/readiness covers Divinr schema, contract hashes, key-provider availability, Bitcoin sync, both LND sync states, wallet unlock/readiness, active channel capacity, facade database readiness, and mTLS identity registry.
- Logs are structured and credential-redacted. Correlation IDs link A2A requests, tasks, mandates, payments, artifacts, receipts, and audit events.
- Scheduled workers handle outbox, push, reconciliation, refunds, expired reservations/codes/nonces, and retention. Work leasing is idempotent and restart-safe.
- Contract/schema version, upstream commit pins, key IDs, image digests, and migration version are observable in safe operator health output.

## 5. Non-Functional Requirements

### Security

- Fail closed on unknown protocol version, extension, schema field, issuer, `kid`, algorithm, critical AP2 constraint, unit, network, product, state, or error mapping.
- Every effective user comes only from a verified DPoP-bound access token. Service keys, headers, body/context fields, and task IDs cannot impersonate users.
- DPoP supports up to four one-use five-minute nonces per installation, 60-second proof age, and at least 600-second proof replay retention.
- Open AP2 authority is valid at most one hour and permits only exact catalog products, 1–5 USD minor units per purchase, 25 cumulative USD minor units, 10 successful calls, `250000` reserved-plus-committed msat, and `50000` msat per transaction. Exact product binding enforces lower amounts.
- Evidence is minimum-disclosure; private keys, full access/refresh tokens, macaroons, preimages/reusable payment credentials, and unnecessary personal data never enter logs, analytics, errors, audits, task payloads, or model context.
- Append-only audit events are hash-linked and retained according to the frozen 90-day evidence/idempotency period unless a stricter operational policy applies.

### Reliability and recovery

- Quote and invoice lifetimes are 120 seconds; maximum task runtime is 900 seconds.
- Unknown payment outcomes remain pending/reconciliation states; timeout never means unpaid and never authorizes retry payment.
- Outbox delivery, settlement verification, release, refund, and reconciliation resume after process restart without duplicating side effects.
- Serialization/deadlock failures retry a bounded number of times with jitter; business responses never expose database internals.
- Disposable regtest reset is explicit and cannot point at mainnet, testnet, or signet. Demo configuration rejects any non-regtest network at startup and in database checks.

### Performance and limits

- Public/metadata endpoints should respond within 500 ms p95 without external payment calls.
- Authenticated task reads should respond within 750 ms p95 under normal Spark load.
- Admission/quote responses should respond within 2 seconds p95 excluding client retry and Lightning settlement.
- Request/response, rate, concurrency, outstanding-task, and list-page limits are those in section 4.3 and are enforced before expensive work.

### Compatibility and maintainability

- Wire behavior is isolated behind versioned adapters. A2A/AP2/x402 upgrades or incompatibilities require a coordinated v0.3 contract; local aliases never change v0.2 wire IDs.
- Divinr accepts Apple v0.2's shared canonical-intent fields, SwiftData ownership, serial reservation transaction, Keychain reference-swap recovery, stable non-exportable P-256 DPoP key, separate owner/delegated AP2 keys, and reauthorization on installation-key rotation. These are compatibility facts, not server-side implementation choices.
- AP2 accepts only SD-JWT/ES256 VCTs `mandate.checkout.open.1`, `mandate.checkout.1`, `mandate.payment.open.1`, and `mandate.payment.1`, with checkout audience `https://divinr.ai/a2a`, payer audience `https://spark-51e5.tail126196.ts.net:7443`, and quote-bound single-use nonces.
- Divinr emits compact ES256 JWS checkout/service/refund receipts and verifies the payer's compact ES256 Payment Receipt. Every `kid` resolves through an approved issuer/key-role registry.
- NestJS constructor parameters use explicit `@Inject(...)`.
- Shared transport types remain provider-neutral; both supported database providers implement and test transaction semantics.
- Existing browser auth, Stripe billing, and legacy code/database identifiers continue to work. User-visible new copy follows repository vocabulary.

## 6. Out of Scope

- Bitcoin mainnet, signet, testnet, economically valuable settlement, real wallet custody, or autonomous trading of real assets.
- Unrestricted third-party agent/client registration.
- Club membership and any skill not in the seven-item v0.2 Agent Card.
- Divinr enforcement of a cross-merchant global budget it did not receive and cannot verify.
- Replacing Divinr browser authentication, Stripe subscriptions, or existing separately approved service-key integrations.
- Charging for discovery, auth, polling, errors, receipts, refunds, reconciliation, balance inspection, or unsolicited push.
- Streaming in the first vertical slice; initial task delivery is polling.
- Exposing raw LND REST/gRPC, seeds, admin macaroons, private keys, or general shell/database access to an agent or model.
- Claiming released A2A x402 v0.1 or official Lightning x402 scheme compliance.
- Refunds for owner cancellation after valid release or dissatisfaction with a valid result.

## 7. Dependencies & Risks

| Dependency/risk | Impact | Mitigation |
|---|---|---|
| Shared v0.2 artifacts drift between iCloud, Apple, and Divinr | Wire incompatibility or signature/hash failure | Vendor exact files, validate manifest hashes in CI, record provenance, reject local mutation, coordinate any change as v0.3. |
| Pinned A2A/AP2/x402 artifacts are evolving and not mutually wire-compatible | False standards claim or broken serialization | Isolate adapters, pin commits, vendor schemas, use only the project extension, run fixture/conformance tests. |
| Existing A2A guard falls through and accepts caller user context | Cross-user data exposure | Replace protected route guard/dispatcher before exposure; add negative regression tests proving service keys/context cannot enter v0.2. |
| Current database abstraction lacks transaction-scoped connections | Double spend/release under concurrency | Add `withTransaction`, serializable retry helper, provider parity tests, and transaction-bound repositories before state machines. |
| AP2 SD-JWT/selective-disclosure or canonicalization implemented incorrectly | Invalid authority accepted/rejected | Use vetted standards libraries where available, strict algorithms/issuers/VCTs, pinned positive/negative fixtures, byte-level RFC 8785 tests. |
| Spark currently has one unsynchronized LND node and zero channels | No usable payment demo | Diagnose existing miner/sync configuration; build isolated two-node replacement; do not cut over until health and payment tests pass. |
| Two services on one Spark host are mistaken for one trust principal | Credential/policy compromise crosses roles | Separate Unix users, databases/roles, volumes, keys, macaroons, listeners, SPIFFE identities, and audit trails; test denied cross-role operations. |
| Tailscale address/certificate SAN changes | Payer connection outage or unsafe fallback pressure | Signed deployment profile and explicit certificate rotation; fail closed; update ACL and SAN together; no bearer fallback. |
| Lightning returns an unknown outcome | Duplicate payment on retry | Persist request/payment hashes before execution, reconcile through both nodes, never retry payment based only on timeout. |
| Execution fails after settlement | User paid without result | Durable artifact state, automatic exact-principal refund case, restart-safe reconciliation, evidence-linked terminal state. |
| Model or rendered content attempts to approve work | Privilege escalation | Typed native controls and deterministic endpoints only; no model/Markdown actions; browser and injection tests. |
| Key custody is unavailable or misconfigured | Signing/release cannot safely continue | Fail readiness, use role-specific external custody references, documented rotation/recovery, retain old public keys, never generate silent fallback keys in production. |
| Scope is large and security-sensitive | Partial system appears production-ready | Deliver phase gates in dependency order; do not expose protected A2A or paid release until readiness checklist and cross-system acceptance pass. |

Required implementation dependencies include PostgreSQL transaction support, strict JSON Schema validation, RFC 8785 canonicalization, ES256/JWT/JWK/DPoP primitives, SD-JWT/AP2 verification, RFC 9421/9530 signing, Bitcoin Core regtest, two LND nodes, Tailscale, TLS 1.3 mTLS, and the Apple project's frozen client behavior.

## 8. Phasing

### Phase 1 — Frozen contract and atomic foundation

Vendor and hash-verify all shared v0.2 artifacts plus pinned AP2 schemas; add schema compilation, canonicalization, catalog bindings, fixture tests, provenance, `DatabaseService.withTransaction`, serializable retry behavior, and provider parity tests. No public behavior changes.

**Gate:** manifest and every positive/negative fixture pass; catalog matches all seven products exactly; transaction rollback/isolation tests pass on both providers; lint/typecheck/build pass.

### Phase 2 — Versioned Divinr persistence

Add migrations, RLS/roles/checks/indexes, transaction repositories, immutable seeds, bootstrap tasks, and readiness checks for all Divinr connected-agent, A2A, AP2, payment, result, receipt, push, audit, refund, and reconciliation tables.

**Gate:** empty-database bootstrap and upgrade migration pass; readiness fails for every missing critical relation/seed; uniqueness/concurrency/RLS tests pass; no request-time DDL.

### Phase 3 — A2A 1.0 discovery and task protocol

Replace the prototype Agent Card/`invoke` contract with signed `/.well-known/agent-card.json`, JWKS, version/extension negotiation, strict JSON-RPC method dispatch, task binding, frozen errors, and conformance tests. Do not expose business skills until DPoP is complete.

**Gate:** pinned Agent Card/A2A fixtures pass; legacy user-context path cannot reach v0.2; unsupported methods/versions/extensions fail correctly; task ownership and pagination tests pass.

### Phase 4 — Device authorization and connected-agent UI

Implement OAuth metadata, device initiation/poll/approve/deny, installations/grants, browser APIs, `/connect/device`, connected-agent settings/detail, revocation, first-touch, deep skill, and Playwright coverage.

**Gate:** cross-user, replay, expiry, excessive-scope, login-return, approve/deny/revoke, desktop/mobile, accessibility, and first-touch tests pass.

### Phase 5 — DPoP credentials and recovery

Implement key registries/providers, access-token issuance, nonce challenges, protected-resource proofs, token JTI tracking, refresh rotation/reuse detection, revocation, and 90-day public verification-key overlap.

**Gate:** wrong key/method/URL/`ath`/audience/nonce/scope, replay, expiry, revoked grant, refresh reuse, and key-rotation cases all fail or recover exactly as frozen.

### Phase 6 — Deterministic admission and paid update skills

Build `VerifiedAgentPrincipal`, strict skill/schema/product admission, ownership/output filtering, common paid task path, idempotency, transactional events/outbox/audit, and general/personal update adapters.

**Gate:** both update skills reach `payment-required` at exact prices; cross-user and product mismatch fail; concurrent idempotent requests create one task/quote; no paid output is released.

### Phase 7 — Spark two-node regtest and restricted facades

Create `infra/lightning-regtest`, payer/merchant migrations and services, mTLS identities/operation maps, sync/mining/channel automation, health, backups/resets, least-privilege LND credentials, and balance evidence. Preserve the old instance until acceptance.

**Gate:** both nodes synchronized and funded with active channel; exact invoice payment succeeds; invalid/expired/underpaid/duplicate/already-settled cases are deterministic; cross-role and non-regtest access fail.

### Phase 8 — AP2 and A2A-carried payment exchange

Implement SD-JWT/AP2 verification, minimum disclosure, critical constraint registry, counters/reservations, checkout quote/receipt, payment requirement/submission, payer/merchant verification adapters, settlement commit, and unknown-outcome reconciliation.

**Gate:** all frozen mandate/payment fixtures pass; altered/replayed/expired/wrong-key/unknown constraint fails; concurrent cumulative limits cannot overspend; settlement commits once.

### Phase 9 — Paid analysis, release, receipts, and refunds

Connect analysis generation to the durable saga, create content-addressed artifacts, consume merchant release authorization, return signed receipts/evidence, and implement post-settlement recovery/refund.

**Gate:** valid payment releases exactly one artifact; pre-settlement reads cannot retrieve it; restart/timeout cannot double-charge/release; all four refundable failures complete or remain safely pending with evidence.

### Phase 10 — Tournament skills, remaining catalog, and trusted push

Add tournaments list/context, separately approved join/trade, five-action limit, verified-analysis binding, push subscription/delivery/signing/acknowledgment, and remaining catalog end-to-end cases.

**Gate:** all seven skills match frozen schemas/prices; action/payment approvals remain separate; tournament rule/status mapping passes; push cannot authorize work and retries without duplicate side effects.

### Phase 11 — Production hardening and cross-system acceptance

Run migration, conformance, adversarial, concurrency, fuzz/size/rate, browser, restart/recovery, mTLS, key-rotation, audit-redaction, and Apple↔Divinr↔Spark acceptance. Document threat model, operations, recovery, and demo evidence.

**Gate:** every success criterion passes on Spark production topology; no critical/high security finding remains; protected A2A exposure and paid release stay disabled until the operator readiness checklist is explicitly satisfied.
