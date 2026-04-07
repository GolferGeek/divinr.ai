# Day Traders & Leaderboard — Intention

## What this effort is

Two threads of work that finish the multi-actor paper-trading game:

1. **Real day-trader strategy content** — replace the three `StubStrategy` placeholders shipped by `effort/portfolio-foundation-resume` with actual signal logic for `momentum_breakout`, `mean_reversion`, and `gap_and_go`. Wire the runner into the existing 15-minute price-refresh tick instead of its current hourly cron. Persist per-strategy state in `analyst_portfolios.strategy_state`.

2. **Leaderboard upgrade** — extend the existing master-detail `/portfolios` view (built in portfolio-foundation Phase 5) into a full leaderboard with new metrics (Sharpe, max drawdown, calibration, longest winning streak, best/worst trade), an SPY-overlaid equity-curve detail panel, sortable columns, search, and kind filters. No new top-level route; the upgrade lives at `/portfolios`.

This is the third and final effort in the multi-actor arc, sitting on top of:
1. **Portfolio Foundation & Manual Trading** — schema, portfolios, master-detail UI, manual trading, monthly reset, benchmark ingest *(in main)*
2. **Agent Autotrading** — analysts and arbitrator auto-trading on conviction, stop/take/trailing rules, EOD sweep *(in main)*

## Why now

After the first two efforts shipped, the game has the user, every analyst, the arbitrator, and three day-trader portfolios all wired and visible on the master-detail leaderboard. What's missing:
- The day traders don't actually trade (their strategies are stubs).
- The leaderboard shows the right rows but only the basic columns (balance, realized, unrealized, win rate, return, bailouts, open count, sparkline). It's not yet a "leaderboard" in the bragging-rights sense — no Sharpe, no max drawdown, no calibration, no equity-curve detail, no sort/search.

This effort closes both gaps so the game is actually playable.

## What is already in main (verified 2026-04-07)

From `effort/portfolio-foundation-resume` PR #5:

**Backend**
- `DayTraderRunnerService` (`apps/api/src/markets/services/day-trader-runner.service.ts`) with strategy registry, admin endpoint `POST /markets/admin/run-day-trader-strategies`, opens routed through `AutotradeOpenHelper`, closes through `AnalystPortfolioService.closePosition`. Cross-portfolio purity verified by unit test. **Current strategies are `StubStrategy` placeholders that return zero intents.**
- `AutotradeOpenHelper` writes new positions with `high_water_mark = NULL` (Phase 1 invariant).
- `OutcomeTrackingService` runs on `@Cron('*/15 * * * *')` and calls `stopLossWatcher.sweep()` after every price refresh — **this is where day-trader strategies need to slot in**.
- `LeaderboardService` (`leaderboard.service.ts`) provides `getAllPortfoliosSummary()` (master row with 9 fields per portfolio) and `getPortfolioDetail({kind, id})` (positions + 30-day `daily_pnl_snapshot` rows). **No Sharpe, no drawdown, no calibration yet.**
- `MonthlyResetService` + `BenchmarkIngestService` populate `bailout_ledger` and `benchmark_series` (SPY).
- `EodSettlementService.writeDailySnapshots()` writes one `daily_pnl_snapshot` row per portfolio per trading day.

**Schema (already added, no migration needed)**
- `prediction.analyst_portfolios.strategy_state jsonb not null default '{}'::jsonb` — strategies can persist state here
- `prediction.analyst_positions.trigger_strategy text` — populated by `AutotradeOpenHelper` when caller passes it
- `prediction.bailout_ledger`, `prediction.benchmark_series`, `prediction.daily_pnl_snapshot`

**Frontend**
- `PortfolioDashboardView.vue` at `/portfolios` (and `/portfolio` redirect). 10-column master table, expandable rows, `EquitySparkline.vue` inline, `ProvenanceTooltip.vue` per position.
- 53-row leaderboard cleaned up to 10 real rows (1 user + 5 named analysts + 1 arbitrator + 3 day_trader) by orphan cleanup in PR #5.

## Locked decisions

### Day-trader strategies

- **Three strategies, no more**:
  1. **Momentum / Breakout** — buy on N-bar high breakout (default N=20 bars), sell on first lower-high.
  2. **Mean Reversion** — buy when price drops below `SMA(N) − k×stdev(N)` (default N=20, k=2.0), sell on cross back to mean.
  3. **Gap-and-Go** — at the first 15-min tick of the trading day (14:30 UTC for US session), check gap vs prior `daily_pnl_snapshot` close; if gap-up ≥ 1% and the current 15-min bar is up, buy. Sell on first reversal tick (any 15-min bar that closes red).
- **Universe**: same as analysts — every instrument the system already covers.
- **Cadence**: day-trader runner is invoked from `OutcomeTrackingService` immediately after `stopLossWatcher.sweep()` on every 15-min tick. The hourly `@Cron` annotation on `DayTraderRunnerService.cronTick` is **removed** in this effort. Honest limitation acknowledged: ~13 decision points per US session at 15-min granularity. Faster feeds are a future monetization story.
- **Flat by EOD**: when the runner is invoked on the last tick before 22:00 UTC settlement, it force-closes all open day-trader positions at last cached price with `trigger_reason='strategy'` and `trigger_strategy='eod_flat'`.
- **Stop/take/trailing rules do NOT apply** to day-trader positions. `StopLossWatcherService` already filters to non-day-trader portfolios — verify in this effort and lock with a unit test.
- **Strategy state**: each strategy reads/writes its own slice of `analyst_portfolios.strategy_state` jsonb keyed by `strategy_name`. Each strategy is responsible for trimming its own state (recent bars, range markers, daily flags). The runner persists `strategy_state` after every successful `decide()` call.
- **Position sizing**: 5% of `current_balance` per trade, hardcoded constant per strategy class (overridable via env later if needed). No Kelly.
- **Signal access**: day-trader strategies see the latest `prediction.market_predictions` row for their candidate instrument and use the conviction score as a **size modifier** (0.5× to 1.5× the base 5% sizing) and a **veto** (if conviction is "flat" and abs(conviction-score) > 70, skip the trade). Never as the primary trigger.

### Leaderboard

- **Extends `/portfolios`, does not replace it**. No new top-level route. The upgrade lives in `PortfolioDashboardView.vue` and the existing `/markets/portfolios` and `/markets/portfolios/:kind/:id` endpoints.
- **New metric columns** added to the master table: Sharpe (current month), max drawdown (current month), longest winning streak, calibration. Existing 10 columns stay.
- **Calibration metric** is per-analyst only. Computed as the absolute difference between (avg conviction on resolved predictions in a bucket) and (realized hit rate in that bucket), averaged across buckets, weighted by bucket count. Shows `—` with tooltip when fewer than 20 resolved predictions exist for the actor. day_traders show `—` (no predictions to calibrate against).
- **Equity curve detail**: when a row is expanded, the existing positions/snapshots panel grows a full-size `EquityCurveChart.vue` (vs the inline 80×24 sparkline) with optional SPY overlay toggle.
- **Sortable columns + search + kind-filter chips** at the table top.

## What's in scope

### Backend

- **Refactor `DayTraderStrategy` interface** in `day-trader-runner.service.ts` from `generateIntents(portfolio) → {opens, closes}` to `decide({portfolio, recentBars, latestSignals, state}) → {action: 'open'|'close'|'noop', instrumentId?, direction?, sizingMultiplier?, newState}`. Update the runner to assemble `recentBars` (from a new `getRecentBars(instrumentId, count)` helper on `OutcomeTrackingService` or wherever the price-refresh persists OHLC), `latestSignals` (one `prediction.market_predictions` row per candidate instrument), and `state` (the slice of `strategy_state` keyed by `strategy_name`) before each call.
- **Implement three real strategies**: `MomentumBreakoutStrategy`, `MeanReversionStrategy`, `GapAndGoStrategy` in `apps/api/src/markets/strategies/`. Each is a class implementing `DayTraderStrategy` with its own constants. Unit-tested directly with a fake `recentBars` series (no DB).
- **Wire runner into OutcomeTracking**: in `outcome-tracking.service.ts`, after `stopLossWatcher.sweep()`, invoke `dayTraderRunner.runStrategies()` and log the result. Inject `DayTraderRunnerService`.
- **Remove the hourly cron** annotation on `DayTraderRunnerService.cronTick`. Keep `runStrategies()` as the public method; keep the admin endpoint for manual triggering.
- **Strategy state persistence**: extend `runStrategies()` to (a) load `strategy_state` from each portfolio row before calling the strategy, (b) persist the returned `newState` back to the portfolio row after a successful action.
- **EOD-flat logic**: pass an `isLastTickOfSession` boolean into the runner; if true, the runner ignores strategy intents and just force-closes every open day-trader position.
- **Recent-bars helper**: a single private method on `OutcomeTrackingService` (or a new `PriceHistoryService`) that returns the last N 15-min bars for an instrument by reading from wherever the existing price-refresh path already stores them. **Open question**: confirm whether 15-min bars are persisted today or only the latest tick — if only the latest, this effort needs to add a small ring buffer table or jsonb column. *Decide during the build-prd phase.*
- **`LeaderboardService` extensions**:
  - `getAllPortfoliosSummary()` adds Sharpe, max drawdown, longest winning streak, and calibration to its returned shape. SQL-aggregated where possible from `daily_pnl_snapshot` + `analyst_positions` + `market_predictions` + `bailout_ledger` + `benchmark_series`.
  - `getPortfolioDetail()` returns enough snapshot history (default 90 days, configurable) for the full equity curve detail panel.
  - New helper `computeCalibration(analystId)` returns the calibration score and the per-bucket data needed for the calibration tooltip / chart.

### API
- **No new endpoints.** All work extends the existing `GET /markets/portfolios` and `GET /markets/portfolios/:kind/:id` payloads. Frontend reads the new fields without a new round-trip.

### Frontend (`apps/web`)
- `PortfolioDashboardView.vue`: add new columns (Sharpe, drawdown, streak, calibration), sortable column headers, search box, kind-filter chips. Calibration column shows `—` for analysts below the 20-prediction threshold and for non-analyst kinds.
- `EquityCurveChart.vue` — new component, full-size SVG curve with optional SPY overlay toggle. Used in the expanded row detail panel.
- `CalibrationChart.vue` — new component, bucket-bar chart showing conviction-bucket vs realized-hit-rate per analyst. Shown only on analyst rows in the expanded detail panel.
- `EquitySparkline.vue` (existing) is reused unchanged for the master-row inline trend.
- `portfolio.store.ts`: extend the typed shapes for the new fields.

### Tests

- Unit tests per strategy class (fake bars, deterministic): each rule + edge cases (insufficient bars, NaN price, missing signal).
- Unit test for the EOD-flat path.
- Unit test for the `LeaderboardService` calibration computation against a fixture set of resolved predictions.
- Integration: extend `apps/api/tests/unit/day-trader-runner.test.ts` to cover the new strategy interface, state persistence, and OutcomeTracking call site.
- Update the existing `leaderboard-service.test.ts` for the new metric fields.

### Manual test plan
- Update `testing/ui/manual-test-plan.md` §2.11 to describe the new sortable columns + filters + equity-curve detail.
- Update §4.6 (day-trader runner) to walk the new strategies end-to-end.

## Out of scope

- Per-strategy parameter tuning UI (constants live in code for v1)
- Backtest mode for strategies
- A fourth or fifth day-trader strategy
- Faster than 15-minute price feeds (and the price-history persistence required for finer bars)
- Per-user customizable leaderboard views or saved sorts
- Historical backfill of leaderboard metrics for actors that didn't exist before this effort
- New top-level `/leaderboard` route (the upgrade lives at `/portfolios`)
- Schema changes beyond what's already in main *(unless the recent-bars open question forces a small bars table — that's the only condition)*
- Replacing `LeaderboardService` with a new service — extend it in place

## Open questions to resolve during build-prd

1. **Are 15-min OHLC bars persisted today, or only the latest tick?** If only the latest tick, the effort needs a tiny `recent_bars` ring buffer (jsonb column on `instruments` or a small table). This is the one place schema work might creep in. Investigate during build-prd and either confirm in-scope or document the storage shape.
2. **Calibration bucket boundaries**: 5 buckets at 50/60/70/80/90% conviction, or 4 buckets at 60/70/80/90? Pick during build-prd.
3. **Equity-curve overlay**: should SPY normalize to the actor's starting balance or stay in absolute SPY price? Pick during build-prd.

## Success criteria

- After a full US trading session, all three day-trader strategies have produced at least one trade each (verified against a synthetic fixture session if real market is closed).
- Every day-trader portfolio is flat at 22:00 UTC settlement.
- All day-trader trades carry `trigger_reason='strategy'` and a populated `trigger_strategy` (`momentum_breakout` / `mean_reversion` / `gap_and_go` / `eod_flat`).
- The `/portfolios` master table sorts and filters correctly across the new columns.
- Sorting by bailouts surfaces a meaningful "shame" ranking; sorting by calibration surfaces analysts with ≥ 20 resolved predictions, with analysts below the threshold pinned at the bottom showing `—`.
- Expanding any row shows the full equity-curve detail panel with optional SPY overlay.
- Expanding any analyst row shows the calibration chart.
- All Phase Foundation + Agent Autotrading functionality continues to work — no regressions in `pnpm test:unit` or `pnpm ci:markets`.
- The 5/10/trailing rules are confirmed (by unit test) to NOT fire on day-trader positions.

## Estimated size

Mid-sized effort. The strategy work is the riskiest piece (signal logic + tuning + bars-storage open question). The leaderboard upgrade is mostly SQL + Vue templating against existing data. Probably 6–8 phases.
