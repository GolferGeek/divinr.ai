# Test: Auth & User Management — Implementation Plan

**PRD**: ./prd.md
**Created**: 2026-04-13
**Status**: In Progress

## Progress Tracker
- [x] Phase 1: API Verification
- [ ] Phase 2: Chrome Testing
- [ ] Phase 3: Bug Fixes & Marketing

---

## Phase 1: API Verification
**Status**: Complete
**Note**: Found and fixed 2 bugs: (1) user profile created in wrong schema (public.users → authz.users), (2) invite signup emailConfirm was false, preventing login
**Objective**: Verify all 9 auth endpoints via curl, RBAC enforcement per role, and user data isolation.

### Steps
- [ ] 1.1 Test login: `POST /auth/login` with valid credentials → 200 with accessToken, refreshToken
- [ ] 1.2 Test login with bad password → 401
- [ ] 1.3 Test `GET /auth/me` with valid token → 200 with user info + role
- [ ] 1.4 Test `GET /auth/me` without token → 401
- [ ] 1.5 Test `POST /auth/refresh` with valid refreshToken → 200 with new tokens
- [ ] 1.6 Test `POST /auth/logout` → clears session
- [ ] 1.7 Test invite flow: create invite (`POST /auth/invites`), validate token (`GET /auth/invites/:token/validate`), signup (`POST /auth/signup-with-invite`)
- [ ] 1.8 Test RBAC: login as beta_reader, attempt a write endpoint (e.g., `POST /clubs`) → 403 "Read-only access"
- [ ] 1.9 Test user scoping: login as user A, call `GET /markets/instruments` → only user A's data. Login as user B → only user B's data. Attempt to access user A's instrument by ID as user B → not returned.

### Quality Gate
- [ ] **All curl tests pass**: Every endpoint returns expected status code and shape
- [ ] **RBAC verified**: beta_reader gets 403 on write, member/admin/owner can write
- [ ] **User isolation verified**: No cross-user data leakage
- [ ] **Phase Review**: All PRD Phase 1 items covered

---

## Phase 2: Chrome Testing
**Status**: In Progress
**Note**: Steps 2.1-2.3 verified (login → dashboard → user name displays). Remaining: logout, invite signup in browser, beta reader UI, cross-user check.
**Objective**: Walk through auth flows in the browser to verify UI behavior.

### Steps
- [ ] 2.1 Navigate to divinr.ai → redirected to login page (no saved session)
- [ ] 2.2 Login with valid credentials → lands on dashboard with data
- [ ] 2.3 Verify user name displays in header
- [ ] 2.4 Click logout → redirected to login, state cleared
- [ ] 2.5 Login again → verify auto-login works (tokens in localStorage)
- [ ] 2.6 Create an invite via API (`POST /auth/invites`) → get invite token
- [ ] 2.7 Navigate to `/signup/:token` → invite signup form loads
- [ ] 2.8 Sign up as beta reader → auto-login, dashboard loads
- [ ] 2.9 As beta reader, attempt write actions (create club, queue analysis) → "Read Only" shown or action blocked
- [ ] 2.10 Verify no cross-user data visible (switch between users)

### Quality Gate
- [ ] **Chrome Tests**: All 10 browser scenarios pass
- [ ] **Screenshots**: Key flows documented
- [ ] **Phase Review**: All PRD Phase 2 items covered

---

## Phase 3: Bug Fixes & Marketing
**Status**: Not Started
**Objective**: Fix any bugs found, write marketing blurb.

### Steps
- [ ] 3.1 Fix any bugs discovered in Phases 1-2
- [ ] 3.2 Re-run failed tests to verify fixes
- [ ] 3.3 Write marketing blurb (2-3 sentences) covering: secure per-user accounts, invite-only beta access, role-based permissions. Save to `docs/efforts/current/test-auth-user-management/marketing-blurb.md`

### Quality Gate
- [ ] **Build**: `cd apps/api && pnpm run build` — clean
- [ ] **Lint**: `cd apps/api && pnpm run lint` — clean
- [ ] **Unit Tests**: `cd apps/api && pnpm run test:unit` — zero failures
- [ ] **All Phase 1+2 tests pass**: No regressions
- [ ] **Marketing blurb written**: Captures auth/security story
- [ ] **Phase Review**: All PRD Phase 3 items covered
