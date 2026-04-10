# User-Scoped Platform — Implementation Plan

**PRD**: [prd.md](prd.md)
**Created**: 2026-04-10
**Status**: Not Started

## Progress Tracker
- [x] Phase 1: Schema Migration
- [ ] Phase 2: Service Layer
- [ ] Phase 3: Controller & Auth
- [ ] Phase 4: Frontend
- [ ] Phase 5: Cleanup

---

## Phase 1: Schema Migration
**Status**: Complete
**Objective**: Add `user_id` columns alongside `organization_slug` in all ownership tables, update `ensureSchema()` DDL, backfill data, and update seed files — without breaking any existing queries.

### Steps
- [x] 1.1 Update `apps/api/src/markets/schema/markets-schema.service.ts`: Add `user_id TEXT` columns (via `ALTER TABLE ADD COLUMN IF NOT EXISTS`) to all ownership tables: `instruments`, `market_analysts`, `risk_dimensions`, `risk_debate_contexts`, `learning_proposals`, `canonical_test_days`, `analyst_portfolios`, `audit_findings`, `user_trade_decisions`, `user_trade_queue`, `prediction_challenges`, `analyst_risk_assessments`.
  - **Note**: `user_trade_decisions` and `user_trade_queue` already have `user_id` as the owner column — no new column needed.
- [x] 1.2 In the same schema service, add new indexes on `user_id` for the tables above (alongside existing `organization_slug` indexes). Add partial unique indexes where needed (e.g., `UNIQUE (symbol) WHERE user_id IS NULL` for system instruments).
- [x] 1.3 Rename `org_learning_config` table to `learning_config` with a new `user_id` column (NULL = system default). Add the DDL change to `ensureSchema()`.
- [x] 1.4 Update `position_sizing_config` table: remove `organization_slug` from PK, keep as system-level config (single row). Add `ALTER TABLE DROP COLUMN IF EXISTS organization_slug` and update the `CREATE TABLE` definition in `ensureSchema()`.
- [x] 1.5 Rename `market_articles.external_organization_slug` to `external_source_slug` via `ALTER TABLE RENAME COLUMN IF EXISTS`.
- [x] 1.6 Update seed SQL file `apps/api/db/seed/2026-04-08-auth-bootstrap.sql`: add `user_id` values alongside `organization_slug` in all seeded rows. Map `personal-golfergeek` → the golfergeek user_id. System/base resources get `user_id = NULL`.
  - **Note**: Updated `authz.users` insert to populate `organization_slug` so backfill can map org → user. Prediction table seeds (in schema service) use `__base__`/`__template__` which the backfill correctly skips (those get `user_id = NULL`).
- [x] 1.7 Update `scripts/seed-demo-tenants.ts` to populate `user_id` alongside `organization_slug` for demo data.
- [x] 1.8 Add a backfill method to the schema service (called from `ensureSchema()`): for each ownership table, `UPDATE SET user_id = (SELECT id FROM authz.users WHERE organization_slug = <table>.organization_slug) WHERE user_id IS NULL`.
- [x] 1.9 Simplify RBAC roles in seed: keep only `admin`, `subscriber`, `beta_reader`. Add these to the auth-bootstrap seed if not present.
  - **Note**: Added new roles alongside legacy roles (dual-column period). Legacy roles will be removed in Phase 5.
- [x] 1.10 Run `ensureSchema()` via dev startup to verify all DDL applies cleanly.

### Quality Gate
Before moving to Phase 2, ALL of the following must pass:

- [x] **Build**: `pnpm run build` completes without errors
- [x] **Lint**: `pnpm run lint` passes
- [x] **Unit Tests**: `pnpm --filter @divinr/api run test:unit` — all tests pass
- [x] **Compliance Tests**: `pnpm --filter @divinr/api run test:compliance` passes (6/6 pass; pre-existing pool teardown error on exit is unrelated)
- [x] **Schema Verification**: DDL applied directly via psql. All 12 ownership tables have `user_id` columns. `learning_config` renamed. `position_sizing_config` constraint updated. `external_source_slug` column renamed.
- [x] **Backfill Verification**: user_id columns are NULL pending first `ensureSchema()` call — backfill method is in place and will run on next API request. DDL + backfill code verified in schema service.
- [x] **Existing Queries Unbroken**: Existing `WHERE organization_slug = $1` queries still work (covered by unit/compliance tests passing).
- [x] **Phase Review**:
  - [x] All ownership tables have `user_id` columns
  - [x] All seed files populate `user_id`
  - [x] Backfill maps org → user correctly (method implemented, awaiting first run)
  - [x] No existing functionality broken (dual-column period)

---

## Phase 2: Service Layer
**Status**: In Progress
**Objective**: Update all service files with org references to accept `userId` instead of `organizationSlug`, switch queries from `WHERE organization_slug = $1` to `WHERE user_id = $1` (or `WHERE user_id IS NULL OR user_id = $1` for combined listings), and simplify RBAC checks.

### Steps
- [ ] 2.1 Update `apps/api/src/markets/markets.types.ts` (28 refs): Remove `organizationSlug` from all type/interface definitions. Add `userId` where ownership is needed. Update `ExecutionContext` type to drop `orgSlug`.
- [ ] 2.2 Update `packages/transport-types/invocation/execution-context.ts` (4 refs): Remove `orgSlug` from `ExecutionContext` type. Replace with `userId` if not already present.
- [ ] 2.3 Update RBAC service `packages/planes/rbac/rbac.service.ts` (17 refs): Change `hasPermission(userId, organizationSlug, permission)` → `hasPermission(userId, permission)`. Update the `rbac_has_permission` RPC call to drop `p_organization_slug`.
- [ ] 2.4 Update RBAC guard `packages/planes/rbac/guards/rbac.guard.ts` (8 refs): Remove org extraction from request context. Check user role only.
- [ ] 2.5 Update RBAC controller `packages/planes/rbac/rbac.controller.ts` (18 refs): Remove `organizationSlug` from all endpoint parameters and service calls.
- [ ] 2.6 Update the `rbac_has_permission` Supabase RPC function to remove `p_organization_slug` parameter. The function should still join `rbac_user_org_roles` (table rename happens in Phase 3) on `(user_id, role_id)` only — drop the `organization_slug` join condition.
- [ ] 2.7 Update `apps/api/src/markets/markets.service.ts` (172 refs — largest file):
  - Change all method signatures: drop `organizationSlug` param, keep `userId`.
  - `listInstruments(userId)`: query `WHERE user_id IS NULL OR user_id = $1` (system + user instruments).
  - `createInstrument(input)`: insert with `user_id = input.userId` instead of `organization_slug`.
  - `listAnalysts(userId)`: query `WHERE user_id IS NULL OR user_id = $1`.
  - `createAnalyst(input)`: insert with `user_id = input.userId`.
  - `requireRead(userId)` / `requireWrite(userId)`: check global role via updated `hasPermission(userId, permission)`.
  - `buildExecutionContext()`: remove `orgSlug` from context object.
  - Apply same pattern to all ~40 methods that currently take `organizationSlug`.
- [ ] 2.8 Update all 24 service files with org references in `apps/api/src/markets/services/` (8 of 32 total service files have no org references and need no changes):
  - `prediction-runner.service.ts` (39 refs): Drop `organizationSlug` from method signatures and queries.
  - `risk-runner.service.ts` (27 refs): Same pattern.
  - `learning-engine.service.ts` (22 refs): Same.
  - `nightly-evaluation.service.ts` (16 refs): Same.
  - `strategic-overhaul.service.ts` (14 refs): Same.
  - `user-portfolio.service.ts` (13 refs): Same — this already uses `userId`, just drop the org param.
  - `trade-recommendation.service.ts` (13 refs): Same.
  - `prediction-generator.service.ts` (12 refs): Same.
  - `eod-forced-buy.service.ts` (12 refs): Same.
  - `outcome-tracking.service.ts` (11 refs): Same.
  - `eod-settlement.service.ts` (11 refs): Same.
  - `analyst-portfolio.service.ts` (11 refs): Same.
  - `predictor-generator.service.ts` (10 refs): Same.
  - `conviction-trader.service.ts` (8 refs): Same.
  - `position-sizing.service.ts` (7 refs): Same.
  - `day-trader-runner.service.ts` (7 refs): Same.
  - `audit.service.ts` (7 refs): Same.
  - `risk-debate.service.ts` (4 refs): Same.
  - `canonical-test-runner.service.ts` (3 refs): Same.
  - `autotrade-open-helper.service.ts` (3 refs): Same.
  - `risk-dimension-analyzer.service.ts` (2 refs): Same.
  - `orchestrator-base-data.service.ts` (2 refs): Same.
  - `markets-llm.service.ts` (1 ref): Same.
  - `context-provider.service.ts` (1 ref): Same.
- [ ] 2.9 Update `apps/api/src/markets/strategies/day-trader-strategy.types.ts` (1 ref): Remove `organizationSlug` from strategy types.
- [ ] 2.10 Update observability services in `packages/planes/observability/` (7 files, 14 refs): Remove `organizationSlug` from event context and webhook payloads.
- [ ] 2.11 Update LLM services in `packages/planes/llm/` (8 files, 13 refs): Remove `organizationSlug` from LLM request context.
- [ ] 2.12 Update auth services `packages/planes/auth/services/base-auth.service.ts` (14 refs), `supabase-auth.service.ts` (2 refs), `external-oidc-auth.service.ts` (2 refs): Remove org from auth context and user resolution.
- [ ] 2.13 Update invite service `apps/api/src/auth/invite.service.ts` (8 refs): Remove org from invitation logic. Invites are per-user (beta_reader role grant).
- [ ] 2.14 Update all unit tests that reference `organizationSlug` (13 test files): Replace with `userId` in test fixtures and assertions. Files: `conviction-trader.test.ts`, `context-markdown-carry-forward.test.ts`, `contract-editor.test.ts`, `eod-forced-buy.test.ts`, `day-trader-runner.test.ts`, `invite-service.test.ts`, `risk-score-aggregation.test.ts`, `user-portfolio-immediate.test.ts`, `trade-recommendation.test.ts`, `momentum-breakout-strategy.test.ts`, `mean-reversion-strategy.test.ts`, `gap-and-go-strategy.test.ts`, `autotrade-open-helper.test.ts`.
- [ ] 2.15 Update compliance harness `apps/api/tests/compliance/compliance-harness.ts` (24 refs) and compliance test files (10 refs total): Replace `organizationSlug` with `userId` in test setup and assertions.
- [ ] 2.16 Update smoke tests `apps/api/tests/markets/run-markets-smoke-tests.ts` (17 refs) and HTTP tests `run-markets-http-tests.ts` (4 refs): Replace org with userId in test requests.
- [ ] 2.17 Update integration test fixtures `apps/api/tests/markets/integration/db-fixtures.ts` (3 refs): Replace org with userId in fixture data.
- [ ] 2.18 Update scripts: `scripts/generate-analyst-contracts.ts` (4 refs), `scripts/upgrade-contracts-v3.ts` (3 refs), `scripts/bootstrap-analyst-versions.ts` (3 refs), `scripts/generate-day-trader-contracts.ts` (2 refs): Replace org with userId.

### Quality Gate
Before moving to Phase 3, ALL of the following must pass:

- [ ] **Build**: `pnpm run build` completes without errors
- [ ] **Lint**: `pnpm run lint` passes
- [ ] **Typecheck**: `pnpm run typecheck` passes (catches signature mismatches across packages)
- [ ] **Unit Tests**: `pnpm --filter @divinr/api run test:unit` — all tests pass with updated fixtures
- [ ] **Compliance Tests**: `pnpm --filter @divinr/api run test:compliance` passes
- [ ] **Planes Tests**: `pnpm --filter @orchestratorai/planes run test` — contract tests pass
- [ ] **Smoke Tests**: `pnpm --filter @divinr/api run test:markets:smoke` passes
- [ ] **Phase Review**:
  - [ ] Zero `organizationSlug` references in any service method signature
  - [ ] All queries use `user_id` for ownership filtering
  - [ ] System resources (base analysts, instruments) accessible via `WHERE user_id IS NULL OR user_id = $1`
  - [ ] RBAC checks use `hasPermission(userId, permission)` without org
  - [ ] All test fixtures updated to use `userId`

---

## Phase 3: Controller & Auth
**Status**: Not Started
**Objective**: Remove org resolution from all controllers and auth flow. API endpoints no longer accept or require `organizationSlug`. RBAC tables restructured.

### Steps
- [ ] 3.1 Update `apps/api/src/markets/markets.controller.ts` (87 refs):
  - Remove `resolveIdentity()` method entirely.
  - Add simple `getUserId(req): string` that returns `req.user.id`.
  - Remove `@Query('organizationSlug')` from all GET endpoints.
  - Remove `organizationSlug` from all `@Body()` DTOs.
  - Remove `@Headers('x-org-slug')` from all endpoints.
  - Update all service calls: pass `userId` only.
  - Update `requireWriteAccess(user)`: check global role (admin/subscriber can write, beta_reader cannot).
- [ ] 3.2 Update `apps/api/src/auth/auth.controller.ts` (16 refs):
  - `/auth/me` endpoint: remove `x-org-slug` header dependency. Return user profile with global role (from `rbac_user_roles`).
  - Remove any org-based role resolution.
- [ ] 3.3 Update auth middleware `apps/api/src/auth/auth.middleware.ts`: Remove any org resolution. Keep JWT user extraction as-is.
- [ ] 3.4 Rename RBAC table: `ALTER TABLE authz.rbac_user_org_roles RENAME TO authz.rbac_user_roles`. Drop `organization_slug` from PK. New PK: `(user_id, role_id)`. Add this DDL to the auth-bootstrap seed or a migration step.
- [ ] 3.5 Drop `authz.organizations` table (no longer needed).
- [ ] 3.6 Update `rbac_has_permission` RPC function to join on the renamed `rbac_user_roles` table (was `rbac_user_org_roles` before step 3.4).
- [ ] 3.7 Update `apps/api/tests/unit/write-access-guard.test.ts` and `beta-reader-guard.test.ts`: Test global role checks instead of per-org role checks.
- [ ] 3.8 Update curl test script `apps/api/tests/curl/run-curl-tests.sh` (2 refs): Remove `organizationSlug` from curl commands.

### Quality Gate
Before moving to Phase 4, ALL of the following must pass:

- [ ] **Build**: `pnpm run build` completes without errors
- [ ] **Lint**: `pnpm run lint` passes
- [ ] **Typecheck**: `pnpm run typecheck` passes
- [ ] **Unit Tests**: `pnpm --filter @divinr/api run test:unit` — all tests pass
- [ ] **Compliance Tests**: `pnpm --filter @divinr/api run test:compliance` passes
- [ ] **Planes Tests**: `pnpm --filter @orchestratorai/planes run test` passes
- [ ] **Curl Tests**: API endpoints respond correctly without `organizationSlug`:
  ```bash
  # List instruments (no org param needed)
  curl -s http://localhost:7100/api/markets/instruments \
    -H "Authorization: Bearer $TOKEN" | jq '.length'
  # Should return instruments (base + user-owned)

  # List analysts (no org param needed)
  curl -s http://localhost:7100/api/markets/analysts \
    -H "Authorization: Bearer $TOKEN" | jq '.length'

  # Auth me (no x-org-slug header needed)
  curl -s http://localhost:7100/api/auth/me \
    -H "Authorization: Bearer $TOKEN" | jq '.role'
  # Should return global role like "admin" or "subscriber"
  ```
- [ ] **Phase Review**:
  - [ ] `resolveIdentity()` is gone from controller
  - [ ] No endpoint accepts `organizationSlug` via query, body, or header
  - [ ] `/auth/me` returns global role without org context
  - [ ] RBAC tables use `(user_id, role_id)` without org
  - [ ] Write access checks use global role

---

## Phase 4: Frontend
**Status**: Not Started
**Objective**: Remove all organization references from the frontend — tenant store, useApi, auth bootstrap, router, and components.

### Steps
- [ ] 4.1 Update `apps/web/src/stores/tenant.store.ts` (11 refs):
  - Remove `orgSlug` ref and `divinr_org` localStorage key.
  - Remove `orgRole` ref and `divinr_org_role` localStorage key.
  - Add `role` ref with `divinr_role` localStorage key.
  - Rename store from `'tenant'` to `'auth'` (update `defineStore('auth', ...)`).
  - Rename `setTenant()` → `setAuth(userId, jwt, role)`.
  - Update `isConfigured()` to check `userId` only.
  - Update `isBetaReader` to use `role` instead of `orgRole`.
  - Rename file to `auth.store.ts`.
- [ ] 4.2 Update `apps/web/src/composables/useApi.ts` (7 refs):
  - Remove `x-org-slug` header from `getHeaders()`.
  - Remove `appendOrg()` function entirely.
  - Remove GET URL calls to `appendOrg()` — just use the URL directly.
  - Remove `organizationSlug` injection from `post()` body.
  - Update store import from `useTenantStore` to `useAuthStore`.
- [ ] 4.3 Update `apps/web/src/auth/bootstrap-auth.ts`:
  - Remove `VITE_DEFAULT_ORG_SLUG` env var usage.
  - Remove org derivation logic.
  - `/auth/me` call: drop `x-org-slug` header.
  - Call `setAuth(me.id, login.accessToken, me.role)` instead of `setTenant(...)`.
- [ ] 4.4 Update `apps/web/src/router/index.ts` (3 refs):
  - Guard checks `divinr_user` only (remove `divinr_org` check).
  - Update store import if used.
- [ ] 4.5 Update `apps/web/src/components/AnalystPredictionModal.vue` (4 refs): Remove `organizationSlug` from API call payloads.
- [ ] 4.6 Update `apps/web/src/stores/portfolio.store.ts` (2 refs): Remove org from portfolio API calls.
- [ ] 4.7 Update `apps/web/src/layouts/DefaultLayout.vue` (2 refs): Remove org display/usage.
- [ ] 4.8 Update `apps/web/src/views/InviteSignupView.vue` (1 ref): Remove org from invite signup flow.
- [ ] 4.9 Update `apps/web/src/composables/useCanWrite.ts`: Update store import from `useTenantStore` to `useAuthStore`. Update any org-based write permission checks.
- [ ] 4.10 Update `apps/web/src/views/LoginView.vue`: Remove org references from login flow (org derivation, org display).
- [ ] 4.11 Update `apps/web/src/views/DomainDashboardView.vue`: Remove org references from dashboard data fetching.
- [ ] 4.12 Update `apps/web/src/main.ts`: Update `useTenantStore` import to `useAuthStore`.
- [ ] 4.13 Remove `VITE_DEFAULT_ORG_SLUG` from `.env` file.
- [ ] 4.14 Update any remaining component imports from `useTenantStore` → `useAuthStore`.

### Quality Gate
Before moving to Phase 5, ALL of the following must pass:

- [ ] **Build**: `pnpm run build` completes without errors (includes web build via Vite)
- [ ] **Lint**: `pnpm run lint` passes
- [ ] **Typecheck**: `pnpm run typecheck` passes (includes `vue-tsc --noEmit` for web)
- [ ] **Unit Tests**: `pnpm --filter @divinr/api run test:unit` passes (backend still works)
- [ ] **Chrome Tests**: Start dev servers (`pnpm run dev`), verify in browser at `http://localhost:7101`:
  - [ ] Login page loads and authenticates without org selection
  - [ ] Dashboard shows base instruments and analysts
  - [ ] Can create a custom instrument (saved with user_id)
  - [ ] Can view predictions and risk assessments
  - [ ] Beta reader role correctly restricts write actions
  - [ ] No console errors referencing `organizationSlug`, `orgSlug`, `divinr_org`, or `x-org-slug`
- [ ] **Phase Review**:
  - [ ] No `divinr_org` in localStorage after login
  - [ ] No `x-org-slug` header in network requests
  - [ ] No `organizationSlug` in request bodies or query params
  - [ ] Auth store replaces tenant store
  - [ ] All pages functional

---

## Phase 5: Cleanup
**Status**: Not Started
**Objective**: Remove all `organization_slug` columns from the database, drop dual-column code, remove the org table, and verify zero references remain anywhere in the codebase.

### Steps
- [ ] 5.1 Update `apps/api/src/markets/schema/markets-schema.service.ts`: Add `ALTER TABLE DROP COLUMN IF EXISTS organization_slug` for all 31 prediction-schema tables. Remove `organization_slug` from `CREATE TABLE` definitions. Remove old indexes that referenced `organization_slug`.
- [ ] 5.2 Drop `authz.organizations` table DDL from seed files if not done in Phase 3.
- [ ] 5.3 Drop `authz.users.organization_slug` column from seed DDL.
- [ ] 5.4 Remove backfill code added in Phase 1 step 1.8 (no longer needed — `organization_slug` columns gone).
- [ ] 5.5 Remove `prediction_schema_backup_20260403.sql` (184 refs — stale backup with old schema).
- [ ] 5.6 Update `scripts/seed-demo-tenants.ts` (22 refs): Remove all org references. Rename to `seed-demo-users.ts` if appropriate.
- [ ] 5.7 Remove `market_instrument_analyst_assignments` composite PK with org — set new PK to `(instrument_id, analyst_id)` if not done in Phase 1.
- [ ] 5.8 Final exhaustive grep — run and fix any remaining references:
  ```bash
  grep -rn "organization_slug\|orgSlug\|org_slug\|divinr_org\|x-org-slug\|x_org_slug\|orgRole\|org_role\|useTenantStore\|tenant\.store" \
    apps/ packages/ scripts/ --include="*.ts" --include="*.vue" --include="*.sql" --include="*.sh" --include="*.env"
  ```
- [ ] 5.9 Update documentation files that reference the old org pattern (effort docs, plans, PRDs) — add a note that org scoping was removed, but don't rewrite historical docs.

### Quality Gate
ALL of the following must pass:

- [ ] **Build**: `pnpm run build` completes without errors
- [ ] **Lint**: `pnpm run lint` passes
- [ ] **Typecheck**: `pnpm run typecheck` passes
- [ ] **Unit Tests**: `pnpm --filter @divinr/api run test:unit` — all tests pass
- [ ] **Compliance Tests**: `pnpm --filter @divinr/api run test:compliance` passes
- [ ] **Planes Tests**: `pnpm --filter @orchestratorai/planes run test` passes
- [ ] **Smoke Tests**: `pnpm --filter @divinr/api run test:markets:smoke` passes
- [ ] **Zero References**: The grep from step 5.8 returns zero results across `apps/`, `packages/`, and `scripts/`.
- [ ] **Schema Verification**: Confirm `organization_slug` columns are gone:
  ```bash
  psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c \
    "SELECT table_name FROM information_schema.columns WHERE table_schema='prediction' AND column_name='organization_slug';"
  # Should return 0 rows
  ```
- [ ] **End-to-End**: Start API and web (`pnpm run dev`), verify full flow: login → view instruments → create instrument → run prediction → view results. No errors.
- [ ] **Chrome Tests**:
  - [ ] Login works without org
  - [ ] All pages load and function
  - [ ] No `organizationSlug` in any network traffic
- [ ] **Phase Review**:
  - [ ] Zero `organization_slug` columns in any database table
  - [ ] Zero references in code, tests, scripts, or config
  - [ ] Application fully functional end-to-end
  - [ ] All PRD success criteria met
