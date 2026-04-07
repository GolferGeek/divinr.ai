# Agent Autotrading — Product Requirements Document

## 1. Overview

Make analysts and the arbitrator "mini-me" trade their own predictions automatically. When an analyst publishes a prediction whose conviction crosses a configurable threshold, that analyst immediately opens a position in their own paper portfolio. The arbitrator does the same for its synthesized prediction. Open positions are managed by 5% stop-loss / 10% take-profit / trailing-stop rules, swept on every 15-minute price refresh. At end of day, any prediction still above threshold without an existing position gets a forced buy at the close.

This effort sits on top of the **portfolio-foundation** effort (Phase 1 of which has shipped — schema additions and arbitrator + day-trader portfolio seeding are live in `main`). It does **not** include day traders, the leaderboard, equity curves, or master-detail UI work. The original intention's frontend deliverable (provenance tooltip on master-detail trade rows) is **deferred** to a later effort that builds the master-detail view, since that view doesn't exist yet — Phase 5/6 of portfolio-foundation never shipped. This effort is therefore **backend-only**: agents trade themselves, every fill carries provenance in the database, and the next effort that builds master-detail UI will surface it.

## 2. Goals & Success Criteria

**Goals**
- Env var `CONVICTION_TRADE_THRESHOLD` (default 70) gates all agent trades.
- After each analyst publish, if conviction ≥ threshold and no existing open position for `(portfolio_id, instrument_id, prediction_id)`, the analyst opens a position via `AnalystPortfolioService.openPosition()`.
- After arbitrator synthesis, the arbitrator portfolio gets the same treatment.
- A 15-minute background sweep closes any analyst- or arbitrator-owned position that hits −5% (stop), +10% (take-profit), or trips its trailing-stop.
- The high-water-mark column on `analyst_positions` is maintained on every sweep.
- The existing 22:00 UTC EOD settlement cron, after running its current steps, scans open predictions where conviction ≥ threshold and creates forced-buy positions for any that don't already have one. Idempotent.
- Every fill (open or close) writes the full provenance set: `trigger_reason`, `trigger_prediction_id`, `trigger_conviction`, plus `trigger_strategy` left null (reserved for the day-trader effort).
- Day-trader portfolios (`kind='day_trader'`) are explicitly excluded from the stop/take/trailing watcher and from the EOD forced-buy sweep.
- The books-balance invariant `current_balance + Σ(open_position_value) = initial + Σ(realized_pnl) + Σ(bailouts)` continues to hold for every analyst + arbitrator portfolio after a real session.

**Done when**
- All quality gates pass on the effort branch.
- A pipeline run with at least one ≥-threshold analyst prediction produces an open analyst position with `trigger_reason='signal_cross'` and matching `trigger_conviction`.
- An arbitrator synthesis with ≥-threshold conviction produces an open arbitrator position similarly.
- Driving a position's `current_price` to entry × 0.95 (or × 1.10) in the DB and triggering the watcher closes the position with the right `trigger_reason`.
- Running the EOD sweep produces forced buys for still-strong predictions that don't already have positions; running it again writes zero new positions.
- A test seeded with three day-trader positions confirms the watcher leaves them alone.

## 3. User Stories / Use Cases

- **As an observer of the analysts**, after a real pipeline run, I query `prediction.analyst_positions` and see new rows owned by the analysts whose predictions crossed conviction 70, each with `trigger_reason='signal_cross'`, `trigger_conviction` populated, and `trigger_prediction_id` linking back to the source prediction.
- **As an observer of the arbitrator**, similarly, the arbitrator portfolio (`pf-portfolio-arbitrator`) has new positions whenever the arbitrator's synthesized conviction crosses threshold.
- **As an operator**, after the 22:00 UTC settlement cron runs on a day where some analysts had ≥-threshold predictions but never had an intraday open position created (e.g. the prediction was published after the last 15-min sweep), the EOD sweep creates forced-buy positions for those, marked `trigger_reason='eod_sweep'`.
- **As an auditor**, every closed position has a `trigger_reason` of `stop_loss`, `take_profit`, or `trailing_stop` (for agent-managed exits) and the unrealized → realized P&L computation is sound.
- **As a future UI developer building master-detail**, every fill row has the provenance fields needed to render a "why" tooltip without further backfill.

## 4. Technical Requirements

### 4.1 Architecture

**Backend** (NestJS, `apps/api`)

New services in `apps/api/src/markets/services/`:

- **`ConvictionTraderService`** (`conviction-trader.service.ts`)
  - `evaluateAnalyst(prediction, run)` — called from `prediction-runner.service.ts` after each analyst publish. Reads the analyst's portfolio (`kind='analyst'` row in `analyst_portfolios` keyed by analyst id + organization slug). If `prediction.confidence × 100 >= CONVICTION_TRADE_THRESHOLD` AND no open `analyst_positions` row exists for `(portfolio_id, instrument_id, prediction_id)`, calls `AnalystPortfolioService.openPosition(...)` with provenance fields populated.
  - `evaluateArbitrator(arbitratorPrediction, run)` — same shape, but routed to `pf-portfolio-arbitrator` (the seeded arbitrator portfolio from portfolio-foundation Phase 1).
  - Sizing: reuses the existing Phase 6 `position-sizing.service.ts` Kelly calculator unchanged.
  - Both methods are idempotent on the conviction-cross trigger via the `(portfolio_id, instrument_id, prediction_id)` open-position check.

- **`StopLossWatcherService`** (`stop-loss-watcher.service.ts`)
  - Exposes `sweep()` invoked **synchronously** by `OutcomeTrackingService` immediately after each 15-min price refresh writes new `current_state.price` values. (Synchronous to avoid races with the price update.)
  - Iterates open `analyst_positions` joined to `analyst_portfolios` filtered to `kind IN ('analyst','arbitrator')`. Day traders are filtered out at the SQL level.
  - For each open position, computes `unrealized_pct = (current_price - entry_price) / entry_price`.
  - **Stop-loss**: if `unrealized_pct <= -0.05`, close with `trigger_reason='stop_loss'`.
  - **Take-profit**: else if `unrealized_pct >= 0.10`, close with `trigger_reason='take_profit'`.
  - **Trailing stop**: else update `high_water_mark = greatest(coalesce(high_water_mark, entry_price), current_price)`. If `current_price <= high_water_mark × (1 - 0.05)` AND `high_water_mark > entry_price × 1.05` (i.e. we ever moved meaningfully into profit), close with `trigger_reason='trailing_stop'`.
  - Closing a position uses `AnalystPortfolioService.closePosition()` (or the equivalent existing method) which already handles realized-P&L bookkeeping.

- **`EodForcedBuyService`** (`eod-forced-buy.service.ts`)
  - Exposes `runSweep({manual:boolean})`. Called from `eod-settlement.service.ts` at the end of its existing 22:00 UTC cron handler, after the existing settlement steps complete and after the daily P&L snapshot writer (which is part of portfolio-foundation Phase 4 — *that* is also deferred since portfolio-foundation only shipped Phase 1). For now this service runs immediately after the existing settlement steps; the daily snapshot integration is left for the foundation effort to land later.
  - For each `market_predictions` row from today where `confidence × 100 >= CONVICTION_TRADE_THRESHOLD` and `role='personality'` or `role='arbitrator'`:
    - Resolve the owning portfolio (analyst portfolio for the analyst id, or `pf-portfolio-arbitrator` for arbitrator role).
    - If no open position exists for `(portfolio_id, instrument_id, prediction_id)`, open one at the last cached price with `trigger_reason='eod_sweep'`, `trigger_conviction = confidence × 100`, `trigger_prediction_id = prediction.id`.
  - Idempotent: the open-position check protects against re-runs on the same day. A second invocation writes zero new rows.

**Existing service modifications**

- `prediction-runner.service.ts`: after each analyst publish (existing inner loop around line 142), call `convictionTrader.evaluateAnalyst(prediction, run)`. After the arbitrator synthesis step (line 145-149), call `convictionTrader.evaluateArbitrator(arbitratorOutcome, run)`. Both calls wrapped in try/catch — autotrade failures are logged and do not fail the pipeline.
- `outcome-tracking.service.ts`: after the existing 15-min `*/15 * * * *` cron writes new prices, call `stopLossWatcher.sweep()` synchronously. Wrap in try/catch.
- `eod-settlement.service.ts`: at the end of the existing handler, call `eodForcedBuy.runSweep({manual:false})`. Wrap in try/catch.
- `markets.module.ts`: register the three new services.

**No frontend work in this effort.** Provenance tooltip and master-detail trade rows are deferred to whichever later effort builds the master-detail UI (portfolio-foundation Phases 5–6, currently un-shipped).

### 4.2 Data Model Changes

**None.** All required schema changes (the `kind` column on `analyst_portfolios`, the `trigger_*` columns and `high_water_mark` on `analyst_positions`) shipped with portfolio-foundation Phase 1 and are live on `main`.

This effort only writes to columns that already exist.

### 4.3 API Changes

**None.** This effort is entirely background services hooked into existing crons and pipeline steps. No new HTTP endpoints.

(A future operator-facing endpoint to trigger the EOD sweep manually — `POST /markets/portfolios/admin/eod-forced-buy` — could be useful but is not required for this effort. If added later, it's a single endpoint behind the existing admin guard.)

### 4.4 Frontend Changes

**None.** Per §1, deferred to a later effort that builds master-detail.

### 4.5 Infrastructure Requirements

- New env var `CONVICTION_TRADE_THRESHOLD`, default `70`. Documented in `.env.example` if that file is tracked.
- No new cron jobs. Three integrations into existing crons:
  - `OutcomeTrackingService` 15-min cron → calls `StopLossWatcherService.sweep()`
  - `EodSettlementService` 22:00 UTC cron → calls `EodForcedBuyService.runSweep()`
  - `prediction-runner.service.ts` (called via existing pipeline trigger paths) → calls `ConvictionTraderService.evaluate*()`
- No new external dependencies.

## 5. Non-Functional Requirements

- **Idempotency**: every trade trigger checks for an existing open position on `(portfolio_id, instrument_id, prediction_id)` before opening. The watcher's `closePosition` is naturally idempotent because the next sweep sees `status='closed'` and skips.
- **Failure isolation**: an autotrade error must not fail the pipeline run, the price refresh, or the EOD settlement. Wrap all three integration points in try/catch + structured log.
- **Books-balance invariant**: `current_balance + Σ(open_value) = initial + Σ(realized) + Σ(bailouts)` for every analyst + arbitrator portfolio. Enforced in tests.
- **Day-trader exclusion**: SQL filter on `kind IN ('analyst','arbitrator')` in the watcher and EOD sweep, plus an explicit test that a seeded day-trader position is never touched.
- **Provenance non-null**: every fill row written by this effort has `trigger_reason` set to one of `signal_cross`, `eod_sweep`, `stop_loss`, `take_profit`, `trailing_stop`. The schema CHECK constraint enforces this on every row.
- **Performance**: the watcher must complete in under 1s with up to ~200 open positions. SQL-side filter, single-pass iteration.
- **Threshold semantics**: `prediction.confidence` is stored as a 0..1 float in `market_predictions`. The threshold env var is in 0..100 conviction units. Multiply by 100 at comparison time.
- **Compatibility**: existing user trade queue, EOD settlement queue execution, dashboard widgets, and disclaimer flow remain functional.

## 6. Out of Scope

- Day-trader actors and strategies → `day-traders-and-leaderboard` future effort.
- Full leaderboard, equity curves, calibration view → `day-traders-and-leaderboard`.
- Master-detail UI / provenance tooltip → deferred until portfolio-foundation Phases 5–6 land.
- Per-actor conviction-threshold overrides — single env var only.
- Incremental arbitrator synthesis on every analyst publish (the arbitrator only re-evaluates at the existing once-per-run synthesis step).
- Auto-management of user positions — user positions remain manual exit only.
- The `POST /admin/eod-forced-buy` operator endpoint — nice to have, not required.
- Real broker integration, sub-15-minute price feeds, shorting, leverage, options, fractional shares.

## 7. Dependencies & Risks

**External dependencies**
- Portfolio-foundation Phase 1 (shipped): schema columns + seeded arbitrator portfolio.
- Existing `position-sizing.service.ts` Kelly calculator (Phase 6).
- Existing `AnalystPortfolioService.openPosition()` and `closePosition()` (Phase 6).
- Existing `prediction-runner.service.ts` analyst loop and arbitrator synthesis step.
- Existing `OutcomeTrackingService` 15-min price refresh cron.
- Existing `eod-settlement.service.ts` 22:00 UTC cron.

**Risks**

| Risk | Mitigation |
|---|---|
| Watcher races with the 15-min price refresh and reads partial data | Watcher is invoked **synchronously** from `OutcomeTrackingService` after the price write completes, in the same cron tick. Single source of truth for the snapshot it operates on. |
| EOD sweep double-fires forced buys if the cron retries | Idempotency guard on `(portfolio_id, instrument_id, prediction_id)`. Second invocation writes zero new positions. Tested. |
| ConvictionTraderService throws and breaks the pipeline run | Wrapped in try/catch in `prediction-runner.service.ts`. Errors logged, pipeline continues. |
| The arbitrator portfolio row (`pf-portfolio-arbitrator`) doesn't exist in some environments | Portfolio-foundation Phase 1 seeds it idempotently in `seedPortfolioFoundation()`. New environments running migrations get it. Verified live. |
| `analyst_portfolios` lookup for an analyst returns no row (e.g. analyst created after seeding) | `evaluateAnalyst` skips with a warn log. Future enhancement: auto-create on first encounter. |
| Trailing-stop logic fires too eagerly on noisy 15-min bars | Trailing stop only arms after price has moved above `entry × 1.05` (i.e. we've banked 5% gain first). Tunable later via env var if needed. |
| Threshold-unit confusion (conviction in 0..1 vs 0..100) | All comparisons use `prediction.confidence × 100`. Single multiplication site, documented in the service. Test covers 0.69 / 0.70 / 0.71 boundary. |
| Day-trader positions accidentally swept by the stop watcher | Test asserts watcher leaves day-trader portfolios untouched. SQL filter is `WHERE kind IN ('analyst','arbitrator')`. |
| The daily P&L snapshot integration mentioned in the original autotrading intention isn't possible because portfolio-foundation Phase 4 hasn't shipped | Out of scope for this effort. EOD forced-buy still runs cleanly without the snapshot writer. The foundation effort lands its own daily snapshot work later. |

## 8. Phasing

Three small phases, each independently testable.

### Phase 1 — ConvictionTraderService + Pipeline Wiring

**Goal**: analysts and the arbitrator open positions automatically when their conviction crosses threshold.

**Scope**:
- Env var `CONVICTION_TRADE_THRESHOLD` (default 70) wired through the existing config provider.
- New `ConvictionTraderService` with `evaluateAnalyst()` and `evaluateArbitrator()` methods, both idempotent on the `(portfolio_id, instrument_id, prediction_id)` open-position check, both populating full provenance.
- Wire into `prediction-runner.service.ts`: call after each analyst publish, call after arbitrator synthesis. Both calls in try/catch.
- Service registered in `MarketsModule`.
- Unit tests: opens position when conviction crosses; does not double-open; skips when below threshold; populates provenance correctly; arbitrator routes to `pf-portfolio-arbitrator`.

**Validates**: a real pipeline run with a ≥-threshold prediction produces an open analyst position with full provenance; the arbitrator portfolio gets a position when arbitrator conviction crosses threshold; re-running the pipeline against the same prediction does not create duplicate positions.

### Phase 2 — StopLossWatcherService

**Goal**: open analyst + arbitrator positions exit on −5% / +10% / trailing-stop. Day traders excluded.

**Scope**:
- New `StopLossWatcherService.sweep()` method.
- Wire into `OutcomeTrackingService` synchronously after the 15-min price write, in try/catch.
- Trailing-stop logic with `high_water_mark` updates each tick.
- Service registered in `MarketsModule`.
- Unit tests: stop fires at −5%; take-profit fires at +10%; trailing fires only after price has been ≥ entry × 1.05 then drops 5% from the peak; high_water_mark updates monotonically; day-trader positions are not touched; all close fills carry `trigger_reason` of `stop_loss` / `take_profit` / `trailing_stop`.

**Validates**: in the test fixture, all three exit conditions fire on the right positions and skip the right ones; manually setting a real position's `current_price` and triggering the sweep closes it in DB.

### Phase 3 — EodForcedBuyService

**Goal**: at 22:00 UTC settlement, any still-strong prediction without an existing position gets a forced buy at the close.

**Scope**:
- New `EodForcedBuyService.runSweep({manual})` method.
- Wire into `eod-settlement.service.ts` at the end of the existing handler, in try/catch.
- Service registered in `MarketsModule`.
- Unit tests: produces a forced buy for an above-threshold prediction with no existing position; does not produce a duplicate when a position already exists; idempotent on second run; routes correctly to analyst vs arbitrator portfolios; populates `trigger_reason='eod_sweep'`.

**Validates**: simulated 22:00 UTC run produces forced buys with full provenance; second invocation in the same day writes zero new rows; analyst + arbitrator both work; day traders untouched.
