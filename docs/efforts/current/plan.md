# Portfolio Foundation Resume + Autotrading Polish — Implementation Plan

**PRD**: ./prd.md
**Intention**: ./intention.md
**Created**: 2026-04-07
**Status**: Not Started

## Progress Tracker
- [x] Phase 1: AutotradeOpenHelper extraction (G7)
- [x] Phase 2: Manual immediate-fill trading (G3)
- [ ] Phase 3: Master-detail read API (G1 backend)
- [ ] Phase 4: Background jobs — reset, benchmark, daily P&L (G5)
- [ ] Phase 5: Frontend master-detail view + provenance tooltip + bundle split (G1 frontend, G2, G14)
- [ ] Phase 6: Trade action UI (G4)
- [ ] Phase 7: Day-trader runner + leaderboard surfacing (G6)
- [ ] Phase 8: Autotrading polish + provenance disambiguation + anomaly cleanup (G8, G9, G10, G11)
- [ ] Phase 9: Repo hygiene — authz seed, settings.json drift (G12, G13)
- [ ] Phase 10: Test plan extension + Tier 2 / Tier 3 walk (G15) — *fresh-context session*

---

## Standard quality-gate commands

These commands are the same across most phases. Each phase's gate checks the items relevant to its scope.

| Gate item | Command |
|---|---|
| API lint | `cd apps/api && pnpm lint` |
| API typecheck | `cd apps/api && pnpm typecheck` |
| API build | `cd apps/api && pnpm build` |
| API unit tests | `cd apps/api && pnpm test:unit` (runs all 15 suites) |
| Web lint | `cd apps/web && pnpm lint` |
| Web typecheck | `cd apps/web && pnpm typecheck` |
| Web build | `cd apps/web && pnpm build` |
| Markets gate (when authz seed lands) | `cd apps/api && pnpm ci:markets` |
| API restart for new endpoints | `kill $(lsof -t -i :7100); cd apps/api && nohup node dist/src/main.js > /tmp/divinr-api.log 2>&1 &` |

**Auth headers for curl tests** (dev mode): `-H "x-user-id: admin@alpha-capital.demo" -H "x-org-slug: alpha-capital"`

---

## Phase 1: AutotradeOpenHelper extraction

**Status**: In Progress (code + static gates done; live verification pending user)
**Objective**: Extract the duplicated raw-SQL INSERT logic from `ConvictionTraderService` and `EodForcedBuyService` into a single helper. Pure refactor — zero behavior change.

### Steps
- [x] 1.1 Read `apps/api/src/markets/services/conviction-trader.service.ts` lines 195–230 (current INSERT block) and `apps/api/src/markets/services/eod-forced-buy.service.ts` lines 145–175 (current INSERT block). Diff them line-by-line; document the deltas (column order, idempotency clause, return shape).
- [x] 1.2 Create `apps/api/src/markets/services/autotrade-open-helper.service.ts` with one `@Injectable()` class `AutotradeOpenHelper` exposing `async openPosition(input: AutotradeOpenInput): Promise<{ positionId: string | null; reason: 'inserted' | 'idempotent' | 'no_price' | 'no_portfolio' }>`. The input type is `{ db, portfolio, instrumentId, symbol, direction: 'long'|'short', quantity, entryPrice, predictionId, conviction, triggerReason, organizationSlug }`. Helper performs the idempotency SELECT on `(portfolio_id, instrument_id, prediction_id)` and the INSERT. **The INSERT must set `high_water_mark = NULL` explicitly** — newly opened positions never inherit a per-instrument HWM cache (this is the root cause of the SHOP $0-P&L anomaly that Phase 8.3 will verify is no longer reproducible). Returns the discriminated reason for caller logging.
- [x] 1.3 Register `AutotradeOpenHelper` in `apps/api/src/markets/markets.module.ts` providers list (alphabetical with other services).
- [x] 1.4 Refactor `ConvictionTraderService.openPositionWithProvenance` (or whichever private method does the INSERT) to call `this.helper.openPosition(...)`. Inject `AutotradeOpenHelper` via constructor. Preserve the existing log line wording (`Autotrade open: portfolio=... reason=...`).
- [x] 1.5 Refactor `EodForcedBuyService` similarly. Preserve its log line wording (`EOD forced-buy: portfolio=... role=...`).
- [x] 1.6 Run all 86 agent-autotrading unit assertions: `npx tsx apps/api/tests/unit/conviction-trader.test.ts && npx tsx apps/api/tests/unit/eod-forced-buy.test.ts && npx tsx apps/api/tests/unit/stop-loss-watcher.test.ts`. Every assertion must still pass.
- [x] 1.7 Add a unit test `apps/api/tests/unit/autotrade-open-helper.test.ts` with at least 6 assertions: happy-path insert, idempotency hit, missing price, missing portfolio, direction mapping (long+short), trigger_reason passed through verbatim.
- [x] 1.8 Wire the new test file into `apps/api/package.json` `test:unit` script (append `&& tsx tests/unit/autotrade-open-helper.test.ts`).

### Quality Gate
- [ ] **Lint**: `cd apps/api && pnpm lint` clean
- [ ] **Typecheck**: `cd apps/api && pnpm typecheck` clean
- [ ] **Build**: `cd apps/api && pnpm build` succeeds
- [ ] **Unit Tests**: `cd apps/api && pnpm test:unit` — expect 463 + 6 = 469 assertions, all pass
- [ ] **Markets gate**: skipped until Phase 9 lands the `authz.users` seed
- [ ] **Live verification**: restart API, then re-run Tier 4 §4.2.A SHOP stop_loss recipe — confirm `closed > 0` rows still appear with the same `trigger_reason` values
  - `curl -X POST http://localhost:7100/markets/admin/run-stop-loss-sweep -H "x-user-id: admin@alpha-capital.demo" -H "x-org-slug: alpha-capital"`
- [ ] **DB diff**: pick one freshly-written `signal_cross` row from before refactor and one from after; assert every column matches except `id`, `opened_at`, `updated_at`
- [ ] **Phase Review**:
  - [ ] `ConvictionTraderService` and `EodForcedBuyService` both delegate to `AutotradeOpenHelper`
  - [ ] Both services produce byte-identical DB rows post-refactor (verified via DB diff above)
  - [ ] All 86 agent-autotrading assertions still green
  - [ ] No deviations from PRD §4.1 helper signature

---

## Phase 2: Manual immediate-fill trading

**Status**: Not Started
**Objective**: User can fill a buy or close a position at the current cached price via API, bypassing the existing 5pm queue.

### Steps
- [x] 2.1 Read `apps/api/src/markets/services/user-portfolio.service.ts` end-to-end to understand the existing service shape, then read the trade-related sections of `markets.controller.ts` (around line 885 — `queue-trade`) to understand the disclaimer-ack guard pattern.
- [x] 2.2 Add `executeImmediate({userId, predictionId, instrumentId, quantity, direction})` to `UserPortfolioService`. Reads `prediction.instruments.current_state->>'price'`, opens a `user_positions` row directly, debits `current_balance`, sets `trigger_reason='manual'` + `trigger_prediction_id`. Idempotency: if a row exists for `(user_id, prediction_id, instrument_id, status='open', opened_at::date = current_date)`, return it instead of creating a new one.
- [x] 2.3 Add `closePosition({userId, positionId})` to `UserPortfolioService`. Reads current cached price, computes `realized_pnl = (current - entry) * quantity` for long / `(entry - current) * quantity` for short, updates `exit_price`, `closed_at`, `realized_pnl`, `status='closed'`, credits `current_balance`. Throws if position doesn't belong to `userId`.
- [x] 2.4 Add `POST /markets/portfolios/me/execute-trade` to `markets.controller.ts`. Body DTO `{predictionId, instrumentId, direction, quantity}`. JWT guard + existing disclaimer-ack guard. Returns 201 + position.
- [x] 2.5 Add `POST /markets/portfolios/me/positions/:positionId/close`. JWT guard. Returns 200 + updated position.
- [x] 2.6 Add unit test `apps/api/tests/unit/user-portfolio-immediate.test.ts` with assertions: happy path opens position with `trigger_reason='manual'`; idempotent re-call returns same position id; balance debited correctly; closePosition computes long P&L; closePosition computes short P&L; closePosition rejects positions belonging to a different user.
- [x] 2.7 Wire the new test file into `apps/api/package.json` `test:unit`.

### Quality Gate
- [ ] **Lint** + **Typecheck** + **Build**: clean across api
- [ ] **Unit Tests**: `pnpm test:unit` passes including new spec
- [ ] **API restart** to pick up new endpoints
- [ ] **Curl Tests** (against `localhost:7100`):
  - `curl -X POST http://localhost:7100/markets/portfolios/me/execute-trade -H "x-user-id: admin@alpha-capital.demo" -H "x-org-slug: alpha-capital" -H "Content-Type: application/json" -d '{"predictionId":"<real>","instrumentId":"<real>","direction":"long","quantity":10}'` → 201 with position, `trigger_reason='manual'`
  - Repeat the same call → returns same position id (idempotency)
  - `curl -X POST http://localhost:7100/markets/portfolios/me/positions/<id>/close -H "x-user-id: ..." -H "x-org-slug: ..."` → 200, `status='closed'`, `realized_pnl` computed
- [ ] **Phase Review**:
  - [ ] PRD §4.3 endpoints `execute-trade` and `:positionId/close` wired
  - [ ] Idempotency holds within current trading day
  - [ ] Existing `queue-trade` endpoints unchanged
  - [ ] Disclaimer-ack guard still in front of `execute-trade`

---

## Phase 3: Master-detail read API

**Status**: Not Started
**Objective**: Endpoints to fetch the cross-actor master-detail summary and per-portfolio detail, including snapshot rows for sparkline rendering.

### Steps
- [ ] 3.1 Read `apps/api/src/markets/services/analyst-portfolio.service.ts` (225 lines) to understand existing analyst-portfolio query patterns; read `markets.controller.ts:825-885` for the existing `portfolios/*` route shape.
- [ ] 3.2 Create `apps/api/src/markets/services/leaderboard.service.ts` with two methods:
  - `getAllPortfoliosSummary()` — single SQL query joining `analyst_portfolios` (all kinds) and `user_portfolios`, returning `[{kind, id, name, current_balance, realized_pnl, unrealized_pnl, win_rate, total_return_pct, total_bailouts, open_position_count}]`. Win rate = closed wins / total closed positions, null if total < 1. Uses `coalesce` from `bailout_ledger` for total bailouts.
  - `getPortfolioDetail({kind, id})` — returns `{portfolio, positions: [open + last 30d closed], snapshots: [last 30 daily_pnl_snapshot rows ordered by snapshot_date asc]}`. Snapshots feed the inline sparkline in Phase 5.
- [ ] 3.3 Register `LeaderboardService` in `apps/api/src/markets/markets.module.ts` providers.
- [ ] 3.4 Inject `LeaderboardService` into `MarketsController`. Add `GET /markets/portfolios` returning `getAllPortfoliosSummary()`.
- [ ] 3.5 Add `GET /markets/portfolios/:kind/:id`. Validates `kind ∈ {user, analyst}` (analyst includes arbitrator + day-trader rows since they share the table). Returns `getPortfolioDetail()`.
- [ ] 3.6 Add unit test `apps/api/tests/unit/leaderboard-service.test.ts` with assertions: summary returns one row per portfolio; win_rate null when no closed positions; win_rate computed correctly with mixed wins/losses; detail returns positions ordered correctly; detail rejects invalid kind.
- [ ] 3.7 Wire the new test file into `pnpm test:unit`.

### Quality Gate
- [ ] **Lint** + **Typecheck** + **Build**: clean
- [ ] **Unit Tests**: pass with new spec
- [ ] **API restart**
- [ ] **Curl Tests**:
  - `curl http://localhost:7100/markets/portfolios -H "x-user-id: admin@alpha-capital.demo" -H "x-org-slug: alpha-capital"` → 200; array contains user row(s), N analyst rows, 1 arbitrator row, 3 day-trader rows; `pf-portfolio-arbitrator` present
  - `curl http://localhost:7100/markets/portfolios/analyst/pf-portfolio-arbitrator -H "x-user-id: ..." -H "x-org-slug: ..."` → 200 with `{portfolio, positions, snapshots}` (snapshots may be empty until Phase 4 ships)
  - `curl http://localhost:7100/markets/portfolios/analyst/pf-portfolio-momentum-breakout ...` → 200 with day-trader portfolio
- [ ] **DB sanity**: query confirms the summary returned a row for every kind including `day_trader` and `arbitrator`
- [ ] **Phase Review**:
  - [ ] PRD §4.3 GET endpoints wired
  - [ ] Summary returns every kind correctly (user, analyst, arbitrator, day_trader)
  - [ ] Detail endpoint validates `:kind` parameter
  - [ ] Sparkline data shape (snapshots array, ordered ascending by date) matches what Phase 5 will consume

---

## Phase 4: Background jobs — reset, benchmark, daily P&L

**Status**: Not Started
**Objective**: Monthly reset + bailout ledger; SPY benchmark daily ingest; daily P&L snapshots written inside the existing EOD cron.

### Steps
- [ ] 4.1 Read `apps/api/src/markets/services/eod-settlement.service.ts` (~347 lines) to understand the cron handler structure; read `apps/api/src/markets/adapters/fmp.adapter.ts` to find the daily-bar fetch entry point.
- [ ] 4.2 Create `apps/api/src/markets/services/monthly-reset.service.ts`. `@Cron('0 0 1 * *')`. Method `runReset({manual:boolean})`: iterates `analyst_portfolios` (all kinds) + `user_portfolios`; for each portfolio, closes any open positions at last cached price via the existing `AnalystPortfolioService.closePosition` / `UserPortfolioService.closePosition` paths (`AutotradeOpenHelper` is open-only and is not used here); computes `topup = max(0, 1000000 - current_balance)`; INSERTs `bailout_ledger` row (UNIQUE constraint on `(portfolio_kind, portfolio_id, reset_date)` handles idempotency); resets `current_balance = 1000000`. Returns `{ledgerRowsWritten, alreadyResetCount}`.
- [ ] 4.3 Create `apps/api/src/markets/services/benchmark-ingest.service.ts`. `@Cron('0 23 * * 1-5')`. Method `ingestSpy()`: calls FMP adapter for SPY daily close, upserts into `benchmark_series` keyed on `(symbol, trading_date)`.
- [ ] 4.4 Extend `eod-settlement.service.ts`: at the end of `runSettlement()` (after `markTodaysPredictionsSettled` and `resolveExpiredPositions`), call a new private `writeDailySnapshots(closingPrices)` method that reuses the existing `closingPrices` map already built early in `runSettlement()` (no second fetch). For every portfolio in `analyst_portfolios` + `user_portfolios`, computes starting balance, ending balance, realized P&L from today's closes, unrealized P&L from open positions priced at `closingPrices`, open position count, trades-today count, and INSERTs one `daily_pnl_snapshot` row keyed on `(portfolio_kind, portfolio_id, snapshot_date)`. Wrap in `try/catch` — log on failure, do not roll back settlement. UNIQUE constraint enables idempotent retry.
- [ ] 4.5 Add `POST /markets/portfolios/admin/monthly-reset` and `POST /markets/admin/run-benchmark-ingest` endpoints. Calls `runReset({manual:true})` and `ingestSpy()` respectively. Same auth pattern as existing admin endpoints.
- [ ] 4.6 Register `MonthlyResetService` and `BenchmarkIngestService` in `MarketsModule` providers.
- [ ] 4.7 Add unit tests in `apps/api/tests/unit/monthly-reset.test.ts`: writes one row per portfolio; second invocation in same month writes zero rows; books-balance invariant `current_balance + Σ(open_value) = initial + Σ(realized) + Σ(bailouts)` holds for every portfolio after reset.
- [ ] 4.8 Wire the new test file into `pnpm test:unit`.

### Quality Gate
- [ ] **Lint** + **Typecheck** + **Build**: clean
- [ ] **Unit Tests**: pass with new spec including books-balance invariant
- [ ] **API restart**
- [ ] **Curl Tests**:
  - `curl -X POST http://localhost:7100/markets/portfolios/admin/monthly-reset -H "x-user-id: ..." -H "x-org-slug: ..."` → 200, `{ledgerRowsWritten: N}` where N = total portfolio count
  - Repeat → 200, `{ledgerRowsWritten: 0, alreadyResetCount: N}`
  - `curl -X POST http://localhost:7100/markets/admin/run-benchmark-ingest -H "..."` → 200 with `{rowsWritten: 1+}`
  - `curl -X POST http://localhost:7100/markets/admin/run-settlement -H "..."` → after completion, run a `daily_pnl_snapshot` count query
- [ ] **DB verification**:
  - `psql ... -c "select count(*) from prediction.benchmark_series where symbol='SPY'"` returns ≥ 1
  - `psql ... -c "select count(*) from prediction.daily_pnl_snapshot where snapshot_date = current_date"` returns ≥ portfolio count
  - `psql ... -c "select count(*) from prediction.bailout_ledger where reset_date = current_date"` returns = portfolio count after manual reset
- [ ] **Phase Review**:
  - [ ] Three background jobs wired and idempotent
  - [ ] Books-balance invariant holds
  - [ ] Existing EOD settlement steps unchanged (Phase 3 endpoints still return same shape)
  - [ ] Phase 3 detail endpoint now returns non-empty `snapshots` array

---

## Phase 5: Frontend master-detail view + provenance tooltip + bundle split

**Status**: Not Started
**Objective**: `/portfolios` route renders the master-detail table with sparklines + provenance tooltips; web bundle vendor chunk split to clear the 500 KB advisory.

**⚠ Recommended**: run this phase in a fresh Claude context. UI work uses Chrome MCP tools heavily and context grows fast.

### Steps
- [ ] 5.1 Read `apps/web/src/views/PortfolioDashboardView.vue` and `apps/web/src/stores/portfolio.store.ts` to understand current layout and store shape.
- [ ] 5.2 Extend `portfolio.store.ts` with state `allPortfolios: PortfolioSummary[]`, `portfolioDetails: Record<string, PortfolioDetail>` and actions `fetchAllPortfolios()`, `fetchPortfolioDetail(kind, id)` calling Phase 3 endpoints.
- [ ] 5.3 Refactor `PortfolioDashboardView.vue` into master-detail layout. Top table columns per PRD G1: name, kind badge, current balance, realized P&L, unrealized P&L, win rate, total return %, bailouts, open-position count, inline equity sparkline. Click row → expanded inline panel with positions list + recent trades. Day-trader rows render with a `day_trader` badge.
- [ ] 5.4 Create `apps/web/src/components/EquitySparkline.vue` — pure inline-SVG sparkline component, props `{snapshots: DailyPnlSnapshot[], width: 80, height: 24}`. No chart library dependency. Renders empty state if `snapshots.length === 0`.
- [ ] 5.5 Create `apps/web/src/components/ProvenanceTooltip.vue` — Ionic popover, prop `position: AnalystPosition | UserPosition`. For opens: shows reason + linked prediction id (`/predictions/:id`) + conviction. For closes: shows reason + exit price + percent move from entry. Used on every position row.
- [ ] 5.6 Move existing balance + queue widgets into the user's expanded panel (preserved, not deleted).
- [ ] 5.6a On every **user** open-position row in the expanded panel, render reference 5% / 10% / trailing-stop levels (computed inline from `entry_price` and `direction`), labelled "reference levels (manual exit)". These are informational only — no auto-sell, no buttons attached. Carries over from the prior portfolio-foundation PRD §4.4.
- [ ] 5.7 Add router entry `/portfolios` pointing at the refactored view. Keep `/portfolio` (singular) as a redirect to `/portfolios` to avoid breaking any existing links.
- [ ] 5.8 Add a Vitest spec for the new store actions: `fetchAllPortfolios` populates state from a mocked fetch; `fetchPortfolioDetail` populates the keyed map.
- [ ] 5.9 **Bundle split investigation**: run `pnpm build` and inspect `dist/assets/index-*.js`. Identify what's in the 1 MB chunk (most likely `@ionic/vue` + the eager `icons-*.js` chunk). Apply one of:
  - Add `build.rollupOptions.output.manualChunks` in `vite.config.ts` to split `@ionic/vue` into a vendor chunk
  - OR convert eager icon imports (`import { addOutline, ... } from 'ionicons/icons'`) to per-icon dynamic imports
  - Verify with `pnpm build` that no chunk > 500 KB after gzip warning fires.

### Quality Gate
- [ ] **Lint** + **Typecheck** + **Build**: clean across web
- [ ] **Build**: `pnpm build` shows zero "Some chunks are larger than 500 kB" advisory
- [ ] **Unit Tests**: web vitest store spec passes
- [ ] **Chrome Tests** (manual, against `pnpm dev`):
  - Open `/portfolios`: master-detail table renders with user + every analyst + arbitrator + 3 day-traders, all columns populated
  - Sparklines render for portfolios that have `daily_pnl_snapshot` rows; empty for those that don't
  - Click an analyst row: positions + recent trades panel expands inline below
  - Hover over a `signal_cross` position: provenance tooltip shows reason + prediction id + conviction
  - Hover over a `stop_loss` closed position (in recent trades): tooltip shows close reason + exit + percent move
  - Click the user row: existing dashboard widgets render inside the expanded panel
  - Walk every Tier 1 route post-bundle-split to confirm no `ChunkLoadError`
- [ ] **Phase Review**:
  - [ ] PRD §4.4 master-detail layout matches spec
  - [ ] G1 column set complete (name, kind, balance, realized, unrealized, win rate, return %, bailouts, open count, sparkline)
  - [ ] G2 provenance tooltip wired on every row
  - [ ] G14 bundle advisory cleared
  - [ ] Existing widgets preserved
  - [ ] `pf-portfolio-arbitrator` id used as the only source of truth (no rename)

---

## Phase 6: Trade action UI

**Status**: Not Started
**Objective**: Buy/Sell from any prediction view with disclaimer ack, immediately visible in the user's expanded portfolio row.

**⚠ Recommended**: fresh Claude context. UI phase.

### Steps
- [ ] 6.1 Read `apps/web/src/components/AnalystPredictionModal.vue` to understand current props and disclaimer flow.
- [ ] 6.2 Extend `AnalystPredictionModal.vue` with `mode: 'view' | 'trade'` prop. In trade mode show: direction (Buy/Sell toggle), share-count input, current price display, total cost display, Submit button. On Submit → existing disclaimer ack flow → call `portfolioStore.executeTrade()`.
- [ ] 6.3 Extend `portfolio.store.ts` with `executeTrade(payload)` and `closePositionAction(positionId)` actions calling Phase 2 endpoints.
- [ ] 6.4 Locate prediction view, analysis view, and challenges view components (`grep -rn "AnalystPredictionModal" apps/web/src/views`). Add a "Trade" button on each that opens `AnalystPredictionModal.vue` in `mode='trade'` with the relevant context (predictionId, instrumentId, default direction).
- [ ] 6.5 In the master-detail user-row expanded panel, add a Sell button on each open position row that calls `closePositionAction`.
- [ ] 6.6 Vitest spec extension: `executeTrade` posts the right body and updates the affected portfolio in state; `closePositionAction` updates the position in state.

### Quality Gate
- [ ] **Lint** + **Typecheck** + **Build**: clean across web
- [ ] **Unit Tests**: web vitest passes
- [ ] **Curl Tests**: Phase 2 + Phase 3 curl set must still pass unchanged
- [ ] **Chrome Tests**:
  - Open a prediction view, click the new Trade button → modal opens in trade mode
  - Set quantity 10, click Buy, accept disclaimer → modal closes
  - Navigate to `/portfolios`, click user row → new position visible with provenance tooltip showing `manual` reason
  - Click Sell on that position → status flips to closed in expanded panel, realized P&L visible, tooltip shows close reason
  - Repeat across analysis view and challenges view trade buttons
  - Confirm disclaimer cannot be bypassed (decline → no trade fires)
- [ ] **Phase Review**:
  - [ ] PRD §3 user stories all fulfilled
  - [ ] Disclaimer ack still gates every trade action (no bypass)
  - [ ] No regressions in Phase 5 master-detail
  - [ ] Trade button present on prediction, analysis, and challenges views

---

## Phase 7: Day-trader runner + leaderboard surfacing

**Status**: Not Started
**Objective**: The 3 day-trader portfolios start trading via their strategy hooks and route through `AutotradeOpenHelper` so provenance is consistent.

### Steps
- [ ] 7.1 Read the existing day-trader strategy code (`grep -rn "momentum-breakout\|mean-reversion\|gap-and-go" apps/api/src/markets`). Document where each strategy's signal logic lives. If the strategies are stub-only, the work is *wiring* not *content*.
- [ ] 7.2 Create `apps/api/src/markets/services/day-trader-runner.service.ts`. Method `runStrategies()`: for each of the 3 day-trader portfolios, invoke its strategy hook, get back zero or more `{instrumentId, direction, quantity, conviction}` open intents and zero or more `{positionId}` close intents. Route opens through `AutotradeOpenHelper.openPosition(...)` with `triggerReason='strategy'` and `predictionId=null`. Route closes through `AnalystPortfolioService.closePosition(...)`.
- [ ] 7.3 Add `@Cron('0 14,15,16,17,18 * * 1-5')` (hourly during market hours) — schedule TBD by user during phase. Manual trigger via admin endpoint always available.
- [ ] 7.4 Add `POST /markets/admin/run-day-trader-strategies` admin endpoint. Calls `dayTraderRunner.runStrategies()`. Same auth pattern.
- [ ] 7.5 Register `DayTraderRunnerService` in `MarketsModule` providers.
- [ ] 7.6 Update `analyst_positions.trigger_reason` CHECK constraint to admit `'strategy'` if not already (Phase 1 of portfolio-foundation included it; verify).
- [ ] 7.7 Add unit test `apps/api/tests/unit/day-trader-runner.test.ts`: each strategy routes through helper; close path routes through `closePosition`; positions land in the correct portfolio_id (no cross-pollination).
- [ ] 7.8 Wire test into `pnpm test:unit`.

### Quality Gate
- [ ] **Lint** + **Typecheck** + **Build**: clean
- [ ] **Unit Tests**: pass with new spec
- [ ] **API restart**
- [ ] **Curl Tests**:
  - `curl -X POST http://localhost:7100/markets/admin/run-day-trader-strategies -H "..."` → 200 with `{strategiesRun: 3, opensRequested: N, opensWritten: M, closesRequested: P, closesWritten: Q}`
- [ ] **DB verification**:
  - `psql ... -c "select count(*) from prediction.analyst_positions where portfolio_id in ('pf-portfolio-momentum-breakout','pf-portfolio-mean-reversion','pf-portfolio-gap-and-go')"` returns ≥ 1
  - Cross-pollination check: every day-trader position has `portfolio_id` matching its own portfolio (no rows where a momentum-breakout position landed in mean-reversion's portfolio)
- [ ] **Chrome Tests**: open `/portfolios`, day-trader rows now show non-zero open positions; click into one, positions list appears with `strategy` provenance tooltip
- [ ] **Phase Review**:
  - [ ] G6 satisfied — day-trader portfolios trading and visible in leaderboard
  - [ ] All day-trader writes route through `AutotradeOpenHelper` (verified by log line consistency)
  - [ ] Strategy *content* unchanged from what existed before this phase
  - [ ] No cross-portfolio pollution

---

## Phase 8: Autotrading polish + provenance disambiguation + anomaly cleanup

**Status**: Not Started
**Objective**: Env-tunable stop-loss constants; `eod_backfill` provenance for the existing EOD backfill; SHOP $0-P&L anomaly resolved; historical below-threshold rows cleaned up.

### Steps
- [ ] 8.1 **Env-tune stop-loss constants (G8)**: in `apps/api/src/markets/services/stop-loss-watcher.service.ts:33-36`, replace the `static readonly STOP_LOSS_PCT = -0.05` etc. with a private getter that reads `process.env.STOP_LOSS_PCT` (etc.) with the current value as default. Add unit test `apps/api/tests/unit/stop-loss-watcher-env.test.ts` asserting env override works and default unchanged when env unset.
- [ ] 8.2 **Provenance disambiguation (G9)**: in `apps/api/src/markets/schema/markets-schema.service.ts`, update the `analyst_positions.trigger_reason` CHECK constraint via `DROP CONSTRAINT IF EXISTS ... ADD CONSTRAINT ... CHECK (trigger_reason IN ('signal_cross','eod_sweep','eod_backfill','stop_loss','take_profit','trailing_stop','manual','strategy'))`. Then in `apps/api/src/markets/services/eod-settlement.service.ts:218`, change the `analystPortfolio.createPositionFromPrediction` call (or wherever the default `trigger_reason` is set) to pass `'eod_backfill'` instead of relying on the `'manual'` default.
- [ ] 8.3a **SHOP anomaly repro (G10)**: write a unit test in `apps/api/tests/unit/stop-loss-watcher-shop-anomaly.test.ts` that calls `StopLossWatcherService.decide()` directly with `{direction:'long', entryPrice:110, currentPrice:110, highWaterMark:118.80}`. Expected: `closeReason='trailing_stop'`, `newHighWaterMark=118.80`. This deterministically reproduces the observed behavior and proves it's a function of the input HWM, not a race.
- [ ] 8.3b **Verify Phase 1 fix is in place**: `psql ... -c "select count(*) from prediction.analyst_positions where trigger_reason='signal_cross' and opened_at > now()-interval '1 hour' and high_water_mark is not null"` should return 0. Phase 1.2 explicitly sets `high_water_mark = NULL` on INSERT, so freshly opened positions can never inherit an HWM. If this query returns > 0, Phase 1 has a bug — go back and fix it before continuing.
- [ ] 8.3c **Document the resolution**: the SHOP $0-P&L anomaly is "correct given the inputs" — `decide()` did the right thing with the HWM it was given. The bug was in the *write* path (Phase 1 helper inheriting HWM), now fixed. Add a note to `testing/ui/manual-test-plan.md` Tier 4 §4.2 explaining that the historical SHOP test results showed this race and that Phase 1 of the resume effort eliminated it. Also add to the completion report.
- [ ] 8.4 **Historical row cleanup (G11)**: write a one-shot SQL script `apps/api/db/cleanup/2026-04-07-stale-threshold-rows.sql`. Default action: `UPDATE prediction.analyst_positions SET notes = 'historical: written under stale CONVICTION_TRADE_THRESHOLD=60 env override, 2026-04-07' WHERE trigger_reason IN ('signal_cross','eod_sweep') AND trigger_conviction < 70 AND opened_at < '2026-04-07 17:30:00+00';`. (Adds the `notes` column via the schema runner in step 8.2 if not already present.) Run the script once against the dev DB.
- [ ] 8.5 Add unit tests for env override (8.1 above) and for the new `eod_backfill` value being accepted by the constraint (sanity check).
- [ ] 8.6 Wire new test files into `pnpm test:unit`.

### Quality Gate
- [ ] **Lint** + **Typecheck** + **Build**: clean
- [ ] **Unit Tests**: pass with new specs
- [ ] **DB verification**:
  - `psql ... -c "\d prediction.analyst_positions"` shows the new CHECK constraint includes `eod_backfill`
  - `psql ... -c "select count(*) from prediction.analyst_positions where trigger_reason='eod_backfill'"` returns ≥ 1 after running EOD settlement
  - `psql ... -c "select count(*) from prediction.analyst_positions where trigger_reason in ('signal_cross','eod_sweep') and trigger_conviction < 70 and notes is null"` returns 0
  - `psql ... -c "select high_water_mark from prediction.analyst_positions where trigger_reason='signal_cross' and opened_at > now()-interval '5 minutes' limit 5"` returns NULLs (per 8.3 fix)
- [ ] **Phase Review**:
  - [ ] G8 env override works
  - [ ] G9 `eod_backfill` provenance reflected in new EOD settlements
  - [ ] G10 anomaly diagnosed; if fix applied, regression test added
  - [ ] G11 historical rows annotated (or deleted, per user choice during step)
  - [ ] No regressions in Tier 4 §4.2 recipes

---

## Phase 9: Repo hygiene — authz seed + settings.json drift

**Status**: Not Started
**Objective**: `pnpm ci:markets` runs end-to-end; `.claude/settings.json` allowlist drift committed.

### Steps
- [ ] 9.1 **authz.users seed (G12)**: locate the existing seed pattern for `authz.users` (`grep -rn "authz.users" apps/api/db apps/api/src/markets/schema 2>/dev/null`). Create a one-shot seed under wherever the existing pattern lives, inserting 3 deterministic users (e.g. `admin@alpha-capital.demo`, `admin@steadfast-advisors.demo`, `admin@apex-quant.demo`). Idempotent via `ON CONFLICT DO NOTHING`. Either wire into the schema runner or document the manual `psql -f` command.
- [ ] 9.2 Run `cd apps/api && pnpm ci:markets` and verify it goes past the previous "At least 3 records are required in authz.users" failure point. If any new failures surface, file them as out-of-scope (not absorbed into this effort) unless they're trivially fixable.
- [ ] 9.3 **settings.json drift (G13)**: `git status .claude/settings.json` — should show modified. Review the diff for any obvious garbage entries that should NOT be committed (e.g. `Bash(disown)`, `Bash(setsid ...)` — those look like ad-hoc kill commands, may want to keep or drop). Stage and commit with message `chore(claude): commit accumulated permission allowlist drift`.

### Quality Gate
- [ ] **Markets gate**: `cd apps/api && pnpm ci:markets` exits 0
- [ ] **Git status clean** for `.claude/settings.json`
- [ ] **No regressions**: `pnpm test:unit` still passes (all 469+ assertions)
- [ ] **Phase Review**:
  - [ ] G12 markets gate green locally
  - [ ] G13 settings drift committed
  - [ ] No new entries in `authz.users` outside the seeded 3

---

## Phase 10: Test plan extension + Tier 2 / Tier 3 walk

**Status**: Not Started
**Objective**: Walk Tier 2 (per-screen elements + interactions) and Tier 3 (edge cases / multi-step trade flow) against the new master-detail view; add Tier 4 §4.6 day-traders subsection.

**⚠ MUST run in a fresh Claude context.** Long backend session is not appropriate for Chrome MCP-heavy testing.

### Steps
- [ ] 10.1 In a fresh session, read `testing/ui/manual-test-plan.md` end-to-end. Walk Tier 1 first to confirm the current state of the app post-Phases 1–9.
- [ ] 10.2 Walk Tier 2 §§2.1–2.15 top-to-bottom against the new master-detail `/portfolios` view (which replaces §2.11). Capture findings inline. Anything broken either gets fixed in this session or filed as a separate effort with a one-line description in the completion report.
- [ ] 10.3 Walk Tier 3 §§3.1–3.7. Edge cases, error states, multi-step trade flow (3.4), multi-actor portfolio comparison (3.5).
- [ ] 10.4 Update `testing/ui/manual-test-plan.md` §2.11 to reflect the new master-detail layout (replacing the old "deferred" notes).
- [ ] 10.5 Add Tier 4 §4.6 "day-traders" subsection: static invariants (3 day-trader portfolios exist; non-zero positions; cross-portfolio purity), live trigger (`POST /markets/admin/run-day-trader-strategies`), and the unit-test command. Use the same template as §§4.1–4.3.
- [ ] 10.6 Add Tier 4 §4.7 "monthly reset + benchmark + daily P&L" subsection covering Phase 4 capabilities.
- [ ] 10.7 Update completion report with the walk results, all findings, and resolutions.

### Quality Gate
- [ ] **Tier 1**: all 17 routes load with zero console errors
- [ ] **Tier 2**: every screen's elements + interactions verified or filed
- [ ] **Tier 3**: every edge case verified or filed
- [ ] **Test plan updated**: §2.11 reflects new layout, §§4.6 + 4.7 added
- [ ] **No regressions in earlier phases**: re-run `pnpm test:unit` and `pnpm ci:markets` from this fresh context to confirm
- [ ] **Phase Review**:
  - [ ] G15 satisfied — Tier 2/3 walked, day-traders subsection added
  - [ ] All findings either fixed or filed
  - [ ] Completion report covers every phase's outcome

---

## Notes for run-plan

- **Phase 1 is the riskiest** — it touches code that's currently working in production. Never advance past Phase 1 without all 86 agent-autotrading assertions green AND the Tier 4 §4.2 SHOP recipe re-verified.
- **Phases 5, 6, 10 should run in fresh sessions** for context hygiene. Phase 5 specifically does heavy Chrome MCP work; bolting it onto a backend session is the failure mode the user already flagged in feedback.
- **Phase 8.3 (SHOP anomaly) might modify Phase 1's helper.** That's fine — if `AutotradeOpenHelper` is currently inheriting `high_water_mark` from somewhere, fix it in 8.3 and re-run Phase 1's gate before considering Phase 8 done.
- **`pf-portfolio-arbitrator` is sacred.** No phase should rename, recreate, or move it. Phase 3 and Phase 5 specifically must read from this id, not derive their own.
- **Markets gate is gated on Phase 9.** Phases 1–8 skip the markets gate (`pnpm ci:markets`) because the `authz.users` seed isn't in place yet. Phase 9 turns it on; from that point forward every subsequent phase includes it.
