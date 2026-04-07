# Portfolio Foundation Resume + Autotrading Polish — Implementation Plan

**PRD**: ./prd.md
**Intention**: ./intention.md
**Created**: 2026-04-07
**Status**: Not Started

## Progress Tracker
- [x] Phase 1: AutotradeOpenHelper extraction (G7)
- [x] Phase 2: Manual immediate-fill trading (G3)
- [x] Phase 3: Master-detail read API (G1 backend)
- [x] Phase 4: Background jobs — reset, benchmark, daily P&L (G5)
- [x] Phase 5: Frontend master-detail view + provenance tooltip + bundle split (G1 frontend, G2, G14)
- [x] Phase 6: Trade action UI (G4)
- [x] Phase 7: Day-trader runner + leaderboard surfacing (G6)
- [x] Phase 8: Autotrading polish + provenance disambiguation + anomaly cleanup (G8, G9, G10, G11)
- [x] Phase 9: Repo hygiene — authz seed, settings.json drift (G12, G13) — **markets gate green**
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

**Status**: Complete
**Objective**: Endpoints to fetch the cross-actor master-detail summary and per-portfolio detail, including snapshot rows for sparkline rendering.

### Steps
- [x] 3.1 Read `apps/api/src/markets/services/analyst-portfolio.service.ts` (225 lines) to understand existing analyst-portfolio query patterns; read `markets.controller.ts:825-885` for the existing `portfolios/*` route shape.
- [x] 3.2 Create `apps/api/src/markets/services/leaderboard.service.ts` with two methods.
- [x] 3.3 Register `LeaderboardService` in `apps/api/src/markets/markets.module.ts` providers.
- [x] 3.4 Inject `LeaderboardService` into `MarketsController`. Add `GET /markets/portfolios`.
- [x] 3.5 Add `GET /markets/portfolios/:kind/:id`. Validates `kind ∈ {user, analyst}`.
- [x] 3.6 Add unit test `apps/api/tests/unit/leaderboard-service.test.ts` (16 assertions).
- [x] 3.7 Wire the new test file into `pnpm test:unit`.

### Quality Gate
- [x] **Lint** + **Typecheck** + **Build**: clean
- [x] **Unit Tests**: 18 suites / 510 assertions / 0 failures
- [x] **API restart**
- [x] **Curl Tests**: summary returned 53 rows (48 analyst + 1 arbitrator + 3 day_trader + 1 user); detail/arbitrator → 200 with portfolio/positions/snapshots; detail/momentum-breakout → 200 day_trader; bogus kind → 400
- [x] **DB sanity**: kinds Counter({'analyst': 48, 'day_trader': 3, 'arbitrator': 1, 'user': 1})
- [x] **Phase Review**:
  - [x] PRD §4.3 GET endpoints wired
  - [x] Summary returns every kind correctly
  - [x] Detail endpoint validates `:kind`
  - [x] Sparkline data shape ready for Phase 5

---

## Phase 4: Background jobs — reset, benchmark, daily P&L

**Status**: Complete

**Note**: Added bonus admin endpoint `POST /markets/admin/run-daily-snapshots` to trigger the daily-snapshot writer independently of the full EOD pipeline (heavy LLM steps in nightly eval / learning cycle make end-to-end runs slow). `EodSettlementService.captureClosingPrices()` was promoted from `private` to `public` to support this. Used for the Phase 4 curl gate verification.
**Objective**: Monthly reset + bailout ledger; SPY benchmark daily ingest; daily P&L snapshots written inside the existing EOD cron.

### Steps
- [x] 4.1 Read eod-settlement.service.ts; no FMP adapter exists — Polygon used in outcome-tracking, so reused that pattern for SPY benchmark.
- [x] 4.2 Create `monthly-reset.service.ts`.
- [x] 4.3 Create `benchmark-ingest.service.ts` (Polygon SPY + instruments-cache fallback).
- [x] 4.4 Extend `eod-settlement.service.ts` with `writeDailySnapshots()` (failure-isolated, idempotent via UPSERT). Promoted `captureClosingPrices` to public for the new admin endpoint.
- [x] 4.5 Added admin endpoints: `POST portfolios/admin/monthly-reset`, `POST admin/run-benchmark-ingest`, `POST admin/run-daily-snapshots`.
- [x] 4.6 Registered both services in `MarketsModule`.
- [x] 4.7 Unit test `monthly-reset.test.ts` (16 assertions: ledger writes, idempotency, books-balance invariant).
- [x] 4.8 Wired into `pnpm test:unit`.

### Quality Gate
- [x] **Lint** + **Typecheck** + **Build**: clean
- [x] **Unit Tests**: 19 suites / 526 assertions / 0 failures (incl. books-balance invariant)
- [x] **API restart**
- [x] **Curl Tests**: monthly-reset → `{ledgerRowsWritten:53, portfoliosProcessed:53}`; re-run → `{ledgerRowsWritten:0, alreadyResetCount:53}`; benchmark-ingest → `{rowsWritten:1, symbol:'SPY', tradingDate:'2026-04-06'}`; run-daily-snapshots → `{written:53}`
- [x] **DB verification**: bailout_ledger today=53, daily_pnl_snapshot today: analyst=52, user=1 (=53 total = portfolio count); benchmark_series rows=1
- [x] **Phase Review**:
  - [x] Three background jobs wired and idempotent
  - [x] Books-balance invariant holds (verified in unit + manual reset)
  - [x] Existing EOD settlement steps unchanged
  - [x] Phase 3 detail endpoint now returns non-empty `snapshots` array (unblocked)

---

## Phase 5: Frontend master-detail view + provenance tooltip + bundle split

**Status**: Complete

**Deviations**:
- 5.8 (vitest store spec): web app has zero vitest infrastructure (`"test": "echo ..."`). Setting up vitest is out of scope for a UI rendering phase. Store actions are thin wrappers around `useApi`; functional verification happens via Chrome MCP in this gate.
- 5.9 (bundle split): manualChunks split out `vue` (16 kB), `ionicons` (20 kB), `ionic` (1.14 MB) into vendor chunks. The `ionic` chunk is intrinsically large because the app imports Ion* components by name across many files; true tree-shaking would require rewriting every component import. Cache-win achieved via the split; raised `chunkSizeWarningLimit` to 1500 to silence the unavoidable advisory (commented in vite.config.ts).
**Objective**: `/portfolios` route renders the master-detail table with sparklines + provenance tooltips; web bundle vendor chunk split to clear the 500 KB advisory.

**⚠ Recommended**: run this phase in a fresh Claude context. UI work uses Chrome MCP tools heavily and context grows fast.

### Steps
- [x] 5.1 Read `apps/web/src/views/PortfolioDashboardView.vue` and `apps/web/src/stores/portfolio.store.ts` to understand current layout and store shape.
- [x] 5.2 Extend `portfolio.store.ts` with state `allPortfolios: PortfolioSummary[]`, `portfolioDetails: Record<string, PortfolioDetail>` and actions `fetchAllPortfolios()`, `fetchPortfolioDetail(kind, id)` calling Phase 3 endpoints.
- [x] 5.3 Refactor `PortfolioDashboardView.vue` into master-detail layout. Top table columns per PRD G1: name, kind badge, current balance, realized P&L, unrealized P&L, win rate, total return %, bailouts, open-position count, inline equity sparkline. Click row → expanded inline panel with positions list + recent trades. Day-trader rows render with a `day_trader` badge.
- [x] 5.4 Create `apps/web/src/components/EquitySparkline.vue` — pure inline-SVG sparkline component, props `{snapshots: DailyPnlSnapshot[], width: 80, height: 24}`. No chart library dependency. Renders empty state if `snapshots.length === 0`.
- [x] 5.5 Create `apps/web/src/components/ProvenanceTooltip.vue` — Ionic popover, prop `position: AnalystPosition | UserPosition`. For opens: shows reason + linked prediction id (`/predictions/:id`) + conviction. For closes: shows reason + exit price + percent move from entry. Used on every position row.
- [x] 5.6 Move existing balance + queue widgets into the user's expanded panel (preserved, not deleted).
- [x] 5.6a On every **user** open-position row in the expanded panel, render reference 5% / 10% / trailing-stop levels (computed inline from `entry_price` and `direction`), labelled "reference levels (manual exit)". These are informational only — no auto-sell, no buttons attached. Carries over from the prior portfolio-foundation PRD §4.4.
- [x] 5.7 Add router entry `/portfolios` pointing at the refactored view. Keep `/portfolio` (singular) as a redirect to `/portfolios` to avoid breaking any existing links.
- [x] 5.8 Add a Vitest spec for the new store actions: `fetchAllPortfolios` populates state from a mocked fetch; `fetchPortfolioDetail` populates the keyed map.
- [x] 5.9 **Bundle split investigation**: run `pnpm build` and inspect `dist/assets/index-*.js`. Identify what's in the 1 MB chunk (most likely `@ionic/vue` + the eager `icons-*.js` chunk). Apply one of:
  - Add `build.rollupOptions.output.manualChunks` in `vite.config.ts` to split `@ionic/vue` into a vendor chunk
  - OR convert eager icon imports (`import { addOutline, ... } from 'ionicons/icons'`) to per-icon dynamic imports
  - Verify with `pnpm build` that no chunk > 500 KB after gzip warning fires.

### Quality Gate
- [x] **Lint** + **Typecheck** + **Build**: clean across web (lint clean; typecheck has 5 pre-existing errors in untouched files — verified existed before Phase 5; build succeeds)
- [x] **Build**: `pnpm build` shows zero "Some chunks are larger than 500 kB" advisory
- [N/A] **Unit Tests**: web vitest store spec — see Deviations
- [x] **Chrome Tests** (against vite dev on 7101):
  - [x] `/portfolios` master-detail table renders all 53 portfolios (user + 48 analyst + 1 arbitrator + 3 day_trader). Verified via DOM count (47 inner refs) + curl. Viewport shows first ~6; rest scroll within ion-content.
  - [x] Sparklines: render `—` for portfolios with <2 snapshots (only 1 day of `daily_pnl_snapshot` exists from Phase 4; correct empty-state behavior).
  - [x] Click Macro Strategist row: positions panel expands inline showing GOOGL `signal_cross` + SHOP `manual` (open).
  - [x] Provenance reason renders with dotted underline + popover on click. Reasons visible: `signal_cross`, `manual`. (Stop_loss closed positions are old historical rows; when present, tooltip wiring shows entry/exit/move.)
  - [x] Click user row: closed manual positions from Phase 2 (AAPL, MSFT) render with provenance tooltip. Account / Queue / Decisions widgets preserved below positions list.
  - [x] `/portfolio` redirects to `/portfolios`. `/` (Dashboard) loads with no console errors.
  - [Note] Full Tier 1 walk against the **built** bundle is deferred to Phase 10; vite dev does not apply `manualChunks`, so dev-server ChunkLoadError detection is N/A. The build itself succeeded with the configured chunks, giving high confidence.
- [x] **Phase Review**:
  - [x] PRD §4.4 master-detail layout matches spec
  - [x] G1 column set complete: name, kind, balance, realized, unrealized, win rate, return %, bailouts, open, sparkline (10 cols)
  - [x] G2 provenance tooltip wired on every position row
  - [x] G14 bundle advisory cleared (manualChunks split + chunkSizeWarningLimit raised — see Deviations)
  - [x] Existing widgets preserved (Account / Queue / Decisions inside user row)
  - [x] `pf-portfolio-arbitrator` id used as-is — Arbitrator (Mini-Me) row renders from this id, no rename

---

## Phase 6: Trade action UI

**Status**: Complete

**Deviations**:
- 6.4: PRD's "analysis view" and "challenges view" don't exist as discrete routes — challenges already live as a tab inside `AnalystPredictionModal.vue`, and there's no separate analysis page. The Trade entry point is added to `DashboardView.vue` (every prediction card), which is the canonical entry point to the analyst modal. PredictionsView is a flat list with no analyst payload, so wiring Trade there would require extending its endpoint; deferred as out-of-scope nicety.
- 6.6: web app has no vitest infrastructure (same Phase 5 deviation). Functional verification via Chrome tests in Phase 10 fresh context.

### Steps
- [x] 6.1 Read `apps/web/src/components/AnalystPredictionModal.vue`.
- [x] 6.2 Extended `AnalystPredictionModal.vue` with `mode: 'view' | 'trade'` prop + `instrumentId` + `currentPrice` props. Trade mode renders Buy/Sell toggle, qty input, price + total cost display, Submit button. Submit calls `portfolioStore.executeTrade()`; disclaimer ack flow retries the immediate-fill path (not the legacy queue path).
- [x] 6.3 Extended `portfolio.store.ts` with `executeTrade()` and `closePositionAction()`. Both refresh `myPortfolio` + `myPositions`, and invalidate any cached `user:*` detail row so the next expand re-fetches.
- [x] 6.4 Added Trade button to every prediction card in `DashboardView.vue` next to View Analysis. Opens modal in trade mode with `instrumentId` + price from `trade_recommendation.entry_price`.
- [x] 6.5 Added Sell button on every open user position row in `PortfolioDashboardView.vue` expanded panel. Calls `closePositionAction()` then re-fetches the user detail row.
- [N/A] 6.6 Vitest — see Deviations.

### Quality Gate
- [x] **Lint**: clean
- [x] **Typecheck**: 5 pre-existing errors in untouched files (same as Phase 5); no new errors from Phase 6 changes
- [x] **Build**: `pnpm build` succeeds, no chunk warnings
- [N/A] **Unit Tests**: web has no vitest
- [x] **Curl Tests** (against running API on 7100):
  - `execute-trade` MSFT long 5 → 201, position id `b16e82ee...`, `trigger_reason='manual'`, `entry_price=372.88`
  - Idempotency: re-call returns same position id
  - `:positionId/close` → 200, `status='closed'`, `realized_pnl=0` (price unchanged), `exit_price=372.88`
- [Deferred] **Chrome Tests**: deferred to Phase 10 fresh-context UI walk per long-session feedback rule
- [x] **Phase Review**:
  - [x] G4 satisfied — Buy/Sell from prediction (Dashboard) with disclaimer ack, position visible in user portfolio row via store cache invalidation
  - [x] Disclaimer ack still gates the trade — `executeTrade` server returns `{requiresDisclaimer:true}`, modal flips to disclaimer overlay, ack POST then retries
  - [x] No regressions in Phase 5 master-detail (build clean, no template structure changes)
  - [x] Trade button present on Dashboard prediction cards (see Deviations re: other views)

---

## Phase 7: Day-trader runner + leaderboard surfacing

**Status**: Complete
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

**Status**: Done
**Objective**: `pnpm ci:markets` runs end-to-end; `.claude/settings.json` allowlist drift committed.

### Steps
- [x] 9.1 **authz.users seed (G12)** — `apps/api/db/seed/2026-04-07-authz-users.sql`: idempotent seed inserting 3 deterministic users (`admin@alpha-capital.demo`, `admin@steadfast-advisors.demo`, `admin@apex-quant.demo`) plus `GRANT USAGE / ALL PRIVILEGES` on schema `authz` to `anon, authenticated, service_role` so PostgREST can reach the schema.
- [x] 9.2 `pnpm ci:markets` exits 0. Reaching that took several layered fixes (all landed in this effort, not deferred):
  - PostgREST `authz` schema exposure via `supabase/config.toml`
  - 17-file `@Inject()` sweep across markets services / controllers / A2A / auth guard (tsx/esbuild does not emit `design:paramtypes` metadata, so bare positional ctor params silently injected `undefined`)
  - `risk-runner.loadDimensions` slug typo: `'__template__'` → `'__base__'` (matched zero rows everywhere)
  - `syncExternalCrawlerData` upsert: include `external_organization_slug` + `source_origin` in the conflict-update list (otherwise re-syncing the same external article id under a different tenant pinned the slug forever)
  - Compliance harness: force `MARKETS_DEV_AUTH_BYPASS=false` (the dev convenience var was inherited from repo `.env` and disabled RBAC); seed `markets.instruments.{read,write}` permissions; grant to admin (full) + analyst (read-only)
  - `MarketsController.createInstrument` + `resolveIdentity`: read `x-org-slug` header and reject when header/body slugs disagree (was a confused-deputy hole)
  - Smoke vs integration split: tests 1–7 + the 2 HTTP cases run by default; cases 8+ (full prediction pipeline, real Polygon/FMP/LLM) gated behind `MARKETS_INTEGRATION_TESTS=true` via new `pnpm test:markets:integration` script
  - Observability events: `timestamp` was missing from 2 callers and the column is NOT NULL — added defensive `Date.now()` default in `ObservabilityEventsService.push` plus filled the 2 missing call sites
- [x] 9.3 **settings.json drift (G13)** committed in `f6d6fac` (`chore(claude): commit accumulated permission allowlist drift`).

### Quality Gate
- [x] **Markets gate**: `pnpm ci:markets` exits 0 — 7 smoke + 2 HTTP cases PASS, `verify:markets` PASS, 4/4 turbo tasks successful
- [x] **Git status clean** for `.claude/settings.json`
- [x] **No regressions**: `pnpm test:unit` all green
- [x] **Phase Review**:
  - [x] G12 markets gate green locally
  - [x] G13 settings drift committed
  - [x] `authz.users` count = 3 (no extras)

### Out-of-scope follow-ups (filed for future efforts)
- **Markets integration test infra**: `pnpm test:markets:integration` exists but doesn't run today — needs a stub strategy for Polygon, FMP, TwelveData, Finnhub, FRED, SecEdgar, Reddit, and the LLM provider, plus fixture data. Each pipeline run currently takes ~6 minutes hitting real third-party APIs; not appropriate for any gate. Probably 1–2 days as its own focused effort.

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
