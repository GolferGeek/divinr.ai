# User-Scoped Platform — Product Requirements Document

## 1. Overview

Divinr.ai currently scopes all data and access control through `organization_slug`, inherited from the Orchestrator AI multi-tenant architecture. This effort removes that layer entirely and replaces it with `user_id`-based ownership for user-created resources, while system-owned resources (base analysts, base instruments, base sources) become globally accessible without any org filter.

This is prerequisite work. Every upcoming B2C feature (affinity, notifications, billing) needs per-user scoping. Building those on top of the org abstraction means threading a meaningless `organizationSlug` through every new feature.

## 2. Goals & Success Criteria

| Goal | Success Criterion |
|------|-------------------|
| Eliminate `organization_slug` from the codebase | Zero references to `organization_slug` in any service, controller, schema DDL, or frontend file |
| User-owned resources scoped by `user_id` | All queries for user-created resources (custom analysts, custom instruments, custom sources, portfolios, trade decisions) filter by `user_id` |
| System resources globally accessible | Base analysts, base instruments, base sources accessible to all authenticated users without scoping |
| Simplified auth flow | `resolveIdentity()` returns only `userId` from JWT — no org resolution, no `x-org-slug` header |
| Simplified RBAC | Roles are per-user (`admin`, `subscriber`, `beta_reader`) — no per-org role assignments |
| Frontend cleaned up | No `divinr_org` in localStorage, no `organizationSlug` in `useApi()`, no org selection in login |
| No regressions | All existing tests pass after migration |
| Shared results follow parent ownership | Predictions, risk debates, evaluations inherit access from the instrument/analyst they reference |

## 3. User Stories / Use Cases

**Subscriber (paying user)**
- Signs up, gets a JWT with `user_id`. No org selection step.
- Sees all base analysts and base instruments immediately.
- Creates custom analysts and instruments — these are private to them.
- Runs orchestration on any instrument they have access to (base or their own).
- Views predictions, risk assessments, and trade recommendations scoped to instruments they can access.

**Beta Reader (invited read-only user)**
- Logs in, sees base analysts and base instruments.
- Cannot create or modify resources.
- Can view predictions and risk assessments for base instruments.

**Platform Admin**
- Full access to all resources (system and user-owned).
- Can manage base analysts, instruments, and sources.
- Can view any user's resources for support purposes.

## 4. Technical Requirements

### 4.1 Architecture

**Ownership model**: Two categories of resources:

| Category | Identified by | Access |
|----------|--------------|--------|
| System-owned | `user_id IS NULL` | All authenticated users |
| User-owned | `user_id = <creator>` | Only the owning user (+ admins) |

No intermediate org layer. No `owner_type` discriminator needed — `NULL` user_id = system.

**Resource classification**:
- **System-owned**: base analysts (seeded), base instruments (seeded), base sources, risk debate contexts (seeded), position sizing config (global), risk dimensions (seeded)
- **User-owned**: custom analysts, custom instruments, user portfolios, user positions, user trade decisions, user trade queue, learning proposals, analyst portfolios, analyst positions
- **Derived (inherit from parent)**: orchestration runs → from instrument owner; predictions, risk assessments, risk debates, run evaluations, run replays, run artifacts → from run; market articles → system (sourced externally); prediction horizon evaluations, analyst performance profiles → from analyst; canonical test days → from instrument

### 4.2 Data Model Changes

**31 tables in `prediction` schema** currently have `organization_slug`. Changes per table:

**Add `user_id` column (ownership tables)**:
- `instruments` — add `user_id TEXT` (NULL = system/base). Drop unique `(organization_slug, symbol)`, replace with unique `(user_id, symbol)` where `user_id IS NULL` uses a partial unique index for system instruments.
- `market_analysts` — add `user_id TEXT` (NULL = system/base). Drop unique `(organization_slug, slug)`, replace with unique `(user_id, slug)`.
- `market_instrument_analyst_assignments` — drop composite PK `(organization_slug, instrument_id, analyst_id)`, replace with PK `(instrument_id, analyst_id)`.
- `risk_dimensions` — add `user_id TEXT` (NULL = system). Drop unique `(organization_slug, slug)`, replace with unique `(user_id, slug)`.
- `risk_debate_contexts` — add `user_id TEXT` (NULL = system). Drop unique `(organization_slug, role, version)`, replace with unique `(user_id, role, version)`.
- `learning_proposals` — add `user_id TEXT`. Drop index on `(organization_slug, status)`, replace with `(user_id, status)`.
- `canonical_test_days` — add `user_id TEXT`. Replace index.
- `analyst_portfolios` — add `user_id TEXT`. Replace index on `(analyst_id, organization_slug)` with `(analyst_id, user_id)`.
- `analyst_positions` — no change needed (FK to portfolio).
- `user_portfolios` — already has `user_id`. Drop unique `(user_id, organization_slug)`, make `user_id` the unique key (one portfolio per user).
- `user_positions` — no change needed (FK to portfolio).
- `audit_findings` — add `user_id TEXT`. Drop org index.
- `user_trade_decisions` — add `user_id TEXT`. Drop org scope.
- `user_trade_queue` — add `user_id TEXT`. Drop org scope.
- `prediction_challenges` — add `user_id TEXT`. Drop org scope.
- `analyst_risk_assessments` — add `user_id TEXT`. Drop org scope.

**Drop `organization_slug` only (derived/referenced tables)**:
- `orchestration_runs` — drop `organization_slug` from unique index on queued runs. Access derived from instrument ownership.
- `market_predictors` — drop `organization_slug` from index. Scoped by instrument_id + analyst_id.
- `market_predictions` — already indexed by `instrument_id`. No org needed.
- `market_risk_assessments` — scoped by `run_id`. Drop org.
- `risk_dimension_assessments` — drop `organization_slug` from index. Scope by instrument_id.
- `risk_composite_scores` — drop `organization_slug` from index. Scope by instrument_id.
- `risk_debates` — scoped by `run_id`. Drop org.
- `market_run_evaluations` — scoped by `run_id`. Drop org.
- `market_run_replays` — scoped by `run_id`. Drop org.
- `market_run_artifacts` — scoped by `run_id`. Drop org.
- `market_articles` — `external_organization_slug` is nullable and references external source, not internal org. Rename to `external_source_slug` for clarity.
- `analyst_config_versions` — scoped by `analyst_id`. Drop org.
- `prediction_horizon_evaluations` — scoped by `analyst_id`. Drop org.
- `analyst_performance_profiles` — scoped by `analyst_id`. Drop org.

**Replace entirely**:
- `org_learning_config` — PK is currently `organization_slug`. Convert to `user_learning_config` with PK `user_id`, or make it a single system-level config row.
- `position_sizing_config` — currently keyed by `organization_slug` with `*` for global. Remove org column; keep as system-level config.

**RBAC tables (authz schema)**:
- `authz.rbac_user_org_roles` → rename to `authz.rbac_user_roles`. Drop `organization_slug` from PK. New PK: `(user_id, role_id)`.
- `authz.organizations` → drop table (no longer needed).
- `authz.users` → drop `organization_slug` column.
- Simplify roles to: `admin` (platform admin), `subscriber` (paying user), `beta_reader` (read-only).
- `rbac_has_permission` RPC → remove `p_organization_slug` parameter. Check `(user_id, role_id, permission_id)` only.

### 4.3 API Changes

**Controller (`markets.controller.ts`)**:
- Remove `resolveIdentity()` method entirely.
- Replace with simple `getUserId(req)` that returns `user.id` from JWT.
- Remove `@Query('organizationSlug')` from all GET endpoints.
- Remove `organizationSlug` from all POST/PUT request bodies.
- Remove `x-org-slug` header handling from all endpoints.
- Remove `requireWriteAccess(user, organizationSlug)` — replace with role-based check using `requireWriteAccess(user)` (checks user's global role).

**Auth controller (`auth.controller.ts`)**:
- `/auth/me` — remove `x-org-slug` header dependency. Return user profile with global role.
- `/auth/login` — unchanged (already returns JWT with user_id).

**Service methods (`markets.service.ts` and all services in `markets/services/`)**:
- Drop `organizationSlug` parameter from all method signatures.
- Replace `WHERE organization_slug = $1` with either:
  - `WHERE user_id = $1` (user-owned resources)
  - No filter (system resources — list all)
  - `WHERE user_id IS NULL OR user_id = $1` (combined listing of system + user resources)
- `requireRead(userId)` / `requireWrite(userId)` — check global role, not per-org.
- `buildExecutionContext()` — remove `orgSlug` from execution context.

### 4.4 Frontend Changes

**Tenant store (`tenant.store.ts`)**:
- Remove `orgSlug` ref and `divinr_org` localStorage key.
- Remove `orgRole` ref and `divinr_org_role` localStorage key.
- Add `role` ref with `divinr_role` localStorage key (global role from `/auth/me`).
- Rename to `useAuthStore` (it's no longer about tenancy).
- `setTenant()` → `setAuth(userId, jwt, role)`.
- `isConfigured()` → check `userId` only (no org).

**useApi composable (`useApi.ts`)**:
- Remove `x-org-slug` header from `getHeaders()`.
- Remove `appendOrg()` function — GET URLs no longer need `organizationSlug` query param.
- Remove `organizationSlug` injection from POST body in `post()`.

**Auth bootstrap (`bootstrap-auth.ts`)**:
- Remove `VITE_DEFAULT_ORG_SLUG` env var usage.
- Remove org derivation logic (`personal-${email.split('@')[0]}`).
- `/auth/me` call drops `x-org-slug` header.
- `setTenant()` → `setAuth(me.id, login.accessToken, me.role)`.

**Router guard (`router/index.ts`)**:
- Check `divinr_user` only (no `divinr_org` check).

**Component files** referencing `organizationSlug`:
- Remove org from any component that passes it to API calls.

### 4.5 Infrastructure Requirements

- **Database migration**: Must be additive-first. Add `user_id` columns, backfill, validate, then drop `organization_slug` columns. No big-bang DDL.
- **Backfill strategy**: For existing data seeded with `organization_slug = 'personal-golfergeek'`, map to the corresponding `user_id` from `authz.users`. System/base resources get `user_id = NULL`.
- **Supabase RPC**: Update `rbac_has_permission` function to remove org parameter.
- **No downtime required**: This is a dev-stage product with seeded data only. Migration can be destructive if needed, but additive approach is safer for the pattern.

## 5. Non-Functional Requirements

- **Performance**: No new performance requirements. Replacing `WHERE organization_slug = $1` with `WHERE user_id = $1` is equivalent. Indexes must be updated to match new query patterns.
- **Security**: User-owned resources must not be accessible by other non-admin users. All resource access must validate `user_id` matches the requesting user or the resource is system-owned.
- **Compatibility**: Breaking change to all API endpoints. Frontend and backend must be updated together. No backward compatibility needed (dev-stage product, no external consumers).
- **Testing**: All existing tests must pass after migration. Service tests that pass `organizationSlug` must be updated to pass `userId`.

## 6. Out of Scope

- **Team/group sharing** — if needed later, add a group layer on top of users.
- **Billing integration** — that's the power-user-expansion effort.
- **New user-facing features** (affinity, notifications) — those come after this cleanup.
- **Multi-user collaboration** — not a current product requirement.
- **Data migration for production users** — dev-stage only, seeded data can be re-seeded.

## 7. Dependencies & Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Wide blast radius (31 tables, ~28 service files, 7+ frontend files) | High — touches every layer | Phase the work: schema → services → controllers → frontend → cleanup. Each phase leaves the system functional. |
| Composite primary keys reference `organization_slug` | Medium — DDL changes can break FK chains | Map all FK dependencies before starting. Drop constraints, migrate, re-add. |
| RBAC RPC function (`rbac_has_permission`) is called from multiple services | Medium — signature change breaks all callers | Update RPC and all callers in the same phase. |
| Seed data assumes org-scoped structure | Low — re-seeding is routine | Update all seed SQL files in the schema phase. |
| `ensureSchema()` is re-entrant (uses `IF NOT EXISTS`) | Low risk, high leverage — schema changes via `ensureSchema()` are safe to re-run | Leverage this for additive column additions. Column drops need explicit `ALTER TABLE DROP COLUMN`. |
| Test coverage gaps | Medium — untested paths may break silently | Run full test suite after each phase. Add tests for user-scoped access control. |

## 8. Phasing

### Phase 1: Schema Migration
**Goal**: Add `user_id` columns alongside `organization_slug`. Update `ensureSchema()` DDL. Backfill data. Update seed files.

**What changes**:
- `markets-schema.service.ts`: Add `user_id` columns to all ownership tables. Add new indexes on `user_id`. Keep `organization_slug` columns (dual-column period).
- Seed SQL files: Add `user_id` values alongside `organization_slug`.
- Backfill script: Map existing `organization_slug` values to `user_id` via `authz.users`.

**Validation gate**: `ensureSchema()` runs successfully. All tables have both `organization_slug` and `user_id` columns. Existing queries still work unchanged.

### Phase 2: Service Layer
**Goal**: Update all service methods to accept `userId` instead of `organizationSlug`. Queries use `user_id` for filtering.

**What changes**:
- `markets.service.ts` and all services in `markets/services/`: Change method signatures from `(organizationSlug, userId)` to `(userId)`. Update SQL queries from `WHERE organization_slug = $1` to `WHERE user_id = $1` or `WHERE user_id IS NULL OR user_id = $1`.
- `requireRead()` / `requireWrite()`: Simplify to user-role checks without org.
- `buildExecutionContext()`: Remove `orgSlug` from context.
- RBAC service: Update `hasPermission()` to drop `organizationSlug` parameter. Update `rbac_has_permission` RPC.

**Validation gate**: All service-level tests pass with `userId`-based scoping. System resources accessible without user filter. User resources properly isolated.

### Phase 3: Controller & Auth
**Goal**: Remove org resolution from controllers and auth flow. API endpoints no longer accept `organizationSlug`.

**What changes**:
- `markets.controller.ts`: Remove `resolveIdentity()`. Remove `organizationSlug` from all endpoint parameters. Call services with `userId` only.
- `auth.controller.ts`: `/auth/me` returns global role, no org context.
- `auth.middleware.ts`: No changes needed (already extracts user from JWT).
- `requireWriteAccess()`: Check global role only.
- RBAC tables: Rename `rbac_user_org_roles` → `rbac_user_roles`. Drop org column.

**Validation gate**: API endpoints work without `organizationSlug` parameter. Auth flow returns user with global role. All controller tests pass.

### Phase 4: Frontend
**Goal**: Remove all org references from the frontend.

**What changes**:
- `tenant.store.ts`: Remove `orgSlug`, `orgRole`, rename to auth store. Update `setTenant` → `setAuth`.
- `useApi.ts`: Remove `x-org-slug` header, `appendOrg()`, and org body injection.
- `bootstrap-auth.ts`: Remove org selection, update `/auth/me` call.
- `router/index.ts`: Guard checks `userId` only.
- All components: Remove `organizationSlug` from API call payloads.

**Validation gate**: Frontend loads, authenticates, and displays data without any org references. All pages functional.

### Phase 5: Cleanup
**Goal**: Remove all `organization_slug` columns, drop dual-column code, clean up artifacts.

**What changes**:
- `markets-schema.service.ts`: Remove `organization_slug` from all DDL. Drop columns via `ALTER TABLE DROP COLUMN`.
- Drop `authz.organizations` table.
- Remove any remaining `organization_slug` references from seed files.
- Update all test fixtures to remove org references.
- Remove `VITE_DEFAULT_ORG_SLUG` from env files.
- Final grep for `organization_slug`, `orgSlug`, `org_slug`, `divinr_org`, `x-org-slug` — zero hits.

**Validation gate**: Full test suite passes. `grep -r "organization_slug\|orgSlug\|org_slug\|divinr_org\|x-org-slug" apps/ packages/` returns zero results. Application runs end-to-end.
