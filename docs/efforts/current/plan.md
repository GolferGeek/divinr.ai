# Day Traders & Leaderboard — Implementation Plan

**PRD**: ./prd.md
**Created**: 2026-04-07
**Status**: Not Started

## Progress Tracker
- [x] Phase 1: Open/close signature extension + recent-bars helper
- [x] Phase 2: Strategy interface refactor + EOD-flat scaffolding
- [x] Phase 3: Wire runner into OutcomeTracking + remove hourly cron
- [x] Phase 4: Three real strategies
- [x] Phase 5: Stop-loss isolation lock + state-persistence test
- [x] Phase 6: LeaderboardService metric extensions
- [ ] Phase 7: Frontend leaderboard upgrade
- [ ] Phase 8: Manual test plan + final regression sweep

---

## Phase 1: Open/close signature extension + recent-bars helper
**Status**: Complete
**Objective**: Make `triggerStrategy` writable on opens/closes and persist a 32-bar
ring buffer inside `instruments.current_state` jsonb.

### Steps
- [x] 1.1 Extend `AutotradeOpenHelper.openPosition` (`apps/api/src/markets/services/autotrade-open-helper.service.ts`) with optional `triggerStrategy?: string`; write into `analyst_positions.trigger_strategy` on insert; default NULL preserved for existing callers.
- [x] 1.2 Extend `AnalystPortfolioService.closePosition` (`apps/api/src/markets/services/analyst-portfolio.service.ts`) with optional `triggerStrategy?: string`; write into `analyst_positions.trigger_strategy` on update.
- [x] 1.3 In `OutcomeTrackingService.updateInstrumentPrice` (`apps/api/src/markets/services/outcome-tracking.service.ts`), append a `{t, o, h, l, c, v}` bar to `current_state.recent_bars` (cap 32, oldest dropped) only on a real Polygon hit. Use the values already in `priceData` for `c`; until OHLC is available from `/prev`, set `o=h=l=c=price` and `v=0` (documented limitation).
- [x] 1.4 Add `getRecentBars(instrumentId: string, count: number): Promise<Bar[]>` helper on `OutcomeTrackingService` reading from `current_state.recent_bars`.
- [x] 1.5 Extend `apps/api/tests/unit/autotrade-open-helper.test.ts` with a `triggerStrategy` write-through case.
- [x] 1.6 Add a new `apps/api/tests/unit/analyst-portfolio-close-trigger.test.ts` covering the closePosition signature extension.
- [x] 1.7 Add a new `apps/api/tests/unit/recent-bars-ring-buffer.test.ts` covering append, cap-32 trim, and getter shape.

### Quality Gate
- [ ] **Lint**: `pnpm --filter @divinr/api lint`
- [ ] **Build**: `pnpm --filter @divinr/api build`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api test:unit`
- [ ] **E2E Tests**: n/a this phase
- [ ] **Curl Tests**: n/a this phase
- [ ] **Chrome Tests**: n/a this phase
- [ ] **Phase Review**:
  - [ ] Both signature extensions are backward compatible (existing callers unchanged).
  - [ ] `recent_bars` is appended only on a real Polygon hit, never on rate-limit skip.
  - [ ] No schema migration was added.

---

## Phase 2: Strategy interface refactor + EOD-flat scaffolding
**Status**: Not Started
**Objective**: Refactor `DayTraderStrategy` to a stateful `decide()` interface, persist `strategy_state`, and add the EOD-flat force-close branch.

### Steps
- [ ] 2.1 In `day-trader-runner.service.ts`, replace `DayTraderStrategy.generateIntents` with `decide({portfolio, recentBars, latestSignals, state}) => {action: 'open'|'close'|'noop', instrumentId?, direction?, sizingMultiplier?, newState}`.
- [ ] 2.2 Update existing `StubStrategy` placeholders to comply (always return `{action: 'noop', newState: state}`).
- [ ] 2.3 Update `runStrategies()` to: (a) load `strategy_state` per portfolio, (b) assemble `recentBars` via `getRecentBars`, (c) fetch `latestSignals` (latest `market_predictions` row per candidate instrument), (d) call `decide()`, (e) persist returned `newState` back to `analyst_portfolios.strategy_state` keyed by strategy_name.
- [ ] 2.4 Update `routeOpen` to pass `triggerStrategy: portfolio.strategy_name` to `AutotradeOpenHelper.openPosition`.
- [ ] 2.5 Update `routeClose` to pass `triggerStrategy` to `closePosition` (`'eod_flat'` for EOD path, otherwise `portfolio.strategy_name`).
- [ ] 2.6 Add `runStrategies({isLastTickOfSession})`; when true, ignore strategy intents and force-close every open day-trader position at last cached price with `triggerReason='strategy'`, `triggerStrategy='eod_flat'`.
- [ ] 2.7 Rewrite `apps/api/tests/unit/day-trader-runner.test.ts` for the new interface; preserve cross-portfolio purity coverage.
- [ ] 2.8 Add an EOD-flat unit test asserting all open day-trader positions are closed when `isLastTickOfSession=true` and strategies are not consulted.

### Quality Gate
- [ ] **Lint**: `pnpm --filter @divinr/api lint`
- [ ] **Build**: `pnpm --filter @divinr/api build`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api test:unit`
- [ ] **E2E Tests**: n/a
- [ ] **Curl Tests**: n/a
- [ ] **Chrome Tests**: n/a
- [ ] **Phase Review**:
  - [ ] All three placeholder `StubStrategy` instances comply with the new interface.
  - [ ] `strategy_state` is loaded and persisted per portfolio per tick.
  - [ ] EOD-flat path force-closes without consulting strategies.
  - [ ] Cross-portfolio purity test still green.

---

## Phase 3: Wire runner into OutcomeTracking + remove hourly cron
**Status**: Not Started
**Objective**: Day-trader runner fires after every 15-min `stopLossWatcher.sweep()`; the legacy hourly cron is removed.

### Steps
- [ ] 3.1 Inject `DayTraderRunnerService` into `OutcomeTrackingService` constructor.
- [ ] 3.2 In `runTracking()`, after the `stopLossWatcher.sweep()` block, call `dayTraderRunner.runStrategies({isLastTickOfSession})`. Compute `isLastTickOfSession` as: the next 15-min boundary would land at-or-after 22:00 UTC.
- [ ] 3.3 Wrap the runner call in a try/catch and log failures without breaking the rest of outcome tracking (mirroring stop-loss sweep isolation).
- [ ] 3.4 Remove the `@Cron(...)` annotation from `DayTraderRunnerService.cronTick`. Keep `runStrategies()` and the admin endpoint `POST /markets/admin/run-day-trader-strategies`.
- [ ] 3.5 Verify module wiring (`MarketsModule` providers list) so `OutcomeTrackingService` resolves `DayTraderRunnerService`.
- [ ] 3.6 Extend the day-trader-runner test (or add an outcome-tracking test) asserting the runner is invoked exactly once per `runTracking()` call and that the EOD boundary is detected correctly at 21:45 UTC.

### Quality Gate
- [ ] **Lint**: `pnpm --filter @divinr/api lint`
- [ ] **Build**: `pnpm --filter @divinr/api build`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api test:unit`
- [ ] **E2E Tests**: n/a
- [ ] **Curl Tests**:
  - [ ] `curl -X POST http://localhost:7100/markets/admin/run-day-trader-strategies` returns 200 with a JSON result body and no positions opened (strategies still return `noop` until Phase 4).
- [ ] **Chrome Tests**: n/a
- [ ] **Phase Review**:
  - [ ] Hourly `@Cron` annotation is gone; runner no longer fires on its own schedule.
  - [ ] OutcomeTracking → runner call happens once per tick.
  - [ ] Runner failure does not break outcome tracking.

---

## Phase 4: Three real strategies
**Status**: Complete
**Objective**: Implement and unit-test `MomentumBreakoutStrategy`, `MeanReversionStrategy`, `GapAndGoStrategy`, register them in the runner.

### Steps
- [x] 4.1 Create `apps/api/src/markets/strategies/day-trader-strategy.types.ts` with the `DayTraderStrategy` interface and shared `Bar` / `Signal` types (move from `day-trader-runner.service.ts`).
- [x] 4.2 Create `apps/api/src/markets/strategies/momentum-breakout.strategy.ts`. Constants: `LOOKBACK=20`, `BASE_SIZE_PCT=0.05`. Rule: buy on N-bar high breakout; sell on first lower-high; consume conviction score as 0.5×–1.5× sizing multiplier; veto open if direction is "flat" and `abs(score) > 70`.
- [x] 4.3 Create `apps/api/src/markets/strategies/mean-reversion.strategy.ts`. Constants: `LOOKBACK=20`, `K=2.0`, `BASE_SIZE_PCT=0.05`. Rule: buy when price < `SMA(N) − k×stdev(N)`; sell on cross back to mean; same conviction modifier + flat-veto.
- [x] 4.4 Create `apps/api/src/markets/strategies/gap-and-go.strategy.ts`. Constants: `GAP_PCT=0.01`, `BASE_SIZE_PCT=0.05`. Rule: at first 15-min tick after 14:30 UTC, gap-up ≥ 1% vs prior daily snapshot close AND current bar green → buy; sell on first red 15-min bar; same conviction modifier + flat-veto. Use a `state.daily_armed_date` flag so each strategy fires at most once per session.
- [x] 4.5 In `day-trader-runner.service.ts`, replace the three `StubStrategy` placeholders in the registry with the three real strategy instances, mapped by `analyst_portfolios.strategy_name`.
- [x] 4.6 The runner enumerates candidate instruments the same way the existing flow did (active instruments excluding `__base__`). No new universe logic.
- [x] 4.7 Add `apps/api/tests/unit/momentum-breakout-strategy.test.ts` covering: happy-path breakout open, lower-high close, insufficient bars (returns noop), NaN/missing bar (returns noop), missing signal (size = base), conviction sizing modifier path, flat-veto path.
- [x] 4.8 Add `apps/api/tests/unit/mean-reversion-strategy.test.ts` with the same edge-case coverage.
- [x] 4.9 Add `apps/api/tests/unit/gap-and-go-strategy.test.ts` covering pre-14:30 noop, gap-up arming, gap-down skip, daily-once flag, red-bar close.
- [x] 4.10 Append all three new test files to `apps/api/package.json` `test:unit` script.
- [x] 4.11 Extend the existing day-trader-runner test with a synthetic-fixture session asserting each of the three real strategies opens at least one position.

### Quality Gate
- [x] **Lint**: `pnpm --filter @divinr/api lint`
- [x] **Build**: `pnpm --filter @divinr/api build`
- [x] **Unit Tests**: `pnpm --filter @divinr/api test:unit`
- [ ] **E2E Tests**: n/a
- [ ] **Curl Tests**:
  - [ ] `curl -X POST http://localhost:7100/markets/admin/run-day-trader-strategies` returns 200 and (when seeded with bars) opens at least one day-trader position visible in `select * from prediction.analyst_positions where trigger_reason='strategy'`. (deferred — requires running API + seeded bars)
- [ ] **Chrome Tests**: n/a
- [x] **Phase Review**:
  - [x] All three strategies present in `apps/api/src/markets/strategies/`.
  - [x] Registry no longer contains `StubStrategy`.
  - [x] Each strategy is unit-tested deterministically with no DB.
  - [x] Conviction is consumed as a sizing modifier and a flat-veto, never as a primary trigger.

---

## Phase 5: Stop-loss isolation lock + state-persistence test
**Status**: Complete
**Objective**: Lock down "5/10/trailing rules don't fire on day-trader positions" with a unit test, and prove `strategy_state` persists across consecutive ticks.

### Steps
- [x] 5.1 Extend `apps/api/tests/unit/stop-loss-watcher.test.ts` (or add a new file) with a fixture: a day-trader portfolio (`kind='day_trader'`) holding an open position with `entry_price` deep enough to trigger a 10% stop on a non-day-trader. Run `sweep()`. Assert position remains open and no close call was made.
- [x] 5.2 Extend `apps/api/tests/unit/day-trader-runner.test.ts` with a two-tick fixture: tick 1 mutates `state.foo = 'bar'`; tick 2's `decide()` receives the previous `state.foo` and uses it to decide.
- [x] 5.3 Verify both new test files are wired into the `test:unit` script. (already wired from Phase 4)

### Quality Gate
- [x] **Lint**: `pnpm --filter @divinr/api lint`
- [x] **Build**: `pnpm --filter @divinr/api build`
- [x] **Unit Tests**: `pnpm --filter @divinr/api test:unit`
- [ ] **E2E Tests**: n/a
- [ ] **Curl Tests**: n/a
- [ ] **Chrome Tests**: n/a
- [x] **Phase Review**:
  - [x] Stop-loss isolation explicitly locked by a regression test.
  - [x] State persistence proven across two consecutive ticks.

---

## Phase 6: LeaderboardService metric extensions
**Status**: Complete
**Objective**: Add Sharpe, max drawdown, longest winning streak, and calibration to `getAllPortfoliosSummary()`; extend `getPortfolioDetail()` with snapshot/benchmark/calibration data.

### Steps
- [x] 6.1 In `apps/api/src/markets/services/leaderboard.service.ts`, extend `getAllPortfoliosSummary()` to compute:
  - `sharpe_30d` from `daily_pnl_snapshot` (mean / stdev of daily returns × √252; null if < 10 snapshots).
  - `max_drawdown_30d` from `daily_pnl_snapshot` peak-to-trough (negative, e.g. `-0.084`; null if < 10 snapshots).
  - `longest_win_streak` from `analyst_positions` realized PnL ordered chronologically.
  - `calibration_score` per analyst (null for non-analyst kinds and < 20 resolved predictions).
  Use a single CTE-based query joining `daily_pnl_snapshot`, `analyst_positions`, `market_predictions`, `prediction_horizon_evaluations`.
- [x] 6.2 Add `computeCalibration(analystId)` returning `{score, buckets}` where `buckets` is an array of 5 entries at conviction boundaries 50/60/70/80/90%, each with `{bucket_min, bucket_max, predicted_avg, realized_rate, count}`.
- [x] 6.3 Extend `getPortfolioDetail({kind, id, days?})` to accept an optional `days` param (default 90, cap 365) and return:
  - `snapshot_history: Array<{date, equity, realized, unrealized, bailout_flag}>` for that range.
  - `calibration_buckets` (analysts only, ≥ 20 resolved predictions).
  - `benchmark_series: Array<{date, spy_close}>` over the same range from `prediction.benchmark_series`.
- [x] 6.4 Update `LeaderboardController` (`apps/api/src/markets/markets.controller.ts` or wherever the route lives) so `GET /markets/portfolios/:kind/:id` accepts `?days=` query param.
- [x] 6.5 Update `apps/api/tests/unit/leaderboard-service.test.ts` for the new master-row fields and a calibration fixture (synthetic resolved predictions across all 5 buckets).

### Quality Gate
- [x] **Lint**: `pnpm --filter @divinr/api lint`
- [x] **Build**: `pnpm --filter @divinr/api build`
- [x] **Unit Tests**: `pnpm --filter @divinr/api test:unit`
- [ ] **E2E Tests**: n/a
- [ ] **Curl Tests**: deferred — requires running API instance with seeded snapshots
  - [ ] `curl http://localhost:7100/markets/portfolios | jq '.[0] | keys'` includes `sharpe_30d`, `max_drawdown_30d`, `longest_win_streak`, `calibration_score`.
  - [ ] `curl 'http://localhost:7100/markets/portfolios/analyst/<id>?days=90' | jq 'keys'` includes `snapshot_history`, `benchmark_series`, `calibration_buckets`.
- [ ] **Chrome Tests**: n/a
- [x] **Phase Review**:
  - [x] Single CTE query — no N+1.
  - [x] Calibration is `null` for non-analyst kinds and analysts with < 20 resolved predictions.
  - [x] No new endpoints — only payload extensions and a new query param.

---

## Phase 7: Frontend leaderboard upgrade
**Status**: Not Started
**Objective**: Add Sharpe / Drawdown / Streak / Calibration columns with sort, search, and kind filters; build EquityCurveChart and CalibrationChart for the detail panel.

### Steps
- [ ] 7.1 In `apps/web/src/stores/portfolio.store.ts`, extend the typed shapes for the new master-row fields and detail-panel arrays.
- [ ] 7.2 In `apps/web/src/views/PortfolioDashboardView.vue`, append 4 new columns: Sharpe, Max DD, Win Streak, Calibration.
- [ ] 7.3 Add sortable column headers (asc/desc indicators) for all columns.
- [ ] 7.4 Add a search input filtering by display name (case-insensitive substring).
- [ ] 7.5 Add kind-filter chips above the table: All / User / Analyst / Arbitrator / Day Trader (multi-select).
- [ ] 7.6 Calibration cell renders `—` with tooltip ("Needs ≥ 20 resolved predictions" or "Not applicable for this actor type") and pins to bottom of any sort.
- [ ] 7.7 Create `apps/web/src/components/EquityCurveChart.vue`: full-size SVG line chart, accepts `snapshot_history` and optional `benchmark_series`. SPY overlay normalized to actor's starting balance with a header toggle.
- [ ] 7.8 Create `apps/web/src/components/CalibrationChart.vue`: bucket-bar chart of `predicted_avg` vs `realized_rate` per bucket.
- [ ] 7.9 Wire both charts into the expanded row detail panel inside `PortfolioDashboardView.vue`. Calibration chart renders only when `kind === 'analyst'` and `calibration_buckets` is present.
- [ ] 7.10 Use "analysis/signal" framing in all new tooltips and copy; do not use "advice" or "recommendation".

### Quality Gate
- [ ] **Lint**: `pnpm --filter @divinr/web lint`
- [ ] **Build**: `pnpm --filter @divinr/web build`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api test:unit` (no regression)
- [ ] **E2E Tests**: n/a
- [ ] **Curl Tests**: n/a
- [ ] **Chrome Tests** (against `http://localhost:7101/portfolios`):
  - [ ] Master table renders 14 columns including Sharpe, Max DD, Win Streak, Calibration.
  - [ ] Clicking any column header sorts asc, clicking again sorts desc.
  - [ ] Sorting by Calibration pins `—` rows to the bottom regardless of direction.
  - [ ] Search box filters rows by name (case-insensitive substring).
  - [ ] Kind-filter chips add/remove kinds from the visible set.
  - [ ] Expanding any row shows `EquityCurveChart` with a SPY overlay toggle that visibly toggles the overlay.
  - [ ] Expanding an analyst row also shows `CalibrationChart`; expanding non-analyst rows does NOT show it.
- [ ] **Phase Review**:
  - [ ] No new top-level route — upgrade lives at `/portfolios`.
  - [ ] Existing 10 columns + sparkline + provenance tooltip still work.
  - [ ] All copy uses analysis/signal framing.

---

## Phase 8: Manual test plan + final regression sweep
**Status**: Not Started
**Objective**: Document the new behavior in the manual test plan and run the full regression suite.

### Steps
- [ ] 8.1 Update `testing/ui/manual-test-plan.md` §2.11 with sortable columns + search + kind filters + equity-curve detail walkthrough.
- [ ] 8.2 Update `testing/ui/manual-test-plan.md` §4.6 with the day-trader runner walkthrough: trigger via admin endpoint, observe each strategy producing trades against a synthetic fixture session, observe EOD-flat behavior at 21:45 UTC, verify `trigger_strategy` populated.
- [ ] 8.3 Run `pnpm test:unit`, `pnpm ci:markets`, and the web build end-to-end. Fix any regressions.

### Quality Gate
- [ ] **Lint**: `pnpm lint`
- [ ] **Build**: `pnpm build`
- [ ] **Unit Tests**: `pnpm test:unit`
- [ ] **E2E Tests**: n/a
- [ ] **Curl Tests**:
  - [ ] `curl http://localhost:7100/markets/portfolios | jq '. | length'` returns 10.
  - [ ] `curl -X POST http://localhost:7100/markets/admin/run-day-trader-strategies` returns 200.
- [ ] **Chrome Tests**:
  - [ ] Smoke pass on `http://localhost:7101/portfolios`: master table loads, expand a row, both charts render.
- [ ] **Phase Review**:
  - [ ] Manual test plan reflects new behavior in §2.11 and §4.6.
  - [ ] `pnpm test:unit` and `pnpm ci:markets` green.
  - [ ] Effort matches every PRD success criterion.
