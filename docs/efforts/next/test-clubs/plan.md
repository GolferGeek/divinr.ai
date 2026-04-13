# Test: Learning Clubs — Implementation Plan

**PRD**: ../../../learning-clubs/prd.md
**Created**: 2026-04-13
**Status**: Not Started
**Depends on**: test-auth-user-management (complete)

## Progress Tracker
- [ ] Phase 1: API Verification — Club CRUD & Membership
- [ ] Phase 2: API Verification — Activities, Analytics & Rankings
- [ ] Phase 3: Chrome Testing
- [ ] Phase 4: Bug Fixes & Marketing

---

## Phase 1: API Verification — Club CRUD & Membership
**Status**: Not Started
**Objective**: Verify club creation, membership, invites, and role management via API.

### Steps
- [ ] 1.1 Create a club (`POST /clubs`) with name, description, is_public=true → 201 with id, invite_code
- [ ] 1.2 List my clubs (`GET /clubs`) → new club appears with my_role=owner
- [ ] 1.3 Get club detail (`GET /clubs/:id`) → full object with members, stats
- [ ] 1.4 Update club (`PATCH /clubs/:id`) — change description → 200
- [ ] 1.5 Create invite (`POST /clubs/:id/invites`) → returns token
- [ ] 1.6 Preview invite (`GET /clubs/invite/:token`) → club name without auth
- [ ] 1.7 Accept invite as second user (`POST /clubs/invite/:token/accept`) → joins as member
- [ ] 1.8 List members (`GET /clubs/:id/members`) → both users with roles
- [ ] 1.9 Promote member to admin (`POST /clubs/:id/members/:userId/promote`) → role updated
- [ ] 1.10 Demote admin back to member (`POST /clubs/:id/members/:userId/demote`) → role updated
- [ ] 1.11 Remove member (`DELETE /clubs/:id/members/:userId`) → member removed
- [ ] 1.12 Join via invite code (`POST /clubs/:id/join`) → re-joins
- [ ] 1.13 Leave club (`POST /clubs/:id/leave`) → membership removed
- [ ] 1.14 Discover public clubs (`GET /clubs/discover`) → public club listed
- [ ] 1.15 RBAC: beta_reader cannot create club → 403
- [ ] 1.16 Delete club (`DELETE /clubs/:id`) as owner → 200

### Quality Gate
- [ ] All membership lifecycle operations verified
- [ ] Role hierarchy enforced (only owner can delete, owner/admin can promote)

---

## Phase 2: API Verification — Activities, Analytics & Rankings
**Status**: Not Started
**Objective**: Verify learning activities, analytics, club rankings, and mentoring.

### Steps
- [ ] 2.1 Create prediction challenge (`POST /clubs/:id/challenges`) → 201
- [ ] 2.2 Submit response to challenge (`POST /clubs/:id/challenges/:cid/respond`) with bull/bear thesis → 200
- [ ] 2.3 Reveal AI analysis (`POST /clubs/:id/challenges/:cid/reveal`) → AI analysis returned
- [ ] 2.4 Create consensus poll (`POST /clubs/:id/polls`) → 201
- [ ] 2.5 Cast vote on poll (`POST /clubs/:id/polls/:pid/vote`) → 200
- [ ] 2.6 Reveal poll results (`POST /clubs/:id/polls/:pid/reveal`) → aggregated results
- [ ] 2.7 Add strategy journal entry (`POST /clubs/:id/journals`) → 201
- [ ] 2.8 List journal entries (`GET /clubs/:id/journals`) → entries returned
- [ ] 2.9 Get club analytics (`GET /clubs/:id/analytics`) → win_rate, learning_score, club_style
- [ ] 2.10 Get rankings leaderboard (`GET /clubs/rankings/leaderboard`) → clubs ranked by composite score
- [ ] 2.11 Get badge definitions (`GET /clubs/rankings/badges`) → badge types listed
- [ ] 2.12 Compare two clubs (`GET /clubs/rankings/compare?club_a=X&club_b=Y`) → side-by-side stats
- [ ] 2.13 Get ranking history (`GET /clubs/rankings/:clubId/history`) → seasonal snapshots
- [ ] 2.14 Create club analyst (`POST /clubs/:id/analysts`) → 201
- [ ] 2.15 Get club analyst contract (`GET /clubs/:id/analysts/:aid/contract`) → contract details
- [ ] 2.16 Check mentor eligibility (`GET /clubs/:id/mentoring/eligibility`) → eligible/not eligible

### Quality Gate
- [ ] Learning activities full lifecycle works
- [ ] Rankings computation returns reasonable scores
- [ ] Club analysts are scoped to their club only

---

## Phase 3: Chrome Testing
**Status**: Not Started
**Objective**: Walk through club flows in the browser end-to-end.

### Steps
- [ ] 3.1 Navigate to `/clubs` → page loads with My Clubs and Discover tabs
- [ ] 3.2 Click "Create Club" → form loads
- [ ] 3.3 Fill form (name, description, public=true) and submit → redirected to club detail
- [ ] 3.4 Verify club detail page shows members tab with owner
- [ ] 3.5 Copy invite code and open in second user session → preview page
- [ ] 3.6 Accept invite → second user joins, appears in members list
- [ ] 3.7 Switch to Activities tab → create a prediction challenge
- [ ] 3.8 Submit a bull/bear thesis response
- [ ] 3.9 Switch to Analytics tab → club stats displayed
- [ ] 3.10 Navigate to `/clubs/rankings` → global leaderboard table loads
- [ ] 3.11 Navigate to `/clubs/compare` → side-by-side comparison (needs 2 clubs)
- [ ] 3.12 Switch to Discover tab → public club visible with member count
- [ ] 3.13 As beta_reader, verify no "Create Club" button, no write controls
- [ ] 3.14 Click Chat → messaging channel opens

### Quality Gate
- [ ] All 14 browser scenarios pass
- [ ] No write controls visible for beta_reader
- [ ] Screenshots of key flows

---

## Phase 4: Bug Fixes & Marketing
**Status**: Not Started
**Objective**: Fix any bugs found, write marketing blurb.

### Steps
- [ ] 4.1 Fix any bugs discovered in Phases 1-3
- [ ] 4.2 Re-run failed tests to verify fixes
- [ ] 4.3 Write marketing blurb covering: collaborative learning clubs, prediction challenges, consensus polls, club rankings, mentoring. Save to `marketing-blurb.md`

### Quality Gate
- [ ] **Build**: clean
- [ ] **Lint**: clean
- [ ] **Unit Tests**: no new failures
- [ ] **Marketing blurb written**
