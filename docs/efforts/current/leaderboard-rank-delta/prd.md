# Leaderboard Rank Delta — PRD

**Intention**: `./intention.md`
**Created**: 2026-04-18

## 1. Overview

PR #58 (`club-tournament-experience-polish`) shipped the leaderboard polish but deferred the rank-movement arrow (↑N / ↓N / —) because neither the tournament leaderboard nor the club-rankings payload carried any notion of a prior-period rank. Without delta, a multi-day sprint reads as a static snapshot rather than a live competition — the entire point of a tournament is momentum visibility.

This effort adds a prior-day rank snapshot for both surfaces, wires `rank_delta` and `prev_rank` through the existing DTOs, and renders an arrow + magnitude next to the Rank cell on `/tournaments/:id` (Leaderboard tab) and `/clubs/rankings`.

No new endpoints. No new UI surfaces. No new notification mechanics. Just enough scaffolding to make the existing Rank column dynamic.

## 2. Goals & Success Criteria

**Goals** (from intention):
1. Every row on a multi-day leaderboard shows a rank delta (arrow + magnitude when moved, em-dash when unchanged, blank on day one).
2. Deltas are accurate against a hand-check across two consecutive days.
3. Mobile rendering is unaffected — no reflow of the sticky Rank/Player columns on the tournament table.

**Glyph resolution** (reconciling the two intention lines — Scope says "null on day-one shows nothing"; Success says "— on the first period"):
- `rank_delta > 0` → `↑N` in green.
- `rank_delta < 0` → `↓N` in red (magnitude = `|delta|`).
- `rank_delta === 0` → `—` muted (rank unchanged — this is the "— on the first period" case applied on every period, most visible on the first period after data starts to flow).
- `rank_delta === null` (no prior snapshot exists for this participant — day one of the tournament, or a user who joined mid-sprint before their first snapshot) → blank. No glyph.

**Measurable success**:
- `GET /tournaments/:id/leaderboard` returns `rank_delta: number | null` and `prev_rank: number | null` on every entry.
- `GET /clubs/rankings/leaderboard` returns the same two fields on every entry.
- Integration test seeds two consecutive daily snapshots, calls the endpoint, and asserts `rank_delta` matches the hand-computed value for at least three movers (up, down, unchanged).
- Chrome walkthrough: on a multi-day tournament with at least one prior daily snapshot, every leaderboard row shows an arrow + number (or em-dash); sticky columns still work at `<600px`.

## 3. User Stories / Use Cases

- **As a beta student mid-sprint**, I load the tournament leaderboard and instantly see that I moved up 3 positions overnight — so the game feels alive.
- **As a club owner** browsing `/clubs/rankings`, I see which clubs are climbing vs. sliding so I can tell whether my club's strategy is working.
- **As a player who was rank 1 yesterday and is rank 1 today**, the em-dash beside my rank confirms "unchanged" — I'm not left wondering whether the feature is broken.
- **As a first-day tournament participant** (no prior snapshot exists yet), the Rank cell shows just the number — no misleading ↑/↓ arrow.

## 4. Technical Requirements

### 4.1 Architecture

Current state:
- **Tournament leaderboard** is computed on-demand in `TournamentLeaderboardService.getLeaderboard()` at `apps/api/src/tournaments/tournament-leaderboard.service.ts:35` — no snapshot exists, rank is just `index + 1` after sorting.
- **Club rankings** are recomputed nightly (3 AM UTC) in `ClubRankingService.handleNightlyRankingCron()` at `apps/api/src/clubs/club-ranking.service.ts:49`. `clubs.ranking_position` is persisted; a monthly/quarterly snapshot table already exists at `prediction.club_ranking_snapshots`.

Target state:
1. Daily end-of-day snapshots for both surfaces.
2. At API read time, join each row against its latest prior-day snapshot to compute `prev_rank` and `rank_delta = prev_rank - current_rank` (positive = moved up).
3. On day one (no prior snapshot exists), `prev_rank` and `rank_delta` return `null`.

Rationale for daily (not hourly, not per-period): intention explicitly says "previous day's end-of-day ranks is a reasonable default for sprint-length tournaments." Sprints run 3–7 days; one snapshot per day gives meaningful movement without noise. Hourly tracking is a non-goal.

### 4.2 Data Model Changes

**New table** — `prediction.tournament_rank_snapshots`:

```sql
CREATE TABLE IF NOT EXISTS prediction.tournament_rank_snapshots (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tournament_id TEXT NOT NULL REFERENCES prediction.tournaments(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  snapshot_date DATE NOT NULL,
  rank INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tournament_id, user_id, snapshot_date)
);
CREATE INDEX IF NOT EXISTS idx_tournament_rank_snapshots_tournament_date
  ON prediction.tournament_rank_snapshots(tournament_id, snapshot_date DESC);
```

**Extend existing table** — add `'daily'` to `club_ranking_snapshots.period_type` CHECK constraint. The table already has the right shape; we only need to widen the enum and use `period_label = YYYY-MM-DD` for daily rows. A partial index on daily rows keeps reads cheap:

```sql
ALTER TABLE prediction.club_ranking_snapshots
  DROP CONSTRAINT IF EXISTS club_ranking_snapshots_period_type_check;
ALTER TABLE prediction.club_ranking_snapshots
  ADD CONSTRAINT club_ranking_snapshots_period_type_check
  CHECK (period_type IN ('daily', 'monthly', 'quarterly'));
CREATE INDEX IF NOT EXISTS idx_club_ranking_snapshots_daily
  ON prediction.club_ranking_snapshots(period_label DESC)
  WHERE period_type = 'daily';
```

Migration lives at `apps/api/db/migrations/2026-04-18-leaderboard-rank-delta.sql`, idempotent.

### 4.3 API Changes

Endpoint contracts unchanged; DTOs extended.

**Tournament leaderboard** — `GET /tournaments/:id/leaderboard`
- `LeaderboardEntry` interface in `apps/api/src/tournaments/tournament-leaderboard.service.ts:6` gains:
  ```ts
  prev_rank: number | null;
  rank_delta: number | null;
  ```
- Query changes: after computing current ranks, LEFT JOIN against the latest `tournament_rank_snapshots` row per user where `snapshot_date < today_utc` (most recent prior day). If no row exists for a user, both fields are `null`.

**Club rankings** — `GET /clubs/rankings/leaderboard`
- `RankedClub` interface in `apps/api/src/clubs/club-ranking.service.ts:7` gains the same two fields.
- Query changes: LEFT JOIN against `club_ranking_snapshots` rows where `period_type = 'daily'` and `period_label < today_label` (most recent prior daily snapshot).

**Semantics**:
- `rank_delta = prev_rank - current_rank`. Positive → moved up. Negative → moved down. Zero → unchanged.
- `prev_rank` and `rank_delta` are both `null` iff no prior-day snapshot exists for that participant. No partial nulls.

### 4.4 Frontend Changes

**Tournament detail** — `apps/web/src/views/TournamentDetailView.vue:260`
- Current: `<td>{{ entry.rank }}</td>`
- Target: `<td><RankCell :rank="entry.rank" :delta="entry.rank_delta" /></td>`

**Club rankings** — `apps/web/src/views/ClubRankingsView.vue:48`
- Current: `<td class="rank">{{ club.ranking_position }}</td>`
- Target: `<td class="rank"><RankCell :rank="club.ranking_position" :delta="club.rank_delta" /></td>`

**New shared component** — `apps/web/src/components/leaderboard/RankCell.vue`:
- Props: `rank: number`, `delta: number | null`.
- Renders `{rank}` followed by:
  - `delta > 0` → `↑{delta}` in `--ion-color-success` (green).
  - `delta < 0` → `↓{|delta|}` in `--ion-color-danger` (red).
  - `delta === 0` → `—` in `--ion-color-medium` (muted).
  - `delta === null` → nothing (blank — day-one case).
- Glyph rendered via `<span class="delta">` with a monospace width so multi-digit magnitudes don't jitter column width.

**Sticky column preservation** (mobile, `<600px`):
- Tournament table: the Rank cell is already sticky at `left: 0` (see `TournamentDetailView.vue:436`) with the Player cell sticky at `left: 48px`. The rank-cell width must remain ≤ 48px so Player still snaps into place. The `RankCell` component keeps the rank+delta compact (rank right-aligned, delta left-aligned, total ≤ 44px at typical 2-digit rank + 2-digit delta). If a 3-digit rank + 2-digit delta ever pushes past 48px, the component truncates the delta glyph (e.g., `↑99+`) rather than breaking the column.
- Club rankings table: no sticky columns; nothing to preserve.

### 4.5 Infrastructure Requirements

**Daily snapshot cron** — one scheduler entry, fired at 23:50 UTC (chosen to land before the existing 03:00 UTC club ranking recompute, so "yesterday's EOD" is the rank *before* tomorrow morning's recompute overwrites `clubs.ranking_position`).

Implementation sketch — new method `DailyRankSnapshotService.snapshotAll()` invoked by `@Cron('50 23 * * *')`:

1. For each active tournament (`status = 'active'`):
   - Call `TournamentLeaderboardService.getLeaderboard(tournamentId)`.
   - Insert one row per entry into `tournament_rank_snapshots` with `snapshot_date = CURRENT_DATE` (UTC). `ON CONFLICT (tournament_id, user_id, snapshot_date) DO UPDATE SET rank = EXCLUDED.rank`.
2. For each public club:
   - Read `ranking_position` from `prediction.clubs`.
   - Insert into `club_ranking_snapshots` with `period_type = 'daily'`, `period_label = to_char(CURRENT_DATE, 'YYYY-MM-DD')`. Reuse the existing unique constraint.

Gated by `process.env.MARKETS_DISABLE_CLUB_RANKINGS === 'true'` (matches existing cron pattern). A new flag `MARKETS_DISABLE_RANK_SNAPSHOTS` is added for finer control.

**NestJS DI**: every constructor param in the new service gets `@Inject(ClassName)` per `CLAUDE.md`.

## 5. Non-Functional Requirements

- **Performance**: snapshot cron processes O(active_tournaments × entries) + O(public_clubs) rows once per day. At expected beta scale (< 20 active tournaments, < 50 entries each, < 100 public clubs), total < 2,000 inserts/day — negligible.
- **Read-path cost**: leaderboard endpoints add one LEFT JOIN against a date-indexed snapshot table. Integration tests must show no regression > 50ms on a 50-entry leaderboard at the p95 (baseline: current leaderboard response time from club-tournament-experience-polish completion report).
- **Security**: snapshots contain only `user_id` + `rank` + `tournament_id` (or `club_id`) — no new PII surface. Read access follows the same RLS/auth as the underlying leaderboard endpoint.
- **Compatibility**: new DTO fields are additive and nullable; existing web clients that ignore them continue to work. No breaking change.
- **Idempotency**: migration uses `IF NOT EXISTS` / `DROP CONSTRAINT IF EXISTS`; cron snapshot insert uses `ON CONFLICT … DO UPDATE` so a retry or double-fire is safe.
- **Legal language**: no user-facing copy changed; arrow glyph itself carries no "advice/recommendation" language — still safe.

## 6. Out of Scope

Lifted from intention non-goals:
- Hourly rank tracking or sparkline history.
- Rank-change push notifications (the `tournament_rank_change` event type exists at `apps/api/src/markets/markets.types.ts:779` but is emitted elsewhere in a separate effort).
- Rank deltas on entity-level performance-attribution tables.

Additionally out of scope for this effort:
- Retroactive backfill of snapshots for in-flight tournaments (there is no historical data to backfill from — snapshots start when the cron starts; that's acceptable per "null on day-one shows nothing").
- Tournament leaderboard caching/materialization beyond what's needed for the delta join.
- Club-level "Biggest Mover" badge surfacing daily deltas — `rising_club` / `most_improved` badges stay on the existing monthly cadence.
- Admin UI to manually trigger or inspect snapshots.

## 7. Dependencies & Risks

**Dependencies**:
- `@nestjs/schedule` is already in use (`club-ranking.service.ts` imports `Cron`). No new package.
- Migration runner pattern established at `apps/api/db/migrations/` — follow the existing idempotent convention.

**Risks**:

1. **Cron timing vs. club recompute**: the existing club ranking cron runs 03:00 UTC and overwrites `clubs.ranking_position`. If the daily snapshot ran *after* 03:00 UTC, it would capture "today's recomputed rank" as if it were yesterday's. *Mitigation*: run the daily snapshot at 23:50 UTC (before the 03:00 recompute). Plan phase 1 includes an assertion test for ordering.

2. **Tournament daily snapshot runs when tournament is paused or not yet started**: the current `status` filter (`'active'` only) must hold. If we accidentally snapshot `upcoming` tournaments, they'd have all-zero portfolios and produce meaningless deltas when the sprint starts. *Mitigation*: explicit `WHERE t.status = 'active' AND t.starts_at <= now()` guard. Covered by unit test.

3. **Mid-tournament join**: if a user joins a tournament on Day 2, their first snapshot is Day 2's. On Day 3 they see a delta. On Day 2 they see null → blank (correct — they have no prior rank).

4. **Timezone semantics**: "end of day" is ambiguous. *Mitigation*: we use UTC throughout; `snapshot_date` is a `DATE` column stored in UTC. Intention doesn't require user-local boundaries, and all existing cron jobs use UTC.

5. **Ties in ranking**: current `ORDER BY (total_realized_pnl + total_unrealized_pnl) DESC` with no tiebreaker means ties get arbitrary ranks across snapshots — a user tied for 3rd might be rank 3 yesterday and rank 4 today, showing a spurious `↓1`. *Mitigation*: add `user_id ASC` as a deterministic tiebreaker to the ORDER BY (both at read time and snapshot time). This is a tiny, contained fix; the intention allows it ("hand-check accurate" implies deterministic).

6. **Sticky-column overflow on mobile**: a 3-digit rank + 2-digit delta could push the cell wider than the 48px offset the Player column expects, breaking sticky positioning. *Mitigation*: component truncates to `↑99+` / `↓99+` and uses a monospace span; Chrome verification at 375px width on a 100-row leaderboard is part of the Phase 3 quality gate.

## 8. Phasing

Three phases — each independently mergeable and validated.

### Phase 1 — Snapshot infrastructure (DB + cron)

- Write migration `2026-04-18-leaderboard-rank-delta.sql`:
  - Create `prediction.tournament_rank_snapshots` table + index.
  - Extend `prediction.club_ranking_snapshots` period_type CHECK; add partial daily index.
- Create `DailyRankSnapshotService` in `apps/api/src/tournaments/` (or a shared location — decide in plan). Fields injected via `@Inject(ClassName)`.
- Register `@Cron('50 23 * * *')` hook. Gate with `MARKETS_DISABLE_RANK_SNAPSHOTS`.
- Add tiebreaker `user_id ASC` to tournament leaderboard query ORDER BY.
- Unit tests: (a) snapshot creates one row per active tournament entry; (b) re-running the same day overwrites not duplicates; (c) inactive/upcoming tournaments are skipped; (d) club snapshot uses `period_type = 'daily'` with `YYYY-MM-DD` label.
- Gate: lint, build, unit tests, `curl` the leaderboard endpoints to confirm shape unchanged, manually invoke `snapshotAll()` in dev and inspect the tables.

### Phase 2 — API DTO + delta computation

- Extend `LeaderboardEntry` and `RankedClub` interfaces with `prev_rank` and `rank_delta`.
- Update `TournamentLeaderboardService.getLeaderboard()` SQL to LEFT JOIN the latest prior-day snapshot per `(tournament_id, user_id)`.
- Update `ClubRankingService.getLeaderboard()` SQL to LEFT JOIN the latest prior-day `club_ranking_snapshots` row per club.
- Integration test: seed two daily snapshots, call endpoint, assert three movers (up/down/unchanged) + one null (new user, no prior snapshot).
- Gate: lint, build, unit tests, integration test passes, `curl` returns new fields and existing fields unchanged.

### Phase 3 — Web render (RankCell component + table wiring)

- Create `apps/web/src/components/leaderboard/RankCell.vue`.
- Wire it into `TournamentDetailView.vue:260` and `ClubRankingsView.vue:48`.
- Extend the web DTO types (if there's a matching `types.ts` or Pinia store interface) to include `prev_rank` and `rank_delta`.
- CSS: ensure total rank-cell width ≤ 48px at 2-digit rank + 2-digit delta on mobile; truncate with `99+` suffix above that.
- Gate: lint, build, Chrome verification on both `/tournaments/:id` (Leaderboard tab) and `/clubs/rankings`:
  - Day-one state: arrows are blank, rank column renders normally.
  - With seeded prior snapshot: green ↑, red ↓, muted em-dash all render.
  - At 375px viewport: sticky columns still work, no horizontal reflow breakage, arrow fits inside rank cell.
- Phase Review: re-read intention "Success Criteria" — every bullet verified.
