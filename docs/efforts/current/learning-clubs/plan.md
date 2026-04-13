# Investment Learning Clubs — Implementation Plan

**PRD**: ./prd.md
**Created**: 2026-04-13
**Status**: Not Started

## Progress Tracker
- [ ] Phase 1: Club Entity & Membership
- [ ] Phase 2: Club Analysts
- [ ] Phase 3: Club Tournaments
- [ ] Phase 4: Learning Activities
- [ ] Phase 5: Club Analytics & Post-Mortems
- [ ] Phase 6: Frontend — Club UI

---

## Phase 1: Club Entity & Membership
**Status**: Not Started
**Objective**: Create all club database tables, build ClubModule with CRUD and membership management, implement role hierarchy, auto-create messaging channel on club creation.

### Steps
- [ ] 1.1 Create database migration `apps/api/db/migrations/2026-04-13-learning-clubs.sql` with tables: `prediction.clubs`, `prediction.club_members`, `prediction.club_invites`, `prediction.club_analysts`, `prediction.club_prediction_challenges`, `prediction.club_challenge_responses`, `prediction.club_consensus_polls`, `prediction.club_consensus_votes`, `prediction.club_strategy_journals`. All DDL uses `CREATE TABLE IF NOT EXISTS`. Indexes on `(club_id, user_id)`, `invite_code`, `invite_token`.
- [ ] 1.2 Create `apps/api/src/clubs/` directory with module structure:
  - `club.module.ts` — NestJS module
  - `club.controller.ts` — Controller under `/clubs` prefix with `@UseGuards(JwtAuthGuard)`
  - `club.service.ts` — CRUD + membership service
  - `club.types.ts` — TypeScript interfaces for all club entities
  - `club-schema.service.ts` — Schema service with `ensureSchema()`
- [ ] 1.3 Implement `ClubSchemaService` with `ensureSchema()` mirroring the migration DDL.
- [ ] 1.4 Implement `ClubService` with methods:
  - `createClub(input, userId)` — creates club, auto-generates invite_code (8-char alphanumeric), creates owner entry in `club_members`, auto-creates messaging channel via `MessagingService.createChannel('club', clubId, clubName)`, adds owner as channel admin.
  - `listMyClubs(userId)` — clubs where user is a member.
  - `discoverClubs()` — public clubs with member count, tournament count.
  - `getClub(id, userId)` — club profile with member list. Requires membership.
  - `updateClub(id, input, userId)` — owner/admin only.
  - `deleteClub(id, userId)` — owner only. Cascades: removes members, archives channel.
  - `joinClub(id, code, userId)` — validates invite_code, creates member entry, adds to messaging channel.
  - `leaveClub(id, userId)` — removes member entry (owner cannot leave). Removes from messaging channel.
  - `listMembers(clubId, userId)` — requires membership.
  - `promoteMember(clubId, targetUserId, userId)` — owner only, sets role to 'admin'.
  - `demoteMember(clubId, targetUserId, userId)` — owner only, sets role to 'member'.
  - `removeMember(clubId, targetUserId, userId)` — owner/admin only. Cannot remove owner.
- [ ] 1.5 Implement invite endpoints in `ClubService`:
  - `createInvite(clubId, userId, input?: { email?, username? })` — generates invite token. If username/email provided, sends notification.
  - `getInviteDetails(token)` — returns club info from invite token (no membership required).
  - `acceptInvite(token, userId)` — validates token, joins club.
- [ ] 1.6 Implement `ClubController` endpoints:
  - `POST /clubs` — create club
  - `GET /clubs` — list my clubs
  - `GET /clubs/discover` — browse public clubs
  - `GET /clubs/invite/:token` — invite preview (before `:id` routes)
  - `POST /clubs/invite/:token/accept` — accept invite
  - `GET /clubs/:id` — club profile
  - `PATCH /clubs/:id` — update
  - `DELETE /clubs/:id` — delete
  - `POST /clubs/:id/join` — join via invite code
  - `POST /clubs/:id/leave` — leave
  - `GET /clubs/:id/members` — list members
  - `POST /clubs/:id/members/:userId/promote` — promote
  - `POST /clubs/:id/members/:userId/demote` — demote
  - `DELETE /clubs/:id/members/:userId` — remove member
  - `POST /clubs/:id/invites` — create invite
- [ ] 1.7 Register `ClubModule` in `apps/api/src/app.module.ts`. Import `MessagingService`, `MessagingSchemaService`, `NotificationService`, `MarketsSchemaService` in the module providers.
- [ ] 1.8 Write unit test `apps/api/tests/unit/club-membership.test.ts` covering:
  - Club creation generates invite code and owner membership
  - Join via invite code creates member entry
  - Duplicate join rejected
  - Owner cannot leave
  - Only owner can promote/demote
  - Only owner/admin can remove members
  - Cannot remove owner
  - Public clubs appear in discovery, private do not

### Quality Gate
- [ ] **Lint**: `cd apps/api && pnpm run lint` passes
- [ ] **Build**: `pnpm build` completes without errors
- [ ] **Typecheck**: passes (included in build)
- [ ] **Unit Tests**: `cd apps/api && npx tsx tests/unit/club-membership.test.ts` passes
- [ ] **Curl Tests**:
  ```bash
  curl -s -X POST http://localhost:7100/clubs \
    -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
    -d '{"name":"Test Club","description":"A test club","is_public":true}' \
    | jq '.id, .invite_code' # → UUID, 8-char code

  curl -s http://localhost:7100/clubs -H "Authorization: Bearer $TOKEN" \
    | jq 'length' # → ≥ 1

  curl -s http://localhost:7100/clubs/discover -H "Authorization: Bearer $TOKEN" \
    | jq 'length' # → ≥ 1 (public club)

  curl -s http://localhost:7100/clubs/$CLUB_ID -H "Authorization: Bearer $TOKEN" \
    | jq '.name' # → "Test Club"

  curl -s http://localhost:7100/clubs/$CLUB_ID/members -H "Authorization: Bearer $TOKEN" \
    | jq '.[0].role' # → "owner"
  ```
- [ ] **Phase Review**: Compare against PRD Phase 1 / §4.2-4.3:
  - [ ] All club tables created matching PRD §4.2
  - [ ] CRUD + membership endpoints match PRD §4.3
  - [ ] Role hierarchy enforced (owner > admin > member)
  - [ ] Messaging channel auto-created on club creation
  - [ ] `@Inject()` on every constructor parameter

---

## Phase 2: Club Analysts
**Status**: Not Started
**Objective**: Build club analyst management — create custom analysts linked to clubs, extend the analyst pipeline to include club analysts for club members, and guard the contract editor for club-scoped access.

### Steps
- [ ] 2.1 Create `apps/api/src/clubs/club-analyst.service.ts` with:
  - `createClubAnalyst(clubId, input: { slug, display_name, persona_prompt, analyst_type?, workflow_scope? }, userId)` — validates user is club admin. Creates `market_analysts` row with `user_id = userId`. Creates `club_analysts` junction row. Rate-limit: max 10 analysts per club.
  - `listClubAnalysts(clubId, userId)` — requires club membership. Returns analysts with performance stats.
  - `getClubAnalystContract(clubId, analystId, userId)` — requires membership. Returns analyst with config versions.
  - `updateClubAnalystContract(clubId, analystId, input: { persona_prompt, context_markdown, change_reason }, userId)` — requires admin. Creates new `analyst_config_versions` row.
- [ ] 2.2 Extend the analyst visibility in `apps/api/src/markets/markets.service.ts` `listAnalysts()` method: in addition to `user_id IS NULL OR user_id = $1`, also include analysts where the user is a member of a club that has that analyst (join `club_analysts` → `club_members`).
- [ ] 2.3 Extend the prediction pipeline to include club analysts. In `apps/api/src/markets/services/predictor-generator.service.ts` (or wherever analysts are selected for a prediction run), add a query that includes analysts linked via `club_analysts` for clubs the target user belongs to.
- [ ] 2.4 Add controller endpoints in `ClubController`:
  - `POST /clubs/:id/analysts` — create club analyst
  - `GET /clubs/:id/analysts` — list club analysts
  - `GET /clubs/:id/analysts/:analystId/contract` — get contract
  - `PUT /clubs/:id/analysts/:analystId/contract` — update contract
- [ ] 2.5 Register `ClubAnalystService` in `ClubModule` providers.
- [ ] 2.6 Write unit test `apps/api/tests/unit/club-analyst.test.ts` covering:
  - Only admin can create club analyst
  - Rate limit: 11th analyst rejected
  - Non-member cannot see club analysts
  - Club analyst visibility includes club membership check

### Quality Gate
- [ ] **Lint**: `cd apps/api && pnpm run lint` passes
- [ ] **Build**: `pnpm build` completes without errors
- [ ] **Unit Tests**: `cd apps/api && npx tsx tests/unit/club-analyst.test.ts` passes
- [ ] **Existing Tests**: all prior test suites pass
- [ ] **Curl Tests**:
  ```bash
  curl -s -X POST http://localhost:7100/clubs/$CLUB_ID/analysts \
    -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
    -d '{"slug":"club-value","display_name":"Club Value Analyst","persona_prompt":"Focus on fundamentals..."}' \
    | jq '.analyst_id' # → UUID

  curl -s http://localhost:7100/clubs/$CLUB_ID/analysts \
    -H "Authorization: Bearer $TOKEN" \
    | jq 'length' # → ≥ 1
  ```
- [ ] **Phase Review**: Compare against PRD Phase 2 / §4.3 Club Analysts:
  - [ ] Club analyst created as market_analysts row + junction entry
  - [ ] Contract editor endpoints work with club scope
  - [ ] Analyst pipeline includes club analysts for club members
  - [ ] Rate limit enforced (10 per club)

---

## Phase 3: Club Tournaments
**Status**: Not Started
**Objective**: Wire club tournaments into the existing tournament system by validating club membership on `scope='club'` tournament creation and filtering visibility for club members.

### Steps
- [ ] 3.1 Update `TournamentService.createTournament()` in `apps/api/src/tournaments/tournament.service.ts`: when `scope='club'`, validate that `scope_id` references an existing club and that the creator is an admin/owner of that club. Import `ClubService` (or query directly).
- [ ] 3.2 Update `TournamentService.listTournaments()` visibility: add condition `OR (t.scope = 'club' AND EXISTS (SELECT 1 FROM prediction.club_members cm WHERE cm.club_id = t.scope_id AND cm.user_id = $1))`.
- [ ] 3.3 Update `TournamentService.getTournament()` visibility with the same club membership check.
- [ ] 3.4 Add a "Club Tournaments" section to the club detail endpoint: `GET /clubs/:id` should include recent tournaments where `scope='club' AND scope_id = clubId`.
- [ ] 3.5 Write unit test `apps/api/tests/unit/club-tournament.test.ts` covering:
  - Club tournament creation requires club admin role
  - Non-club-member cannot see club tournaments
  - Club member can see and enter club tournaments

### Quality Gate
- [ ] **Lint**: `cd apps/api && pnpm run lint` passes
- [ ] **Build**: `pnpm build` completes without errors
- [ ] **Unit Tests**: `cd apps/api && npx tsx tests/unit/club-tournament.test.ts` passes
- [ ] **Existing Tests**: all prior test suites pass (including tournament tests)
- [ ] **Phase Review**: Compare against PRD Phase 3 / §4.5:
  - [ ] Club tournament creation validates club membership + admin role
  - [ ] Tournament visibility includes club membership check
  - [ ] Club detail includes tournament list

---

## Phase 4: Learning Activities
**Status**: Not Started
**Objective**: Build prediction challenges, consensus polls, strategy journals, and contrarian spotlight — the educational activities that make clubs more than just tournament groups.

### Steps
- [ ] 4.1 Create `apps/api/src/clubs/club-activity.service.ts` with:
  - **Prediction challenges**: `createChallenge(clubId, input, userId)` — admin only. `listChallenges(clubId, userId)` — member. `respondToChallenge(challengeId, input, userId)` — member, one response per challenge. `revealChallenge(challengeId, userId)` — admin, sets status to 'revealed', fetches AI predictions for the instrument.
  - **Consensus polls**: `createPoll(clubId, input, userId)` — admin. `listPolls(clubId, userId)` — member. `vote(pollId, direction, userId)` — member, one vote per poll. `revealPoll(pollId, userId)` — admin, sets status to 'revealed'.
  - **Strategy journals**: `addJournalEntry(clubId, input, userId)` — member. `listJournals(clubId, userId)` — member (sees all club entries).
  - **Contrarian spotlight**: computed in analytics (Phase 5) — when a member's vote disagreed with club consensus AND the member's direction was correct, flag it.
- [ ] 4.2 Add controller endpoints:
  - `POST /clubs/:id/challenges` — create
  - `GET /clubs/:id/challenges` — list (include response counts, user's response if any)
  - `POST /clubs/:id/challenges/:challengeId/respond` — submit thesis
  - `POST /clubs/:id/challenges/:challengeId/reveal` — reveal AI analysis
  - `POST /clubs/:id/polls` — create
  - `GET /clubs/:id/polls` — list (include vote tallies, user's vote if any)
  - `POST /clubs/:id/polls/:pollId/vote` — cast vote
  - `POST /clubs/:id/polls/:pollId/reveal` — reveal
  - `POST /clubs/:id/journals` — add entry
  - `GET /clubs/:id/journals` — list entries
- [ ] 4.3 Register `ClubActivityService` in `ClubModule` providers.
- [ ] 4.4 Write unit test `apps/api/tests/unit/club-activity.test.ts` covering:
  - Only admin can create challenges and polls
  - Member can respond/vote once per challenge/poll
  - Duplicate response/vote rejected
  - Reveal changes status and records revealed_at
  - Journal entries visible to all club members

### Quality Gate
- [ ] **Lint**: `cd apps/api && pnpm run lint` passes
- [ ] **Build**: `pnpm build` completes without errors
- [ ] **Unit Tests**: `cd apps/api && npx tsx tests/unit/club-activity.test.ts` passes
- [ ] **Existing Tests**: all prior test suites pass
- [ ] **Phase Review**: Compare against PRD Phase 4 / §4.3 Learning Activities:
  - [ ] All learning activity endpoints implemented
  - [ ] Role checks enforced (admin creates, member responds)
  - [ ] One response/vote per member per activity

---

## Phase 5: Club Analytics & Post-Mortems
**Status**: Not Started
**Objective**: Build aggregate club analytics (win rate, analyst trust, learning score, club style, common mistakes) and auto-generate post-mortems for completed club tournaments.

### Steps
- [ ] 5.1 Create `apps/api/src/clubs/club-analytics.service.ts` with:
  - `getClubAnalytics(clubId, userId)` — requires membership. Returns:
    - `member_count`: total members
    - `tournament_count`: completed club tournaments
    - `avg_return_pct`: average member return across club tournaments
    - `club_win_rate`: aggregate win rate across all member tournament positions
    - `analyst_trust`: top 5 trusted analysts by average affinity score across members (query `user_analyst_affinity` for club member user_ids)
    - `analyst_trust_evolution`: last 5 data points of aggregate trust per top analyst (from `user_affinity_signals` timestamps)
    - `learning_score`: average member accuracy improvement (first tournament return vs latest)
    - `club_style`: "contrarian" / "trend follower" / "balanced" based on aggregate affinity patterns
    - `common_mistakes`: top 3 symbols where club members collectively lost money
    - `contrarian_spotlights`: members who went against consensus polls and were correct
  - `getPostMortem(clubId, tournamentId, userId)` — requires membership. Returns:
    - Tournament summary (name, dates, entrant count)
    - Top 3 performers with return %, key trades
    - Which analysts the top performer followed (from affinity signals during tournament period)
    - Consensus poll accuracy during tournament period
    - Biggest win and biggest loss across all members
- [ ] 5.2 Add controller endpoints:
  - `GET /clubs/:id/analytics` — aggregate stats
  - `GET /clubs/:id/analytics/post-mortem/:tournamentId` — tournament post-mortem
- [ ] 5.3 Register `ClubAnalyticsService` in `ClubModule` providers.
- [ ] 5.4 Write unit test `apps/api/tests/unit/club-analytics.test.ts` covering:
  - Analytics returns expected shape with all fields
  - Win rate calculation correct
  - Learning score computation logic
  - Club style determination logic
  - Non-member cannot access analytics

### Quality Gate
- [ ] **Lint**: `cd apps/api && pnpm run lint` passes
- [ ] **Build**: `pnpm build` completes without errors
- [ ] **Unit Tests**: `cd apps/api && npx tsx tests/unit/club-analytics.test.ts` passes
- [ ] **Existing Tests**: all prior test suites pass
- [ ] **Phase Review**: Compare against PRD Phase 5 / §4.3 Analytics:
  - [ ] All analytics fields from PRD implemented
  - [ ] Post-mortem generated from structured data
  - [ ] Analyst trust evolution tracked over time
  - [ ] Contrarian spotlight computed

---

## Phase 6: Frontend — Club UI
**Status**: Not Started
**Objective**: Build all frontend views, store, dashboard integration, and legal framing so the full club user journey works in the browser.

### Steps
- [ ] 6.1 Create Pinia store `apps/web/src/stores/club.store.ts` with state and actions for all club API endpoints. Include SSE handler for club-related events.
- [ ] 6.2 Add club routes to `apps/web/src/router/index.ts`:
  - `/clubs` → `ClubsView`
  - `/clubs/create` → `ClubCreateView`
  - `/clubs/invite/:token` → `ClubInviteView` (before `:id`)
  - `/clubs/:id` → `ClubDetailView`
- [ ] 6.3 Create `apps/web/src/views/ClubsView.vue` — "My Clubs" tab + "Discover" tab. My clubs show member count and link to detail. Discover shows public clubs with join button. "Create Club" button.
- [ ] 6.4 Create `apps/web/src/views/ClubCreateView.vue` — form with: name, description, public/private toggle. Submit creates club and redirects to detail.
- [ ] 6.5 Create `apps/web/src/views/ClubDetailView.vue` — tabbed layout:
  - **Members**: member list with roles, promote/demote/remove for owner. Invite button.
  - **Tournaments**: club tournaments list (filtered by scope='club'). Create tournament button for admin.
  - **Analysts**: club analysts list. Create analyst button for admin. Link to contract editor.
  - **Activities**: prediction challenges, consensus polls, strategy journals. Create buttons for admin.
  - **Analytics**: club stats dashboard — win rate, learning score, analyst trust chart, common mistakes, contrarian spotlights.
  - **Chat**: link to club messaging channel.
- [ ] 6.6 Create `apps/web/src/views/ClubInviteView.vue` — club preview from invite token. "Join Club" button. Auth required.
- [ ] 6.7 Add "Your Clubs" card to `apps/web/src/views/DashboardView.vue` showing clubs with member count.
- [ ] 6.8 Add "Clubs" navigation item to sidebar in `apps/web/src/layouts/DefaultLayout.vue` (using `peopleCircleOutline` icon).
- [ ] 6.9 Add legal disclaimer on all club views: "Investment Learning Club — educational platform for practicing AI-assisted market analysis. Not investment advice."
- [ ] 6.10 Add invite code display + copy functionality on club detail page.

### Quality Gate
- [ ] **Lint**: `cd apps/web && pnpm run lint` and `cd apps/api && pnpm run lint` pass
- [ ] **Build**: `pnpm build` (root) completes without errors
- [ ] **Typecheck**: passes (included in build)
- [ ] **Existing Tests**: all API test suites pass
- [ ] **Chrome Tests** (manual browser verification):
  - [ ] Navigate to `/clubs` — page loads with My Clubs + Discover tabs
  - [ ] Create a club — redirects to detail page with owner as member
  - [ ] Club detail shows all tabs (members, tournaments, analysts, activities, analytics, chat)
  - [ ] Invite code visible and copyable
  - [ ] Open invite link — shows club preview with "Join" button
  - [ ] Dashboard shows "Your Clubs" card
  - [ ] Sidebar shows "Clubs" navigation item
  - [ ] Legal disclaimer visible on all club pages
  - [ ] All copy uses educational language
- [ ] **Phase Review**: Compare against PRD Phase 6 / §4.4:
  - [ ] All routes from PRD §4.4 implemented
  - [ ] Pinia store covers all actions
  - [ ] Dashboard card shows clubs
  - [ ] Messaging linked via channel_id
  - [ ] Disclaimer and educational language applied throughout
