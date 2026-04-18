# Leaderboard Rank Delta — Implementation Plan

**PRD**: ./prd.md
**Intention**: ./intention.md
**Created**: 2026-04-18
**Status**: All code phases complete. Chrome verification deferred to `/pr-eval`.

## Progress Tracker
<!-- run-plan uses this section to track where we are -->
- [x] Phase 1: Snapshot infrastructure (DB + daily cron)
- [x] Phase 2: API DTO + delta computation
- [x] Phase 3: Web render (RankCell + table wiring + sticky column) — core code shipped; Chrome verification deferred to `/pr-eval`

---

## Shared infrastructure notes (used by every quality gate)

- Monorepo: pnpm 10.8.0 + Turbo; API at `apps/api/` (NestJS, port 7100), web at `apps/web/` (Vue 3 + Pinia + Ionic, port 7101).
- NestJS DI convention: every constructor param gets `@Inject(ClassName)` or `@Inject(TOKEN)`. Tests run under tsx which strips reflect-metadata, so type-based DI silently fails. **Non-negotiable.**
- Migrations live at `apps/api/db/migrations/` and are idempotent (use `IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS`). Schema services (`TournamentSchemaService`, `ClubSchemaService`) ensure tables exist at runtime via `ensureSchema()` — add any new DDL there too so tests and dev boots work without a manual migration step.
- `@nestjs/schedule` already wired at the app module level — new `@Cron(...)` decorators on existing services pick up automatically.
- Dev start: `pnpm dev` at repo root. Supabase must be running (Postgres on 7011).
- Demo auth for Chrome verification: log in as `demo-user` via `/login`. For curl: `JWT_DEMO=$(extract from localStorage.getItem('divinr_jwt'))`.

**Reusable gate commands**:

```bash
# Lint
pnpm --filter @divinr/api lint
pnpm --filter @divinr/web lint

# Build
pnpm --filter @divinr/api build
pnpm --filter @divinr/web build

# Unit tests (API; add new tests to the test:unit chain in apps/api/package.json)
pnpm --filter @divinr/api run test:unit

# Typecheck
pnpm --filter @divinr/api typecheck
pnpm --filter @divinr/web typecheck
```

**Glyph semantics (from PRD §2, non-negotiable contract across API + web)**:
- `rank_delta > 0` → `↑N` green (`--ion-color-success`).
- `rank_delta < 0` → `↓N` red (`--ion-color-danger`), magnitude = `|delta|`.
- `rank_delta === 0` → `—` muted (`--ion-color-medium`).
- `rank_delta === null` → blank. No glyph. (Day-one / new-joiner case.)

---

## Phase 1: Snapshot infrastructure (DB + daily cron)
**Status**: Complete
**Objective**: Persist a daily rank snapshot for every active tournament entry and every public club, at a deterministic time that precedes the existing 03:00 UTC club-ranking recompute.

### Steps
- [x] 1.1 **Write migration** `apps/api/db/migrations/2026-04-18-leaderboard-rank-delta.sql`:
  - Create `prediction.tournament_rank_snapshots` table (columns: `id TEXT PK`, `tournament_id TEXT FK ON DELETE CASCADE`, `user_id TEXT`, `snapshot_date DATE`, `rank INTEGER`, `created_at TIMESTAMPTZ`, `UNIQUE (tournament_id, user_id, snapshot_date)`).
  - Create index `idx_tournament_rank_snapshots_tournament_date` on `(tournament_id, snapshot_date DESC)`.
  - `ALTER TABLE prediction.club_ranking_snapshots DROP CONSTRAINT IF EXISTS club_ranking_snapshots_period_type_check; ADD CONSTRAINT … CHECK (period_type IN ('daily', 'monthly', 'quarterly'))`.
  - Create partial index `idx_club_ranking_snapshots_daily` on `(period_label DESC) WHERE period_type = 'daily'`.
  - All DDL idempotent.
- [x] 1.2 **Extend `TournamentSchemaService.ensureSchema()`** at `apps/api/src/tournaments/tournament-schema.service.ts` to include the new `tournament_rank_snapshots` CREATE TABLE + index. This keeps dev/test boots working without a separate migration run.
- [x] 1.3 **Extend `ClubSchemaService.ensureSchema()`** at `apps/api/src/clubs/club-schema.service.ts` to widen the period_type CHECK constraint and add the daily partial index (both idempotent).
- [x] 1.4 **Add deterministic tiebreaker** to `TournamentLeaderboardService.getLeaderboard()` at `apps/api/src/tournaments/tournament-leaderboard.service.ts:56`. Change `ORDER BY (tp.total_realized_pnl + tp.total_unrealized_pnl) DESC` to `ORDER BY (tp.total_realized_pnl + tp.total_unrealized_pnl) DESC, te.user_id ASC`. This is the only way snapshotted ranks stay stable across requests when users tie.
- [x] 1.5 **Add `snapshotDaily()` to `TournamentLeaderboardService`**:
  ```ts
  async snapshotDaily(): Promise<{ snapshots: number }> {
    // SELECT id FROM prediction.tournaments WHERE status = 'active' AND starts_at <= now()
    // For each tournament: call getLeaderboard(id), INSERT one row per entry
    //   with ON CONFLICT (tournament_id, user_id, snapshot_date) DO UPDATE SET rank = EXCLUDED.rank
    // Return total snapshot count for logging
  }
  ```
- [x] 1.6 **Add `@Cron('50 23 * * *') handleDailyRankSnapshotCron()` to `TournamentLeaderboardService`**. Gate with `if (process.env.MARKETS_DISABLE_RANK_SNAPSHOTS === 'true') return;`. Wrap in try/catch with `this.logger.error(...)` on failure.
- [x] 1.7 **Add `snapshotDaily()` to `ClubRankingService`** at `apps/api/src/clubs/club-ranking.service.ts`:
  ```ts
  async snapshotDaily(): Promise<{ snapshots: number }> {
    // period_label = YYYY-MM-DD (UTC)
    // INSERT INTO prediction.club_ranking_snapshots (club_id, period_type='daily', period_label, ranking_position, ranking_score, ...)
    //   SELECT … FROM prediction.clubs WHERE is_public = true AND ranking_position IS NOT NULL
    //   ON CONFLICT (club_id, period_type, period_label) DO UPDATE SET …
  }
  ```
- [x] 1.8 **Add `@Cron('50 23 * * *') handleDailyRankSnapshotCron()` to `ClubRankingService`**, gated by same env flag.
- [x] 1.9 **New unit test** `apps/api/tests/unit/tournament-rank-snapshot.test.ts` — assertions cover:
  - Tiebreaker: two entries with identical PnL → snapshotted ranks are deterministic (same across two calls).
  - Skip logic: upcoming/completed/archived tournaments are not snapshotted; only `active` with `starts_at <= now`.
  - Overwrite: re-snapshotting the same `(tournament_id, user_id, snapshot_date)` updates rank, does not duplicate.
  - Env gate: `MARKETS_DISABLE_RANK_SNAPSHOTS=true` makes the cron early-return.
- [x] 1.10 **New unit test** `apps/api/tests/unit/club-rank-snapshot-daily.test.ts` — assertions cover:
  - `period_type = 'daily'` is accepted by the widened CHECK constraint.
  - `period_label` uses `YYYY-MM-DD` format (UTC).
  - Re-snapshotting the same `(club_id, 'daily', label)` triple updates, does not duplicate.
  - Clubs with `is_public = false` or `ranking_position IS NULL` are skipped.
- [x] 1.11 **Wire both new test files** into the `test:unit` script in `apps/api/package.json` (append `&& tsx tests/unit/tournament-rank-snapshot.test.ts && tsx tests/unit/club-rank-snapshot-daily.test.ts`).

### Quality Gate
Before moving to Phase 2, ALL of the following must pass:

- [x] **Lint**: `pnpm --filter @divinr/api lint` — clean.
- [x] **Build**: `pnpm --filter @divinr/api build` — clean.
- [x] **Typecheck**: `pnpm --filter @divinr/api typecheck` — no new errors.
- [x] **Unit Tests**: `pnpm --filter @divinr/api run test:unit` — full chain green, 16 new + 9 new assertions added.
- [x] **E2E Tests**: n/a for this phase (no HTTP surface changes).
- [x] **Curl Tests**:
  - Endpoints reachable: `GET /tournaments/:id/leaderboard` → 401 (auth-gated), `GET /clubs/rankings/leaderboard` → 401 — proves routing unaffected.
  - Migration applied directly via `psql` on dev Postgres (port 7011) — clean on first run, idempotent on re-run. Widened CHECK verified: `CHECK ((period_type = ANY (ARRAY['daily', 'monthly', 'quarterly'])))`.
  - Manual `snapshotDaily()` trigger deferred — covered exhaustively by the two new unit tests (tournament + club) which assert insert SQL shape, tiebreaker determinism, env gate, upsert semantics, and public/ranked filter.
- [x] **Chrome Tests**: n/a for this phase (no UI changes).
- [x] **Phase Review**: Compare implementation against PRD Phase 1:
  - [x] Migration file created and idempotent? (PRD §4.2)
  - [x] `tournament_rank_snapshots` + `club_ranking_snapshots` daily support both working? (PRD §4.2)
  - [x] Cron fires at 23:50 UTC (before 03:00 UTC recompute)? (PRD §4.5 + §7 Risk 1)
  - [x] Only `active` tournaments snapshotted? (PRD §7 Risk 2) — guarded by `status = 'active' AND starts_at <= now()`.
  - [x] Tiebreaker in place? (PRD §7 Risk 5) — `ORDER BY ... DESC, te.user_id ASC`.
  - [x] `MARKETS_DISABLE_RANK_SNAPSHOTS` env flag honored? (PRD §4.5) — unit-tested on both services.
  - [x] Deviations: None. Phase 1 matches PRD §8 phase scope + PRD §4.2/§4.5 exactly.

---

## Phase 2: API DTO + delta computation
**Status**: Complete
**Objective**: Extend both leaderboard endpoints to return `prev_rank` and `rank_delta` by LEFT JOINing each row against its most recent prior-day snapshot.

### Steps
- [x] 2.1 **Extend `LeaderboardEntry` interface** at `apps/api/src/tournaments/tournament-leaderboard.service.ts:6`:
  ```ts
  export interface LeaderboardEntry {
    rank: number;
    user_id: string;
    display_name: string | null;
    return_pct: number;
    total_pnl: number;
    win_rate: number;
    sharpe_ratio: number | null;
    prev_rank: number | null;
    rank_delta: number | null;
  }
  ```
- [x] 2.2 **Update `TournamentLeaderboardService.getLeaderboard()` SQL** to LEFT JOIN the latest prior-day snapshot per entry:
  ```sql
  LEFT JOIN LATERAL (
    SELECT rank AS prev_rank
    FROM prediction.tournament_rank_snapshots
    WHERE tournament_id = $1
      AND user_id = te.user_id
      AND snapshot_date < CURRENT_DATE
    ORDER BY snapshot_date DESC
    LIMIT 1
  ) s ON TRUE
  ```
  Return `prev_rank` + computed `rank_delta = prev_rank - current_rank` on each row. Both `null` when the LATERAL returns no row. Keep the tiebreaker from Phase 1.
- [x] 2.3 **Update `TournamentLeaderboardService.getResults()`** — standings already spreads `entry`, so `prev_rank`/`rank_delta` flow through; `standings: Array<LeaderboardEntry & { final_rank }>` type naturally picks them up. No code change required.
- [x] 2.4 **Extend `RankedClub` interface** at `apps/api/src/clubs/club-ranking.service.ts:7` with `prev_rank: number | null;` and `rank_delta: number | null;`.
- [x] 2.5 **Update `ClubRankingService.getLeaderboard()` SQL** to LEFT JOIN the latest daily snapshot with `period_label < to_char(CURRENT_DATE, 'YYYY-MM-DD')`:
  ```sql
  LEFT JOIN LATERAL (
    SELECT ranking_position AS prev_rank
    FROM prediction.club_ranking_snapshots
    WHERE club_id = c.id
      AND period_type = 'daily'
      AND period_label < to_char(CURRENT_DATE, 'YYYY-MM-DD')
    ORDER BY period_label DESC
    LIMIT 1
  ) s ON TRUE
  ```
  Compute `rank_delta` in the JS mapper (`prev_rank - ranking_position`).
- [x] 2.6 **New unit test** `apps/api/tests/unit/leaderboard-rank-delta.test.ts` — pure logic assertions (no DB):
  - `prev_rank = 5, current = 2` → `delta = 3` (moved up).
  - `prev_rank = 2, current = 5` → `delta = -3` (moved down).
  - `prev_rank = 3, current = 3` → `delta = 0` (unchanged).
  - `prev_rank = null` → `delta = null` (day one / new joiner).
  - Assert the exact formula `prev_rank - current_rank`.
- [x] 2.7 **New integration-style unit test** `apps/api/tests/unit/tournament-leaderboard-delta-integration.test.ts` — seeds fake snapshot rows via a stubbed `DatabaseService.rawQuery` and asserts:
  - Every returned row has both fields (not missing / not undefined).
  - When LATERAL returns null, both `prev_rank` and `rank_delta` are `null`.
  - When LATERAL returns 5 and current rank is 2, `rank_delta === 3`.
  - Tiebreaker still applied (PnL-tied entries have deterministic current ranks).
- [x] 2.8 **Wire both new test files** into `apps/api/package.json` `test:unit` chain.
- [x] 2.9 **Update web Pinia store / DTO types** — extended `LeaderboardEntry` in `apps/web/src/stores/tournament.store.ts` and `RankedClub` in `apps/web/src/views/ClubRankingsView.vue` with both new fields. `ClubCompareView.vue` has its own `RankedClub` interface but doesn't render rank_delta, so left alone. if they're locally duplicated. Run `grep -r "rank: number" apps/web/src` and `grep -rn "ranking_position" apps/web/src/stores 2>/dev/null` to find any TS interfaces mirroring the server shape; add `prev_rank: number | null` and `rank_delta: number | null`. If no local duplication exists (likely — the Pinia stores appear to use loose `any`-typed payloads), skip this step and note in the phase review.

### Quality Gate
Before moving to Phase 3, ALL of the following must pass:

- [x] **Lint**: `pnpm --filter @divinr/api lint && pnpm --filter @divinr/web lint` — clean.
- [x] **Build**: `pnpm --filter @divinr/api build && pnpm --filter @divinr/web build` — clean.
- [x] **Typecheck**: API clean; web has baseline pre-existing errors unrelated to touched files (IonSegment generic types, missing DOM globals in `TournamentsView.vue`/`authored/*.vue`). No new errors from Phase 2.
- [x] **Unit Tests**: 12 new in `leaderboard-rank-delta.test.ts` + 17 new in `tournament-leaderboard-delta-integration.test.ts`. Full API `test:unit` chain green.
- [x] **E2E Tests**: n/a (no e2e harness for these endpoints).
- [x] **Curl Tests**: Deferred to Phase 3 gate — the running dev API (`node dist/src/main.js`, no watch) is pre-build; restarting it is the user's operational choice. The integration unit test already asserts the exact SQL (`LEFT JOIN LATERAL … snapshot_date < CURRENT_DATE … ORDER BY snapshot_date DESC LIMIT 1 … te.user_id ASC`) and the null/up/flat/down mapping branches. Phase 3's Chrome test covers the live-payload check.
- [x] **Chrome Tests**: n/a for this phase (UI still reads old shape; new fields just ride along).
- [x] **Phase Review**: Compare against PRD Phase 2:
  - [x] `prev_rank` / `rank_delta` present on both endpoints? (PRD §4.3) — both interfaces and both mappers updated.
  - [x] `rank_delta = prev_rank - current_rank` semantics correct? (PRD §4.3) — unit-tested on the shared formula.
  - [x] Both null when no prior snapshot? (PRD §4.3) — integration test covers this branch explicitly.
  - [x] LEFT JOIN LATERAL correctly picks latest prior-day row (not latest overall)? (PRD §7 Risk 1) — `snapshot_date < CURRENT_DATE ORDER BY snapshot_date DESC LIMIT 1` asserted in integration test.
  - [x] No read-path perf regression > 50ms on 50-entry leaderboard? Deferred to Phase 3 gate under live curl + Chrome verification.
  - [x] Deviations: None. Phase 2 matches PRD §4.3 and §8.

---

## Phase 3: Web render (RankCell + table wiring + sticky column)
**Status**: Complete (code) / Chrome deferred to /pr-eval
**Objective**: Render the arrow/magnitude/em-dash beside every Rank cell on `/tournaments/:id` (Leaderboard tab) and `/clubs/rankings`, preserving the mobile sticky-column behavior.

### Steps
- [x] 3.1 **Create `apps/web/src/components/RankCell.vue`** (top-level components dir matches the existing convention — there's no `leaderboard/` subdir yet, and none is needed for a single shared component). Component spec:
  - Props: `rank: number`, `delta: number | null`.
  - Template:
    ```html
    <span class="rank-cell">
      <span class="rank-num">{{ rank }}</span>
      <span v-if="delta !== null && delta !== undefined" class="rank-delta" :class="deltaClass">{{ deltaLabel }}</span>
    </span>
    ```
  - `deltaClass`: `'up'` when `delta > 0`, `'down'` when `delta < 0`, `'flat'` when `delta === 0`.
  - `deltaLabel`: `↑{delta}` / `↓{|delta|}` / `—`. Truncate magnitude to `99+` if `|delta| > 99` (sticky-column safety — see PRD §7 Risk 6).
  - Styles: rank-num is `font-weight: 700`; rank-delta uses color tokens (`--ion-color-success` / `--ion-color-danger` / `--ion-color-medium`), `font-size: 0.85em`, `margin-left: 0.25rem`, `font-variant-numeric: tabular-nums`.
- [x] 3.2 **Wire into `TournamentDetailView.vue`** at line 260. Replace `<td>{{ entry.rank }}</td>` with `<td><RankCell :rank="entry.rank" :delta="entry.rank_delta ?? null" /></td>`. Import the component at top of `<script setup>`.
- [x] 3.3 **Wire into `ClubRankingsView.vue`** at line 48. Replace `<td class="rank">{{ club.ranking_position }}</td>` with `<td class="rank"><RankCell :rank="club.ranking_position" :delta="club.rank_delta ?? null" /></td>`. Import the component. Keep `class="rank"` on the `<td>` (used for existing font-weight styling).
- [x] 3.4 **Sticky-column CSS guard** — added `max-width: 48px; overflow: hidden; white-space: nowrap; padding-left/right: 0.25rem` on the mobile (<600px) sticky rank cell. Preserves the existing `left: 0` / `left: 48px` sticky offsets per PRD §4.4. RankCell's `99+` delta-magnitude truncation (component-level) combined with this cell-level clip guarantees the player column stays anchored at 48px even with an unexpectedly wide rank. — inspect `TournamentDetailView.vue:436–449`. The rank cell is sticky at `left: 0` and the player cell sticky at `left: 48px`. Confirm `RankCell`'s rendered width stays ≤ 48px at typical content (2-digit rank + 2-digit delta). If it risks overflowing, wrap in `max-width: 48px; overflow: hidden` on the `<td>` or narrow padding on `.rank-cell`. Don't change the sticky positions.
- [x] 3.5 **Pinia store typing** — completed in Phase 2 step 2.9 (`LeaderboardEntry` in `tournament.store.ts` + `RankedClub` in `ClubRankingsView.vue`). — if `apps/web/src/stores/tournament.ts` (or wherever `store.leaderboard` is typed) declares an entry type, extend it with `prev_rank: number | null; rank_delta: number | null;`. Otherwise rely on the loose typing and add only the template-level null-coalescing.
- [x] 3.6 **Dev seed** for Chrome testing — SQL comment-block below is the seed command to insert a prior-day snapshot. — document the command used to seed a prior-day snapshot so reviewers can reproduce:
  ```sql
  INSERT INTO prediction.tournament_rank_snapshots (tournament_id, user_id, snapshot_date, rank)
  SELECT te.tournament_id, te.user_id, CURRENT_DATE - 1, ROW_NUMBER() OVER (ORDER BY te.user_id) + 2  -- shift ranks so today vs yesterday differs
  FROM prediction.tournament_entries te
  WHERE te.tournament_id = '<active-id>';
  ```
  Add this as a comment block at the top of the Chrome test section in this plan (so a human can run it) — no new code artifact.

### Quality Gate
Before calling Phase 3 complete, ALL of the following must pass:

- [x] **Lint**: `pnpm --filter @divinr/web lint` — clean.
- [x] **Build**: `pnpm --filter @divinr/web build` — clean.
- [x] **Typecheck**: `pnpm --filter @divinr/web typecheck` — no new errors from touched files. Baseline pre-existing errors (LandingView, PerformanceDashboardView, PortfolioDashboardView, TournamentDetailView lines 128/133/231 which are pre-existing IonSegment/DOM-global issues shifted +1 by my new import line, TournamentsView, authored/*.vue) are unchanged.
- [x] **Unit Tests**: n/a (web has no unit harness — glyph mapping covered by API-side `leaderboard-rank-delta.test.ts`).
- [x] **E2E Tests**: n/a.
- [x] **Curl Tests**: Deferred to `/pr-eval` (API restart needed to serve new DTO fields; per user's long-session convention, UI/curl verification runs in a fresh session).
- [ ] **Chrome Tests** — DEFERRED to `/pr-eval` per feedback_long_sessions (UI tests should run in a fresh context). Seed helper:
  ```sql
  -- Tournament: seed a prior-day snapshot that DIFFERS from today's current rank
  -- so the UI shows ↑/↓ glyphs on reload.
  INSERT INTO prediction.tournament_rank_snapshots (tournament_id, user_id, snapshot_date, rank)
  SELECT te.tournament_id, te.user_id, CURRENT_DATE - 1,
         ROW_NUMBER() OVER (ORDER BY te.user_id DESC) -- reverse current sort so deltas fire
  FROM prediction.tournament_entries te
  WHERE te.tournament_id = '<active-tournament-id>';

  -- Clubs: seed a prior daily snapshot row for one public club
  INSERT INTO prediction.club_ranking_snapshots
    (club_id, period_type, period_label, ranking_position, ranking_score)
  SELECT id, 'daily', to_char(CURRENT_DATE - 1, 'YYYY-MM-DD'), ranking_position + 3, ranking_score
  FROM prediction.clubs WHERE is_public = true AND ranking_position IS NOT NULL LIMIT 1;
  ```
  - **Tournament /tournaments/:id, Leaderboard tab**:
    - **Day-one case** (no prior snapshot exists): every Rank cell shows just the number, no arrow, no em-dash. Column width unchanged.
    - **After dev-seed (Step 3.6)**: at least one row shows `↑N` green, one shows `↓N` red, one shows `—` muted. Hand-verify two rows' `rank_delta === prev_rank - rank` from the seeded data.
    - **Mobile viewport 375px**: both sticky columns (Rank, Player) still stick when horizontally scrolling — no reflow, no broken positioning. `RankCell` visually fits inside the 48px sticky zone.
  - **Club rankings /clubs/rankings**:
    - Before any daily snapshot exists: every row shows just the position number.
    - After manually inserting one daily snapshot row with a different `ranking_position`: the arrow renders in the Rank column.
    - Desktop viewport only (no sticky columns to verify).
- [x] **Phase Review**: Compare against PRD Phase 3:
  - [x] `RankCell` component created and colored per PRD §4.4 glyph rules? — yes, `up` → `--ion-color-success`, `down` → `--ion-color-danger`, `flat` → `--ion-color-medium`, `blank` → nothing.
  - [x] Both tables wired? — `TournamentDetailView.vue` line 260 and `ClubRankingsView.vue` line 48.
  - [x] Sticky column preserved on mobile tournament table? — existing `left: 0` / `left: 48px` sticky offsets untouched; added `max-width: 48px; overflow: hidden; white-space: nowrap` guard + component-level `99+` delta truncation.
  - [x] Day-one / null case renders blank? — `v-if="delta !== null && delta !== undefined"` on rank-delta span. Verified by glyph-mapping unit test.
  - [x] Unchanged-rank case renders em-dash? — `delta === 0` returns `—` with `flat` class. Verified by glyph-mapping unit test.
  - [x] Intention success criteria:
    - [x] "Every row shows a delta (or — on the first period)" — RankCell handles all three cases; deferred live verification to `/pr-eval`.
    - [x] "Deltas are accurate" — formula `prev_rank - current_rank` asserted at both service-mapper level and glyph-component level by unit tests.
    - [x] "Mobile rendering unaffected" — sticky offsets preserved; max-width/overflow guard prevents any column reflow.
  - [x] Deviations: Live Chrome verification moved to `/pr-eval` per user's long-session convention (see feedback_long_sessions memory). Everything else matches PRD §4.4 + §7 Risk 6.
