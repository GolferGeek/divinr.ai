# Secure Apple Assistant A2A Integration — Implementation Plan

**PRD**: `docs/efforts/current/secure-apple-assistant-a2a/prd.md`  
**Created**: 2026-07-24  
**Status**: In Progress

## Progress Tracker

- [x] Phase 1: Frozen contract and atomic foundation
- [x] Phase 2: Versioned Divinr persistence
- [ ] Phase 3: A2A 1.0 discovery and task protocol
- [ ] Phase 4: Device authorization and connected-agent UI
- [ ] Phase 5: DPoP credentials and recovery
- [ ] Phase 6: Deterministic admission and paid update skills
- [ ] Phase 7: Spark two-node regtest and restricted facades
- [ ] Phase 8: AP2 and A2A-carried payment exchange
- [ ] Phase 9: Paid analysis, release, receipts, and refunds
- [ ] Phase 10: Tournament skills, remaining catalog, and trusted push
- [ ] Phase 11: Production hardening and cross-system acceptance

---

## Phase 1: Frozen Contract and Atomic Foundation

**Status**: Complete
**Objective**: Establish byte-exact v0.2 contracts, strict validation/canonicalization, frozen product metadata, and transaction-scoped database primitives without changing public behavior.

### Steps

- [x] 1.1 Copy the six shared v0.2 artifacts into `contracts/apple-divinr/v0.2/`, preserve bytes, add a provenance README with source paths and pinned commits, and add a manifest verifier that rejects missing, extra, or hash-mismatched files.
- [x] 1.2 Vendor the six AP2 base schemas and every referenced AP2 type schema unchanged from commit `b4587ac1d055888a73b4b21750973cffba961793`; record upstream relative paths and verify stored hashes.
- [x] 1.3 Add strict JSON Schema registry code for every shared `$defs` contract, URI/ref resolution, unknown-field rejection, fixture validation, and safe error normalization.
- [x] 1.4 Add RFC 8785 canonicalization and SHA-256 utilities with byte-level tests for Unicode, number formatting, property order, canonical intent phases, receipts, and fixture hashes.
- [x] 1.5 Add a typed immutable seven-product catalog generated/validated from the frozen profile; expose exact scopes, schemas, USD minor units, msat strings, classification, AP2/quote/idempotency/time/redaction/error/audit metadata.
- [x] 1.6 Extend `DatabaseService` with `withTransaction`, add `DatabaseTransaction`, implement reserved-client begin/commit/rollback/release behavior in PostgreSQL and Supabase providers, and add bounded serializable-retry support.
- [x] 1.7 Add provider-parity tests for commit, rollback, thrown callbacks, connection release, selected isolation, and serialization retry exhaustion.
- [x] 1.8 Add package scripts for contract verification and focused agent-commerce tests; document that no public endpoint or runtime schema changes occur in this phase.

**Implementation note (2026-07-24):** The frozen schemas are valid JSON Schema but intentionally omit redundant `type`/`properties` declarations in some presence and branch schemas. Ajv runs with strict unknown-keyword/format behavior while its optional `strictRequired` and `strictTypes` authoring lints are disabled. Manifest byte verification and every declared runtime constraint remain active; vendored v0.2 bytes were not changed.

### Quality Gate

- [x] **Lint**: `pnpm --filter @divinr/api run lint`
- [x] **Build**: `pnpm --filter @divinr/api run typecheck && pnpm --filter @divinr/api run build`
- [x] **Unit Tests**: `pnpm --filter @divinr/api exec tsx tests/unit/agent-contract-bundle.test.ts && pnpm --filter @divinr/api exec tsx tests/unit/agent-canonicalization.test.ts && pnpm --filter @divinr/api exec tsx tests/unit/database-transaction.test.ts && pnpm --filter @divinr/api run test:unit`
- [x] **E2E Tests**: `pnpm --filter @divinr/api exec tsx tests/integration/agent-contract-fixtures.test.ts`
- [x] **Curl Tests**: With the unchanged local API running, `curl -fsS http://127.0.0.1:7100/health | jq -e '.ok == true and .service == "divinr-api"'`
- [x] **Chrome Tests**: N/A — this phase changes no user-visible surface; confirm `git diff --name-only main...HEAD -- apps/web/src` is empty.
- [x] **Phase Review**: Compare implementation with PRD Phase 1.
  - [x] Shared/AP2 files and pins are exact and validation fails closed.
  - [x] Catalog contains exactly seven products with correct prices/scopes/schemas.
  - [x] Both database providers provide real transaction-scoped execution.
  - [x] No public behavior, schema, or Spark topology changed.

---

## Phase 2: Versioned Divinr Persistence

**Status**: Complete
**Objective**: Create the complete Divinr-side connected-agent and commerce schema with atomic repositories, RLS, immutable seeds, bootstrap, and readiness.

### Steps

- [x] 2.1 Add ordered migrations for the ten connected-agent/OAuth/DPoP/key-registry tables with hashes only for reusable tokens/codes/nonces and no private key material.
- [x] 2.2 Add ordered migrations for A2A product/task/event/idempotency/quote tables, AP2 mandate/constraint/counter/reservation tables, and their foreign keys/checks/indexes.
- [x] 2.3 Add ordered migrations for requirements/submissions/settlements/artifacts/receipts/reconciliation/refunds, push/delivery/outbox, and append-only hash-linked audit tables.
- [x] 2.4 Add user ownership, service-role grants, RLS, evidence non-cascade behavior, UTC/UUID/numeric amount checks, state checks, lock versions, and every uniqueness invariant in PRD 4.2.
- [x] 2.5 Add transaction-bound repositories for task admission/idempotency, quote creation, counter reservation, settlement, release, refund, outbox, and audit; repositories accept `DatabaseTransaction`.
- [x] 2.6 Add `AgentCommerceSchemaService` bootstrap for immutable OAuth client, catalog/schema hashes, and public key metadata; register explicit bootstrap and add all critical relations/seeds to readiness.
- [x] 2.7 Add empty-database, upgrade, rollback, duplicate, counter-race, ownership/RLS, and missing-readiness tests; extend schema-hot-read-path tests to reject request-time DDL.

**Implementation note (2026-07-24):** The configured database is the Spark production PostgreSQL instance. The complete migration and real bootstrap path were therefore exercised inside rollback-only transactions, followed by isolated-schema RLS, constraint, four-nonce, and two-connection counter-race tests. No production `agent_commerce` schema was left behind. Production migration plus API health smoke remains an explicit deployment action, not a source-commit side effect.

### Quality Gate

- [x] **Lint**: `pnpm --filter @divinr/api run lint`
- [x] **Build**: `pnpm --filter @divinr/api run typecheck && pnpm --filter @divinr/api run build`
- [x] **Unit Tests**: `pnpm --filter @divinr/api exec tsx tests/unit/agent-commerce-schema.test.ts && pnpm --filter @divinr/api exec tsx tests/unit/agent-commerce-repositories.test.ts && pnpm --filter @divinr/api exec tsx tests/unit/schema-hot-read-paths.test.ts && pnpm --filter @divinr/api run test:unit`
- [x] **E2E Tests**: `AGENT_COMMERCE_DB_TESTS=true pnpm --filter @divinr/api exec tsx -r dotenv/config tests/integration/agent-commerce-migrations.test.ts dotenv_config_path=../../.env`
- [x] **Deployment Smoke Decision**: Do not apply unreviewed migrations to the configured Spark production database from a source checkpoint. The migration/bootstrap path passed against that PostgreSQL engine under rollback; production bootstrap plus `curl -fsS http://127.0.0.1:7100/health | jq -e '.ok == true'` remains required when deployment is authorized.
- [x] **Chrome Tests**: N/A — no UI surface; `git diff --name-only 6961c4b -- apps/web/src` is empty.
- [x] **Phase Review**: Compare implementation with PRD Phase 2 and data contract.
  - [x] All 30 Divinr database tables, constraints, RLS, and transaction boundaries exist.
  - [x] Readiness fails on missing critical schema/seed state.
  - [x] No request handler performs DDL.

---

## Phase 3: A2A 1.0 Discovery and Task Protocol

**Status**: Not Started  
**Objective**: Replace the insecure prototype with signed A2A 1.0 discovery and fail-closed task protocol plumbing while keeping business skills disabled.

### Steps

- [ ] 3.1 Add role-specific key-provider interfaces and test custody; load Agent Card public/signing references through `cryptographic_key_registry` and fail production readiness on fallback/test keys.
- [ ] 3.2 Replace `/.well-known/agent.json` with `/.well-known/agent-card.json`, A2A 1.0 `supportedInterfaces`, modes, seven skill schema URIs/examples, OAuth/DPoP metadata, and the frozen optional global extension/required-skill list.
- [ ] 3.3 Add RFC 8785 Agent Card canonicalization, detached/embedded ES256 signature per frozen schema, and role-filtered `/.well-known/jwks.json`.
- [ ] 3.4 Replace custom `invoke` parsing with strict JSON-RPC `SendMessage`, `GetTask`, `ListTasks`, and `CancelTask`; enforce 1.0/version headers, profile extension, body/response size, pagination, and frozen errors.
- [ ] 3.5 Add task access binding and placeholder authentication policy that denies every protected business call until Phase 5; public discovery cannot select protected policy.
- [ ] 3.6 Remove caller-context user selection from the v0.2 path and prove `div_sk_` service keys cannot impersonate a personal-agent grant; retain only separately approved legacy routes if needed.
- [ ] 3.7 Add A2A/profile conformance, JSON-RPC, version/extension, size/rate, pagination, cross-task, and legacy-regression tests.

### Quality Gate

- [ ] **Lint**: `pnpm --filter @divinr/api run lint`
- [ ] **Build**: `pnpm --filter @divinr/api run typecheck && pnpm --filter @divinr/api run build`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api exec tsx tests/unit/a2a-agent-card.test.ts && pnpm --filter @divinr/api exec tsx tests/unit/a2a-protocol.test.ts && pnpm --filter @divinr/api run test:unit`
- [ ] **E2E Tests**: `pnpm --filter @divinr/api exec tsx tests/integration/a2a-conformance.test.ts`
- [ ] **Curl Tests**: `curl -fsS http://127.0.0.1:7100/.well-known/agent-card.json | jq -e '.protocolVersion == "1.0.0"'`; `curl -fsS http://127.0.0.1:7100/.well-known/jwks.json | jq -e '.keys | length > 0'`; unauthenticated `POST /a2a` `SendMessage` must return HTTP 401/DPoP auth error.
- [ ] **Chrome Tests**: N/A — protocol-only phase; visually opening the Agent Card is not a user application surface.
- [ ] **Phase Review**: Compare implementation with PRD Phase 3.
  - [ ] Discovery/signature/version/schema are conformant and non-sensitive.
  - [ ] Only four methods exist and task access is tuple-bound.
  - [ ] Protected business work remains disabled.

---

## Phase 4: Device Authorization and Connected-Agent UI

**Status**: Not Started  
**Objective**: Let an authenticated Divinr user explicitly approve, inspect, and revoke a proposed Apple Assistant installation.

### Steps

- [ ] 4.1 Implement RFC-shaped authorization-server/protected-resource metadata and `POST /oauth/device_authorization` with explicit request, proposed DPoP thumbprint, scope/resource allowlist, keyed code hashes, single use, expiry, and initiation/poll/entry limits.
- [ ] 4.2 Implement device-grant polling states at `/oauth/token` without issuing usable tokens yet; implement atomic approval/denial and durable installation/grant/audit creation.
- [ ] 4.3 Add browser-authenticated connected-agent APIs for code review, typed approval/denial, list/detail, grant revocation, and installation revocation with cross-user non-disclosure.
- [ ] 4.4 Add `/connect/device`, preserve the code through login, and render installation ID/name/thumbprint/scopes/authority/expiry with typed Approve/Deny controls.
- [ ] 4.5 Add `/settings/connected-agents` and detail views with grants, status, last use, safe audit/receipt references, and typed revocation controls.
- [ ] 4.6 Add `FirstTouchPanel`/`useFirstTouch` keys and `surface-content.ts` entries for both new surfaces; use approved analysis/signal vocabulary and `LegalDisclaimer` where applicable.
- [ ] 4.7 Create `.agents/skills/divinr-connected-agents-browser-skill/` with SKILL/what/where/expectations/tests/completeness, register a `connected-agents` Playwright project, and add desktop/mobile specs under `apps/e2e/tests/connected-agents/`.
- [ ] 4.8 Add device flow, code race/replay/expiry, excessive scope, login return, cross-user, approve/deny/revoke, accessibility, and first-touch tests; add `apps/api/tests/http/oauth-device-curl.sh` with exact DPoP fixture generation, curl requests, headers/bodies, and `jq` assertions.

### Quality Gate

- [ ] **Lint**: `pnpm --filter @divinr/api run lint && pnpm --filter @divinr/web run lint`
- [ ] **Build**: `pnpm --filter @divinr/api run typecheck && pnpm --filter @divinr/web run typecheck && pnpm --filter @divinr/api run build && pnpm --filter @divinr/web run build`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api exec tsx tests/unit/oauth-device-authorization.test.ts && pnpm --filter @divinr/api exec tsx tests/unit/connected-agents.test.ts && pnpm --filter @divinr/api run test:unit`
- [ ] **E2E Tests**: `BASE_URL=http://127.0.0.1:7101 API_BASE_URL=http://127.0.0.1:7100 pnpm --filter @divinr/e2e exec playwright test --project=connected-agents`
- [ ] **Curl Tests**: `AGENT_HTTP_BASE=http://127.0.0.1:7100 bash apps/api/tests/http/oauth-device-curl.sh`
- [ ] **Chrome Tests**: In Chrome, complete login-return → review → approve, deny a second code, inspect the list/detail, revoke a grant, revoke an installation, and repeat at mobile width with no clipping or model-rendered action.
- [ ] **Phase Review**: Compare implementation with PRD Phase 4.
  - [ ] Approval is typed, explicit, owner-bound, single-use, and auditable.
  - [ ] New surfaces have first-touch and deep testing coverage.
  - [ ] No browser/service credential is issued to Apple.

---

## Phase 5: DPoP Credentials and Recovery

**Status**: Not Started  
**Objective**: Issue and enforce short-lived sender-constrained agent credentials with refresh-family recovery and revocation.

### Steps

- [ ] 5.1 Implement ES256 OAuth key custody/registry/JWKS rotation and exact `at+jwt` claims/audience/scopes/lifetimes.
- [ ] 5.2 Implement DPoP proof verification for device authorization, token, refresh, revocation, and protected A2A: `typ`, signature/JWK, `jkt`, `htm`, canonical `htu`, `ath`, time, nonce, JTI replay, token/grant state.
- [ ] 5.3 Implement up to four concurrent five-minute one-use nonces per installation, 60-second proof age, 600-second replay retention, and exactly one challenge for absent/stale nonce.
- [ ] 5.4 Issue hashed opaque refresh tokens, rotate generations, bind families to the same `dpop_jkt`, detect reuse, revoke compromised families/JTIs, and audit recovery.
- [ ] 5.5 Implement grant/installation/key-rotation revocation and forced reauthorization; retain retiring public verification keys for 90 days.
- [ ] 5.6 Add credential redaction tests covering logs, errors, tasks, analytics, audits, and model inputs; add `apps/api/tests/http/oauth-dpop-curl.sh` to exercise valid and frozen negative proof cases using ephemeral test keys.

### Quality Gate

- [ ] **Lint**: `pnpm --filter @divinr/api run lint`
- [ ] **Build**: `pnpm --filter @divinr/api run typecheck && pnpm --filter @divinr/api run build`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api exec tsx tests/unit/dpop-verifier.test.ts && pnpm --filter @divinr/api exec tsx tests/unit/oauth-agent-tokens.test.ts && pnpm --filter @divinr/api run test:unit`
- [ ] **E2E Tests**: `pnpm --filter @divinr/api exec tsx tests/integration/oauth-dpop-flow.test.ts`
- [ ] **Curl Tests**: `AGENT_HTTP_BASE=http://127.0.0.1:7100 bash apps/api/tests/http/oauth-dpop-curl.sh`
- [ ] **Chrome Tests**: Re-run connected-agent approval/revocation Playwright/Chrome scenarios and confirm revoked status prevents client refresh; no new surface is added.
- [ ] **Phase Review**: Compare implementation with PRD Phase 5.
  - [ ] Credentials are sender-constrained and role-separated.
  - [ ] Rotation/reuse/revocation behavior is deterministic and tested.
  - [ ] Secrets never enter unsafe stores or output.

---

## Phase 6: Deterministic Admission and Paid Update Skills

**Status**: Not Started  
**Objective**: Admit verified agent principals into the durable common paid-task path and reach exact `payment-required` states for both update skills.

### Steps

- [ ] 6.1 Add immutable `VerifiedAgentPrincipal`/validated-command types and deterministic middleware for version, extension, size, DPoP, scope, grant, ownership, entitlement, rate/concurrency, schema, product, idempotency, minimization, and audit.
- [ ] 6.2 Implement atomic task admission/idempotency/events/outbox/audit and tuple-bound poll/list/cancel/continuation access.
- [ ] 6.3 Implement exact quote/payment-requirement generation and role-specific signing without releasing or generating paid output.
- [ ] 6.4 Add `general_updates` and `personal_updates` adapters to existing user-scoped services with output schema validation/redaction; adapters receive no raw caller claims.
- [ ] 6.5 Enforce 60/30/1200 request limits, four concurrent/two outstanding paid tasks, 50-item pages, 256 KiB input, 1 MiB output, and 900-second task lifetime.
- [ ] 6.6 Add cross-user, scope, entitlement, product/price, schema, idempotency race, rate/concurrency, and prepayment-release tests; add `apps/api/tests/http/a2a-paid-admission-curl.sh`.

### Quality Gate

- [ ] **Lint**: `pnpm --filter @divinr/api run lint`
- [ ] **Build**: `pnpm --filter @divinr/api run typecheck && pnpm --filter @divinr/api run build`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api exec tsx tests/unit/agent-admission.test.ts && pnpm --filter @divinr/api exec tsx tests/unit/a2a-update-skills.test.ts && pnpm --filter @divinr/api run test:unit`
- [ ] **E2E Tests**: `AGENT_COMMERCE_DB_TESTS=true pnpm --filter @divinr/api exec tsx tests/integration/a2a-paid-admission.test.ts`
- [ ] **Curl Tests**: `AGENT_HTTP_BASE=http://127.0.0.1:7100 bash apps/api/tests/http/a2a-paid-admission-curl.sh`
- [ ] **Chrome Tests**: N/A for agent endpoint; rerun connected-agent detail to ensure new task/audit references render safely.
- [ ] **Phase Review**: Compare implementation with PRD Phase 6.
  - [ ] Effective user is credential-derived and adapters are policy-free.
  - [ ] Exact quotes are durable/idempotent.
  - [ ] No result can be released.

---

## Phase 7: Spark Two-Node Regtest and Restricted Facades

**Status**: Not Started  
**Objective**: Build an isolated Spark-hosted two-node Lightning regtest environment and separately trusted payer and merchant services.

### Steps

- [ ] 7.1 Inventory and diagnose the existing Spark bitcoind/LND/miner state read-only; record sync, volumes, credentials, ports, and OrchestratorAI dependencies without disrupting it.
- [ ] 7.2 Add `infra/lightning-regtest/` with pinned images/digests, one bitcoind regtest backend, deterministic miner, two LND identities/volumes, health probes, funding/channel bootstrap, backup/reset, and explicit non-regtest rejection.
- [ ] 7.3 Add `apps/payment-facades/` package with separate payer and merchant entrypoints, explicit `@Inject` use, separate service users/config, and schema-validated APIs.
- [ ] 7.4 Add payer and merchant migrations for every PRD 4.2 table, restricted roles, exact uniqueness/checks, immutable policies, audit/outbox, and independent readiness.
- [ ] 7.5 Implement TLS 1.3 mTLS identity/SAN/SPKI/serial/operation authorization, payer Tailscale + loopback verifier listeners, merchant loopback listener, and no fallback auth.
- [ ] 7.6 Implement least-privilege LND clients, exact invoice/payment/status/receipt/balance/reconciliation/refund primitives, deduplicated observations, and safe credential handling.
- [ ] 7.7 Synchronize/fund both nodes, open an active channel, execute exact payments, capture both balance views, and test reset/restart/recovery; add `apps/payment-facades/tests/http/regtest-facades-curl.sh` using temporary test mTLS leaves.
- [ ] 7.8 Cut over from the old instance only after all gates pass; retain documented rollback and stable service names independent of OrchestratorAI.

### Quality Gate

- [ ] **Lint**: `pnpm --filter @divinr/api run lint && pnpm --filter @divinr/payment-facades run lint`
- [ ] **Build**: `pnpm --filter @divinr/api run build && pnpm --filter @divinr/payment-facades run typecheck && pnpm --filter @divinr/payment-facades run build`
- [ ] **Unit Tests**: `pnpm --filter @divinr/payment-facades run test`
- [ ] **E2E Tests**: `pnpm --filter @divinr/payment-facades run test:regtest`
- [ ] **Curl Tests**: `PAYER_BASE=https://spark-51e5.tail126196.ts.net:7443/v1 MERCHANT_BASE=https://127.0.0.1:7444/v1 bash apps/payment-facades/tests/http/regtest-facades-curl.sh`
- [ ] **Chrome Tests**: N/A — private infrastructure has no browser surface; inspect only machine-readable health/evidence.
- [ ] **Phase Review**: Compare implementation with PRD Phase 7.
  - [ ] Production target is Spark, never Mac Studio.
  - [ ] Two logical authorities have distinct identities, stores, keys, roles, and wallets.
  - [ ] Both nodes are synchronized with an active funded regtest channel.

---

## Phase 8: AP2 and A2A-Carried Payment Exchange

**Status**: Not Started  
**Objective**: Verify Apple purchasing authority and settle exact regtest payments through atomic, replay-safe checkout and payment states.

### Steps

- [ ] 8.1 Add AP2 SD-JWT/ES256 verification for four exact VCTs, issuers/key roles, audiences, quote nonces, disclosures, parent/open authority, validity, and canonical hashes.
- [ ] 8.2 Implement a closed registry for every v0.2 critical constraint namespace/type/version/operator/unit; reject unknown/optional behavior and enforce exact merchant/user/agent/task/checkout/product/action bindings.
- [ ] 8.3 Implement serializable AP2 counters/reservations for per-call/product, one-hour `25` USD minor unit/10-call/`250000` msat cumulative limits and exact product lower amounts.
- [ ] 8.4 Implement checkout-submitted verification, reservation, signed Checkout Receipt, and checkout-approved/input-required continuation atomically.
- [ ] 8.5 Implement payment-submitted verification against the same checkout/receipt/mandates, payer receipt, merchant observation, exact tuple, nonces, and idempotency.
- [ ] 8.6 Commit settlement once, create/consume merchant release authority, and implement pending/unknown reconciliation without inferring failure from timeout.
- [ ] 8.7 Add altered/replayed/expired/wrong-key/unknown-constraint, concurrent-budget, payment-proof reuse, duplicate settlement, and partial-failure tests; add `apps/api/tests/http/a2a-ap2-payment-curl.sh`.

### Quality Gate

- [ ] **Lint**: `pnpm --filter @divinr/api run lint && pnpm --filter @divinr/payment-facades run lint`
- [ ] **Build**: `pnpm --filter @divinr/api run typecheck && pnpm --filter @divinr/api run build && pnpm --filter @divinr/payment-facades run build`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api exec tsx tests/unit/ap2-verifier.test.ts && pnpm --filter @divinr/api exec tsx tests/unit/ap2-constraints.test.ts && pnpm --filter @divinr/api run test:unit`
- [ ] **E2E Tests**: `AGENT_COMMERCE_DB_TESTS=true pnpm --filter @divinr/api exec tsx tests/integration/a2a-ap2-payment.test.ts`
- [ ] **Curl Tests**: `AGENT_HTTP_BASE=http://127.0.0.1:7100 bash apps/api/tests/http/a2a-ap2-payment-curl.sh`
- [ ] **Chrome Tests**: N/A for payment transport; connected-agent evidence view must safely display state/reference changes without credentials.
- [ ] **Phase Review**: Compare implementation with PRD Phase 8 and 14-step paid flow.
  - [ ] OAuth, AP2, and payment evidence remain distinct.
  - [ ] Critical constraints and cumulative limits fail closed atomically.
  - [ ] Settlement commits once and no output releases yet.

---

## Phase 9: Paid Analysis, Release, Receipts, and Refunds

**Status**: Not Started  
**Objective**: Complete the paid analysis saga with exactly-once artifact release, signed evidence, restart recovery, and exact-principal refunds.

### Steps

- [ ] 9.1 Add the `analysis_request` adapter using the shared request/result schemas and existing analysis services; generate a content-addressed artifact without releasing it.
- [ ] 9.2 Atomically bind verified settlement, artifact, merchant release authorization, service receipt, task state/events, outbox, and audit; release only after single-use authorization consumption.
- [ ] 9.3 Emit/verify compact ES256 quote, checkout, payer-payment, merchant, service, and release evidence with approved issuer/key-role registries and 90-day public-key overlap.
- [ ] 9.4 Add task/result/receipt retrieval with tuple binding, response minimization, before/after balance evidence, and no pre-settlement artifact bytes.
- [ ] 9.5 Add post-settlement failure detection and one idempotent refund case for duplicate charge, non-delivery, product mismatch, or amount mismatch.
- [ ] 9.6 Implement payer refund invoice, merchant exact-principal payment, observation reconciliation, `refund-required`/`refund-submitted`/`refund-completed`, pending unknown outcomes, and no routing-fee refund.
- [ ] 9.7 Add restart, crash boundary, timeout retry, double-charge/release, key rotation, non-refundable cancellation/dissatisfaction, and all refund outcome tests; add `apps/api/tests/http/paid-analysis-refund-curl.sh`.

### Quality Gate

- [ ] **Lint**: `pnpm --filter @divinr/api run lint && pnpm --filter @divinr/payment-facades run lint`
- [ ] **Build**: `pnpm --filter @divinr/api run build && pnpm --filter @divinr/payment-facades run build`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api exec tsx tests/unit/paid-analysis-saga.test.ts && pnpm --filter @divinr/api exec tsx tests/unit/agent-refunds.test.ts && pnpm --filter @divinr/api run test:unit`
- [ ] **E2E Tests**: `AGENT_COMMERCE_DB_TESTS=true AGENT_REGTEST_TESTS=true pnpm --filter @divinr/api exec tsx tests/integration/paid-analysis-regtest.test.ts`
- [ ] **Curl Tests**: `AGENT_HTTP_BASE=http://127.0.0.1:7100 bash apps/api/tests/http/paid-analysis-refund-curl.sh`
- [ ] **Chrome Tests**: In connected-agent detail, inspect safe analysis task/receipt/refund evidence at desktop/mobile widths; verify no forbidden “prediction/advice” copy.
- [ ] **Phase Review**: Compare implementation with PRD Phase 9.
  - [ ] Paid analysis releases once only after verified settlement.
  - [ ] Receipts/evidence link every authoritative object.
  - [ ] Post-settlement failure delivers or refunds safely.

---

## Phase 10: Tournament Skills, Remaining Catalog, and Trusted Push

**Status**: Not Started  
**Objective**: Complete all seven products, add separately approved simulated tournament mutations, and deliver non-authorizing trusted push.

### Steps

- [ ] 10.1 Add tournaments list/context adapters with entitlement filtering, archived exclusion, status mapping, exact schemas, and 1¢/2¢ pricing.
- [ ] 10.2 Add join with only `tournamentId`, current eligibility, separate fresh typed owner action approval, atomic idempotent mutation, and 3¢ pricing.
- [ ] 10.3 Add trade with matching entitled UUID/symbol, side, quantity/rules/shorting validation, verified analysis artifact binding, separate action approval, atomic queueing, and 4¢ pricing.
- [ ] 10.4 Enforce at most five committed state-changing tournament actions per one-hour authority and prove payment approval alone cannot mutate state.
- [ ] 10.5 Implement exact callback subscription policy, transactional delivery/outbox, RFC 9421/9530 signing, five-minute expiry, eight frozen retry intervals, safe payloads, and duplicate acknowledgment.
- [ ] 10.6 Add all catalog schema/price/scope/receipt/error cases plus stale approval, changed rules, disallowed symbol/short/quantity, push replay/expiry/retry, and “push cannot authorize” tests; add `apps/api/tests/http/a2a-catalog-push-curl.sh`.
- [ ] 10.7 Extend tournament and connected-agent deep skill test documentation/specs for agent-paid mutations, task evidence, and push-visible state.

### Quality Gate

- [ ] **Lint**: `pnpm --filter @divinr/api run lint && pnpm --filter @divinr/web run lint`
- [ ] **Build**: `pnpm --filter @divinr/api run build && pnpm --filter @divinr/web run build`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api exec tsx tests/unit/a2a-tournament-skills.test.ts && pnpm --filter @divinr/api exec tsx tests/unit/agent-push.test.ts && pnpm --filter @divinr/api run test:unit`
- [ ] **E2E Tests**: `BASE_URL=http://127.0.0.1:7101 API_BASE_URL=http://127.0.0.1:7100 pnpm --filter @divinr/e2e exec playwright test --project=tournaments --project=connected-agents`
- [ ] **Curl Tests**: `AGENT_HTTP_BASE=http://127.0.0.1:7100 APPLE_PUSH_BASE=https://agent.golfergeek.com bash apps/api/tests/http/a2a-catalog-push-curl.sh`
- [ ] **Chrome Tests**: Verify tournament list/context/join/trade consequences and connected-agent evidence at desktop/mobile; ensure typed approvals, rules, and analysis/signal vocabulary are correct.
- [ ] **Phase Review**: Compare implementation with PRD Phase 10.
  - [ ] All seven products exactly match the frozen catalog.
  - [ ] Tournament actions honor live rules and separate authority.
  - [ ] Push is signed, minimal, idempotent, and non-authorizing.

---

## Phase 11: Production Hardening and Cross-System Acceptance

**Status**: Not Started  
**Objective**: Prove the complete Mac Studio Apple Assistant ↔ Spark Divinr/payer/merchant system is secure, recoverable, observable, and ready for controlled demo exposure.

### Steps

- [ ] 11.1 Write the threat model, data-flow/trust-boundary diagram, key/certificate rotation, signed update/dependency controls, audit retention/redaction, incident recovery, regtest reset, and Spark rollback runbooks.
- [ ] 11.2 Add fuzz/schema/size/rate, auth, cross-user, replay, mandate/budget, concurrency, settlement, refund, push, mTLS/cross-role, non-regtest, and secret-scanning adversarial suites.
- [ ] 11.3 Add process-kill/restart tests at every paid saga boundary and prove outbox/reconciliation/reservation expiry recover without duplicate payment/action/release.
- [ ] 11.4 Run clean bootstrap and upgrade migrations on an isolated Spark-equivalent database and validate every readiness dependency, image digest, upstream pin, key role, and safe health field.
- [ ] 11.5 Run the frozen positive and negative cross-system fixtures against the Apple implementation and resolve incompatibilities only through a jointly approved v0.3 contract.
- [ ] 11.6 Execute live Spark acceptance: discovery, device approval, DPoP update purchase, paid analysis, excessive local and Divinr denial, exact regtest settlement/release/receipts/balances, refund injection, and revocation; add `apps/api/tests/http/apple-divinr-spark-acceptance-curl.sh`.
- [ ] 11.7 Conduct dependency/security scans and independent-style adversarial review; fix all critical/high findings and document residual lower risks.
- [ ] 11.8 Keep protected A2A/paid release disabled until the operator readiness checklist is signed; then enable only the frozen v0.2 client/profile.

### Quality Gate

- [ ] **Lint**: `pnpm run lint`
- [ ] **Build**: `pnpm run typecheck && pnpm run build`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api run test && pnpm --filter @divinr/payment-facades run test`
- [ ] **E2E Tests**: `pnpm run e2e` plus the documented Spark/Apple acceptance runner with `AGENT_REGTEST_TESTS=true`
- [ ] **Curl Tests**: `AGENT_HTTP_BASE=https://divinr.ai PAYER_BASE=https://spark-51e5.tail126196.ts.net:7443/v1 MERCHANT_BASE=https://127.0.0.1:7444/v1 bash apps/api/tests/http/apple-divinr-spark-acceptance-curl.sh`; archive only redacted outputs and hashes.
- [ ] **Chrome Tests**: Run the connected-agents and tournament Playwright projects in production and manually verify device connection, evidence, revocation, desktop/mobile layout, first-touch, accessibility, and approved vocabulary.
- [ ] **Phase Review**: Compare the entire implementation against every PRD success criterion and non-breakable intention invariant.
  - [ ] Spark is the only Divinr production host; Mac Studio remains Apple Assistant.
  - [ ] No model authorizes identity, scopes, mandates, payment, mutation, release, or audit.
  - [ ] No protected path, key role, cumulative limit, result release, refund, or push behavior can bypass deterministic enforcement.
  - [ ] All tests, operations evidence, threat controls, and readiness sign-off are complete.
