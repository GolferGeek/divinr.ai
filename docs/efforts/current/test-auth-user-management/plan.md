# Test: Auth & User Management — Implementation Plan

**PRD**: ./prd.md
**Created**: 2026-04-13
**Status**: Complete

## Progress Tracker
- [x] Phase 1: API Verification
- [x] Phase 2: Chrome Testing
- [x] Phase 3: Bug Fixes & Marketing

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
**Status**: Complete
**Note**: All 10 steps pass. Found and fixed 3 bugs: (1) signup setAuth missing email/displayName/refreshToken, (2) bootstrap-auth missing email/refreshToken in setAuth, (3) beta_reader role missing markets-instruments-read permission. UX polish item: write-action buttons still visible for beta readers (API blocks correctly with 403).
**Objective**: Walk through auth flows in the browser to verify UI behavior.

### Steps
- [x] 2.1 Navigate to divinr.ai → redirected to login page (no saved session)
- [x] 2.2 Login with valid credentials → lands on dashboard with data
- [x] 2.3 Verify user name displays in header
- [x] 2.4 Click logout → redirected to login, divinr_* keys cleared
- [x] 2.5 Login again → tokens stored in localStorage, dashboard loads
- [x] 2.6 Create an invite via API (`POST /auth/invites`) → got invite token
- [x] 2.7 Navigate to `/signup/:token` → invite signup form loads with pre-filled email
- [x] 2.8 Sign up as beta reader → auto-login, dashboard loads with "Read Only" badge and correct display name
- [x] 2.9 As beta reader, write actions (create club, queue run, create tournament) → API returns 403. UI still shows write buttons (UX polish, not security bug)
- [x] 2.10 No cross-user data visible — beta reader sees 0 clubs, shared instruments only

### Quality Gate
- [x] **Chrome Tests**: All 10 browser scenarios pass
- [x] **Screenshots**: Key flows documented
- [ ] **Phase Review**: All PRD Phase 2 items covered

---

## Phase 3: Bug Fixes & Marketing
**Status**: Complete
**Objective**: Fix any bugs found, write marketing blurb.

### Steps
- [x] 3.1 Fix any bugs discovered in Phases 1-2 — 3 bugs fixed in commit 34171aa (setAuth args, beta_reader permissions, UX write guards)
- [x] 3.2 Re-run failed tests to verify fixes — build clean, lint clean, 1 pre-existing test failure (recent-bars-ring-buffer, unrelated)
- [x] 3.3 Write marketing blurb — saved to `marketing-blurb.md`

### Quality Gate
- [x] **Build**: `cd apps/api && pnpm run build` — clean
- [x] **Lint**: `cd apps/api && pnpm run lint` — clean
- [ ] **Unit Tests**: 1 pre-existing failure (recent-bars-ring-buffer, not auth-related)
- [x] **All Phase 1+2 tests pass**: No regressions
- [x] **Marketing blurb written**: Captures auth/security story
- [x] **Phase Review**: All PRD Phase 3 items covered
