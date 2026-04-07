# Portfolio Foundation & Manual Trading — Implementation Plan

**PRD**: ./prd.md
**Intention**: ./intention.md
**Created**: 2026-04-07
**Status**: In Progress

## Progress Tracker
- [x] Phase 1: Schema & Seeding
- [ ] Phase 2: Manual Immediate-Fill Trading
- [ ] Phase 3: Master-Detail Read API
- [ ] Phase 4: Background Jobs (Reset, Benchmark, Daily P&L)
- [ ] Phase 5: Frontend Master-Detail View
- [ ] Phase 6: Trade Action UI

---

## Phase 1: Schema & Seeding
**Status**: Complete
**Objective**: All schema additions present in the DB; arbitrator + 3 day-trader portfolios seeded at $1M.

### Steps
- [x] 1.1 Read `apps/api/src/markets/schema/markets-schema.service.ts` lines 1–700 to understand the DDL runner pattern (where DDL methods are called from, how seeding routines are invoked).
- [x] 1.2 Read `prediction-runner.service.ts` to find how the arbitrator analyst is identified. **Finding**: arbitrator is a synthesis role (`role='arbitrator'` in `market_predictions`), not an existing `market_analysts` row. Seeding must create a synthetic `market_analysts` row for it (same pattern as `seedPortfolioManagerAnalyst`).
- [x] 1.3 Add a new private method `portfolioFoundationDdl()` in `markets-schema.service.ts` returning the SQL block from PRD §4.2 (modified columns + 3 new tables, all `IF NOT EXISTS`, `text` IDs).
- [x] 1.4 Wire `portfolioFoundationDdl()` into the existing DDL runner (alongside `portfolioSystemDdl()` and `tradeDecisionsDdl()`).
- [x] 1.5 Add a new private async method `seedPortfolioFoundation()` that:
  - Looks up the arbitrator `market_analysts` row by slug `arbitrator` (or whatever 1.2 confirms). If absent, inserts a synthetic one following the `seedPortfolioManagerAnalyst` pattern.
  - Upserts an `analyst_portfolios` row for the arbitrator with `kind='arbitrator'`, $1M balances.
  - Inserts three `market_analysts` rows: `momentum-breakout`, `mean-reversion`, `gap-and-go` with `analyst_type='day_trader'` (or whatever the existing convention names the type).
  - Inserts three matching `analyst_portfolios` rows with `kind='day_trader'`, `strategy_name` set, $1M balances, `strategy_state='{}'::jsonb`.
  - Idempotent throughout via `ON CONFLICT DO NOTHING` / `ON CONFLICT DO UPDATE`.
- [x] 1.6 Wire `seedPortfolioFoundation()` into the schema runner after `seedPortfolioManagerAnalyst()`.

### Quality Gate
- [x] **Lint**: `pnpm lint` clean
- [x] **Typecheck**: api typecheck clean. Web typecheck has 5 pre-existing DOM-lib errors (`HTMLElement`/`window` in `ActivityPanel.vue`, `useApi.ts`, `activity.store.ts`) — pre-existing on main, not introduced by this effort.
- [x] **Build**: `pnpm build` succeeds
- [x] **Unit Tests**: N/A (no new tests this phase — schema only)
- [x] **Markets gate**: `pnpm ci:markets` — schema-level `text = uuid` bug **fixed in this commit** (compliance-harness.ts: `rbac_has_permission` and `secure_upsert_document` declared `p_user_id uuid` but `rbac_user_org_roles.user_id` is `text`; both function signatures changed to `text`). The suite now progresses past schema setup and stops on a pre-existing **data** prerequisite ("At least 3 records are required in authz.users") which exists on main with or without this effort's changes — separate environmental fix needed before later phases that depend on the markets gate.
- [x] **Curl Tests**: N/A (no new endpoints this phase)
- [ ] **DB verification**: deferred to Phase 2 startup, when `pnpm dev` will be running for curl tests anyway. The DDL is `IF NOT EXISTS`/idempotent throughout and matches the proven existing pattern.
- [x] **Phase Review**:
  - [x] All schema additions from PRD §4.2 present in `portfolioFoundationDdl()`
  - [x] Arbitrator + 3 day-trader analysts + portfolios seeded via `seedPortfolioFoundation()`
  - [x] Existing Phase 6 schema unchanged (only additive `ALTER ... ADD COLUMN IF NOT EXISTS` and new tables)
  - [x] Re-running migrations is idempotent (`ON CONFLICT DO NOTHING` on all seed inserts; `IF NOT EXISTS` on all DDL)

**Notes**:
- Fixed during this phase: `compliance-harness.ts` schema-level bug where `rbac_has_permission` and `secure_upsert_document` functions declared `p_user_id uuid` against a `text` column. Functions now declare `p_user_id text`. Verified the schema setup now progresses past the prior failure point.
- Remaining blocker on main (not this effort's): the compliance test suite requires ≥3 seeded users in `authz.users` to run. Local DB doesn't have them. Reproduced on main with this effort stashed. Needs an env/seed fix before Phase 2 can curl against a fully-green markets gate. Phase 2 can still proceed with lint+typecheck+build+unit-test+manual-curl gating in the meantime.
- Pre-existing on main: 5 web DOM-lib typecheck errors in files unrelated to this effort.
- DB schema verification step deferred to Phase 2 (we'll start `pnpm dev` then to curl-test endpoints, and can `psql` the schema at the same time).

---

## Phase 2: Manual Immediate-Fill Trading
**Status**: Not Started
**Objective**: User can fill a buy or close a position at the current cached price via API, bypassing the existing 5pm queue.

### Steps
- [ ] 2.1 Read `apps/api/src/markets/services/user-portfolio.service.ts` (164 lines) to understand the existing service pattern.
- [ ] 2.2 Read the trade-related sections of `apps/api/src/markets/markets.controller.ts` to understand existing guards, DTOs, and the disclaimer ack pattern.
- [ ] 2.3 Add `executeImmediate({userId, predictionId, instrumentId, quantity, direction})` to `UserPortfolioService`. Reads `prediction.instruments.current_state->>'price'` (or `last_price`), opens a `user_positions` row directly (skip the queue), debits `current_balance`, sets `trigger_reason='manual'` + `trigger_prediction_id`. Idempotency: if a row already exists for `(user_id, prediction_id, instrument_id, status='open')` opened today, return it instead of creating a new one.
- [ ] 2.4 Add `closePosition({userId, positionId})` to `UserPortfolioService`. Reads current cached price, computes `realized_pnl = (current - entry) * quantity` (long-only), updates `exit_price`, `closed_at`, `realized_pnl`, `status='closed'`, credits `current_balance`.
- [ ] 2.5 Add `POST /markets/portfolios/me/execute-trade` to `markets.controller.ts`. Body DTO `{predictionId, instrumentId, direction, quantity}`. JWT guard + existing disclaimer-ack guard. Returns 201 + position.
- [ ] 2.6 Add `POST /markets/portfolios/me/positions/:positionId/close`. JWT guard. Returns 200 + updated position.
- [ ] 2.7 Add unit tests in a new spec file alongside `user-portfolio.service.ts`: happy path opens a position; idempotent re-call returns the same position id; balance debited correctly; closePosition computes realized_pnl correctly.

### Quality Gate
- [ ] **Lint**: `pnpm lint` clean
- [ ] **Typecheck**: `pnpm typecheck` clean
- [ ] **Build**: `pnpm build` succeeds
- [ ] **Unit Tests**: `pnpm test` passes including the new spec
- [ ] **Markets gate**: `pnpm ci:markets` passes
- [ ] **Curl Tests** (against `pnpm dev`):
  - `curl -X POST -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d '{"predictionId":"<real>","instrumentId":"<real>","direction":"long","quantity":10}' http://localhost:3000/markets/portfolios/me/execute-trade` → 201 with position, `trigger_reason='manual'`
  - Repeat → same position id (idempotency)
  - `curl -X POST -H "Authorization: Bearer $JWT" http://localhost:3000/markets/portfolios/me/positions/<id>/close` → 200, `status='closed'`, `realized_pnl` computed
- [ ] **Phase Review**:
  - [ ] PRD §4.3 endpoints `execute-trade` and `:positionId/close` wired
  - [ ] Idempotency holds for `executeImmediate`
  - [ ] Existing user trade queue endpoints unchanged

---

## Phase 3: Master-Detail Read API
**Status**: Not Started
**Objective**: Endpoints to fetch the cross-actor master-detail summary and per-portfolio detail.

### Steps
- [ ] 3.1 Read `apps/api/src/markets/services/analyst-portfolio.service.ts` (225 lines) to understand existing analyst-portfolio query patterns.
- [ ] 3.2 Create `apps/api/src/markets/services/leaderboard.service.ts` with two methods:
  - `getAllPortfoliosSummary()` — single SQL query joining `analyst_portfolios` (all kinds) and `user_portfolios`, returning `[{kind, id, name, current_balance, total_return_pct, total_bailouts, open_position_count}]`. Uses `coalesce` from `bailout_ledger` for total bailouts and a count subquery for open positions.
  - `getPortfolioDetail({kind, id})` — returns `{portfolio, positions: [open + last 30d closed], snapshots: [last 30 daily_pnl_snapshot rows]}`.
- [ ] 3.3 Register `LeaderboardService` in `apps/api/src/markets/markets.module.ts`.
- [ ] 3.4 Add `GET /markets/portfolios` endpoint in `markets.controller.ts`. JWT guard. Returns `getAllPortfoliosSummary()` output.
- [ ] 3.5 Add `GET /markets/portfolios/:kind/:id` endpoint. Validates `kind ∈ {user, analyst}`. Returns `getPortfolioDetail()` output.

### Quality Gate
- [ ] **Lint**: `pnpm lint` clean
- [ ] **Typecheck**: `pnpm typecheck` clean
- [ ] **Build**: `pnpm build` succeeds
- [ ] **Unit Tests**: `pnpm test` passes
- [ ] **Markets gate**: `pnpm ci:markets` passes
- [ ] **Curl Tests**:
  - `curl -X GET -H "Authorization: Bearer $JWT" http://localhost:3000/markets/portfolios` → 200; array contains user row(s), N analyst rows, 1 arbitrator row, 3 day_trader rows; every row at $1M
  - `curl -X GET -H "Authorization: Bearer $JWT" http://localhost:3000/markets/portfolios/analyst/<arbitrator-id>` → 200 with `{portfolio, positions:[], snapshots:[]}`
- [ ] **Phase Review**:
  - [ ] PRD §4.3 GET endpoints wired
  - [ ] Master-detail summary returns every kind correctly
  - [ ] Detail endpoint validates `:kind` parameter

---

## Phase 4: Background Jobs (Reset, Benchmark, Daily P&L)
**Status**: Not Started
**Objective**: Monthly reset + bailout ledger; SPY benchmark daily ingest; daily P&L snapshot writes inside the existing EOD cron.

### Steps
- [ ] 4.1 Read `apps/api/src/markets/services/eod-settlement.service.ts` (347 lines) to understand the cron setup.
- [ ] 4.2 Read whichever FMP adapter file under `apps/api/src/markets/adapters/` (or wherever Phase 2 placed them) is used to fetch daily price data.
- [ ] 4.3 Create `apps/api/src/markets/services/monthly-reset.service.ts`. Cron `@Cron('0 0 1 * *')`. Method `runReset({manual:boolean})`: iterates `analyst_portfolios` + `user_portfolios`, closes any open positions at last cached price, computes `topup = max(0, 1000000 - current_balance)`, inserts into `bailout_ledger` (UNIQUE handles idempotency), resets `current_balance = 1000000`. Returns `{ledgerRowsWritten}`.
- [ ] 4.4 Create `apps/api/src/markets/services/benchmark-ingest.service.ts`. Cron `@Cron('0 23 * * 1-5')`. Method `ingestSpy()`: calls FMP adapter, upserts into `benchmark_series`.
- [ ] 4.5 Extend `eod-settlement.service.ts`: at the end of the existing 22:00 UTC cron handler, write one `daily_pnl_snapshot` row per portfolio (analyst + user). Wrap in try/catch — log on failure, do not roll back settlement. Use the UNIQUE constraint for safe retry.
- [ ] 4.6 Add `POST /markets/portfolios/admin/monthly-reset` endpoint. Admin-role guard (use existing pattern). Calls `MonthlyResetService.runReset({manual:true})`.
- [ ] 4.7 Register `MonthlyResetService` and `BenchmarkIngestService` in `MarketsModule`.
- [ ] 4.8 Add unit tests: `MonthlyResetService` writes one row per portfolio; second invocation in same month writes zero rows; books-balance invariant test (`current_balance + Σ(open_value) = initial + Σ(realized) + Σ(bailouts)`).

### Quality Gate
- [ ] **Lint**: `pnpm lint` clean
- [ ] **Typecheck**: `pnpm typecheck` clean
- [ ] **Build**: `pnpm build` succeeds
- [ ] **Unit Tests**: `pnpm test` passes including the new tests
- [ ] **Markets gate**: `pnpm ci:markets` passes
- [ ] **Curl Tests**:
  - `curl -X POST -H "Authorization: Bearer $ADMIN_JWT" http://localhost:3000/markets/portfolios/admin/monthly-reset` → 200, `{ledgerRowsWritten: n}` where n = total portfolio count
  - Repeat → 200, `{ledgerRowsWritten: 0}`
- [ ] **DB verification**:
  - After manual `BenchmarkIngestService.ingestSpy()` invocation: `psql ... "select count(*) from prediction.benchmark_series where symbol='SPY'"` returns ≥ 1
  - After EOD cron run: `psql ... "select count(*) from prediction.daily_pnl_snapshot"` returns ≥ N portfolios
- [ ] **Phase Review**:
  - [ ] Three background jobs wired and idempotent
  - [ ] Books-balance invariant test passes
  - [ ] Existing EOD settlement steps unchanged (queue still settles)

---

## Phase 5: Frontend Master-Detail View
**Status**: Not Started
**Objective**: `/portfolios` route renders the master-detail table; existing dashboard widgets preserved inside the user's expanded panel.

### Steps
- [ ] 5.1 Read `apps/web/src/views/PortfolioDashboardView.vue` and `apps/web/src/stores/portfolio.store.ts` to understand current layout and store shape.
- [ ] 5.2 Extend `portfolio.store.ts`: state `allPortfolios: PortfolioSummary[]`, `portfolioDetails: Record<string, PortfolioDetail>`; actions `fetchAllPortfolios()`, `fetchPortfolioDetail(kind, id)` calling Phase 3 endpoints.
- [ ] 5.3 Refactor `PortfolioDashboardView.vue` into master-detail: top table (name, kind, current balance, total return %, bailouts, open positions); click row → expanded inline panel with positions + recent trades.
- [ ] 5.4 Move existing balance + queue widgets into the user's expanded panel (preserved, not deleted).
- [ ] 5.5 On user open-position rows in the expanded panel, render reference 5% / 10% / trailing-stop levels (computed from `entry_price`), labelled "reference levels (manual exit)".
- [ ] 5.6 Add router entry `/portfolios` pointing at the refactored view.
- [ ] 5.7 Add a Vitest spec for the new store actions: `fetchAllPortfolios` populates state, `fetchPortfolioDetail` populates the keyed map.

### Quality Gate
- [ ] **Lint**: `pnpm lint` clean
- [ ] **Typecheck**: `pnpm typecheck` clean
- [ ] **Build**: `pnpm build` succeeds
- [ ] **Unit Tests**: `pnpm test` passes including the new store spec
- [ ] **Markets gate**: `pnpm ci:markets` passes
- [ ] **Chrome Tests** (manual, `pnpm dev`):
  - Open `/portfolios`: master-detail table renders with user + analysts + arbitrator + 3 day traders, all $1M
  - Click an analyst row: positions + snapshots panel expands below
  - Click the user row: existing dashboard widgets render inside the expanded panel
- [ ] **Phase Review**:
  - [ ] PRD §4.4 master-detail layout matches spec
  - [ ] Existing widgets preserved
  - [ ] Reference levels render on user positions

---

## Phase 6: Trade Action UI
**Status**: Not Started
**Objective**: One-click Buy/Sell from any prediction view with disclaimer ack, immediately visible in the user's expanded portfolio row.

### Steps
- [ ] 6.1 Read `apps/web/src/components/AnalystPredictionModal.vue` to understand current props and disclaimer flow.
- [ ] 6.2 Extend `AnalystPredictionModal.vue` with `mode: 'view' | 'trade'` prop. In trade mode show: direction (Buy/Sell), share-count input, current price display, total cost display, Submit button. On Submit → existing disclaimer ack flow → call `portfolioStore.executeTrade()`.
- [ ] 6.3 Extend `portfolio.store.ts` with `executeTrade(payload)` and `closePosition(positionId)` actions calling Phase 2 endpoints.
- [ ] 6.4 Locate prediction view, analysis view, and challenges view components. Add a "Trade" button on each that opens `AnalystPredictionModal.vue` in `mode='trade'` with the relevant context.
- [ ] 6.5 In the master-detail user-row expanded panel, add a Sell button on each open position that calls `closePosition`.
- [ ] 6.6 Vitest spec extension: `executeTrade` posts the right body and updates the affected portfolio in state.

### Quality Gate
- [ ] **Lint**: `pnpm lint` clean
- [ ] **Typecheck**: `pnpm typecheck` clean
- [ ] **Build**: `pnpm build` succeeds
- [ ] **Unit Tests**: `pnpm test` passes
- [ ] **Markets gate**: `pnpm ci:markets` passes
- [ ] **Curl Tests**: Phase 2 + Phase 3 curl set must still pass unchanged
- [ ] **Chrome Tests**:
  - Open a prediction view, click the new Trade button, modal opens in trade mode
  - Set quantity 10, click Buy, accept disclaimer: modal closes, navigate to `/portfolios`, click user row → new position visible with reference 5%/10% labels
  - Click Sell on that position: status flips to closed, realized P&L visible
  - Repeat across analysis view and challenges view trade buttons
- [ ] **Phase Review**:
  - [ ] PRD §3 user stories all fulfilled
  - [ ] Disclaimer ack still gates trade actions
  - [ ] No regressions in Phase 5 master-detail
