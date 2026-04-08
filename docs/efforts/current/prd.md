- # Day Traders & Leaderboard — Product Requirements Document

## 1. Overview

Close out the multi-actor paper-trading game by (a) replacing the three `StubStrategy`
placeholders shipped in `effort/portfolio-foundation-resume` with real day-trader
signal logic wired into the live 15-minute price-refresh tick, and (b) upgrading the
existing `/portfolios` master-detail view into a full leaderboard with risk-adjusted
metrics, equity-curve detail, calibration, sort, search, and kind filters.

This is the third and final effort in the multi-actor arc; foundations and agent
autotrading already shipped (PR #5 + agent-autotrading). After this effort the game
is fully playable.

## 2. Goals & Success Criteria

### Goals
1. Three real day-trader strategies (`momentum_breakout`, `mean_reversion`, `gap_and_go`)
   produce trades on live 15-min ticks, persist per-strategy state, and flat by EOD.
2. Day-trader runner is invoked from `OutcomeTrackingService` after every price-refresh
   tick; the legacy hourly cron is removed.
3. `/portfolios` master table gains Sharpe, max drawdown, longest winning streak, and
   calibration columns, plus sort, search, and kind-filter chips.
4. Expanded row detail panel shows a full-size equity-curve chart with optional SPY
   overlay, and (for analysts only) a calibration chart.
5. Stop/take/trailing rules continue to NOT fire on day-trader positions, locked by test.

### Success criteria (verifiable)
- After a full US session (or synthetic fixture session), every day-trader strategy
  has produced ≥ 1 trade.
- Every day-trader portfolio is flat at 22:00 UTC settlement.
- All day-trader trades carry `trigger_reason='strategy'` and a populated
  `trigger_strategy` ∈ {`momentum_breakout`, `mean_reversion`, `gap_and_go`, `eod_flat`}.
- `/portfolios` sort/filter/search work across all new columns; calibration shows `—`
  with tooltip for actors with < 20 resolved predictions and for non-analyst kinds,
  pinned to the bottom when sorting by calibration.
- Expanding any row renders `EquityCurveChart` with SPY overlay toggle; expanding any
  analyst row also renders `CalibrationChart`.
- `pnpm test:unit` and `pnpm ci:markets` green; no regressions in foundation or
  agent-autotrading flows.

## 3. User Stories

- **As the player**, I want to see how day-trader algorithms compare against the named
  analysts and the arbitrator on a live leaderboard with risk-adjusted metrics so the
  ranking actually means something.
- **As the player**, I want to expand any portfolio row to see its full equity curve
  vs SPY so I can judge whether outperformance is real or noise.
- **As the player**, I want to expand an analyst row to see how well-calibrated their
  conviction has been across resolved predictions.
- **As the developer**, I want strategy state persisted in `analyst_portfolios.strategy_state`
  so each tick is stateless from the runner's perspective and strategies are unit-testable
  with a fake bar series.

## 4. Technical Requirements

### 4.1 Architecture

- **Day-trader runner stays in `apps/api/src/markets/services/day-trader-runner.service.ts`**
  but its strategy interface is refactored from intent-emission to a stateful `decide()`
  call. The runner is invoked from `OutcomeTrackingService.runTracking()` immediately
  after `stopLossWatcher.sweep()`.
- **Strategy classes** live in a new `apps/api/src/markets/strategies/` directory: one
  file per strategy plus the `DayTraderStrategy` interface. Each is a pure class with
  injectable constants; no DB access from inside `decide()`.
- **Recent-bars storage** (resolves intention open question #1): the existing
  `OutcomeTrackingService.captureSnapshots()` flow only writes the latest tick into
  `prediction.instruments.current_state` jsonb — no bar history is persisted today.
  This effort adds an in-place ring buffer in the same `current_state` jsonb (no new
  table, no new column) under a `recent_bars` key, capped at the last 32 bars
  (`{t, o, h, l, c, v}` per bar). Each price-refresh tick appends one bar built from
  the Polygon `/prev` payload (or the cached price tick when Polygon is rate-limited),
  then trims to the cap. A small helper on `OutcomeTrackingService` returns the array
  for a given instrument id. Rationale: keeps schema work to zero, one write per tick,
  jsonb is already updated on every refresh, and 32 bars covers all three strategies'
  lookback (default N=20, max sane lookback in scope = 30).
- **Leaderboard upgrade is in-place** in `LeaderboardService` — no new service, no new
  endpoints. New SQL aggregations are added to `getAllPortfoliosSummary()`.

### 4.2 Data Model Changes

- **Schema migrations**: none required.
- **Existing columns put into use**:
  - `prediction.analyst_portfolios.strategy_state jsonb` — read at the start of each
    runner tick, written back after each successful `decide()`. Keyed by strategy_name
    so each strategy owns its own slice.
  - `prediction.analyst_positions.trigger_strategy text` — populated for the first
    time on every day-trader open and close.
- **`current_state` jsonb shape extension** on `prediction.instruments`: add
  `recent_bars` key holding an array of up to 32 `{t, o, h, l, c, v}` objects, oldest
  first. Existing keys (`price`, `change`, `changePercent`, `prediction_*`,
  `price_updated_at`) untouched. No migration — jsonb additive write.

### 4.3 API Changes

- **No new endpoints, no URL changes.** Existing `GET /markets/portfolios` and
  `GET /markets/portfolios/:kind/:id` payloads gain new fields:

  `GET /markets/portfolios` (per-row additions):
  - `sharpe_30d: number | null`
  - `max_drawdown_30d: number | null` (negative percent, e.g. `-0.084`)
  - `longest_win_streak: number`
  - `calibration_score: number | null` (0–1; null when < 20 resolved predictions or
    non-analyst kind)

  `GET /markets/portfolios/:kind/:id` (additions):
  - `snapshot_history: Array<{date, equity, realized, unrealized, bailout_flag}>` —
    default 90 days, configurable via `?days=` query param (capped at 365).
  - `calibration_buckets: Array<{bucket_min, bucket_max, predicted_avg, realized_rate, count}>`
    — present only for analyst kind and only when ≥ 20 resolved predictions.
  - `benchmark_series: Array<{date, spy_close}>` — same date range as `snapshot_history`,
    pulled from `prediction.benchmark_series`.

- **Admin endpoint unchanged**: `POST /markets/admin/run-day-trader-strategies` keeps
  working for manual triggering. Internal handler now goes through the new `decide()`
  interface.

### 4.4 Frontend Changes (`apps/web`)

- `PortfolioDashboardView.vue` (`/portfolios`):
  - 4 new columns appended to the master table: Sharpe, Max DD, Win Streak, Calibration.
  - All columns become sortable via clickable headers with asc/desc indicators.
  - Search box filters by display name (case-insensitive substring).
  - Kind-filter chips: All / User / Analyst / Arbitrator / Day Trader (multi-select).
  - Calibration column renders `—` with tooltip ("Needs ≥ 20 resolved predictions" or
    "Not applicable for this actor type") and sorts to the bottom regardless of
    sort direction.
- `EquityCurveChart.vue` — new component, full-size SVG line chart, accepts
  `snapshot_history` + optional `benchmark_series`. SPY overlay normalized to the
  actor's starting balance (resolves intention open question #3) with a header toggle.
- `CalibrationChart.vue` — new component, bucket-bar chart of conviction-bucket vs
  realized-hit-rate. Renders only on analyst rows when buckets are returned.
- `portfolio.store.ts` — extend the typed shapes for the new master-row and detail
  fields; no new actions needed.
- `EquitySparkline.vue` and `ProvenanceTooltip.vue` — unchanged.

### 4.5 Infrastructure Requirements

- No new infra. Same Postgres (port 54322), same NestJS API (port 7100), same Vite
  web app (port 7101). No new env vars for v1; strategy constants live in code.
- Polygon rate-limit behavior unchanged (5/min free tier, 12.5s sleep between
  instruments). When the price fetch is skipped (no API key) the runner still runs
  but every strategy will return `noop` (insufficient bars) — explicitly tested.

## 5. Non-Functional Requirements

- **Performance**: leaderboard summary endpoint must stay under 500 ms p95 for the
  current 10-row dataset; new SQL aggregations are computed in a single query against
  `daily_pnl_snapshot` (Sharpe + drawdown), `analyst_positions` (win streak), and
  `market_predictions + prediction_horizon_evaluations` (calibration). No N+1.
- **Correctness**: each day-trader strategy is deterministic given a fixed bar series
  and state, and is fully unit-testable with no DB.
- **Backward compatibility**: `AutotradeOpenHelper.openPosition` and
  `AnalystPortfolioService.closePosition` gain optional `triggerStrategy?: string`
  parameters — existing callers remain valid and continue to write NULL.
- **Cross-portfolio purity**: existing day-trader-runner unit test asserting purity
  is extended to cover the new interface.
- **Stop-loss isolation**: an explicit unit test on `StopLossWatcherService.sweep()`
  asserts that day-trader portfolios are filtered out and that 5/10/trailing rules
  do not fire on their positions.
- **Legal language**: leaderboard tooltips use "analysis/signal" framing; no
  "advice/recommendation" copy on any new UI strings (per project legal language rule).

## 6. Out of Scope

- Per-strategy parameter tuning UI (constants live in code for v1).
- Backtest mode for strategies.
- A fourth or fifth day-trader strategy.
- Faster than 15-minute price feeds and the bar persistence required for finer bars.
- Per-user customizable leaderboard views or saved sorts.
- Historical backfill of leaderboard metrics for actors that didn't exist before this
  effort.
- New top-level `/leaderboard` route — the upgrade lives at `/portfolios`.
- Replacing `LeaderboardService` with a new service — extended in place.
- New schema migrations — `recent_bars` lives inside the existing `current_state`
  jsonb additively.

## 7. Dependencies & Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Recent-bars ring buffer gives strategies low-quality fake bars when Polygon is rate-limited (only one bar per ~12.5s loop iteration, repeated until next 15-min tick) | High | Medium | Bars are appended only when a fresh Polygon `/prev` payload arrives; rate-limited iterations are skipped (no append). Strategies that need ≥ N bars return `noop` until enough real ticks accumulate. Documented as a known v1 limitation. |
| `decide()` interface refactor breaks the existing day-trader-runner unit test | Certain | Low | Test is rewritten as part of Phase 1; old `generateIntents` shape is deleted in the same commit. |
| Calibration SQL is expensive across all analysts every page load | Medium | Medium | Bucketed counts are computed in a single CTE-based query joined per analyst; capped at the current 5 named analysts. Re-evaluate only if p95 > 500 ms. |
| EOD-flat path miscounts the "last tick of the session" and leaves positions open overnight | Medium | High | The runner derives `isLastTickOfSession` by checking whether the next 15-min tick would land at-or-after 22:00 UTC. EOD settlement service already runs at 22:00 UTC and is the safety net — any straggler day-trader positions get force-closed by `EodSettlementService`. Locked by an integration test that simulates the last-tick boundary. |
| Sharpe / drawdown computed off only 30 days of `daily_pnl_snapshot` for fresh portfolios is misleading | Medium | Low | Show `—` when fewer than 10 snapshots exist; document the threshold in the column tooltip. |
| jsonb `recent_bars` write contention if multiple ticks overlap | Low | Low | `OutcomeTrackingService.runTracking()` is already guarded by an `isRunning` flag — no overlap possible. |

External dependencies: none new. Polygon API, Postgres, NestJS schedule already in place.

## 8. Phasing

Each phase ends with a quality gate (`pnpm test:unit` + targeted suite + lint). Each
phase is independently reviewable and revertable.

### Phase 1 — Open/close signature extension + recent-bars helper
Extend `AutotradeOpenHelper.openPosition` and `AnalystPortfolioService.closePosition`
with optional `triggerStrategy?: string`. Add `recent_bars` ring-buffer write to
`OutcomeTrackingService.updateInstrumentPrice` (cap 32, append on real Polygon hit
only). Add `getRecentBars(instrumentId, count)` helper. Unit tests for both signature
extensions and the ring buffer cap/append behavior.
**Gate**: signature tests + ring buffer test pass; existing day-trader-runner test still
passes against the unchanged `StubStrategy` shape (interface refactor is in Phase 2).

### Phase 2 — Strategy interface refactor + EOD-flat scaffolding
Refactor `DayTraderStrategy` interface to `decide({portfolio, recentBars, latestSignals, state})
→ {action, instrumentId?, direction?, sizingMultiplier?, newState}`. Update the runner
to load `strategy_state` per portfolio, assemble inputs, call strategies, persist
returned `newState`, and route opens/closes through the helper/closePosition with
`triggerStrategy`. Keep `StubStrategy` placeholders compliant with the new interface
(returning `noop`). Implement the `isLastTickOfSession` derivation and the EOD-flat
force-close branch.
**Gate**: refactored runner test green (strategies return `noop`, no trades); EOD-flat
unit test green; cross-portfolio purity test still green.

### Phase 3 — Wire runner into OutcomeTracking + remove hourly cron
Inject `DayTraderRunnerService` into `OutcomeTrackingService`. After
`stopLossWatcher.sweep()`, invoke `runStrategies({isLastTickOfSession})`. Remove the
`@Cron('0 * * * *')` annotation from `DayTraderRunnerService.cronTick`; keep
`runStrategies()` and the admin endpoint. Add a unit test asserting OutcomeTracking
calls the runner exactly once per tick.
**Gate**: integration test for the OutcomeTracking → runner call site; manual smoke
via the admin endpoint; `pnpm ci:markets` green.

### Phase 4 — Three real strategies
Create `apps/api/src/markets/strategies/` with `momentum-breakout.strategy.ts`,
`mean-reversion.strategy.ts`, `gap-and-go.strategy.ts`. Each implements the
`DayTraderStrategy` interface with hardcoded constants (N=20 for breakout/reversion,
k=2.0 for reversion, gap threshold 1% for gap-and-go, base position size 5% of
`current_balance`). Universe is the same set of active instruments the analysts
already trade — the runner enumerates instruments the same way the existing
`StubStrategy` flow did. Each consumes `recentBars`,
`latestSignals` (conviction as 0.5×–1.5× size modifier + flat-veto > 70), and `state`
(its own slice). Register the three classes in the runner registry, replacing the
`StubStrategy` placeholders. Per-strategy unit test files with deterministic fake bar
series covering: happy path, insufficient bars, NaN/missing price, missing signal,
flat-veto path, sizing modifier path.
**Gate**: all three strategy unit suites green; runner integration test asserts each
strategy produces at least one trade against a synthetic fixture session.

### Phase 5 — Stop-loss isolation lock + day-trader-runner end-to-end test
Add a unit test on `StopLossWatcherService.sweep()` that creates a day-trader portfolio
with an open position and asserts that no 5/10/trailing close fires. Extend
`apps/api/tests/unit/day-trader-runner.test.ts` to cover state persistence across two
consecutive ticks (state from tick 1 must be visible to tick 2's `decide()` call).
**Gate**: both tests green; full `pnpm test:unit` green.

### Phase 6 — LeaderboardService metric extensions
Extend `getAllPortfoliosSummary()` to compute Sharpe (30 days), max drawdown (30 days),
longest winning streak, and calibration score in a single query with CTEs joining
`daily_pnl_snapshot`, `analyst_positions`, `market_predictions`, and
`prediction_horizon_evaluations`. Add `computeCalibration(analystId)` returning the
score plus per-bucket breakdown. **Calibration buckets**: 5 buckets at 50/60/70/80/90%
conviction (resolves intention open question #2). Show `—` for actors with < 20
resolved predictions and for non-analyst kinds. Extend `getPortfolioDetail()` to return
`snapshot_history` (default 90 days, `?days=` capped at 365), `calibration_buckets`
(analysts only), and `benchmark_series` for the same range. Update
`leaderboard-service.test.ts` for all new fields plus a calibration fixture test.
**Gate**: leaderboard service tests green; manual `curl` against `/markets/portfolios`
shows the new shape.

### Phase 7 — Frontend leaderboard upgrade
Extend `portfolio.store.ts` typed shapes. Add 4 new columns to the master table in
`PortfolioDashboardView.vue` with sortable headers, search box, and kind-filter chips.
Calibration cell renders `—` with tooltip and pins to bottom regardless of sort.
Build `EquityCurveChart.vue` (full-size SVG, SPY overlay normalized to starting
balance, header toggle) and `CalibrationChart.vue` (bucket-bar chart). Wire both into
the expanded row detail panel; calibration chart shown only for analyst kind.
**Gate**: web build green; manual visual check via the dev server (`pnpm dev` on port
7101); responsive at narrow widths.

### Phase 8 — Manual test plan + final regression sweep
Update `testing/ui/manual-test-plan.md` §2.11 (sortable columns + filters + equity-curve
detail) and §4.6 (day-trader runner walkthrough with the three real strategies and
the EOD-flat path). Run the full `pnpm test:unit` and `pnpm ci:markets` suites.
**Gate**: all suites green; manual test plan reflects the new behavior; effort ready
for PR.
