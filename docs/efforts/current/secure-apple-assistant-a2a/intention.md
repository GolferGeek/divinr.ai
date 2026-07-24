# Divinr Intention: Secure Apple Assistant A2A Integration

## Purpose

Build the Divinr side of a secure, standards-grounded integration with Apple Assistant and the Spark-hosted Bitcoin Lightning regtest environment.

The integration is a client-facing demonstration of A2A, AP2, x402, and inspectable regtest Lightning settlement. It is not intended to make the personal assistant profitable or to enable real-value autonomous trading.

Divinr production, including its API and commerce/payment integration, runs on Spark. The Mac Studio is the separate Apple Assistant and owner-workstation host; it is not the Divinr production deployment target.

The first complete demonstration should let Apple Assistant:

1. discover Divinr through A2A;
2. connect a Divinr user through OAuth Device Authorization;
3. call a paid user-specific skill at its frozen one- to five-cent catalog price with a DPoP-bound token;
4. request a paid analysis under explicit AP2 constraints;
5. settle the payment with valueless Bitcoin regtest funds over Lightning through the selected A2A-carried x402 flow;
6. receive a result plus verifiable payment and service receipts; and
7. show linked before/after channel balances and settlement evidence from both restricted payment facades.

This is a temporary cross-project coordination intention. After the three coordination intentions agree, this scope should move into Divinr's normal effort workflow for PRD, plan, implementation, and verification.

## Governing Principle

Models may propose work and interpret results. Deterministic components authorize identities, enforce scopes and mandates, reserve budgets, sign protocol objects, move value, execute privileged operations, release paid results, and write audit evidence.

Divinr must not merely advertise that it honors an agent's constraints. Divinr must deterministically verify, enforce, test, and audit them.

## Current Divinr State

Divinr already has:

- a NestJS A2A module;
- a preliminary discovery document at `/.well-known/agent.json`;
- a preliminary JSON-RPC-style `POST /a2a` invocation endpoint;
- hashed `div_sk_...` machine API keys;
- Supabase user access and refresh tokens;
- JWT middleware and RBAC;
- market, portfolio, club, tournament, and analysis services;
- Stripe billing infrastructure; and
- a live deployment on Spark at API port `7100`.

The existing A2A surface is a prototype, not the security or conformance baseline for this effort. It must not be exposed as the finished personal-agent integration because:

- its discovery path and document shape do not match the current A2A Agent Card contract;
- its custom `invoke` method and capability payload are not the intended current A2A task contract;
- its service-key guard may fall through when a service key is absent;
- stored service-key scopes are not enforced during dispatch;
- the caller can supply a user identifier in request context; and
- its Agent Card contains obsolete user-facing vocabulary.

User identity for the new A2A surface must come only from a verified, sender-constrained credential. Request bodies, A2A context, headers such as `X-User-Id`, and model output must never choose the effective user.

Existing service API keys may remain for separately approved backend integrations, but they are not a substitute for user-delegated OAuth grants and must not authorize personal A2A access.

## Standards Baseline

The implementation should pin and isolate these protocol versions:

- A2A released specification `1.0.0` for discovery, interfaces, skills, tasks, artifacts, authentication declarations, and extensions;
- OAuth Device Authorization Grant, RFC 8628;
- OAuth DPoP, RFC 9449;
- OAuth Authorization Server Metadata, RFC 8414;
- OAuth Protected Resource Metadata, RFC 9728;
- AP2 `v0.2` for authorization mandates, checkout binding, and receipts;
- x402 core `v2` for the payment protocol model; and
- project profile `urn:golfergeek:profile:apple-divinr-commerce:v0.2` for the A2A payment transport and Lightning regtest scheme.

The v0.2 profile pins A2A `1.0.0` at `173695755607e884aa9acf8ce4feed90e32727a1`, AP2 `v0.2.0` at `b4587ac1d055888a73b4b21750973cffba961793`, and x402 core-v2 object semantics at `21a2e489c7ba17c2b04e4cd9ea7015da1cb4aa99`. Because the published x402 A2A transport at that revision is not wire-compatible with A2A 1.0, paid calls use project extension `urn:golfergeek:a2a:x402-lightning-regtest:v0.2`. Divinr must not claim released A2A x402 v0.1 or standardized Lightning-scheme conformance. Contract v0.1 is superseded history; implementation targets v0.2.

For A2A `1.0`, Divinr requires `A2A-Version: 1.0`, negotiates extensions with `A2A-Extensions`, and publishes the v1 `supportedInterfaces` Agent Card shape.

Divinr vendors `integration-profile.v0.2.json`, `profile-schema.v0.2.json`, `schemas.v0.2.json`, `fixtures.v0.2.json`, `fixtures-schema.v0.2.json`, and `manifest.v0.2.json` under `contracts/apple-divinr/v0.2/` byte-for-byte and vendors the six AP2 base schemas unchanged from the pinned AP2 commit. TypeScript validation, database constraints, RFC 8785 hashing, and positive/negative tests must use those artifacts. Local aliases cannot change wire identifiers.

## Divinr System Roles

Divinr acts as:

- an A2A server/remote agent;
- an OAuth authorization server for connected personal-agent installations;
- an OAuth protected resource;
- an AP2 merchant/service provider;
- an x402 resource server using the selected A2A payment transport;
- a verifier of payment settlement evidence; and
- a producer of service results, receipts, and audit evidence.

Spark is the deployment host. Spark is not a single trust principal. At minimum, it hosts separate logical payment services and Lightning identities for:

- the personal-agent payer; and
- the Divinr merchant/payee.

Those services require separate wallets, credentials, policies, storage, and audit trails.

## Scope

### 1. Standards-Compliant A2A Discovery

Divinr publishes its public Agent Card at:

```text
GET /.well-known/agent-card.json
```

The card must declare:

- Divinr's identity and description;
- the current A2A protocol version;
- supported interfaces and the canonical `POST /a2a` URL;
- supported input and output modes;
- streaming or push support only when actually implemented;
- OAuth and DPoP-related security metadata;
- required scopes;
- the project payment extension globally with `required:false` and frozen params naming profile v0.2, all seven skill IDs in `requiredForSkills`, and every skill's exact input/output schema URI; the dispatcher requires its header for every business `SendMessage`;
- typed skills with examples and schemas or schema references; and
- no credentials, private URLs, internal topology, or sensitive configuration.

The card is RFC 8785-canonicalized and signed with a distinct Divinr Agent Card ES256 key published at `https://divinr.ai/.well-known/jwks.json`. Apple Assistant must still authenticate the HTTPS origin and pin/approve the Divinr identity through its deterministic destination registry.

### 2. Initial A2A Skill Set

The frozen minimum set is:

| Skill | Exact OAuth scopes | Product and price | Initial purpose |
|---|---|---|---|
| `general_updates` | `updates:read commerce:purchase receipts:read` | `divinr.general-updates.demo.v2`; 1¢ / `10000` msat | General filtered updates for a connected user |
| `personal_updates` | `updates:read commerce:purchase receipts:read` | `divinr.personal-updates.demo.v2`; 2¢ / `20000` msat | User-specific Divinr updates |
| `tournaments_list` | `tournaments:read commerce:purchase receipts:read` | `divinr.tournaments-list.demo.v2`; 1¢ / `10000` msat | Tournaments visible to the connected user |
| `tournament_context` | `tournaments:read commerce:purchase receipts:read` | `divinr.tournament-context.demo.v2`; 2¢ / `20000` msat | Context for one visible tournament |
| `analysis_request` | `analysis:purchase commerce:purchase receipts:read` | `divinr.analysis.demo.v2`; 5¢ / `50000` msat | Purchase one defined analysis artifact |
| `tournament_join` | `tournaments:join commerce:purchase receipts:read` | `divinr.tournament-join.demo.v2`; 3¢ / `30000` msat | Join an eligible simulated tournament after separate typed approval |
| `tournament_trade` | `tournaments:trade commerce:purchase receipts:read` | `divinr.tournament-trade.demo.v2`; 4¢ / `40000` msat | Queue an approved simulated trade linked to a verified analysis |

Club membership and additional capabilities are outside v0.2 and require a new Agent Card/profile version after the first vertical slice passes acceptance.

Result retrieval uses A2A `GetTask` and artifact semantics; v0.2 has no `result_get` business skill. Capability discovery exists only in the public Agent Card. Discovery, OAuth, JWKS, task poll/list/cancel, errors, receipt retrieval, refunds, reconciliation, and balance inspection are uncharged. Receipt verification is deterministic library code inside Apple Security Broker, Divinr ingress/release, and the applicable Spark facade; it is not a model-directed skill or separate public endpoint.

Every skill must define:

- input and output JSON schemas;
- public, authenticated, or paid classification;
- required OAuth scopes;
- whether AP2 is required;
- pricing and quote behavior;
- idempotency requirements;
- timeout and task-lifetime behavior;
- data classification and redaction rules;
- retry-safe and terminal errors; and
- audit fields.

User-visible language uses "analysis" or "signal," never prediction or advice terminology. Existing code and database identifiers may retain legacy names where permitted by repository conventions.

The schema definitions are respectively `updatesRequest`/`updatesResult`, `tournamentsListRequest`/`tournamentsListResult`, `tournamentContextRequest`/`tournamentContextResult`, `analysisRequest`/`analysisResult`, `tournamentJoinRequest`/`tournamentJoinResult`, and `tournamentTradeRequest`/`tournamentTradeResult`. Every business skill has exactly one frozen paid product; Divinr rejects unknown fields or any skill/product/price/msat mismatch before task creation.

### 3. OAuth Device Authorization

Apple Assistant is a public OAuth client representing one personal-agent installation.

Divinr provides standards-shaped authorization metadata and logical endpoints for:

```text
GET  /.well-known/oauth-authorization-server
GET  /.well-known/oauth-protected-resource
POST /oauth/device_authorization
POST /oauth/token
POST /oauth/revoke
```

The exact origin is `https://divinr.ai`; client ID is `apple-assistant-native-v1`; resource audience is `https://divinr.ai/a2a`; owner verification is `/connect/device`; public keys are `/.well-known/jwks.json`. Apple is a public native client and has no client secret.

The device flow must:

- begin only from an explicit Apple Assistant connection request;
- return a short-lived device code, user code, verification URI, expiry, and polling interval;
- rate-limit initiation, user-code entry, and token polling;
- require the owner to authenticate through Divinr's existing user authentication;
- show the agent name, installation identity, requested scopes, and spending authority before approval;
- deny unknown or excessive scopes;
- prevent one user from approving a grant for another user;
- expire and single-use device and user codes;
- support denial, revocation, and reauthorization; and
- create a durable connected-agent grant and audit record.

Divinr should reuse the existing user account as the approving resource owner, but it should issue purpose-built agent credentials. Existing browser refresh tokens and long-lived `div_sk_...` service keys must not be copied to the agent.

### 4. DPoP Sender-Constrained Credentials

The frozen interoperability profile uses a per-installation P-256 key and `ES256` DPoP proofs because that key type can be backed by Apple Keychain/Secure Enclave.

During device authorization, Divinr binds the approved agent installation to the public-key thumbprint. Issued access tokens must include an audience for the Divinr A2A resource, approved scopes, the user subject, the agent/client identity, expiration, unique token identifier, and:

```json
{
  "cnf": {
    "jkt": "<approved-public-jwk-thumbprint>"
  }
}
```

Divinr requires:

```text
Authorization: DPoP <access-token>
DPoP: <proof-jwt>
```

The deterministic verifier must validate at least:

- allowed asymmetric algorithm and proof type;
- proof signature and public JWK;
- JWK thumbprint against the token's `cnf.jkt`;
- issuer, subject, audience, scope, issued-at, not-before, and expiry;
- HTTP method (`htm`) and canonical target URI (`htu`);
- access-token hash (`ath`) on protected-resource requests;
- proof issuance time within a narrow accepted window;
- unique proof identifier (`jti`) against a replay store;
- Divinr nonce when required;
- connected-agent and user revocation state; and
- exact skill authorization.

Access tokens should be short-lived. Refresh tokens should be opaque, stored only as hashes by Divinr, rotated on use, reuse-detected, revocable, and sender-constrained to the same DPoP key. Token signing keys require rotation and published verification metadata without exposing private material.

Access-token lifetime is at most 10 minutes and refresh families live at most 30 days. Token claims are exactly `iss`, `sub`, `aud`, `client_id`, `installation_id`, `scope`, `cnf.jkt`, `iat`, `nbf`, `exp`, and `jti`, with `typ=at+jwt`. DPoP is required on device authorization, token, refresh, revocation, and protected A2A calls. The public Agent Card is authenticated by HTTPS plus its dedicated JWS, not DPoP. Divinr issues up to four concurrent one-use nonces per installation, each valid five minutes; an absent/stale nonce receives one challenge. Proof time tolerance is 60 seconds and every proof JTI is replay-checked.

DPoP client keys, OAuth issuer keys, Apple owner-mandate keys, Apple delegated-agent mandate keys, AP2 merchant checkout/receipt keys, push-signing keys, and Lightning wallet keys are distinct cryptographic roles and must not reuse key material.

The LLM, A2A task payload, logs, analytics, error messages, and audit records must never contain private keys, complete access tokens, refresh tokens, macaroons, or reusable payment credentials.

### 5. Deterministic Divinr A2A Ingress

Before dispatching a skill, Divinr deterministically performs:

- protocol/version and extension negotiation;
- request-size and schema validation;
- authentication and DPoP verification where required;
- effective-user derivation exclusively from the verified credential;
- connected-agent revocation checks;
- OAuth scope and skill authorization;
- user entitlement and resource-ownership checks;
- task and idempotency checks;
- rate and call-count enforcement;
- AP2 and payment checks where required;
- data minimization and output filtering; and
- audit creation.

No model participates in these decisions. Internal services receive a verified principal and validated command, not raw caller claims.

Public discovery and authenticated business operations have distinct, explicit policy. The public Agent Card must never cause authentication guards to fall through for a business skill.

The v0.2 A2A ingress accepts at most 256 KiB per request and returns at most 1 MiB. It limits each installation to 60 requests per minute, each source to 30 per minute, and the service globally to 1,200 per minute; the strictest applicable limit wins. An installation may have at most four concurrent tasks and two outstanding paid tasks. `ListTasks` page size is at most 50. `GetTask`, `ListTasks`, `CancelTask`, and every continuation enforce the stored tuple `(effectiveUserId, installationId, grantId, originalSkillScope)`; possession of a task ID never grants access.

### 6. Pricing, AP2, A2A-Carried x402, and Paid Result Release

The v0.2 catalog contains seven paid products. AP2 prices are integer USD minor units from 1–5: general updates and tournament listing cost 1¢, personal updates and tournament context 2¢, tournament join 3¢, simulated tournament trade 4¢, and analysis 5¢. Their independent economically valueless `BTC-REGTEST` settlement vectors are respectively `10000`, `20000`, `30000`, `40000`, or `50000` msat. These paired fields are fixed interoperability data, not an exchange-rate claim. The signed quote lasts at most 120 seconds. The shared schemas freeze result, receipt, retry, refund, and failure behavior; neither side may substitute a skill, product, price, amount, asset, unit, or network in v0.2.

Only successful `SendMessage` business requests enter the payment saga. A charge commits exactly once when settlement is independently verified, before service release. Failed or canceled work before settlement is uncharged; idempotent replay is never charged again. A service failure after verified settlement enters the exact-amount refund saga. Tournament join and trade additionally require a separate fresh action approval; payment approval never authorizes the tournament state change. Divinr permits at most five successful state-changing tournament actions in the one-hour authority window.

Tournament wire status maps deterministically: repository `upcoming` is wire `open`, `active` remains `active`, and `completed` remains `completed`; archived tournaments are excluded. `tournament_join` accepts only `tournamentId`. `tournament_trade` requires a UUID `instrumentId` and uppercase `symbol` that resolve to the same tournament-entitled instrument, `long` or `short`, integer quantity 1–100, and a verified analysis artifact ID/hash. Divinr rejects stale approvals, unavailable tournaments, disallowed symbols, short trades when shorting is disabled, and quantities outside the returned `tournamentRules`.

The intended paid flow is:

1. Apple Assistant submits an authenticated A2A task request with a stable request ID and idempotency key.
2. Divinr authenticates the caller and validates the requested product before doing paid work.
3. Divinr creates a signed, expiring checkout/price quote bound to the user, agent, product, request, amount, currency/network, and idempotency key.
4. Divinr returns the selected A2A-carried x402 `payment-required` state without releasing the paid result.
5. Apple deterministic egress verifies local policy and creates the exact closed Checkout and Payment Mandates.
6. Apple sends `checkoutSubmittedMetadata` to the existing task with the closed Checkout Mandate and minimum disclosed open authority.
7. Divinr verifies the checkout mandate, identity, merchant/product binding, amount, expiry, idempotency, and all critical merchant constraints, then atomically reserves the accepted checkout.
8. Divinr returns `checkoutApprovedMetadata` with a signed Checkout Receipt while the A2A task remains `TASK_STATE_INPUT_REQUIRED`.
9. Apple verifies the Checkout Receipt and binds its hash into the payer preparation request.
10. The personal-agent payment authority on Spark independently verifies the Payment Mandate, Checkout Receipt binding, wallet authority, balance, and wallet-wide constraints, then settles or denies the Lightning regtest payment.
11. Apple sends `paymentSubmittedMetadata` with the same Checkout Mandate and Receipt, the closed Payment Mandate, and signed settlement evidence.
12. Divinr verifies checkout continuity, settlement evidence, cumulative constraints, and idempotency before execution or release.
13. Divinr executes the authorized work or retrieves an idempotently completed result.
14. Divinr returns `payment-completed`, the result artifact, and signed checkout, payment, and service receipt references.

The first paid demonstration uses AP2 `v0.2` autonomous mode. Apple presents a closed Checkout Mandate signed by its delegated-agent mandate key together with the minimum disclosed open authority needed to prove the owner allowed the exact Divinr merchant, product, amount, regtest method/network, validity window, and use/count semantics. Divinr verifies that chain and returns the corresponding Checkout Receipt. The personal-agent payment authority separately verifies the closed Payment Mandate and returns the Payment Receipt.

Divinr enforces only constraints it actually receives and understands through the agreed project AP2 extension claims. Every v0.2 constraint is critical. An unknown namespace, version, constraint type, operator, unit, or critical constraint fails closed; v0.2 has no optional-constraint behavior.

Divinr must enforce:

- exact approved product and action;
- per-call maximum;
- Divinr-specific period amount and call-count limits when present;
- mandate validity window;
- merchant, user, agent, task, and checkout binding;
- single-use or explicitly defined multi-use mandate semantics;
- idempotency under retries and concurrent requests;
- replay prevention for mandate and settlement evidence;
- no overcharge or silent product substitution;
- no paid result release before successful verification; and
- deterministic release, retry, refund, or reconciliation after partial failure.

Enforcement of cumulative limits must use transactional storage or equivalent atomic reservation. A read-then-write tally is insufficient under concurrency.

AP2 evidence and payment evidence are related but not interchangeable. OAuth/DPoP identifies and constrains the caller, AP2 represents user purchasing authority, and A2A-carried x402 plus Lightning provides the payment exchange and settlement evidence.

### 7. Spark Lightning Regtest Topology

Divinr owns the plan to separate the currently OrchestratorAI-named Lightning services into a standalone Spark-hosted test environment without disrupting the existing instance until replacement verification passes.

The target topology is:

```text
Bitcoin Core regtest
  |- personal-agent LND node and restricted payment service
  `- Divinr LND node and restricted merchant service
       `- funded regtest channel(s) between nodes
```

Requirements:

- separate LND data volumes and node identities;
- exactly one Bitcoin Core regtest backend on Spark shared only as chain infrastructure by the two LND nodes;
- deterministic mining suitable for synchronization and channel tests;
- health checks for Bitcoin sync, LND sync, wallet state, channel state, and payment readiness;
- no LND administrator macaroon copied into Apple Assistant, Hermes, Divinr model context, or general application environment;
- least-privilege macaroons or a narrow payment facade;
- private/Tailscale or loopback bindings instead of unrestricted LAN exposure;
- explicit backup/reset behavior for disposable regtest state;
- stable service names and no dependency on the OrchestratorAI application lifecycle; and
- visible labeling that all balances and settlement are regtest and economically valueless.

The personal-agent payer full API listens at `https://spark-51e5.tail126196.ts.net:7443/v1` and exposes a loopback-only read verifier at `https://127.0.0.1:7443/v1`; the merchant facade listens only at `https://127.0.0.1:7444/v1`. All require TLS 1.3 mTLS under the project private CA. Exact SPIFFE SANs are `spiffe://golfergeek.local/apple-assistant/macstudio`, `spiffe://golfergeek.local/divinr/payer-verifier`, `spiffe://golfergeek.local/spark/payer`, `spiffe://golfergeek.local/divinr/api`, and `spiffe://golfergeek.local/spark/merchant`. The payer server certificate additionally has DNS SAN `spark-51e5.tail126196.ts.net` and IP SANs `100.120.203.62` and `127.0.0.1`; the merchant server certificate has IP SAN `127.0.0.1`. The Divinr payer-verifier identity may only read payer JWKS, status, and receipt. There is no bearer/API-key or source-address fallback.

The current Spark instance has one LND node, zero channels, and reports not synchronized to its continuously mined regtest chain. Those conditions must be diagnosed and corrected before the two-node payment acceptance test.

### 8. Receipts, Idempotency, and Audit

Every privileged, state-changing, paid, or pushed interaction has a request ID. Every state-changing or paid interaction also has an idempotency key.

Required behavior:

- same idempotency key plus same canonical request returns the existing task/result/receipt state;
- same key plus different canonical request returns `IDEMPOTENCY_CONFLICT`;
- a timeout does not imply failure or authorize a second charge;
- payment settlement and result release are recoverable state-machine transitions;
- receipts link the request, task, checkout, mandate, settlement, amount, product, result, timestamps, and signer; and
- audit records are append-oriented and redact credentials and unnecessary personal data.

Divinr's audit trail must cover discovery/auth changes where relevant, device grant approval/denial, token refresh reuse detection, A2A admission/denial, policy decisions, quote creation, payment state, mandate verification, execution, result release, push delivery, retries, and reconciliation.

### 9. Frozen Divinr Database Contract

Divinr must implement these exact table names through normal versioned PostgreSQL/Supabase migrations. Column names may follow existing snake-case conventions, but every listed field, uniqueness rule, transaction boundary, isolation rule, and ownership rule is required.

Database conventions:

- Primary keys are UUIDs; externally visible protocol IDs are separate unique text columns.
- Every user-owned row has `user_id NOT NULL` and is protected by service authorization plus RLS where applicable.
- Timestamps use `timestamptz` in UTC.
- Generic atomic payment amounts use `numeric(78,0)` or an equivalently checked integer representation; JavaScript floating point is forbidden.
- Canonical payloads use `jsonb` plus a SHA-256 hash column. Hash comparisons use canonical bytes, not PostgreSQL's JSON display serialization.
- Mutable state-machine rows have an integer `lock_version` for optimistic conflict detection.
- Status columns use database checks/enums; unknown states are rejected.
- Evidence and audit rows do not cascade-delete with users, tasks, or products. Privacy deletion uses explicit redaction/tombstone procedures.
- Private signing keys, access-token plaintext, refresh-token plaintext, wallet seeds, and macaroons are not stored in these tables.

#### Connected Agent and OAuth Tables

| Table | Required columns | Required constraints/indexes |
|---|---|---|
| `oauth_clients` | `id`, public `client_id`, client type, display/software identifiers, allowed grants/auth methods, allowed scopes/audiences, status, created/updated/revoked timestamps | unique `client_id`; status; public Device Authorization client has no client secret |
| `agent_installations` | `id`, external installation ID, `user_id`, OAuth client ID, display name, `dpop_jkt`, DPoP algorithm, status, approved scopes, created/last-used/revoked timestamps and reason | unique external installation ID; unique active `user_id,dpop_jkt`; OAuth client + status index |
| `oauth_device_authorizations` | `id`, OAuth client ID, installation request ID, proposed `dpop_jkt`, device-code hash, normalized user-code keyed hash, requested scopes/audiences, verification URI, poll interval, status, expires/approved/denied/consumed timestamps, approving user | unique device-code hash and user-code hash; client + installation request; status + expiry; single consumption |
| `agent_grants` | `id`, `user_id`, installation ID, granted scopes, status, valid from/until, owner/open-authority references, approved/revoked metadata | unique active user + installation grant; installation + status index |
| `oauth_refresh_token_families` | `id`, grant ID, `dpop_jkt`, status, current generation, created/last-used/compromised/revoked timestamps | unique family ID; grant + status |
| `oauth_refresh_tokens` | `id`, family ID, generation, token hash, issued/expires/used/revoked timestamps, replacement token ID | unique token hash; unique family + generation; unused expiry index |
| `oauth_access_token_jtis` | token JTI/hash, grant ID, audience, scopes hash, `dpop_jkt`, issued/expires/revoked timestamps | unique JTI; grant + expiry; supports immediate revocation/audit without storing JWT plaintext |
| `dpop_proof_replays` | `dpop_jkt`, proof JTI, method, canonical URI hash, access-token hash where present, seen/expires timestamps | unique `dpop_jkt,proof_jti`; expiry index |
| `dpop_nonces` | nonce hash, `dpop_jkt` or installation ID, issued/expires/consumed timestamps, purpose | unique nonce hash; active key + expiry; one-time consumption when profile requires it |
| `cryptographic_key_registry` | key ID, owner/service, role (`agent_card`, `oauth_signing`, `ap2_merchant`, `quote`, `receipt`, `push`, `facade_mtls`), algorithm, public JWK/certificate hash, external custody reference, status, valid from/until, supersedes key ID | unique owner + role + key ID; active role/validity index; no private key material |

Device approval, grant creation, and device-code consumption occur in one transaction. Refresh rotation inserts the next token, marks the prior token used, and advances the family generation in one transaction. Reuse of an already used token marks the family compromised and revokes the grant according to policy.

#### A2A Task, Product, and Quote Tables

| Table | Required columns | Required constraints/indexes |
|---|---|---|
| `a2a_products` | product ID/version, skill ID, status, description, input/output schema hashes, pricing policy, AP2/payment class, artifact type, effective dates | unique product ID + version; active skill/product index |
| `a2a_tasks` | internal ID, protocol task ID, context ID, request ID, `user_id`, installation/grant ID, skill/product/version, scoped idempotency key, business-input hash, base/current intent hashes and intent phase, A2A state, payment state, result state, quote/payment/result references, expiry, lock version, terminal reason/timestamps | unique protocol task ID; unique request ID; user + state; installation + idempotency linkage |
| `a2a_task_events` | task ID, monotonic sequence, event type/state, canonical event hash, safe event data, occurred at | unique task + sequence; task timeline index |
| `a2a_idempotency` | scope hash, idempotency key, immutable base-intent hash, task ID, current intent hash/phase and response/state hash, first/last seen, expires at | unique scope hash + key; expiry index |
| `checkout_quotes` | quote ID, task/user/installation/product IDs, merchant ID, atomic amount/asset/unit, network/method, signed checkout JWT/hash, checkout/payment nonces, signed quote JSON/reference, canonical quote hash, created/expires at, status, selected requirement hash | unique quote ID and quote hash; unique checkout/payment nonce; task; active expiry |

Task admission and idempotency insertion occur in one transaction. Quote creation locks the task, verifies the product/version, inserts the signed quote and payment requirement, advances the task to `payment_required`, appends its event, and writes its outbox/audit records atomically.

#### AP2 Tables

| Table | Required columns | Required constraints/indexes |
|---|---|---|
| `ap2_mandates` | mandate ID, task/user/installation IDs, kind/VCT, issuer, subject, audience, parent/open mandate ID, canonical payload hash, closed-leaf JWT hash, signed credential JSON/reference, disclosure hash set, valid from/until, signature/authority verification states and timestamps, rejection reason | unique mandate ID and payload hash; unique closed-leaf JWT hash for closed mandates; task + kind; parent relation |
| `ap2_constraints` | mandate ID, constraint ID, namespace, type/version/scope, critical flag, canonical value JSON/hash, enforcement state, verifier, evaluated at/reason | unique mandate + constraint ID; type + counter lookup |
| `ap2_counters` | counter ID, user, merchant/product/constraint identity, asset/unit, explicit window start/end, limit/reserved/committed amount, limit/reserved/committed count, lock version | unique authority + constraint + window; active window index; non-negative checks |
| `ap2_reservations` | reservation ID, counter/task/quote/mandate IDs, amount/count, state, expires/committed/released timestamps, settlement ID | unique counter + task; active expiry; non-negative checks |

Divinr creates all required merchant-side reservations while holding the relevant counter rows in one transaction. The transaction fails if any amount/count would exceed its limit. Payment acceptance commits reservations exactly once; definitive failure releases them; unknown settlement leaves them reserved until reconciliation.

#### Payment, Result, and Receipt Tables

| Table | Required columns | Required constraints/indexes |
|---|---|---|
| `payment_requirements` | requirement ID, task/quote IDs, selected compatibility profile and extension URI, canonical x402 requirement JSON/hash, amount/asset/unit/network/method, invoice/reference hash, created/expires at, status | unique requirement ID/hash; task; expiry |
| `payment_submissions` | submission ID, task/requirement/payment-mandate IDs, Checkout Mandate leaf hash, Checkout Receipt ID/hash, Payment Mandate leaf hash, scoped idempotency key, canonical payload/evidence hash and safe reference, payer authority ID, state, submitted/verified timestamps, failure code | unique task + requirement + accepted submission; unique evidence hash; state index |
| `settlements` | settlement ID, submission ID, Spark merchant observation ID, invoice/payment hash, atomic amount/asset/unit, fee, state, verification evidence JSON/reference, observed/confirmed/reconciled timestamps | unique settlement ID; unique payment/invoice hash according to scheme; submission |
| `result_artifacts` | artifact ID, task/product IDs, content hash, storage reference, media/schema metadata, generation state, release state, release settlement/receipt IDs, created/released timestamps | unique artifact ID/content hash as appropriate; task + release state |
| `receipt_records` | receipt ID/type, task/quote/mandate/submission/settlement/artifact IDs, issuer/signer/key ID, canonical payload hash, signed receipt JSON/reference, verification state/time, supersedes ID | unique receipt ID/hash; task + type |
| `reconciliation_cases` | case ID, task/payment/settlement IDs, reason/state, expected/observed state, attempts, next attempt, owner, resolution and timestamps | unique active case per subject/reason; work queue index |
| `refund_cases` | refund ID, task/original submission/settlement IDs and payment hash, reason, Apple refund-invoice ID/protected reference/refund payment hash, amount/asset/unit, payer and merchant observation states, state, receipt ID, attempts/lease/next attempt, created/expires/completed timestamps | unique original settlement + reason; unique refund payment hash; one active case; state/work queue indexes |

The transaction that authorizes paid result release must lock the task and accepted payment submission, verify a successful settlement and required checkout/payment receipts, commit Divinr reservations, mark exactly one artifact releasable, create the service receipt, advance the task, and write outbox/audit events. No other code path may mark a paid artifact released.

#### Push, Delivery, and Audit Tables

| Table | Required columns | Required constraints/indexes |
|---|---|---|
| `agent_push_subscriptions` | subscription ID, user/installation ID, approved callback origin/path, authentication profile/public key, allowed event types, status, created/expires/revoked timestamps | unique active installation + callback; status |
| `agent_push_deliveries` | delivery/event ID, subscription/task/receipt IDs, event type, canonical payload hash/reference, attempt/state, not-before, lease, response/ack hash, delivered/expired timestamps | unique subscription + event ID; ready queue; no duplicate successful delivery |
| `transactional_outbox` | outbox ID, aggregate type/ID/version, event type, payload hash/reference, state, attempts, not-before, lease, published at | unique aggregate + version + event type; ready queue |
| `security_audit_events` | event ID, sequence or ordering key, actor/principal, user/installation/task/mandate/payment/receipt references, action/outcome/reason, redacted detail JSON, previous/event hash, occurred at | unique event ID; user/task/time indexes; append-only application permissions |

Outbox rows are written in the same transaction as the state they announce. Delivery workers lease rows with database locking, may retry safely, and mark success only after a correlated acknowledgment.

### 10. Spark Payment Authority Databases

Spark is a host for two logical authorities. They must not share wallet credentials, mutable policy rows, or unrestricted database roles.

Personal-agent payer schema/service:

| Table | Required columns | Required constraints/indexes |
|---|---|---|
| `payer_key_registry` | key ID, role (`facade_mtls`, `receipt_signing`), algorithm, public key/certificate hash, external custody reference, status, valid from/until, supersedes key ID | unique role + key ID; active validity; no private material |
| `payer_client_identities` | identity ID, authority/installation ID, certificate serial, SPKI hash, required SPIFFE SAN, issuer CA ID, allowed operations, status, valid from/until, revoked at/reason | unique certificate serial and SPKI hash; unique active authority + SPIFFE SAN; validity/status index |
| `payer_wallets` | wallet ID, node public key/alias, network, restricted LND credential reference, signing-key ID, status/health, last synchronized/block height, created/updated timestamps | unique node public key + network; network check permits only regtest in demo; no seed/admin macaroon |
| `payer_policies` | policy ID/version, wallet ID, owner/open-payment-authority hash, accepted mandate/constraint versions, canonical policy hash, status, effective from/until | unique policy ID + version; one active wallet/version; immutable published versions |
| `payer_counters` | counter ID, wallet/policy/constraint identity, asset/unit, exact window start/end, limit/reserved/committed amount/count, lock version | unique policy + constraint + window; non-negative and reserved/committed-within-limit checks |
| `payer_reservations` | reservation ID, counter/request/mandate/invoice IDs, amount/count, state, expires/committed/released timestamps, settlement ID | unique counter + request; active expiry; settled reservation cannot release |
| `payer_payment_requests` | request ID, Apple authority/installation IDs, scoped idempotency key, canonical request, quote, Checkout Receipt, Payment Mandate leaf, and invoice hashes, wallet ID, amount/asset/unit/network/method, state, expiry, lock version, terminal reason/timestamps | unique Apple authority + idempotency key; unique accepted invoice hash; state/expiry index |
| `payer_payment_attempts` | attempt ID, request ID, attempt number, LND payment ID/hash, state, safe failure code, started/ended timestamps | unique request + attempt number; unique non-null LND payment ID; payment hash index |
| `payer_settlements` | settlement ID, request/attempt IDs, payment hash, protected proof/preimage reference or hash, amount/asset/unit, routing fee amount/unit, final state, settled/reconciled timestamps | unique payment hash; unique successful request; amount must match request |
| `payer_balance_snapshots` | snapshot ID, wallet/request/settlement IDs, phase (`before`, `after`), node/channel IDs, local/remote/pending balances, block height, observed at, evidence hash | unique settlement + phase + channel; request/phase index |
| `payer_receipts` | receipt ID, request/settlement/mandate IDs, issuer/key ID, canonical payload/hash, signed receipt/reference, verification state, issued at | unique receipt ID/hash; unique successful settlement receipt |
| `payer_refund_invoices` | refund ID, original request/settlement/payment hash, reason, BOLT11 protected reference/hash, refund payment hash, amount/asset/unit, state, created/expires/settled timestamps, lock version | unique original settlement + reason; unique refund payment hash; active expiry |
| `payer_refund_observations` | observation ID, refund ID/payment hash, LND event sequence, observed state/amount, evidence hash/reference, observed at | unique event sequence; unique refund + evidence hash; refund timeline |
| `payer_reconciliation` | case ID, request/payment hash, reason/state, attempt count, next attempt, lease, observed evidence hash, resolution/timestamps | unique active request + reason; work queue index |
| `payer_outbox` | outbox ID, aggregate/version/event type, payload hash/reference, state, attempts, not-before, lease, published at | unique aggregate + version + event type; ready queue |
| `payer_audit_events` | event ID, ordered sequence, actor, request/mandate/settlement references, action/outcome/reason, redacted detail, previous/event hash, occurred at | unique sequence/event ID; append-only permissions |

Divinr merchant schema/service:

| Table | Required columns | Required constraints/indexes |
|---|---|---|
| `merchant_key_registry` | key ID, role (`facade_mtls`, `settlement_signing`), algorithm, public key/certificate hash, external custody reference, status, valid from/until, supersedes key ID | unique role + key ID; active validity; no private material |
| `merchant_client_identities` | identity ID, service ID, certificate serial, SPKI hash, required SPIFFE SAN, issuer CA ID, allowed operations, status, valid from/until, revoked at/reason | unique certificate serial and SPKI hash; unique active service + SPIFFE SAN; validity/status index |
| `merchant_wallets` | wallet ID, node public key/alias, network, restricted LND credential reference, signing-key ID, status/health, last synchronized/block height, created/updated timestamps | unique node public key + network; regtest-only demo check; no seed/admin macaroon |
| `merchant_invoices` | invoice ID, task/quote/product IDs, merchant wallet ID, BOLT11 protected reference/hash, payment hash, amount/asset/unit/network, created/expires at, state, lock version | unique invoice ID/payment hash; unique active task + quote; expiry index |
| `merchant_payment_observations` | observation ID, wallet/invoice/payment hash, node event sequence, observed state/amount, evidence hash/reference, observed at | unique wallet + event sequence; unique invoice + evidence hash; invoice timeline |
| `merchant_settlements` | settlement ID, invoice/payment hash, amount/asset/unit, independently verified state, payer reference hash, settled/confirmed/reconciled timestamps, evidence hash | unique payment hash; unique successful invoice settlement; amount matches invoice |
| `merchant_release_authorizations` | authorization ID, task/artifact/invoice/settlement IDs, canonical authorization hash, signer/key ID, state, created/expires/consumed timestamps | unique task + artifact; unique settlement; single atomic consumption |
| `merchant_balance_snapshots` | snapshot ID, wallet/invoice/settlement IDs, phase (`before`, `after`), node/channel IDs, local/remote/pending balances, block height, observed at, evidence hash | unique settlement + phase + channel; invoice/phase index |
| `merchant_receipts` | receipt ID, invoice/settlement/task IDs, issuer/key ID, canonical payload/hash, signed receipt/reference, issued/verified timestamps | unique receipt ID/hash; unique settlement receipt |
| `merchant_refund_requests` | refund ID, original invoice/settlement/payment hash, reason, Apple refund invoice protected reference/hash and refund payment hash, amount/asset/unit, scoped idempotency key, state, expiry, lock version, timestamps | unique original settlement + reason; unique refund payment hash; state/expiry |
| `merchant_refund_attempts` | attempt ID, refund ID, attempt number, LND payment ID/hash, state, safe failure code, started/ended timestamps | unique refund + attempt number; unique non-null LND payment ID |
| `merchant_refund_settlements` | settlement ID, refund/attempt IDs, refund payment hash, amount/asset/unit, routing fee, state, evidence hash/reference, settled/reconciled timestamps | unique refund payment hash; unique successful refund; amount matches request |
| `merchant_reconciliation` | case ID, invoice/payment hash, reason/state, attempt count, next attempt, lease, observed evidence hash, resolution/timestamps | unique active invoice + reason; work queue index |
| `merchant_outbox` | outbox ID, aggregate/version/event type, payload hash/reference, state, attempts, not-before, lease, published at | unique aggregate + version + event type; ready queue |
| `merchant_audit_events` | event ID, ordered sequence, actor, invoice/task/settlement/release references, action/outcome/reason, redacted detail, previous/event hash, occurred at | unique sequence/event ID; append-only permissions |

Each service uses its own migration history, database credential, signing identity, restricted LND credential, and audit chain. Cross-service communication uses authenticated APIs and signed/stable identifiers rather than direct cross-schema writes.

Payer authorization and settlement are a durable state machine rather than one long database transaction. The prepare transaction locks policy/counter rows, verifies the closed Payment Mandate and invoice, inserts or confirms idempotency, creates reservations, and commits `prepared` plus outbox/audit records. A worker atomically claims the request and records `paying` before calling LND. It then records `settled`, `failed`, or `unknown` with the LND identifier and evidence. Only definitive failure releases reservations; `unknown` is reconciled against LND by payment hash before any retry.

Merchant invoice creation binds one invoice to the exact task, quote, product, amount, and expiry in one transaction. Node observations are deduplicated by wallet event and payment hash. A successful observation creates or confirms exactly one merchant settlement and release authorization. Divinr consumes that release authorization in the same transaction that releases the paid artifact; an API call or model output cannot set release state directly.

### 11. Trusted Push to Apple Assistant

Trusted push is not required for the first paid vertical slice. When implemented, Divinr may send narrow events such as:

- task/result ready;
- tournament state changed;
- payment action required;
- payment confirmed or failed;
- receipt ready; or
- retry-after state changed.

A push event must never itself spend money, approve a payment, enter a tournament, join a club, or trigger paid work. It may notify Apple Assistant that a separately authorized action is available or required. Any paid follow-up must begin as a new request through Apple deterministic egress.

The callback is exactly `POST https://agent.golfergeek.com/v1/trusted/divinr/events`. The body conforms to `pushEvent`. Divinr signs RFC 9421 HTTP Message Signatures with `ecdsa-p256-sha256` and RFC 9530 `Content-Digest`, covering `@method`, `@target-uri`, `content-digest`, `content-type`, `x-divinr-event-id`, and `x-divinr-issued-at`. Events expire within five minutes. Delivery retries at 5, 30, 120, 600, 1800, 7200, 21600, and 86400 seconds, at most eight attempts. A duplicate acknowledgment completes delivery without another side effect.

Push payloads contain references and minimum necessary display data, not reusable credentials or unnecessary user data. Delivery is idempotent and receiver acknowledgment does not authorize further action.

### 12. Connected Agents User Surface

Divinr needs user-facing surfaces to:

- review and approve a device connection;
- see the agent name, installation identity/key thumbprint, scopes, and requested spending authority;
- list connected agents;
- inspect last use and relevant audit/receipt history;
- revoke an installation or individual grant; and
- require reapproval for increased scopes or spending authority.

These surfaces must follow Divinr repository requirements: first-touch content, approved analysis/signal vocabulary, legal disclaimer reuse where applicable, deep browser-skill coverage, and green Playwright coverage.

Approval UI must use typed deterministic controls. Rendered model text, markdown, HTML, email, or push content cannot approve a connection, mandate, payment, or scope increase.

## Shared Error Contract

Divinr emits only `errorEnvelope` and the exact code enum/retry mapping in `schemas.v0.2.json` and the combined intention. Repository-internal errors normalize at the boundary; local aliases such as `SPEND_LIMIT_EXCEEDED`, `PAYMENT_QUOTE_EXPIRED`, or `DPOP_REPLAY_DETECTED` never appear on the wire. An unclassified internal failure is an HTTP/JSON-RPC internal error with a correlation ID, not a new domain code.

Protocol-native A2A task states and errors remain authoritative where the specification defines them. Authentication failures occur before JSON-RPC dispatch, invalid params use `-32602`, A2A errors use their standard mappings, and deterministic pre-task domain denials use `-32050` with `error.data` equal to `errorEnvelope`.

## Verification Requirements

### Authentication and Binding

- Agent Card conforms to the pinned A2A schema.
- Protected skills reject missing credentials.
- A valid token with no DPoP proof is rejected.
- A copied token signed with another installation key is rejected.
- Wrong method, URL, token hash, audience, nonce, or scope is rejected.
- Replayed proof IDs are rejected.
- Expired and revoked agent grants are rejected.
- Refresh-token rotation and reuse detection are tested.
- Caller-supplied user IDs never alter the effective user.

### Authorization and Data Isolation

- Each skill enforces its exact scope and resource entitlement.
- Service API keys cannot impersonate a user-delegated agent.
- One user's agent cannot retrieve another user's data or task.
- Public-skill policy cannot open protected skills.
- Denials and logs do not leak protected data or credentials.

### Mandate, Budget, and Payment Adversarial Tests

- Amount above the per-call limit is rejected.
- Amount or call count above the remaining period allowance is rejected.
- Two concurrent requests cannot spend the same remaining allowance.
- Altered product, amount, merchant, user, agent, task, or checkout is rejected.
- Expired, revoked, replayed, and wrong-key mandates are rejected.
- Same idempotency key with a changed body is rejected.
- Payment proof cannot be reused for another task.
- A paid result cannot be retrieved before verified settlement.
- Retry after timeout does not double-charge.
- Execution failure after settlement follows the defined reconciliation/refund policy.

### Lightning Regtest

- Both LND nodes report synchronized and ready.
- A funded channel is active.
- Personal-agent node pays a Divinr invoice.
- Divinr independently verifies settlement.
- Invalid, expired, underpaid, duplicate, and already-settled invoices are handled deterministically.
- No mainnet or signet wallet/endpoint can be selected in the demo configuration.

### Cross-System End-to-End

- Apple discovers and validates Divinr's Agent Card.
- Owner completes device authorization.
- Apple performs a paid DPoP-bound personalized call at its exact catalog price.
- Apple receives a payment-required task state for a paid analysis.
- Apple and Spark reject locally excessive spending before payment.
- Divinr rejects excessive or malformed authority even if Apple sends it.
- A valid regtest payment releases exactly one result and linked receipt.
- Both payment facades expose matching pre/post channel balance evidence, invoice/payment identifiers, amount, any routing fee, and settlement state for the linked demo transaction.
- Revoking the connected agent prevents subsequent token refresh and A2A use.

## Delivery Sequence

1. Vendor and validate the frozen shared profile, exact constraint schemas, all seven skill/product bindings, canonical fixtures, receipts, and complete 1¢–5¢ catalog.
2. Add versioned migrations for connected agents/OAuth, A2A tasks/idempotency, products/quotes, AP2 counters/reservations, payments/results/receipts, outbox/audit, and reconciliation.
3. Replace the preliminary Agent Card and A2A dispatch with the pinned A2A interface and add conformance tests.
4. Implement device authorization, connected-agent grants, and approval/inspection/revocation UI.
5. Implement DPoP token issuance, refresh rotation/reuse detection, verification, nonce, replay storage, and revocation.
6. Rebuild skill admission around verified principals, exact scopes, ownership, tasks, idempotency, transactional events, and output filtering.
7. Deliver general and personalized updates through the common authenticated paid-business path.
8. Extract and repair the standalone two-node Spark Lightning regtest topology and implement the separate payer/merchant database schemas and restricted facades.
9. Implement AP2 checkout verification, constraint/disclosure evaluation, counters/reservations, and the version-isolated A2A payment/x402/Lightning adapters.
10. Deliver the paid analysis saga with signed quotes, settlement verification, exactly-once release, all receipts, balance evidence, and reconciliation.
11. Add separately authorized paid tournament join and simulated trade, then trusted push, then complete the remaining catalog skills.
12. Run adversarial, concurrency, migration, conformance, browser, restart/recovery, and cross-system acceptance tests.

Every phase must include migrations/bootstrap readiness, linting, type checking, unit/integration tests, security tests, and relevant browser-visible verification. No request-time schema mutation may be introduced.

Divinr is not ready for Apple Assistant exposure until the current optional service-key guard behavior and caller-selected user context are removed from the protected path; scopes are enforced at dispatch; all required database uniqueness/foreign-key/RLS rules exist; signing keys are in dedicated custody; Spark has two synchronized funded nodes and restricted services; and paid result release is reachable only through the verified transactional state machine.

## Non-Goals for the First Vertical Slice

- Bitcoin mainnet or economically valuable settlement;
- custody of a user's real funds;
- unrestricted third-party agent registration;
- cross-merchant global budget enforcement by Divinr;
- autonomous trading of real assets;
- charging for unsolicited push events;
- replacing Divinr's normal web login or Stripe subscription system;
- exposing raw LND REST/gRPC or admin macaroons to models; or
- claiming that a local Lightning binding is an official x402 network scheme unless it becomes one.

## Frozen Apple Contract

Divinr accepts the shared canonical-intent fields, Apple SwiftData ownership, serial reservation transaction, Keychain reference-swap recovery, stable non-exportable P-256/ES256 DPoP key, separate owner/delegated AP2 keys, and reauthorization on installation-key rotation as v0.2 requirements.

AP2 uses SD-JWT/ES256 with VCTs `mandate.checkout.open.1`, `mandate.checkout.1`, `mandate.payment.open.1`, and `mandate.payment.1`; checkout audience `https://divinr.ai/a2a`; payer audience `https://spark-51e5.tail126196.ts.net:7443`; and quote-bound single-use nonces. The open authority permits USD 1–5 minor units per exact catalog product, at most ten successful business calls, USD 25 minor units total, and `250000` reserved-plus-committed msat in one hour. Per-transaction maximum is `50000` msat, while exact product binding enforces lower product amounts. No exchange rate is claimed.

Divinr issues compact ES256 JWS checkout and service receipts and verifies the payer's compact ES256 AP2 Payment Receipt before release. `kid` resolves only through approved issuer registries. Old public verification keys remain available for 90 days. The exact claim schemas and key-role separation are frozen in the shared contract.

Post-settlement duplicate charge, non-delivery, product mismatch, or amount mismatch opens one automatic refund case and returns `refund-required` on the existing task. Apple supplies one payer-created invoice for the exact original product amount through `refund-submitted`. Divinr verifies its original-payment/reason/amount binding and invokes the merchant refund endpoint idempotently. Routing fees are not refunded, unknown outcomes remain `REFUND_PENDING`, and Divinr does not return terminal `refund-completed` evidence before payer and merchant observations match. A valid released result is not refundable for later cancellation or dissatisfaction.

The Divinr repository owns `infra/lightning-regtest/`, payment-facade code, migrations, and non-secret service configuration. Runtime secrets and wallet state live under `/var/lib/divinr-agent-commerce/`, never Git or iCloud. There are no remaining v0.2 decisions for Apple to choose independently; discovered incompatibilities require a shared v0.3 change.

## Non-Breakable Divinr Invariants

- Effective user identity comes only from verified credentials.
- Protected A2A skills never rely on a fall-through guard.
- DPoP-bound tokens cannot be used without the enrolled installation key.
- Models never receive credentials or make authorization, mandate, payment, or release decisions.
- Divinr verifies scopes, entitlements, AP2 checkout authority, payment evidence, and idempotency independently of Apple Assistant.
- Divinr honors the exact authorized product, amount, time, caller, and constraint set or rejects the request.
- Divinr never releases a paid result before successful deterministic verification.
- Push events never authorize or cause spending.
- Lightning demonstrations use valueless Bitcoin regtest funds and identify them as economically valueless.
- Identity, authorization, receipt, push, and wallet keys are not reused across roles.
- Every privileged transition is idempotent, auditable, replay-resistant, and fail-closed.
- Divinr makes no A2A x402 or Lightning-scheme conformance claim beyond the exact profile demonstrated by shared wire fixtures.
