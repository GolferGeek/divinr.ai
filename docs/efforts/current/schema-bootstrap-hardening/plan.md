# Schema Bootstrap Hardening — Implementation Plan

**PRD**: `docs/efforts/current/schema-bootstrap-hardening/prd.md`
**Created**: 2026-04-27
**Status**: In Progress

## Progress Tracker
- [x] Phase 1: Inventory and Transitional Guardrail
- [x] Phase 2: Explicit Bootstrap and Readiness Path
- [x] Phase 3: Shell Hot-Path Cleanup
- [ ] Phase 4: Markets Decomposition and Broad Cleanup
- [ ] Phase 5: Stabilization Verification and Documentation

---

## Phase 1: Inventory and Transitional Guardrail
**Status**: Complete
**Objective**: Map every request-time schema/bootstrap path and add a temporary guardrail that stops concurrent runtime DDL races while the permanent cleanup is underway.

### Steps
- [x] 1.1 Inventory every `ensureSchema()` call site and schema-owning service under `apps/api/src/`, grouped by module and classified as DDL, seed/default data, validation/warning, or business logic dependency.
- [x] 1.2 Identify which request paths fire during authenticated shell bootstrap, including Learning Panel bootstrap, first-touch, billing, unread counts, affinity, fear/greed, and any related startup requests, and mark which of those requests are essential versus deferrable.
- [x] 1.3 Introduce a temporary process-wide bootstrap coordinator/lock for runtime schema work so concurrent modules cannot deadlock each other during the transition.
- [x] 1.4 Add targeted unit coverage for the coordinator behavior and for the identified shell bootstrap paths that previously raced.
- [x] 1.5 Document the inventory and chosen transition rules in the current effort docs so later phases can remove runtime schema calls systematically.

### Quality Gate
Before moving to Phase 2, ALL of the following must pass:

- [x] **Lint**: `pnpm lint`
- [x] **Build**: `pnpm build`
- [x] **Unit Tests**: `pnpm --filter @divinr/api run test:unit`
- [x] **E2E Tests**: `BASE_URL=http://localhost:7101 E2E_API_BASE=http://127.0.0.1:7100 pnpm --filter @divinr/e2e exec playwright test tests/learning-panel/smoke.spec.ts --project=learning-panel`
- [x] **Curl Tests**:
  - `curl -sS --max-time 5 http://127.0.0.1:7100/api/config/public`
  - `curl -sS --max-time 5 -H "Authorization: Bearer <demo login token>" http://127.0.0.1:7100/api/learning-panel/bootstrap`
- [x] **Chrome Tests**:
  - Open `/chat` and confirm the Learning Panel loads without shell-bootstrap `500`s.
  - Open `/predictions`, launch the Learning Panel from shell chrome, and confirm the panel opens while the rest of the shell remains stable.
- [x] **Phase Review**: Compare implementation against Phase 1 objectives in the PRD
  - [x] Did we accomplish what we said we would?
  - [x] Does the code align with the PRD requirements?
  - [x] Are there any deviations? If so, document why.

Phase 1 notes:
- Validation required a deterministic Learning Panel runtime for browser checks. The API was run locally with `OPENSOURCE_LLM_PROVIDER=none`, `DEFAULT_OPENSOURCE_MODEL=gpt-4o-mini`, `MARKETS_ALLOW_COMMERCIAL_FALLBACK=true`, and `COMMERCIAL_LLM_PROVIDER=openrouter` so the panel used a fast commercial fallback instead of hanging on an unavailable local Ollama model.

---

## Phase 2: Explicit Bootstrap and Readiness Path
**Status**: Complete
**Objective**: Add an explicit schema/bootstrap command and startup readiness validation so schema creation is no longer hidden inside request handling.

### Steps
- [x] 2.1 Create a dedicated bootstrap module/service path for schema/init work, separate from request handlers, and define the interface each domain bootstrap task must implement.
- [x] 2.2 Add an explicit command or script for bootstrap execution, wire it into local dev startup, and make the bootstrap logs distinct from normal API request logs.
- [x] 2.3 Add startup readiness validation in the API boot path so the process fails clearly when required schema/bootstrap state is missing or incompatible.
- [x] 2.4 Add migration/bootstrap tracking or equivalent readiness state so the API can deterministically validate that required bootstrap work has already run.
- [x] 2.5 Move the smallest and most self-contained schema domains first (for example first-touch, learning-panel, billing, credentials, or auth-adjacent schema tasks) onto the explicit bootstrap path.
- [x] 2.6 Add or extend tests for bootstrap idempotence, readiness failure behavior, and startup success after bootstrap runs.

### Quality Gate
Before moving to Phase 3, ALL of the following must pass:

- [x] **Lint**: `pnpm lint`
- [x] **Build**: `pnpm build`
- [x] **Unit Tests**: `pnpm --filter @divinr/api run test:unit`
- [x] **E2E Tests**: `BASE_URL=http://localhost:7101 pnpm --filter @divinr/e2e exec playwright test tests/learning-panel/smoke.spec.ts --project=learning-panel`
- [x] **Curl Tests**:
  - `pnpm --filter @divinr/api run bootstrap:schema`
  - `curl -sS --max-time 5 http://127.0.0.1:7100/health`
  - `curl -sS --max-time 5 http://127.0.0.1:7100/api/config/public`
- [x] **Chrome Tests**:
  - Start the API via the documented local workflow, then open the app and confirm shell bootstrap succeeds after explicit bootstrap.
  - Intentionally skip bootstrap in a controlled dev run and confirm startup fails clearly instead of deferring failure to request time.
- [x] **Phase Review**: Compare implementation against Phase 2 objectives in the PRD
  - [x] Did we accomplish what we said we would?
  - [x] Does the code align with the PRD requirements?
  - [x] Are there any deviations? If so, document why.

Phase 2 notes:
- Added explicit bootstrap and readiness wiring via `apps/api/src/bootstrap/`, `apps/api/src/bootstrap-schema.ts`, `SchemaBootstrapService`, and `SchemaReadinessService`.
- `apps/api/scripts/dev-up.sh` now runs bootstrap first and uses a stronger detached-process launcher so the API survives after the parent shell exits.
- Verified the readiness failure path against a clean disposable Postgres database by overriding `POSTGRESQL_URL`: startup now fails clearly when bootstrap has not run, then succeeds after `bootstrap:schema`.
- Fixed bootstrap gaps discovered on a truly clean database by creating the missing `prediction`/`authz` schemas and minimal prerequisite tables in the smaller schema services.

---

## Phase 3: Shell Hot-Path Cleanup
**Status**: Complete
**Objective**: Remove request-time schema mutation from the modules hit during authenticated shell bootstrap and prove the shell no longer triggers DDL races.

### Steps
- [x] 3.1 Remove request-time `ensureSchema()` calls from Learning Panel, first-touch, billing, notification, fear/greed, affinity, and any other module reached during shell bootstrap.
- [x] 3.2 Remove or refactor request-time schema calls from the specific `MarketsService`/support-service methods used by shell bootstrap endpoints.
- [x] 3.3 Preserve all existing route contracts and shell behavior while shifting those modules to explicit bootstrap + readiness assumptions.
- [x] 3.4 Extend targeted unit/integration coverage so these services prove they operate correctly without schema mutation in normal methods.
- [x] 3.5 Extend existing browser coverage where needed to assert shell bootstrap stability across `/chat`, `/predictions`, and related shell paths.

### Quality Gate
Before moving to Phase 4, ALL of the following must pass:

- [x] **Lint**: `pnpm lint`
- [x] **Build**: `pnpm build`
- [x] **Unit Tests**: `pnpm --filter @divinr/api run test:unit`
- [x] **E2E Tests**:
  - `BASE_URL=http://localhost:7101 pnpm --filter @divinr/e2e exec playwright test tests/learning-panel/smoke.spec.ts --project=learning-panel`
  - `BASE_URL=http://localhost:7101 pnpm --filter @divinr/e2e exec playwright test tests/smoke/login-smoke.spec.ts --project=smoke`
- [x] **Curl Tests**:
  - `curl -sS -H "Authorization: Bearer $DIVINR_TOKEN" http://127.0.0.1:7100/api/learning-panel/bootstrap`
  - `curl -sS -H "Authorization: Bearer $DIVINR_TOKEN" http://127.0.0.1:7100/api/markets/notifications/unread-count`
  - `curl -sS -H "Authorization: Bearer $DIVINR_TOKEN" "http://127.0.0.1:7100/api/markets/affinity/alerts?unread_only=true"`
- [x] **Chrome Tests**:
  - Open `/chat`, send a prompt, refresh, and confirm the panel stays stable with no bootstrap failures.
  - Open `/predictions`, then launch the Learning Panel from shell chrome and confirm the page shell stays responsive while background shell requests succeed.
  - Review API logs during those scenarios and confirm there are no schema deadlock errors.
- [x] **Phase Review**: Compare implementation against Phase 3 objectives in the PRD
  - [x] Did we accomplish what we said we would?
  - [x] Does the code align with the PRD requirements?
  - [x] Are there any deviations? If so, document why.

Phase 3 notes:
- Removed request-time schema calls from shell-hot read paths in notifications, fear/greed alerts, affinity alerts, messaging unread counts, first-touch state, onboarding state, billing subscription reads, and `MarketsService.listPredictionsWithRole`.
- Added `tests/unit/schema-hot-read-paths.test.ts` to lock in the contract that these read methods must not call `ensureSchema()`.
- Re-ran the authenticated Learning Panel smoke, the `/predictions` launcher flow, and the mobile launcher flow against a fresh API restart with deterministic LLM env. All passed.
- Verified authenticated curl access for Learning Panel bootstrap, notifications unread count, affinity alerts, and `GET /markets/predictions?role=analyst`.
- Checked only the fresh post-restart API log tail and confirmed there were no new `deadlock detected` or `Schema creation failed` entries during the shell smoke.

---

## Phase 4: Markets Decomposition and Broad Cleanup
**Status**: Not Started
**Objective**: Decompose `MarketsSchemaService` and remove the remaining runtime schema pattern across the broader API.

### Steps
- [ ] 4.1 Split `MarketsSchemaService` responsibilities into migration-owned DDL, explicit bootstrap-owned seed/default data, and startup verification/warning logic.
- [ ] 4.2 Migrate remaining runtime DDL embedded in markets-adjacent services and the broader API onto the explicit bootstrap path.
- [ ] 4.3 Remove obsolete `ensureSchema()` calls and dead code once their bootstrap responsibilities have been relocated.
- [ ] 4.4 Remove remaining request-time schema calls from non-shell modules such as clubs, tournaments, curriculum, credentials, auth invites, and messaging, then verify they operate under the explicit bootstrap/readiness contract.
- [ ] 4.5 Add or update tests that cover bootstrap idempotence and representative non-shell feature paths after the broad cleanup.

### Quality Gate
Before moving to Phase 5, ALL of the following must pass:

- [ ] **Lint**: `pnpm lint`
- [ ] **Build**: `pnpm build`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api run test:unit`
- [ ] **E2E Tests**:
  - `BASE_URL=http://localhost:7101 pnpm --filter @divinr/e2e exec playwright test tests/learning-panel/smoke.spec.ts --project=learning-panel`
  - `BASE_URL=http://localhost:7101 pnpm --filter @divinr/e2e run e2e --project=smoke`
- [ ] **Curl Tests**:
  - `curl -sS --max-time 5 http://127.0.0.1:7100/api/config/public`
  - `curl -sS -H "Authorization: Bearer $DIVINR_TOKEN" http://127.0.0.1:7100/api/learning-panel/threads`
  - `curl -sS -H "Authorization: Bearer $DIVINR_TOKEN" http://127.0.0.1:7100/api/billing/my-summary`
- [ ] **Chrome Tests**:
  - Exercise Learning Panel, billing, notifications, and at least one club/tournament path from a fresh shell load and confirm no bootstrap instability.
  - Review logs from a cold start plus concurrent authenticated shell loads and confirm runtime schema deadlock noise is gone.
- [ ] **Phase Review**: Compare implementation against Phase 4 objectives in the PRD
  - [ ] Did we accomplish what we said we would?
  - [ ] Does the code align with the PRD requirements?
  - [ ] Are there any deviations? If so, document why.

---

## Phase 5: Stabilization Verification and Documentation
**Status**: Not Started
**Objective**: Prove the hardened bootstrap contract end to end and document it so future efforts do not reintroduce request-time schema mutation.

### Steps
- [ ] 5.1 Run a final cold-start verification pass with explicit bootstrap, startup readiness, and authenticated shell loads under concurrent use.
- [ ] 5.2 Update repo docs and local-dev guidance to describe the bootstrap command, readiness behavior, and the rule that requests must not perform schema mutation.
- [ ] 5.3 Add guardrails in code review guidance or supporting docs so future schema work follows the migration/bootstrap/readiness split.
- [ ] 5.4 Document any intentionally retained bootstrap-owned seed/default data and why it is not a migration yet.
- [ ] 5.5 Reconfirm that `platform-learning-panel` can resume Phase 5 work on top of the hardened platform.

### Quality Gate
Before marking the effort complete, ALL of the following must pass:

- [ ] **Lint**: `pnpm lint`
- [ ] **Build**: `pnpm build`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api run test:unit`
- [ ] **E2E Tests**:
  - `BASE_URL=http://localhost:7101 pnpm --filter @divinr/e2e exec playwright test tests/learning-panel/smoke.spec.ts --project=learning-panel`
  - `BASE_URL=http://localhost:7101 pnpm --filter @divinr/e2e run e2e --project=smoke`
- [ ] **Curl Tests**:
  - `pnpm --filter @divinr/api run bootstrap:schema`
  - `curl -sS --max-time 5 http://127.0.0.1:7100/health`
  - `curl -sS -H "Authorization: Bearer $DIVINR_TOKEN" http://127.0.0.1:7100/api/learning-panel/bootstrap`
- [ ] **Chrome Tests**:
  - Fresh local start: bootstrap, launch API/web, load the authenticated shell, and confirm no bootstrap `500`s or deadlock noise.
  - Resume the shell-integrated Learning Panel flow and confirm the stabilized backend still supports the current panel behavior.
- [ ] **Phase Review**: Compare implementation against Phase 5 objectives in the PRD
  - [ ] Did we accomplish what we said we would?
  - [ ] Does the code align with the PRD requirements?
  - [ ] Are there any deviations? If so, document why.
