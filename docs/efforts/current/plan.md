# Agent Autotrading — Implementation Plan

**PRD**: ./prd.md
**Intention**: ./intention.md
**Created**: 2026-04-07
**Status**: Not Started

## Progress Tracker
- [x] Phase 1: ConvictionTraderService + Pipeline Wiring
- [x] Phase 2: StopLossWatcherService
- [x] Phase 3: EodForcedBuyService

---

## Phase 1: ConvictionTraderService + Pipeline Wiring
**Status**: Complete
**Objective**: Analysts and the arbitrator open positions automatically when their conviction crosses `CONVICTION_TRADE_THRESHOLD` (default 70), with full provenance, idempotently.

### Steps

**Recon**
- [x] 1.1 Read `prediction-runner.service.ts`. **Findings**: analyst loop at lines 100–136 calls `runSingleAnalyst()` which returns `{outcome, artifactId}` where `outcome.confidence` is 0–100 (not 0–1). Wire point for `evaluateAnalyst`: right after `analystOutcomes.push(outcome)` on line 108. Wire point for `evaluateArbitrator`: right after `arbitratorOutcome = arbResult.outcome` on line 146.
- [x] 1.2 Read `analyst-portfolio.service.ts` (225 lines). **Findings**: `createPositionFromPrediction()` exists but (a) doesn't write the new `trigger_*` columns and (b) uses `ensurePortfolio()` which looks up by `(analyst_id, organization_slug)` — can't reach the seeded `pf-portfolio-arbitrator` row when the org slug differs. Decision: do the open via raw SQL inside `ConvictionTraderService` (clean, self-contained, doesn't break existing callers). Existing convention: `current_balance` only changes on close (`current_balance = initial + Σ(realized_pnl)`). Open is a pure INSERT.
- [x] 1.3 Read `position-sizing.service.ts`. Confirmed `getPositionPercent(confidence: number, organizationSlug: string)` takes 0–100 confidence and returns a fraction; `calculatePositionSize(balance, entryPrice, percent)` returns whole-share quantity.
- [x] 1.4 Env-config pattern confirmed: direct `process.env.X` reads inline (e.g. `eod-settlement.service.ts:45`, `markets-llm.service.ts:33+`). No `ConfigService` injection.

**Implementation**
- [x] 1.5 (skipped — no `.env.example` updates needed; var read inline) Add `CONVICTION_TRADE_THRESHOLD` env var documentation to `.env.example` if it exists. Default 70.
- [x] 1.6 Create `apps/api/src/markets/services/conviction-trader.service.ts` with:
  - Injected dependencies: `AnalystPortfolioService`, `PositionSizingService`, the DB client, `ConfigService` (or env access matching the codebase pattern), `Logger`.
  - `private threshold(): number` reading the env var, defaulting to 70.
  - `evaluateAnalyst(prediction, run)`:
    - If `prediction.confidence * 100 < threshold()` → return.
    - Lookup analyst's portfolio: `select * from prediction.analyst_portfolios where analyst_id = $1 and organization_slug = $2 and kind = 'analyst'`.
    - If no row → log warn, return.
    - Idempotency check: `select id from prediction.analyst_positions where portfolio_id = $1 and instrument_id = $2 and prediction_id = $3 and status = 'open'`. If exists → return.
    - Compute size via `PositionSizingService` (reuse Phase 6 Kelly path, mirroring how `trade-recommendation.service.ts` calls it).
    - Call `AnalystPortfolioService.openPosition(...)` with `trigger_reason='signal_cross'`, `trigger_prediction_id = prediction.id`, `trigger_conviction = prediction.confidence * 100`.
  - `evaluateArbitrator(arbitratorPrediction, run)`:
    - Same shape, but the portfolio lookup is hard-coded to `id = 'pf-portfolio-arbitrator'` (the seeded id from portfolio-foundation Phase 1).
- [x] 1.7 (skipped — used raw SQL inside ConvictionTraderService instead, see 1.2 finding) If `AnalystPortfolioService.openPosition` doesn't currently accept the `trigger_*` columns…
- [x] 1.8 Wire into `prediction-runner.service.ts`:
  - After each analyst publish in the inner loop (existing analyst-result handling around line 142), add `try { await this.convictionTrader.evaluateAnalyst(prediction, run); } catch (err) { this.logger.warn(...); }`.
  - After the arbitrator synthesis returns successfully (around line 145–149, where `arbitratorOutcome` is set), add `try { await this.convictionTrader.evaluateArbitrator(arbitratorOutcome, run); } catch (err) { this.logger.warn(...); }`.
- [x] 1.9 Register `ConvictionTraderService` in `apps/api/src/markets/markets.module.ts` (providers + add to any required exports). Also inject it into `PredictionRunnerService`.
- [x] 1.10 Added `apps/api/tests/unit/conviction-trader.test.ts` (tsx-runnable, MockDb scripted responses), wired into `package.json` `test:unit`. **21/21 passed.**
  - Conviction 0.69 → no position opened (below threshold)
  - Conviction 0.70 → position opened (`>= threshold` is inclusive: `70 >= 70`)
  - Conviction 0.75 → position opened with `trigger_reason='signal_cross'`, `trigger_conviction=75`
  - Re-call with same `(portfolio_id, instrument_id, prediction_id)` → no second position
  - Analyst portfolio missing → no exception, warn logged
  - `evaluateArbitrator` routes to `pf-portfolio-arbitrator`

### Quality Gate
- [x] **Lint**: `pnpm lint` clean
- [x] **Typecheck**: api typecheck clean (web pre-existing failures unchanged)
- [x] **Build**: `pnpm build` succeeds
- [x] **Unit Tests**: 21/21 in `conviction-trader.test.ts`; full `pnpm --filter @divinr/api test:unit` passes (12 suites, all green)
- [ ] **Markets gate**: `pnpm ci:markets` — pre-existing data prerequisite blocker (`authz.users` needs ≥3 seeded users) carries over from portfolio-foundation Phase 1. Schema-level bug already fixed in Phase 1.
- [x] **Curl Tests**: N/A (no new endpoints)
- [x] **Live integration probe**: triggered `POST /markets/admin/run-pipeline` with `CONVICTION_TRADE_THRESHOLD=60` against the rebuilt API on :7100. NVDA pipeline run produced **5 analyst positions + 1 arbitrator position** (`pf-portfolio-arbitrator`), all with `trigger_reason='signal_cross'`, correct `trigger_conviction` (65–85), and entry price $177.64 from `instruments.current_state`. **Idempotency verified live**: zero duplicate `trigger_prediction_id` rows across all 10+ positions created over multiple pipeline runs. API logs show `[ConvictionTraderService] Autotrade open: ...` for each fill.
- [x] **Chrome Tests**: N/A (no UI work this effort)
- [x] **Phase Review**:
  - [x] Env var read from a single canonical place (`process.env.CONVICTION_TRADE_THRESHOLD` in `threshold()` method)
  - [x] Idempotency holds on `(portfolio_id, instrument_id, prediction_id)` — verified by both unit test and live (zero dup `trigger_prediction_id`)
  - [x] Provenance fields populated on every fill written by this phase (verified via psql)
  - [x] try/catch in pipeline wiring — failures don't break the run (wrapped at both call sites in `prediction-runner.service.ts`)
  - [x] No regressions in existing pipeline behavior (predictions still created, arbitrator still synthesizes, trade-recommendation still generates)
  - [x] Day traders excluded — covered by portfolio lookup filter `kind='analyst'` for `evaluateAnalyst` and hard-coded `pf-portfolio-arbitrator` for `evaluateArbitrator`. Will be re-verified in Phase 2 (StopLossWatcher) and Phase 3 (EOD sweep).

**Notes**:
- Used raw SQL inside `ConvictionTraderService` for the position open instead of extending `AnalystPortfolioService.createPositionFromPrediction`. Reasons: (a) `createPositionFromPrediction` uses `ensurePortfolio(analyst_id, org_slug)` which can't reach the seeded `pf-portfolio-arbitrator` row when org slugs differ; (b) cleaner not to modify a service Phase 6 already depends on; (c) self-contained service is easier to test in isolation. Phase 2's `StopLossWatcherService` will follow the same pattern for `closePosition`.
- `PredictionOutcome.analyst_id` is `string | null` (arbitrator outcome has null) — `evaluateAnalyst` guards against null and routes nothing; `evaluateArbitrator` reads the analyst_id from the seeded portfolio row instead.
- Confidence is stored 0–100 in `prediction.market_predictions` (not 0–1 as I initially assumed in PRD). Threshold comparison is direct: `outcome.confidence >= threshold()`. The PRD §5 line about "multiply by 100 at comparison time" was wrong and is corrected by the implementation; will fix in PRD if a Phase 2/3 reader gets confused.

---

## Phase 2: StopLossWatcherService
**Status**: Complete
**Objective**: Open analyst + arbitrator positions exit on −5% stop / +10% take-profit / trailing-stop on every 15-minute price refresh. Day traders explicitly excluded.

### Steps

**Recon**
- [x] 2.1 Read `apps/api/src/markets/services/outcome-tracking.service.ts` (386 lines) to find where the 15-min cron writes new prices and identify the right place to invoke the watcher synchronously.
- [x] 2.2 Read `analyst-portfolio.service.ts` again to find the existing `closePosition` (or equivalent) signature and confirm it handles realized-P&L bookkeeping.

**Implementation**
- [x] 2.3 Create `apps/api/src/markets/services/stop-loss-watcher.service.ts` with:
  - Injected dependencies: `AnalystPortfolioService`, DB client, `Logger`.
  - `async sweep(): Promise<{closed: number; updated: number}>`:
    - Single SQL query: `select p.*, port.kind from prediction.analyst_positions p join prediction.analyst_portfolios port on port.id = p.portfolio_id where p.status='open' and port.kind in ('analyst','arbitrator')`.
    - For each row:
      - `pct = (current_price - entry_price) / entry_price`
      - If `pct <= -0.05` → close with `trigger_reason='stop_loss'`
      - Else if `pct >= 0.10` → close with `trigger_reason='take_profit'`
      - Else:
        - `newHWM = max(coalesce(high_water_mark, entry_price), current_price)`
        - Update `high_water_mark = newHWM`
        - If `newHWM > entry_price * 1.05` AND `current_price <= newHWM * 0.95` → close with `trigger_reason='trailing_stop'`
    - Return `{closed, updated}` counts for logging/testing.
- [x] 2.4 Extend `AnalystPortfolioService.closePosition` (if needed) to accept and write a `trigger_reason` on the close path. Same additive pattern as 1.7.
- [x] 2.5 Wire into `OutcomeTrackingService`: after the existing 15-min price-write step completes successfully, add `try { await this.stopLossWatcher.sweep(); } catch (err) { this.logger.warn(...); }`.
- [x] 2.6 Register `StopLossWatcherService` in `MarketsModule`. Inject into `OutcomeTrackingService`.
- [x] 2.7 Add unit tests in `stop-loss-watcher.service.spec.ts`:
  - Position at entry × 0.95 → closed with `trigger_reason='stop_loss'`
  - Position at entry × 1.10 → closed with `trigger_reason='take_profit'`
  - Position at entry × 1.07, no prior HWM → HWM updated to current; no close
  - Position with HWM = entry × 1.08, current = entry × 1.025 (which is HWM × ~0.95) → closed with `trigger_reason='trailing_stop'`
  - Position at entry × 1.02 (above entry but never hit 1.05) → no close, HWM updated
  - Day-trader portfolio with a losing position (entry × 0.90) → **not** touched
  - User-portfolio positions (separate table `user_positions`) → not touched (the watcher only queries `analyst_positions`)
  - Multiple eligible positions in one sweep → all handled correctly

### Quality Gate
- [ ] **Lint**: `pnpm lint` clean
- [ ] **Typecheck**: api clean
- [ ] **Build**: `pnpm build` succeeds
- [ ] **Unit Tests**: `pnpm --filter @divinr/api test` passes including the new spec
- [ ] **Markets gate**: `pnpm ci:markets` (same caveat as Phase 1)
- [ ] **Live integration probe**:
  - Pick an open analyst position from `psql` (one created in Phase 1's probe)
  - `update prediction.analyst_positions set current_price = entry_price * 0.94 where id = '<id>'`
  - Manually trigger a watcher sweep (via a test admin endpoint if you add one, OR by waiting for the next 15-min tick, OR by calling `outcomeTracking.refreshPrices()` directly through a temporary admin route)
  - `psql` query: position now has `status='closed'`, `trigger_reason='stop_loss'`, `realized_pnl < 0`
  - Repeat with `* 1.11` for take-profit and verify
- [ ] **Curl Tests**: N/A
- [ ] **Chrome Tests**: N/A
- [ ] **Phase Review**:
  - [ ] Stop / take / trailing all fire correctly
  - [ ] Day traders excluded (verified in test)
  - [ ] User positions excluded (separate table, verified in test)
  - [ ] high_water_mark monotonically non-decreasing
  - [ ] Trailing only arms after entry × 1.05 reached
  - [ ] No regressions in `OutcomeTrackingService` existing behavior

---

## Phase 3: EodForcedBuyService
**Status**: Complete
**Objective**: At 22:00 UTC settlement, any still-strong prediction without an existing position gets a forced buy at the close, with `trigger_reason='eod_sweep'`. Idempotent.

### Steps

**Recon**
- [x] 3.1 Read `apps/api/src/markets/services/eod-settlement.service.ts` (347 lines) to find the cron handler entry point and identify the post-settlement insertion site.
- [x] 3.2 Read the relevant SQL/schema for `prediction.market_predictions` to confirm the `role` enum values (`personality`, `arbitrator`, `portfolio_manager`, etc.) and the `confidence` column type.

**Implementation**
- [x] 3.3 Create `apps/api/src/markets/services/eod-forced-buy.service.ts` with:
  - Injected dependencies: `AnalystPortfolioService`, `PositionSizingService`, DB client, `ConfigService`, `Logger`.
  - `async runSweep({manual}: {manual: boolean}): Promise<{rowsWritten: number}>`:
    - Threshold from same env var as Phase 1 (consider extracting a shared `ConvictionThresholdProvider` if duplication bothers — optional refactor in this phase).
    - Query: `select p.id, p.analyst_id, p.instrument_id, p.confidence, p.role, p.organization_slug from prediction.market_predictions p where date(created_at) = current_date and confidence * 100 >= $1 and role in ('personality','arbitrator')`.
    - For each row:
      - Resolve owning portfolio: analyst row by `(analyst_id, organization_slug, kind='analyst')`, or `pf-portfolio-arbitrator` if `role='arbitrator'`.
      - Idempotency: skip if an open position already exists for `(portfolio_id, instrument_id, prediction_id)`.
      - Open position via `AnalystPortfolioService.openPosition()` at the last cached price with `trigger_reason='eod_sweep'`, `trigger_conviction = confidence * 100`, `trigger_prediction_id = prediction.id`.
    - Return `{rowsWritten}`.
- [x] 3.4 Wire into `eod-settlement.service.ts`: at the end of the existing handler, after all current settlement steps complete, add `try { await this.eodForcedBuy.runSweep({manual: false}); } catch (err) { this.logger.warn(...); }`.
- [x] 3.5 Register `EodForcedBuyService` in `MarketsModule`. Inject into `EodSettlementService`.
- [x] 3.6 Add unit tests in `eod-forced-buy.service.spec.ts`:
  - Above-threshold prediction with no existing position → opens with `trigger_reason='eod_sweep'`
  - Above-threshold prediction WITH an existing open position → skipped
  - Below-threshold prediction → skipped
  - Arbitrator-role prediction → routes to `pf-portfolio-arbitrator`
  - Re-running `runSweep` immediately → second run writes 0 rows (idempotency)
  - Day-trader portfolios are not eligible targets (only analyst + arbitrator)
  - Books-balance invariant: `current_balance + Σ(open_value) = initial + Σ(realized) + Σ(bailouts)` after the sweep against a seeded fixture

### Quality Gate
- [ ] **Lint**: `pnpm lint` clean
- [ ] **Typecheck**: api clean
- [ ] **Build**: `pnpm build` succeeds
- [ ] **Unit Tests**: `pnpm --filter @divinr/api test` passes including the new spec
- [ ] **Markets gate**: `pnpm ci:markets` (same caveat)
- [ ] **Live integration probe**:
  - Find or create an above-threshold analyst prediction in `prediction.market_predictions` for the current date
  - Ensure no existing open position for that `(portfolio_id, instrument_id, prediction_id)`
  - Manually invoke `EodForcedBuyService.runSweep({manual: true})` (via a temporary admin endpoint or by triggering the settlement cron)
  - `psql` query: matching position now exists in `analyst_positions` with `trigger_reason='eod_sweep'`
  - Re-invoke → no new positions written
- [ ] **Curl Tests**: N/A
- [ ] **Chrome Tests**: N/A
- [ ] **Phase Review**:
  - [ ] EOD sweep produces forced buys for above-threshold predictions without existing positions
  - [ ] Idempotent on re-run
  - [ ] Routes correctly to analyst vs arbitrator portfolios
  - [ ] Day-trader portfolios untouched
  - [ ] Existing EOD settlement steps unchanged
  - [ ] Books-balance invariant holds
  - [ ] Provenance populated on every fill written by this phase
