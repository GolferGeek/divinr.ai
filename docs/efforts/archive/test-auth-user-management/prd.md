# Test: Auth & User Management — Product Requirements Document

## 1. Overview

Systematically verify that authentication, authorization, invite signup, and user-scoped data isolation all work correctly in production. This is a testing + marketing effort — no new features. The deliverables are: confirmed working flows, fixed bugs found during testing, and a marketing blurb for the auth/user story.

## 2. Goals & Success Criteria

- **G1**: Login flow works end-to-end in Chrome: email/password → JWT → dashboard → data loads → logout clears state
- **G2**: Invite signup works: valid token → account created with beta_reader role → auto-login → read-only access enforced
- **G3**: RBAC enforcement verified: super-admin/owner/admin/member can write, beta_reader gets 403 on all mutations
- **G4**: User scoping verified: User A cannot see User B's instruments, portfolios, runs, or analysts
- **G5**: Session management verified: expired tokens redirect to login, refresh extends session, logout clears localStorage
- **G6**: Marketing blurb written for auth/user features

**Success criteria:**
- All Chrome test scenarios pass without bugs
- Any bugs found are fixed before marking complete
- Marketing blurb captures the security story in 2-3 sentences

## 3. User Stories / Use Cases

**UC1 — Login cycle**: User navigates to divinr.ai, enters credentials, lands on dashboard with their data, logs out, state is cleared.

**UC2 — Invite signup**: Admin creates an invite, new user clicks the invite link, signs up, lands on a read-only dashboard. Cannot create instruments, queue runs, or modify anything.

**UC3 — Beta reader blocked**: Beta reader clicks every write action (create club, queue analysis, edit contract) and sees "Read Only" or 403 errors.

**UC4 — User isolation**: Two users exist. User A logs in and sees only their data. User B's instruments/runs/portfolios are invisible.

**UC5 — Token refresh**: User stays on the page past token expiry. Next API call triggers refresh automatically and continues working.

## 4. Technical Requirements

### 4.1 Architecture
No architecture changes. This effort verifies existing auth infrastructure.

### 4.2 Data Model Changes
None.

### 4.3 API Changes
None — testing existing endpoints:
- `POST /auth/login` — email/password → JWT
- `POST /auth/refresh` — refreshToken → new JWT
- `POST /auth/logout` — invalidate session
- `GET /auth/me` — current user info + role
- `POST /auth/invites` — create invite (admin)
- `GET /auth/invites` — list invites (admin)
- `DELETE /auth/invites/:id` — revoke invite (admin)
- `GET /auth/invites/:token/validate` — check invite token
- `POST /auth/signup-with-invite` — claim invite + create account

### 4.4 Frontend Changes
Bug fixes only if Chrome testing reveals issues.

### 4.5 Infrastructure Requirements
None.

## 5. Non-Functional Requirements

- **Security**: Verify no cross-user data leakage. Verify beta readers truly cannot mutate.
- **Reliability**: Token refresh must not break mid-session.

## 6. Out of Scope

- Password reset (not implemented)
- OAuth/SSO (not implemented)
- New auth features — this is testing only

## 7. Dependencies & Risks

**Dependencies:** Two test users must exist in Supabase (demo-user and golfergeek). Both are present.

**Risks:**
| Risk | Mitigation |
|------|------------|
| Token expiry hard to test manually | Use short-lived token or wait for natural expiry |
| No beta_reader user exists to test | Create one via invite flow during testing |

## 8. Phasing

### Phase 1 — API Verification (curl tests)
- Test all 9 auth endpoints via curl with valid/invalid inputs
- Verify RBAC: login as each role, attempt write operations
- Verify user scoping: login as user A, attempt to access user B's data
- **Gate**: All endpoints return expected responses

### Phase 2 — Chrome Testing
- Walk through login → dashboard → logout in browser
- Create invite, sign up as beta reader, verify read-only
- Verify no cross-user data visible
- Verify token refresh on session continuation
- **Gate**: All browser flows work without errors

### Phase 3 — Bug Fixes & Marketing
- Fix any bugs found in Phases 1-2
- Write marketing blurb (2-3 sentences on security/auth story)
- **Gate**: Clean test pass, marketing blurb written
