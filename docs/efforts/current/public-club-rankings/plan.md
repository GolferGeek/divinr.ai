# Public Club Rankings — Implementation Plan

**PRD**: ./prd.md
**Created**: 2026-04-13
**Status**: In Progress

## Progress Tracker
- [x] Phase 1: Ranking Computation & Leaderboard API
- [x] Phase 2: Badges & Comparison
- [x] Phase 3: Frontend — Rankings UI

---

## Phase 1: Ranking Computation & Leaderboard API
**Status**: Not Started
**Objective**: Add ranking columns to clubs table, create snapshots table, build ranking computation service with nightly cron, and expose leaderboard endpoint.

### Steps
- [ ] 1.1 Create migration `apps/api/db/migrations/2026-04-13-public-club-rankings.sql`: add `badges JSONB DEFAULT '[]'`, `ranking_score NUMERIC DEFAULT 0`, `ranking_position INTEGER` columns to `prediction.clubs`. Create `prediction.club_ranking_snapshots` table with indexes.
- [ ] 1.2 Update `ClubSchemaService.ensureSchema()` to include the new columns (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`) and new table.
- [ ] 1.3 Create `apps/api/src/clubs/club-ranking.service.ts` with:
  - `recomputeRankings()` — queries all public clubs, computes composite score `(avg_return * 0.4 + win_rate * 0.3 + log2(members+1)*10 * 0.2 + tournaments * 0.1)`, updates `ranking_score` and `ranking_position` on each club. Only counts tournaments with ≥3 entrants.
  - `getLeaderboard(sortBy, limit, offset)` — queries public clubs ordered by sort column, returns with badges.
  - `@Cron('0 3 * * *')` nightly recomputation (3 AM UTC).
- [ ] 1.4 Add controller endpoint: `GET /clubs/rankings/leaderboard` with `sort_by`, `limit`, `offset` query params.
- [ ] 1.5 Register `ClubRankingService` in `ClubModule` providers.
- [ ] 1.6 Update `ClubService.discoverClubs()` to accept `sort_by` param and default to `ranking_score DESC`.
- [ ] 1.7 Write unit test `apps/api/tests/unit/club-ranking.test.ts` covering composite score formula, ranking position assignment, sort options.

### Quality Gate
- [ ] **Lint**: `cd apps/api && pnpm run lint` passes
- [ ] **Build**: `pnpm build` completes without errors
- [ ] **Unit Tests**: `cd apps/api && npx tsx tests/unit/club-ranking.test.ts` passes
- [ ] **Existing Tests**: all prior test suites pass
- [ ] **Curl Tests**:
  ```bash
  curl -s http://localhost:7100/clubs/rankings/leaderboard -H "x-user-id: seed-user-alpha" | jq '.[0] | keys'
  # → ["id","name","ranking_position","ranking_score","badges","member_count","avg_return_pct",...]
  ```
- [ ] **Phase Review**:
  - [ ] Composite score formula matches PRD §4.5
  - [ ] Leaderboard sorts by ranking_score by default
  - [ ] Only public clubs in leaderboard

---

## Phase 2: Badges & Comparison
**Status**: Not Started
**Objective**: Implement badge evaluation, comparison endpoint, seasonal snapshots, and ranking history.

### Steps
- [ ] 2.1 Add badge evaluation to `ClubRankingService.recomputeRankings()`:
  - `top_10_pct` — club is in top 10% of ranked clubs
  - `top_25_pct` — club is in top 25%
  - `rising_club` — moved up ≥5 positions since last month's snapshot
  - `most_improved` — biggest ranking_score increase since last month's snapshot
  - Minimum 3 public clubs for badges to activate.
- [ ] 2.2 Implement `compareClubs(clubIdA, clubIdB)` — returns both clubs' stats side-by-side (member_count, avg_return, win_rate, ranking_position, ranking_score, badges, tournament_count).
- [ ] 2.3 Implement `snapshotMonthly()` with `@Cron('0 4 1 * *')` — captures current rankings for all public clubs into `club_ranking_snapshots` with `period_type='monthly'`.
- [ ] 2.4 Implement `snapshotQuarterly()` with `@Cron('0 4 1 1,4,7,10 *')` — quarterly snapshots.
- [ ] 2.5 Implement `getRankingHistory(clubId)` — returns snapshots for a club ordered by period.
- [ ] 2.6 Add controller endpoints:
  - `GET /clubs/rankings/compare?club_a=X&club_b=Y`
  - `GET /clubs/rankings/:clubId/history`
  - `GET /clubs/rankings/badges` — static list of badge types with descriptions
- [ ] 2.7 Write unit test `apps/api/tests/unit/club-badges.test.ts` covering badge thresholds, rising club detection, comparison shape.

### Quality Gate
- [ ] **Lint**: `cd apps/api && pnpm run lint` passes
- [ ] **Build**: `pnpm build` completes without errors
- [ ] **Unit Tests**: `cd apps/api && npx tsx tests/unit/club-badges.test.ts` passes
- [ ] **Existing Tests**: all prior test suites pass
- [ ] **Curl Tests**:
  ```bash
  curl -s "http://localhost:7100/clubs/rankings/compare?club_a=$CID_A&club_b=$CID_B" -H "x-user-id: seed-user-alpha" | jq 'keys'
  # → ["club_a","club_b"]

  curl -s http://localhost:7100/clubs/rankings/badges -H "x-user-id: seed-user-alpha" | jq 'length'
  # → 4

  curl -s http://localhost:7100/clubs/rankings/$CID/history -H "x-user-id: seed-user-alpha" | jq 'length'
  # → number of snapshots
  ```
- [ ] **Phase Review**:
  - [ ] All 4 badge types implemented per PRD §4.4
  - [ ] Comparison returns both clubs' full stats
  - [ ] Monthly + quarterly crons registered

---

## Phase 3: Frontend — Rankings UI
**Status**: Not Started
**Objective**: Build leaderboard view, comparison view, badge display, and enhanced discovery sorting.

### Steps
- [ ] 3.1 Extend `useClubStore()` with `fetchLeaderboard(sortBy, limit, offset)`, `fetchComparison(clubA, clubB)`, `fetchRankingHistory(clubId)`.
- [ ] 3.2 Add routes: `/clubs/rankings` → `ClubRankingsView`, `/clubs/compare` → `ClubCompareView`.
- [ ] 3.3 Create `ClubRankingsView.vue` — leaderboard table with columns (rank, name, score, return %, win rate, members, badges). Sort dropdown. Pagination.
- [ ] 3.4 Create `ClubCompareView.vue` — side-by-side stat cards for two clubs. Club selector dropdowns. Metric-by-metric comparison with winner highlighting.
- [ ] 3.5 Update `ClubsView.vue` discover tab: add sort dropdown (Best Overall, Best Return, Most Members, Most Active). Wire to `sort_by` param.
- [ ] 3.6 Update `ClubDetailView.vue`: render badges as colored chips next to club name. Add "Compare" button linking to `/clubs/compare?a=ID`.
- [ ] 3.7 Add "Rankings" button/link on ClubsView page header linking to `/clubs/rankings`.

### Quality Gate
- [ ] **Lint**: `cd apps/web && pnpm run lint` and `cd apps/api && pnpm run lint` pass
- [ ] **Build**: `pnpm build` completes without errors
- [ ] **Existing Tests**: all API test suites pass
- [ ] **Chrome Tests**:
  - [ ] `/clubs/rankings` loads leaderboard table with sort controls
  - [ ] `/clubs/compare?a=X&b=Y` shows side-by-side stats
  - [ ] Discover tab has sort dropdown
  - [ ] Club detail shows badges
- [ ] **Phase Review**:
  - [ ] All routes from PRD §4.4 implemented
  - [ ] Badge display matches PRD (colored chips)
  - [ ] Comparison view shows winner highlighting
