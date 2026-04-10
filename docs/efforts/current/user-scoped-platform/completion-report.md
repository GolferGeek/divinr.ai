# User-Scoped Platform — Completion Report

**Plan**: [plan.md](plan.md)
**PRD**: [prd.md](prd.md)
**Completed**: 2026-04-10
**Final Status**: All Phases Complete

## Summary
- Total phases: 5
- Phases completed: 5
- Phases remaining: 0

## Phase Results

### Phase 1: Schema Migration — Complete
- Added `user_id` columns to all 12 ownership tables
- Renamed `org_learning_config` → `learning_config`, updated `position_sizing_config`
- Renamed `market_articles.external_organization_slug` → `external_source_slug`
- Updated seed files with `user_id` values
- Backfill method mapped `organization_slug` → `user_id` via `authz.users`

### Phase 2: Service Layer — Complete
- Removed `organizationSlug` from all service method signatures (~340 references in `markets.service.ts`, ~250+ across 24 sub-services)
- Updated SQL queries: ownership tables use `WHERE user_id = $1` or `WHERE (user_id IS NULL OR user_id = $1)`, derived tables removed org filtering
- Updated RBAC service: `hasPermission(userId, permission)` without org
- Updated ExecutionContext: removed `orgSlug` field
- Updated observability, LLM, auth, and invite services
- Updated all unit tests (13 files), compliance tests, smoke tests, integration fixtures, and scripts
- Made `organization_slug` nullable on all tables (dual-column period)
- Updated `rbac_has_permission` RPC to drop `p_organization_slug` parameter

### Phase 3: Controller & Auth — Complete
- Removed `resolveIdentity()` from markets controller
- Removed `@Query('organizationSlug')`, `@Headers('x-org-slug')`, and org from `@Body()` DTOs across all ~40 endpoints
- Updated `requireWriteAccess()` to check global role without org
- Updated auth controller: `/auth/me` returns global role
- Renamed `authz.rbac_user_org_roles` → `authz.rbac_user_roles`, PK now `(user_id, role_id)`
- Dropped `authz.organizations` table
- Updated curl test scripts

### Phase 4: Frontend — Complete
- Created `auth.store.ts` replacing `tenant.store.ts`
- Removed `x-org-slug` header from `useApi`
- Removed `appendOrg()` function and org injection from API calls
- Updated auth bootstrap, router guard, all views and components
- Removed `VITE_DEFAULT_ORG_SLUG` from `.env`

### Phase 5: Cleanup — Complete
- Dropped `organization_slug` from all 34 prediction-schema tables + `authz.users`
- Removed org-scoped indexes and constraints
- Removed `organization_slug` from all `CREATE TABLE` definitions
- Replaced backfill code with column-drop migration
- Deleted stale schema backup file
- Final grep: zero functional references remain (only external DB schemas and migration DDL)

## Gate Results

| Gate | Phase 1 | Phase 2 | Phase 3 | Phase 4 | Phase 5 |
|------|---------|---------|---------|---------|---------|
| Build | Pass | Pass | Pass | Pass | Pass |
| Lint | Pass | Pass | Pass | Pass | Pass |
| Typecheck | Pass | Pass | Pass | Pass | Pass* |
| Unit Tests | Pass | Pass | Pass | Pass | Pass |
| Compliance | Pass | 14/14 | 14/14 | 14/14 | 14/14 |
| Planes | Pass | Pass | Pass | Pass | Pass |
| Smoke | N/A | 7/7 | N/A | N/A | 7/7 |

*Web vue-tsc has pre-existing errors unrelated to this effort

## Deviations from PRD
1. **Chrome/E2E tests deferred**: Browser-based verification of login flow, dashboard, and network traffic requires manual testing with running dev servers. All automated tests pass.
2. **`orchestrator-base-data.service.ts` retains org references**: 2 SQL queries read from an external orchestrator database schema that still uses `organization_slug`. This is outside our control.
3. **`external_source_slug` column retained**: The `market_articles.external_source_slug` column (renamed from `external_organization_slug`) references external data sources, not internal org scoping.
4. **Compliance harness creates its own authz tables**: The compliance test infrastructure manages separate auth tables for testing. These still have `organization_slug` in some places for backward compatibility.

## Next Steps
- Run Chrome/E2E tests manually to verify frontend flow
- Monitor for any runtime issues with the new user-scoped queries
- Proceed to next effort (affinity scoring or fear/greed index per roadmap)
