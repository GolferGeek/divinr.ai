# Public Club Rankings — Product Requirements Document

## 1. Overview

Clubs exist in isolation — there's no way to compare clubs or create inter-club competition. Public Club Rankings adds a global leaderboard, profile badges, club comparison, enhanced discovery sorting, and seasonal rankings. This creates social proof for club discovery and competitive motivation for club members.

## 2. Goals & Success Criteria

- **Competition**: Clubs compete for ranking positions, motivating members to perform better in tournaments.
- **Discovery**: Prospective members can find high-performing public clubs by ranking metrics.
- **Recognition**: Badges reward clubs for achievement ("Top 10%", "Rising Club", "Most Improved").

**Success criteria:**
- Global club leaderboard ranks public clubs by aggregate return %, learning score, and member count.
- Clubs earn profile badges based on ranking position and trends.
- Side-by-side club comparison view works for any two public clubs.
- Discovery page supports sort/filter by ranking metrics.
- Seasonal rankings reset monthly and quarterly with historical snapshots.

## 3. User Stories / Use Cases

**Prospective member:** Browses the club discovery page, sorts by "Best Return %", sees the top-ranked clubs with their badges ("Top 10%", "Rising Club"), clicks to compare two clubs side-by-side before joining.

**Club admin:** Checks the global leaderboard to see where their club ranks. Notices they earned "Most Improved" badge after a strong tournament month. Shares the ranking with members to boost morale.

**Competitive member:** Compares their club against a rival club on the comparison view. Sees the rival has better win rate but their club has better learning score. Uses this to motivate their club's next tournament.

## 4. Technical Requirements

### 4.1 Architecture

Extend the existing `ClubModule` with a new `ClubRankingService`. No new module needed — this builds on the club analytics infrastructure.

- **Service**: `ClubRankingService` for leaderboard computation, badge assignment, comparison, and seasonal snapshots.
- **Controller**: New endpoints added to `ClubController` under `/clubs/rankings/*`.
- **Database**: New `prediction.club_ranking_snapshots` table for seasonal history. Badges stored as JSONB on the `prediction.clubs` table.
- **Cron**: Nightly job to recompute rankings and assign badges. Monthly/quarterly snapshot job.

### 4.2 Data Model Changes

**Add column to `prediction.clubs`:**
| Column | Type | Description |
|--------|------|-------------|
| `badges` | jsonb DEFAULT '[]' | Array of badge objects: `[{ badge: 'top_10_pct', earned_at: timestamp }]` |
| `ranking_score` | numeric DEFAULT 0 | Composite ranking score for sort (precomputed) |
| `ranking_position` | integer | Current leaderboard position (precomputed) |

**`prediction.club_ranking_snapshots`**
| Column | Type | Description |
|--------|------|-------------|
| `id` | text PK | |
| `club_id` | text NOT NULL FK → clubs | |
| `period_type` | text NOT NULL | `'monthly'`, `'quarterly'` |
| `period_label` | text NOT NULL | e.g. `'2026-04'`, `'2026-Q2'` |
| `ranking_position` | integer NOT NULL | Position at snapshot time |
| `ranking_score` | numeric NOT NULL | Composite score at snapshot |
| `avg_return_pct` | numeric | |
| `club_win_rate` | numeric | |
| `member_count` | integer | |
| `tournament_count` | integer | |
| `created_at` | timestamptz DEFAULT now() | |
| UNIQUE | `(club_id, period_type, period_label)` | One snapshot per club per period |

### 4.3 API Changes

All new endpoints under `/clubs/rankings` prefix.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/clubs/rankings/leaderboard` | Global leaderboard of public clubs. Query params: `sort_by` (return_pct, win_rate, member_count, ranking_score), `limit`, `offset`. Returns ranked clubs with badges. |
| `GET` | `/clubs/rankings/compare` | Side-by-side comparison. Query params: `club_a`, `club_b`. Returns both clubs' stats for comparison. |
| `GET` | `/clubs/rankings/:clubId/history` | Seasonal ranking history for a club. Returns monthly/quarterly snapshots. |
| `GET` | `/clubs/rankings/badges` | List all badge types with descriptions and criteria. |

**Modify existing endpoint:**
- `GET /clubs/discover` — add `sort_by` query param (ranking_score, member_count, avg_return, win_rate). Default sort changes from `member_count DESC` to `ranking_score DESC`.

### 4.4 Frontend Changes

**New routes:**
| Route | View | Description |
|-------|------|-------------|
| `/clubs/rankings` | `ClubRankingsView` | Global leaderboard with sort controls |
| `/clubs/compare` | `ClubCompareView` | Side-by-side comparison (query params `?a=id&b=id`) |

**Modifications:**
- `ClubsView` discover tab: add sort dropdown (Best Overall, Best Return, Most Members, Most Active).
- `ClubDetailView`: show badges on club profile. Add "Compare" button that links to comparison view.
- Sidebar: no new nav item — rankings accessible from Clubs page via "Rankings" tab or button.

**Badge display:** Badges rendered as colored chips/icons next to club name. Badge types:
- `top_10_pct` — "Top 10%" (gold)
- `top_25_pct` — "Top 25%" (silver)
- `rising_club` — "Rising Club" (green) — moved up ≥5 positions in last month
- `most_improved` — "Most Improved" (blue) — biggest ranking score increase in last month

**Pinia store:** Extend `useClubStore()` with `fetchLeaderboard()`, `fetchComparison()`, `fetchRankingHistory()`.

### 4.5 Infrastructure Requirements

- **Database migration**: Add `badges`, `ranking_score`, `ranking_position` columns to `prediction.clubs`. Create `prediction.club_ranking_snapshots` table.
- **Nightly cron**: `ClubRankingService.recomputeRankings()` — computes composite score for all public clubs, assigns positions, evaluates badge criteria.
- **Monthly cron**: `ClubRankingService.snapshotMonthly()` — captures current rankings into snapshots table. Runs on 1st of each month.
- **Quarterly cron**: `ClubRankingService.snapshotQuarterly()` — captures quarterly snapshot. Runs on 1st of Jan/Apr/Jul/Oct.
- **Composite score formula**: `ranking_score = (avg_return_pct * 0.4) + (club_win_rate * 0.3) + (log2(member_count + 1) * 10 * 0.2) + (tournament_count * 0.1)`. Weights tunable.

## 5. Non-Functional Requirements

- **Performance**: Leaderboard query on precomputed `ranking_score`/`ranking_position` columns — O(1) sort, <100ms for top 50.
- **Consistency**: Rankings recomputed nightly. Stale by at most 24 hours. Acceptable for a competitive but non-real-time feature.
- **Scalability**: Snapshot table grows linearly (clubs × periods). At 1000 clubs × 12 months = 12K rows/year — negligible.

## 6. Out of Scope

- **Real-time ranking updates** — nightly batch is sufficient. No SSE for ranking changes.
- **Private club rankings** — only public clubs appear in leaderboards.
- **Cross-club tournament brackets** — future (club vs club tournaments).
- **Prize/reward system for top clubs** — future. Note: paid-tier framing is retired per `docs/efforts/master-intention.md` §8; any prize system will ride on the single-tier billing model, not club-level billing.

## 7. Dependencies & Risks

**Dependencies:**
- **Learning Clubs** (shipped): `prediction.clubs` table, `ClubAnalyticsService` for aggregate stats.
- **Tournament system** (shipped): Tournament data for return % and win rate computation.

**Risks:**
| Risk | Impact | Mitigation |
|------|--------|------------|
| Ranking score formula favors large clubs over new ones | Medium | Include `rising_club` badge to reward improvement. Tune weights. Log2 scaling on member_count prevents linear advantage. |
| Few public clubs at launch makes leaderboard sparse | Low | Encourage public clubs in onboarding. Minimum 3 clubs needed for badges to activate. |
| Gaming rankings by creating dummy tournaments | Low | Only count tournaments with ≥3 entrants in ranking computation. |

## 8. Phasing

### Phase 1: Ranking Computation & Leaderboard API
Database migration (new columns + snapshots table). Build `ClubRankingService` with composite score computation, ranking assignment, and leaderboard query. Nightly cron for recomputation. Expose `GET /clubs/rankings/leaderboard` with sort/pagination. Validation: leaderboard returns ranked public clubs with scores.

### Phase 2: Badges & Comparison
Implement badge evaluation logic (top 10%, top 25%, rising club, most improved). Badge assignment in nightly cron. Build comparison endpoint. Monthly/quarterly snapshot crons. Expose `GET /clubs/rankings/compare`, `GET /clubs/rankings/:clubId/history`, `GET /clubs/rankings/badges`. Validation: badges assigned correctly, comparison returns both clubs' stats, history shows snapshots.

### Phase 3: Frontend — Rankings UI
Build `ClubRankingsView` (leaderboard table with sort), `ClubCompareView` (side-by-side stats). Add sort dropdown to discover tab. Show badges on club profile. Extend Pinia store. Validation: full user journey — view leaderboard → compare clubs → see badges on profile.
