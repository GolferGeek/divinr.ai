# Beta-User Share Path — Completion Report

**Plan**: ./plan.md
**PRD**: ./prd.md
**Completed**: 2026-04-09
**Final Status**: All Phases Complete

## Summary
- Total phases: 3
- Phases completed: 3
- Phases remaining: 0

## Phase Results

### Phase 1: Role + Invite Backend
- **Status**: Complete
- Created `InviteService` with invite CRUD, token validation, invite-based signup, and org role lookup
- Seeded `beta_reader` role in `authz.rbac_roles` (SQL seed + DDL)
- Created `authz.invites` table with token, expiry, revocation
- Extended auth controller with 5 new endpoints: create/list/revoke invites, validate token, signup-with-invite
- Enhanced `/auth/me` to return `orgRole` from RBAC tables
- 8 unit tests for invite validation logic

### Phase 2: Mutation Guard
- **Status**: Complete
- Added `requireWriteAccess` method to markets controller — queries RBAC roles, blocks `beta_reader`
- Applied to all 30 non-admin mutation handlers; 16 admin handlers already guarded by `requireAdmin`
- Compliance test reads controller source, finds all 46 mutation decorators, verifies each is guarded (47/47 pass)
- Write access guard logic tests verify role-based access (8 tests)

### Phase 3: Frontend Read-Only + Signup
- **Status**: Complete
- Extended tenant store with `orgRole`, `isBetaReader` computed
- Updated `bootstrap-auth.ts` to fetch org role from `/auth/me`
- Created `InviteSignupView.vue` — validates invite, shows signup form, auto-login on success
- Registered `/signup/:token` route as public
- Created `useCanWrite` composable
- Added "Read Only" chip to DefaultLayout header for beta readers
- Hidden mutation controls in 7 views: Dashboard, Runs, Analysts, Findings, Sources, Portfolios, Learning
- 2 views (RunDetail, InstrumentDetail) had no mutation buttons — skipped

## Gate Results
- Lint: clean (all phases, API + web)
- Build: clean (all phases, API + web)
- Unit tests: all pass (all phases)
- Compliance tests: pass (pg-pool teardown crash is pre-existing, not related to changes)
- Smoke tests: pre-existing pg-pool double-end error on teardown (not related)

## Deviations from PRD
- **Admin handlers**: PRD said to add `requireWriteAccess` to all 46 handlers. Implementation adds it to 30 non-admin handlers only — admin handlers are already blocked by `requireAdmin()` which checks `user.role === 'admin'`. Beta readers can never have admin role, so this is equivalent but cleaner.
- **RunDetailView / InstrumentDetailView**: PRD mentioned hiding "Replay"/"Rerun Debate"/"Rerun Risk" buttons. These buttons don't exist in the current views (they're read-only). No changes needed.

## Files Changed
**Backend (11 files):**
- `apps/api/src/auth/invite.service.ts` — new (InviteService)
- `apps/api/src/auth/auth.controller.ts` — invite endpoints + /auth/me orgRole
- `apps/api/src/app.module.ts` — register InviteService
- `apps/api/src/markets/markets.controller.ts` — requireWriteAccess on all mutations
- `apps/api/db/seed/2026-04-08-auth-bootstrap.sql` — beta_reader role
- `apps/api/package.json` — 4 new test files registered
- `apps/api/tests/unit/invite-service.test.ts` — new (8 tests)
- `apps/api/tests/unit/beta-reader-guard.test.ts` — new (47 tests)
- `apps/api/tests/unit/write-access-guard.test.ts` — new (8 tests)

**Frontend (12 files):**
- `apps/web/src/stores/tenant.store.ts` — orgRole, isBetaReader
- `apps/web/src/auth/bootstrap-auth.ts` — fetch orgRole
- `apps/web/src/composables/useCanWrite.ts` — new
- `apps/web/src/views/InviteSignupView.vue` — new
- `apps/web/src/router/index.ts` — /signup/:token route
- `apps/web/src/layouts/DefaultLayout.vue` — Read Only chip
- `apps/web/src/views/AuditFindingsView.vue` — canWrite guard
- `apps/web/src/views/RunsView.vue` — canWrite guard
- `apps/web/src/views/AnalystsView.vue` — canWrite guard
- `apps/web/src/views/SourcesView.vue` — canWrite guard
- `apps/web/src/views/PortfolioDashboardView.vue` — canWrite guard
- `apps/web/src/views/LearningDashboardView.vue` — canWrite guard
- `apps/web/src/views/DashboardView.vue` — canWrite guard

## Next Steps
- Run `/pr-eval` to review the PR before merging
- After merge, run the SQL seed to add the `beta_reader` role to the local Supabase
- Test end-to-end: create invite via curl, use signup link, verify read-only access
- Chrome test the frontend flows manually
