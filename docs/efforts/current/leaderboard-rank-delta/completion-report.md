# Leaderboard Rank Delta — Completion Report

**Plan**: ./plan.md
**PRD**: ./prd.md
**Intention**: ./intention.md
**Completed**: 2026-04-19 (code) / Chrome verification pending `/pr-eval`
**Final Status**: All code phases complete. One non-blocking item (live Chrome test) deferred to `/pr-eval` per the user's long-session convention.

## Summary
- Total phases: 3
- Phases completed (code): 3
- Phases remaining: 0 code; 1 verification item (live Chrome walkthrough on a fresh session)

## Phase Results

### Phase 1 — Snapshot infrastructure — **Complete**
Shipped:
- Migration `apps/api/db/migrations/2026-04-18-leaderboard-rank-delta.sql` (idempotent: new `tournament_rank_snapshots` table + index, widened `club_ranking_snapshots.period_type` CHECK, partial daily index). Verified applying the migration to dev Postgres twice — second run emits NOTICE and skips.
- `TournamentSchemaService.ensureSchema()` and `ClubSchemaService.ensureSchema()` both extended so dev/test boots work without a manual migration step.
- Deterministic tiebreaker `ORDER BY (…) DESC, te.user_id ASC` on the tournament leaderboard query (PRD §7 Risk 5).
- `TournamentLeaderboardService.snapshotDaily()` + `@Cron('50 23 * * *')` gated by `MARKETS_DISABLE_RANK_SNAPSHOTS`. Filters `status = 'active' AND starts_at <= now()`. Upserts on `(tournament_id, user_id, snapshot_date)`.
- `ClubRankingService.snapshotDaily()` + same-schedule cron, same env gate. Inserts one row per public + ranked club with `period_type='daily'`, `period_label=YYYY-MM-DD (UTC)`. Upserts on `(club_id, period_type, period_label)`.
- Two new unit tests: `tournament-rank-snapshot.test.ts` (16 assertions) and `club-rank-snapshot-daily.test.ts` (9 assertions). Wired into `apps/api/package.json` `test:unit` chain.

No deviations from PRD §4.2, §4.5, §7 Risks 1/2/5 or §8 Phase 1.

### Phase 2 — API DTO + delta computation — **Complete**
Shipped:
- `LeaderboardEntry` and `RankedClub` TypeScript interfaces extended with `prev_rank: number | null` and `rank_delta: number | null`.
- `TournamentLeaderboardService.getLeaderboard()` SQL gains a `LEFT JOIN LATERAL (SELECT rank AS prev_rank FROM prediction.tournament_rank_snapshots WHERE tournament_id = $1 AND user_id = te.user_id AND snapshot_date < CURRENT_DATE ORDER BY snapshot_date DESC LIMIT 1)` to pick the most recent prior-day row. JS mapper computes `rank_delta = prev_rank - current_rank`; both fields are `null` iff the LATERAL returned no row.
- `ClubRankingService.getLeaderboard()` mirrors the same LATERAL pattern against `club_ranking_snapshots` filtered to `period_type='daily' AND period_label < to_char(CURRENT_DATE, 'YYYY-MM-DD')`.
- Web types updated: `LeaderboardEntry` in `apps/web/src/stores/tournament.store.ts`, `RankedClub` in `apps/web/src/views/ClubRankingsView.vue`.
- Two new unit tests: `leaderboard-rank-delta.test.ts` (12 pure-logic assertions: sign conventions, null propagation, large magnitudes, glyph mapping) and `tournament-leaderboard-delta-integration.test.ts` (17 assertions: SQL shape verbatim, null branch, up/flat/down deltas via a stubbed DatabaseService). Both wired into `test:unit`.

Deviations: Live `curl` for payload shape was deferred to Phase 3/PR-eval — the running dev API is `node dist/src/main.js` (no watch), and restarting the user's dev process mid-run was out of scope. The integration unit test already asserts the exact SQL (`LEFT JOIN LATERAL`, `snapshot_date < CURRENT_DATE`, `ORDER BY snapshot_date DESC LIMIT 1`, tiebreaker) and every mapping branch (null, up, flat, down).

### Phase 3 — Web render — **Code complete**
Shipped:
- New `apps/web/src/components/RankCell.vue`. Props `rank: number`, `delta: number | null`. Template renders the rank number followed by an optional delta span. Colors: `up → --ion-color-success`, `down → --ion-color-danger`, `flat → --ion-color-medium`. `null`/`undefined` delta → blank (no glyph). Truncates to `99+` when `|delta| > 99` (PRD §7 Risk 6).
- Wired into `TournamentDetailView.vue:261` and `ClubRankingsView.vue:49`.
- Sticky-column guard on mobile (<600px): added `max-width: 48px; overflow: hidden; white-space: nowrap; padding: 0.25rem 0.25rem` to the sticky rank cell. Existing `left: 0` / `left: 48px` sticky offsets preserved.
- Seed helper SQL documented inline in `plan.md` Phase 3 gate so a reviewer can reproduce ↑/↓/— on demand.

Deferred: Live Chrome verification. The user's memory (`feedback_long_sessions.md`) says UI tests should run in a fresh context, not bolted onto long backend sessions. `/pr-eval` will run this morning against a fresh API build.

## Gate Results

| Gate | Phase 1 | Phase 2 | Phase 3 |
|------|---------|---------|---------|
| Lint (API) | ✅ | ✅ | n/a |
| Build (API) | ✅ | ✅ | n/a |
| Typecheck (API) | ✅ | ✅ | n/a |
| Unit tests (API) | ✅ full chain + 25 new | ✅ + 29 new | n/a |
| Lint (web) | n/a | ✅ | ✅ |
| Build (web) | n/a | ✅ | ✅ |
| Typecheck (web) | n/a | ✅ (baseline errors only) | ✅ (baseline errors only) |
| Curl | ✅ reachability + migration idempotency | Deferred to `/pr-eval` | Deferred to `/pr-eval` |
| Chrome | n/a | n/a | **Deferred to `/pr-eval`** |

Total new test assertions added across Phase 1/2: **54** (16 + 9 + 12 + 17). Every existing unit test in the `apps/api` chain continues to pass.

## Deviations from PRD

1. **Live `curl` + Chrome verification deferred to `/pr-eval`.** PRD §8 phases specify `curl` and Chrome as gate items; I executed every non-live gate (lint/build/typecheck/unit) and relied on the integration unit test's verbatim SQL assertions for Phase 2 shape verification. The deferral is consistent with the user's `feedback_long_sessions` memory and `/pr-eval` already exists for this purpose.
2. **Performance micro-benchmark (`time curl` on a seeded 50-entry leaderboard) deferred to `/pr-eval`.** PRD §5 sets a ≤50 ms p95 regression budget. The LATERAL join uses the new `(tournament_id, snapshot_date DESC)` and `WHERE period_type='daily'` partial indexes, so the query planner has fast paths in both cases. No measurement taken yet.

No functional deviations. Both endpoints return the additive fields per PRD §4.3; both crons fire at 23:50 UTC per PRD §4.5; snapshot filters match PRD §7 Risks 1/2; tiebreaker matches §7 Risk 5; truncation matches §7 Risk 6.

## Next Steps

1. Run `/pr-eval` (autonomous agent) to:
   - Restart API so `rank_delta`/`prev_rank` are on the live payload.
   - `curl` both endpoints and confirm shape.
   - Chrome walkthrough at 375px: day-one blank, seeded ↑/↓/— render, sticky columns intact.
   - Measure `time curl` on a 50-entry fixture vs. baseline — confirm no regression beyond the 50 ms budget.
2. If `/pr-eval` passes, merge.
3. Follow-up work discovered during implementation: none. Everything in the PRD scope is code-complete.
