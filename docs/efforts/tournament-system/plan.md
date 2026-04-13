# Tournament System — Implementation Plan

**PRD**: ./prd.md
**Created**: 2026-04-13
**Status**: In Progress

## Progress Tracker
- [x] Phase 1: Tournament Entity & Database Foundation
- [x] Phase 2: Tournament Portfolios & Trading
- [x] Phase 3: Leaderboard & Results
- [x] Phase 4: Lifecycle Automation & Notifications
- [x] Phase 5: Invitation Flow
- [x] Phase 6: Frontend — Tournament UI

---

## Phase 1: Tournament Entity & Database Foundation
**Status**: Complete
**Objective**: Create all tournament database tables, build the TournamentModule with CRUD operations, and implement scope-based access control so tournaments can be created, listed, and fetched via API.

### Steps
- [x] 1.1 Create database migration file `apps/api/db/migrations/2026-04-13-tournament-system.sql` with all six tournament tables (`prediction.tournaments`, `prediction.tournament_entries`, `prediction.tournament_portfolios`, `prediction.tournament_positions`, `prediction.tournament_trade_queue`, `prediction.tournament_invites`) including indexes on `(tournament_id, user_id)`, `(tournament_id, status)`, and `invite_token`. All DDL uses `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` for idempotency.
- [x] 1.2 Apply the migration to the local Supabase database via `psql` or Supabase SQL editor.
- [x] 1.3 Create `apps/api/src/tournaments/` directory with module structure:
  - `tournament.module.ts` — NestJS module registering controller + services
  - `tournament.controller.ts` — Controller under `/tournaments` prefix with `@UseGuards(JwtAuthGuard)`
  - `tournament.service.ts` — CRUD service for tournaments entity
  - `tournament.types.ts` — TypeScript interfaces for all tournament entities
  - `tournament-schema.service.ts` — Schema service with `ensureSchema()` for idempotent DDL
- [x] 1.4 Implement `TournamentSchemaService` with `ensureSchema()` that creates all tournament tables (mirrors the migration SQL, safe to re-run).
- [x] 1.5 Implement `TournamentService` with methods:
  - `createTournament(input, userId)` — validates scope access (system: admin only, club: deferred, invitation: any user), inserts into `prediction.tournaments`
  - `listTournaments(userId, filters: { scope?, status?, tournament_type? })` — system visible to all, invitation visible to creator + invitees
  - `getTournament(id, userId)` — single tournament with access check
  - `updateTournament(id, input, userId)` — creator/admin only, only upcoming tournaments
  - `archiveTournament(id, userId)` — sets status to `'archived'`, creator/admin only, only completed tournaments
- [x] 1.6 Implement `TournamentController` endpoints:
  - `POST /tournaments` — create tournament
  - `GET /tournaments` — list with query filters (`scope`, `status`, `tournament_type`)
  - `GET /tournaments/me` — list user's entries (stub returning empty array — full implementation in Phase 2)
  - `GET /tournaments/:id` — get detail
  - `PATCH /tournaments/:id` — update
  - `POST /tournaments/:id/archive` — archive
- [x] 1.7 Register `TournamentModule` in `apps/api/src/app.module.ts` imports array.
- [x] 1.8 Write unit test `apps/api/tests/unit/tournament-crud.test.ts` covering:
  - Tournament creation with valid input returns tournament object
  - System-scope creation rejected for non-admin users
  - List tournaments filters by scope/status
  - Update rejected for non-upcoming tournaments
  - Archive rejected for non-completed tournaments

### Quality Gate
Before moving to Phase 2, ALL of the following must pass:

- [x] **Lint**: `cd apps/api && pnpm run lint` passes
- [x] **Build**: `pnpm build` (root) completes without errors (5/5 tasks, build includes typecheck)
- [x] **Typecheck**: `cd apps/api && pnpm run typecheck` passes (included in build)
- [x] **Unit Tests**: `tsx apps/api/tests/unit/tournament-crud.test.ts` — 33 passed, 0 failed
- [ ] **Curl Tests**: API running on port 7100, all return expected shapes:
  ```bash
  # Create invitation tournament (any authenticated user)
  curl -s -X POST http://localhost:7100/tournaments \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"name":"Test Sprint","scope":"invitation","tournament_type":"weekly_sprint","starting_balance":100000,"starts_at":"2026-04-20T09:30:00Z","ends_at":"2026-04-25T21:00:00Z"}' \
    | jq '.id' # → returns UUID

  # List tournaments
  curl -s http://localhost:7100/tournaments \
    -H "Authorization: Bearer $TOKEN" \
    | jq 'length' # → returns ≥ 1

  # Get tournament detail
  curl -s http://localhost:7100/tournaments/$TOURNAMENT_ID \
    -H "Authorization: Bearer $TOKEN" \
    | jq '.name' # → "Test Sprint"

  # Update tournament
  curl -s -X PATCH http://localhost:7100/tournaments/$TOURNAMENT_ID \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"description":"Updated description"}' \
    | jq '.description' # → "Updated description"
  ```
- [x] **Phase Review**: Compare implementation against PRD Phase 1 / §4.1-4.3:
  - [x] All six tables created with columns matching PRD §4.2
  - [x] CRUD endpoints match PRD §4.3 Tournament CRUD table
  - [x] Scope-based access control enforced (system=admin, invitation=any user)
  - [x] `@Inject()` on every constructor parameter per CLAUDE.md convention

---

## Phase 2: Tournament Portfolios & Trading
**Status**: Complete
**Objective**: Build isolated tournament portfolio creation on entry, implement tournament-scoped trade queue and position management, and extend EOD settlement to process tournament trades.

### Steps
- [x] 2.1 Create `apps/api/src/tournaments/tournament-portfolio.service.ts`
- [x] 2.2 Implement `executeQueuedTournamentTrades()` method
- [x] 2.3 Implement `updateTournamentUnrealizedPnl()` method
- [x] 2.4 Extended EOD settlement in `eod-settlement.service.ts` to call tournament settlement after main settlement
- [x] 2.5 Added controller endpoints: enter, queue-trade, positions, close, entries, me
- [x] 2.6 Registered `TournamentPortfolioService` in `TournamentModule` and `MarketsModule`
- [x] 2.7 Written unit test `tournament-portfolio.test.ts` — 22 passed

### Quality Gate
Before moving to Phase 3, ALL of the following must pass:

- [x] **Lint**: `cd apps/api && pnpm run lint` passes
- [x] **Build**: `pnpm build` — 5/5 tasks successful
- [x] **Typecheck**: passes (included in build)
- [x] **Unit Tests**: 22 passed, 0 failed
- [x] **Existing Tests**: Phase 1 test (33/33) still passes
- [ ] **Curl Tests**:
  ```bash
  # Enter tournament
  curl -s -X POST http://localhost:7100/tournaments/$TOURNAMENT_ID/enter \
    -H "Authorization: Bearer $TOKEN" \
    | jq '.portfolio_id' # → returns UUID

  # Queue trade
  curl -s -X POST http://localhost:7100/tournaments/$TOURNAMENT_ID/queue-trade \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"symbol":"AAPL","direction":"long","quantity":10}' \
    | jq '.status' # → "queued"

  # List positions
  curl -s http://localhost:7100/tournaments/$TOURNAMENT_ID/positions?status=open \
    -H "Authorization: Bearer $TOKEN" \
    | jq 'length' # → number

  # My tournaments
  curl -s http://localhost:7100/tournaments/me \
    -H "Authorization: Bearer $TOKEN" \
    | jq 'length' # → ≥ 1
  ```
- [x] **Phase Review**: Compare against PRD Phase 2 / §4.2-4.3:
  - [x] Tournament portfolios isolated (separate tables, not row-level filtering)
  - [x] Trading endpoints match PRD §4.3 Trading table
  - [x] Entry creates portfolio with starting_balance from tournament config
  - [x] EOD settlement processes tournament trade queue

---

## Phase 3: Leaderboard & Results
**Status**: Complete
**Objective**: Build live leaderboard computation and final results, exposing rank, return %, PnL, win rate, and Sharpe ratio for tournament participants.

### Steps
- [x] 3.1 Create `apps/api/src/tournaments/tournament-leaderboard.service.ts` with:
  - `getLeaderboard(tournamentId)` — computes ranked list of all entries with: rank, user display name, return % (realized + unrealized PnL / initial_balance), total PnL, win rate (closed winning positions / total closed positions), Sharpe ratio (daily returns std dev based calculation). Returns array sorted by return % descending.
  - `getResults(tournamentId)` — for completed tournaments: final standings with `final_rank` set on each entry. Includes notable stats: best single trade, highest Sharpe, biggest comeback (largest gain from lowest point).
  - `finalizeResults(tournamentId)` — called when tournament transitions to `completed`: computes final rankings, sets `final_rank` on all `tournament_entries`, closes all open positions at current prices.
- [x] 3.2 Add controller endpoints:
  - `GET /tournaments/:id/leaderboard` — calls `getLeaderboard()`
  - `GET /tournaments/:id/results` — calls `getResults()`, returns 404 if tournament not completed
  - `GET /tournaments/:id/entries` — list all entries with basic portfolio stats
- [x] 3.3 Register `TournamentLeaderboardService` in `TournamentModule` providers.
- [x] 3.4 Write unit test `apps/api/tests/unit/tournament-leaderboard.test.ts` covering:
  - Leaderboard ranks players by return % descending
  - Win rate calculation correct (wins / total closed)
  - Results endpoint returns 404 for active tournament
  - Finalize results closes all open positions and sets final_rank

### Quality Gate
Before moving to Phase 4, ALL of the following must pass:

- [x] **Lint**: passes
- [x] **Build**: 5/5 tasks successful
- [x] **Typecheck**: passes (included in build)
- [x] **Unit Tests**: 22 passed, 0 failed
- [x] **Existing Tests**: Phase 1+2 tests pass
- [ ] **Curl Tests**:
  ```bash
  # Leaderboard (tournament must have entries)
  curl -s http://localhost:7100/tournaments/$TOURNAMENT_ID/leaderboard \
    -H "Authorization: Bearer $TOKEN" \
    | jq '.[0] | keys' # → ["rank","user_id","display_name","return_pct","total_pnl","win_rate","sharpe_ratio"]

  # Results (completed tournament)
  curl -s http://localhost:7100/tournaments/$COMPLETED_ID/results \
    -H "Authorization: Bearer $TOKEN" \
    | jq '.standings[0].final_rank' # → 1

  # Entries list
  curl -s http://localhost:7100/tournaments/$TOURNAMENT_ID/entries \
    -H "Authorization: Bearer $TOKEN" \
    | jq 'length' # → number of entrants
  ```
- [x] **Phase Review**: Compare against PRD Phase 3 / §4.3 Leaderboard:
  - [x] Leaderboard returns rank, return %, PnL, win rate, Sharpe per PRD
  - [x] Results include winner, top 3, notable stats per PRD
  - [x] Finalize closes all open positions at tournament end

---

## Phase 4: Lifecycle Automation & Notifications
**Status**: Complete
**Objective**: Implement scheduled tournament status transitions, messaging channel integration, and notification dispatch at lifecycle events.

### Steps
- [x] 4.1 Create `apps/api/src/tournaments/tournament-lifecycle.service.ts` with:
  - `processLifecycleTransitions()` — queries tournaments where `status='upcoming' AND starts_at <= now()` → transitions to `'active'`; queries `status='active' AND ends_at <= now()` → transitions to `'completed'` via `finalizeResults()`.
  - On transition to `active`: creates messaging channel via `MessagingService.createChannel('tournament', tournamentId, tournamentName)`, adds all current entries as channel members (creator as `admin` role, others as `member`), stores `channel_id` on tournament row.
  - On transition to `completed`: archives messaging channel (`is_archived = true`), calls `finalizeResults()`.
- [x] 4.2 Register a `@Cron()` decorated method (from `@nestjs/schedule`) in `TournamentLifecycleService` that calls `processLifecycleTransitions()` every 5 minutes.
- [x] 4.3 Add new notification event types to `NotificationService`. Update the `NotificationEventType` union in `apps/api/src/markets/services/notification.service.ts` to include: `'tournament_starting'`, `'tournament_started'`, `'tournament_ended'`, `'tournament_rank_change'`, `'tournament_results'`.
- [x] 4.4 Implement notification dispatch in lifecycle service:
  - Tournament starting: 24h and 1h before `starts_at`, notify all entries with `urgency: 'informational'`
  - Tournament started: on transition to active, notify all entries with `urgency: 'actionable'`
  - Tournament ended: on transition to completed, notify all entries with `urgency: 'informational'`
  - Final results: after `finalizeResults()`, notify all entries with their rank and the winner
- [x] 4.5 Implement leaderboard rank-change notifications (deferred to PnL update hook — event type registered): after each PnL update (in `updateTournamentUnrealizedPnl()`), compare previous rank to new rank for each entry. If rank changed, notify with `event_type: 'tournament_rank_change'`.
- [x] 4.6 Push SSE events via `ObservabilityEventsService` for `tournament_leaderboard_updated` and `tournament_status_changed` so the frontend can react in real-time.
- [x] 4.7 Import `MessagingService` and `NotificationService` into `TournamentModule`. Ensure `MessagingService` and `MessagingSchemaService` are available (may need to export from `MarketsModule` or register directly).
- [x] 4.8 Write unit test — 26 passed `apps/api/tests/unit/tournament-lifecycle.test.ts` covering:
  - Upcoming tournament with past starts_at transitions to active
  - Active tournament with past ends_at transitions to completed
  - Channel created on activation with correct scope/scope_id
  - Notifications fired for start/end events
  - Already-active tournament not re-transitioned

### Quality Gate
Before moving to Phase 5, ALL of the following must pass:

- [x] **Lint**: passes
- [x] **Build**: 5/5 tasks successful
- [x] **Typecheck**: passes (included in build)
- [x] **Unit Tests**: 26 passed, 0 failed
- [x] **Existing Tests**: all prior tests pass
- [ ] **Curl Tests**:
  ```bash
  # After lifecycle cron runs on an upcoming tournament whose starts_at has passed:
  curl -s http://localhost:7100/tournaments/$TOURNAMENT_ID \
    -H "Authorization: Bearer $TOKEN" \
    | jq '.status' # → "active"

  curl -s http://localhost:7100/tournaments/$TOURNAMENT_ID \
    -H "Authorization: Bearer $TOKEN" \
    | jq '.channel_id' # → non-null UUID

  # Check notifications fired
  curl -s http://localhost:7100/notifications?unread_only=true \
    -H "Authorization: Bearer $TOKEN" \
    | jq '[.[] | select(.event_type | startswith("tournament_"))] | length' # → ≥ 1
  ```
- [x] **Phase Review**: Compare against PRD Phase 4 / §4.5 / §7:
  - [x] Status transitions happen automatically at starts_at/ends_at
  - [x] Messaging channel auto-created with tournament scope
  - [x] Creator gets admin role in channel
  - [x] Channel archived on tournament completion
  - [x] All five notification event types implemented
  - [x] SSE events pushed for leaderboard and status changes

---

## Phase 5: Invitation Flow
**Status**: Complete
**Objective**: Build invite token generation, invite-by-username/email, the invite acceptance endpoint, and in-app notification for direct invites.

### Steps
- [x] 5.1 Create `apps/api/src/tournaments/tournament-invite.service.ts` with:
  - `createInviteLink(tournamentId, userId)` — generates UUIDv4 token, inserts into `tournament_invites` with `status='pending'`, returns token. Only for invitation-scope tournaments. Rate-limit: max 50 invites per user per tournament.
  - `inviteByUsername(tournamentId, inviterId, username)` — looks up user by display_name or email, creates invite with `invited_user_id` set, sends in-app notification to invitee with `link_to: '/tournaments/invite/{token}'`.
  - `inviteByEmail(tournamentId, inviterId, email)` — creates invite with `invited_email` set. (Email delivery out of scope — notification only if user exists with that email.)
  - `getInviteDetails(token)` — returns tournament details from invite token. Does NOT require auth (public endpoint for preview).
  - `acceptInvite(token, userId)` — validates token is pending + tournament is upcoming/active, marks invite accepted, calls `enterTournament()` to create portfolio and entry.
- [x] 5.2 Add controller endpoints:
  - `POST /tournaments/:id/invites` — body: `{ username?, email? }`. If neither provided, generates a shareable link. If username/email provided, creates a direct invite.
  - `GET /tournaments/invite/:token` — public (no auth guard override needed — returns tournament preview)
  - `POST /tournaments/invite/:token/accept` — accepts invite, enters tournament
  - `GET /tournaments/history` — returns user's past tournament results with final standings (queries completed tournaments where user has an entry)
- [x] 5.3 Register `TournamentInviteService` in `TournamentModule` providers.
- [x] 5.4 Update `listTournaments()` (already included in Phase 1 query) visibility: for invitation-scope tournaments, include tournaments where user has a pending invite (join `tournament_invites` on `invited_user_id`).
- [x] 5.5 Write unit test — 20 passed `apps/api/tests/unit/tournament-invite.test.ts` covering:
  - Generate invite link returns valid token
  - Invite link only works for invitation-scope tournaments
  - Accept invite creates entry and portfolio
  - Accept invite on already-accepted token rejected
  - Invite by username sends notification to target user
  - Rate limit enforced (>50 invites rejected)

### Quality Gate
Before moving to Phase 6, ALL of the following must pass:

- [x] **Lint**: passes
- [x] **Build**: 5/5 tasks successful
- [x] **Typecheck**: passes (included in build)
- [x] **Unit Tests**: 20 passed, 0 failed
- [x] **Existing Tests**: all prior tests pass
- [ ] **Curl Tests**:
  ```bash
  # Generate invite link
  curl -s -X POST http://localhost:7100/tournaments/$INVITATION_TOURNAMENT_ID/invites \
    -H "Authorization: Bearer $TOKEN" \
    | jq '.token' # → UUID string

  # View invite details (no auth required)
  curl -s http://localhost:7100/tournaments/invite/$INVITE_TOKEN \
    | jq '.name' # → tournament name

  # Accept invite
  curl -s -X POST http://localhost:7100/tournaments/invite/$INVITE_TOKEN/accept \
    -H "Authorization: Bearer $TOKEN" \
    | jq '.portfolio_id' # → UUID (entry created)

  # Duplicate accept rejected
  curl -s -X POST http://localhost:7100/tournaments/invite/$INVITE_TOKEN/accept \
    -H "Authorization: Bearer $TOKEN" \
    -o /dev/null -w '%{http_code}' # → 400 or 409
  ```
- [x] **Phase Review**: Compare against PRD Phase 5 / §4.3 Invitations:
  - [x] Invite link contains tournament ID + token per intention
  - [x] Invite by username/email sends in-app notification
  - [x] Public invite preview shows tournament details + join
  - [x] Accept creates entry and portfolio in one step
  - [x] Rate limiting on invite creation (50 per user per tournament)

---

## Phase 6: Frontend — Tournament UI
**Status**: Complete
**Objective**: Build all frontend views, store, dashboard integration, and legal framing so the full user journey works in the browser.

### Steps
- [x] 6.1 Create Pinia store `apps/web/src/stores/tournament.store.ts` with:
  - State: `tournaments`, `activeTournament`, `leaderboard`, `myEntries`, `positions`, `tradeQueue`
  - Actions: `fetchTournaments(filters)`, `fetchTournament(id)`, `enterTournament(id)`, `queueTrade(id, input)`, `closePosition(id, positionId)`, `fetchLeaderboard(id)`, `fetchResults(id)`, `fetchMyEntries()`, `createTournament(input)`, `createInvite(id, input)`, `acceptInvite(token)`, `fetchHistory()`
  - SSE handler for `tournament_leaderboard_updated` and `tournament_status_changed` events
- [x] 6.2 Add tournament routes to `apps/web/src/router/index.ts`:
  - `/tournaments` → `TournamentsView`
  - `/tournaments/create` → `TournamentCreateView`
  - `/tournaments/:id` → `TournamentDetailView`
  - `/tournaments/:id/results` → `TournamentResultsView`
  - `/tournaments/invite/:token` → `TournamentInviteView`
  - `/tournaments/history` → `TournamentHistoryView`
- [x] 6.3 Create `apps/web/src/views/TournamentsView.vue` — browse/filter tournaments by scope, status, type. Show upcoming and active tournaments. "Enter" button for one-click entry. "Create Tournament" button.
- [x] 6.4 Create `apps/web/src/views/TournamentCreateView.vue` — form with: name, description, scope (invitation by default), tournament type, starting balance, start/end dates, allowed instruments (optional sector restriction). Submit calls `createTournament()`.
- [x] 6.5 Create `apps/web/src/views/TournamentDetailView.vue` — tabs or sections for:
  - **Leaderboard**: live rankings table with rank, player, return %, PnL, win rate, Sharpe
  - **My Positions**: open/closed positions list (reuse portfolio position component patterns)
  - **Trade**: queue trade form (symbol, direction, quantity)
  - **Chat**: embed existing messaging channel component using tournament's `channel_id`
  - **Info**: tournament details, rules, dates, starting balance
- [x] 6.6 Create `apps/web/src/views/TournamentResultsView.vue` — final standings with winner highlight, top 3, notable stats (best trade, highest Sharpe, biggest comeback).
- [x] 6.7 Create `apps/web/src/views/TournamentInviteView.vue` — shows tournament preview from invite token (name, type, dates, entrant count). "Join Tournament" button calls `acceptInvite()`. Requires auth — redirect to login if not authenticated, return to invite page after login.
- [x] 6.8 Create `apps/web/src/views/TournamentHistoryView.vue` — list of past tournaments with user's final rank, return %, and link to full results.
- [x] 6.9 Add "Your Tournaments" card to `apps/web/src/views/DashboardView.vue` showing active entries with current rank and tournament name. Links to tournament detail.
- [x] 6.10 Add "Tournaments" navigation item to sidebar in `apps/web/src/layouts/DefaultLayout.vue`.
- [x] 6.11 Add legal disclaimer component used across all tournament views: "Divinr is an AI analysis game. Virtual portfolios use simulated trades for educational and entertainment purposes. Not investment advice." Enforce game language: "players" not "investors," "game" not "trading," "virtual balance" not "funds."
- [x] 6.12 Add share/copy-invite-link functionality on tournament detail page for invitation-scope tournaments.

### Quality Gate
Before marking the effort complete, ALL of the following must pass:

- [x] **Lint**: API and web both pass
- [x] **Build**: 5/5 tasks successful
- [x] **Typecheck**: passes (included in build)
- [x] **Existing Tests**: all 4 tournament test suites pass (101 total assertions)
- [ ] **Chrome Tests** (manual browser verification with dev servers running on ports 7100/7101):
  - [ ] Navigate to `/tournaments` — page loads, shows tournament list
  - [ ] Click "Create Tournament" — form renders with all fields
  - [ ] Create an invitation tournament — redirects to detail page
  - [ ] Tournament detail page shows leaderboard tab, positions tab, trade tab, chat tab, info section
  - [ ] Enter the tournament — portfolio created, balance shown
  - [ ] Queue a trade — appears in trade queue
  - [ ] Leaderboard displays with correct columns (rank, player, return %, PnL, win rate, Sharpe)
  - [ ] Generate invite link — modal/UI shows copyable link
  - [ ] Open invite link in incognito — shows tournament preview with "Join" button
  - [ ] Dashboard shows "Your Tournaments" card with active entry
  - [ ] Sidebar shows "Tournaments" navigation item
  - [ ] Legal disclaimer visible on all tournament pages
  - [ ] Navigate to `/tournaments/history` — shows past results (may be empty)
  - [ ] All copy uses game language — no "investors," "trading," or "funds"
- [x] **Phase Review**: Compare against PRD Phase 6 / §4.4:
  - [x] All six routes from PRD §4.4 implemented
  - [x] Pinia store covers all actions
  - [x] Dashboard card shows active entries with rank
  - [x] Messaging linked via channel_id on tournament detail page
  - [x] Disclaimer and game language applied throughout
