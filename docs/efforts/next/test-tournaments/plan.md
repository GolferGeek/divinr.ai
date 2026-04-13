# Test: Tournament System — Implementation Plan

**PRD**: ../../../tournament-system/prd.md
**Created**: 2026-04-13
**Status**: Not Started
**Depends on**: test-auth-user-management (complete), test-trading-portfolios (for trade verification)

## Progress Tracker
- [ ] Phase 1: API Verification
- [ ] Phase 2: Chrome Testing
- [ ] Phase 3: Bug Fixes & Marketing

---

## Phase 1: API Verification
**Status**: Not Started
**Objective**: Verify tournament CRUD, entry, trading, leaderboard, invites, and lifecycle via curl/API calls.

### Steps
- [ ] 1.1 Create a tournament (`POST /tournaments`) with type=weekly_sprint, scope=invitation → 201 with id
- [ ] 1.2 List tournaments (`GET /tournaments`) → new tournament appears with status=upcoming
- [ ] 1.3 Get tournament detail (`GET /tournaments/:id`) → full object with starting_balance, dates, type
- [ ] 1.4 Update tournament (`PATCH /tournaments/:id`) — change name/description while upcoming → 200
- [ ] 1.5 Enter tournament (`POST /tournaments/:id/enter`) → creates isolated portfolio, returns entry
- [ ] 1.6 Queue a trade (`POST /tournaments/:id/queue-trade`) with symbol=AAPL, direction=long, quantity=10 → 201
- [ ] 1.7 List open positions (`GET /tournaments/:id/positions?status=open`) → AAPL position visible
- [ ] 1.8 Close position (`POST /tournaments/:id/positions/:posId/close`) → position marked closed
- [ ] 1.9 Check leaderboard (`GET /tournaments/:id/leaderboard`) → entry with rank, return_pct, total_pnl
- [ ] 1.10 Generate invite link (`POST /tournaments/:id/invites`) → returns token
- [ ] 1.11 Preview invite (`GET /tournaments/invite/:token`) → tournament name/details without auth
- [ ] 1.12 Accept invite as second user (`POST /tournaments/invite/:token/accept`) → joins tournament
- [ ] 1.13 Verify second user appears on leaderboard
- [ ] 1.14 Get tournament results (`GET /tournaments/:id/results`) for a completed tournament → winner, top 3
- [ ] 1.15 RBAC: beta_reader cannot create tournament → 403
- [ ] 1.16 Archive completed tournament (`POST /tournaments/:id/archive`) → status changes

### Quality Gate
- [ ] All API calls return expected status codes and shapes
- [ ] Isolated portfolios verified (user A's trades don't appear for user B)
- [ ] Leaderboard ranks correctly after trades

---

## Phase 2: Chrome Testing
**Status**: Not Started
**Objective**: Walk through tournament flows in the browser end-to-end.

### Steps
- [ ] 2.1 Navigate to `/tournaments` → page loads with filter dropdowns
- [ ] 2.2 Click "Create Tournament" → form loads with all fields
- [ ] 2.3 Fill form and submit → redirected to tournament detail page
- [ ] 2.4 Verify detail page shows correct name, type, balance, dates
- [ ] 2.5 Click "Share Invite Link" → invite URL generated and displayed
- [ ] 2.6 Open invite URL in new session (second user) → preview page loads
- [ ] 2.7 Accept invite → second user enters tournament
- [ ] 2.8 Switch to Trade tab → queue a trade (symbol, direction, quantity)
- [ ] 2.9 Switch to Positions tab → new position visible with entry price
- [ ] 2.10 Close position → removed from open positions
- [ ] 2.11 Switch to Leaderboard tab → both users ranked with metrics
- [ ] 2.12 As beta_reader, verify no "Create Tournament", "Enter Game", or trade controls visible
- [ ] 2.13 Navigate to tournament history → past tournaments listed
- [ ] 2.14 Click Chat button → messaging channel opens (if active)

### Quality Gate
- [ ] All 14 browser scenarios pass
- [ ] No write controls visible for beta_reader
- [ ] Screenshots of key flows

---

## Phase 3: Bug Fixes & Marketing
**Status**: Not Started
**Objective**: Fix any bugs found, write marketing blurb.

### Steps
- [ ] 3.1 Fix any bugs discovered in Phases 1-2
- [ ] 3.2 Re-run failed tests to verify fixes
- [ ] 3.3 Write marketing blurb covering: competitive AI analysis games, invite friends, live leaderboards, virtual trading. Save to `marketing-blurb.md`

### Quality Gate
- [ ] **Build**: clean
- [ ] **Lint**: clean
- [ ] **Unit Tests**: no new failures
- [ ] **Marketing blurb written**
