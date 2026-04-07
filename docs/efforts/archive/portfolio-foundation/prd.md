# Portfolio Foundation & Manual Trading — Product Requirements Document

## 1. Overview

Set up the data, services, endpoints, and UI that the multi-actor paper-trading game will sit on. Every actor — the user, every analyst, the arbitrator "mini-me," and three day-trader actors — gets a $1M paper portfolio that lives in a single master-detail view. The user can buy and sell from any prediction view at the current cached price, immediately, with one disclaimer click. Monthly reset writes to a bailout ledger. Daily P&L snapshots and a SPY benchmark series ingest so later efforts have data to graph.

This effort is foundation only. Autotrading for analysts/arbitrator and day-trader strategies + the full leaderboard live in two follow-up efforts (`docs/efforts/future/agent-autotrading/`, `docs/efforts/future/day-traders-and-leaderboard/`). The schema and seeding here are deliberately shaped to support those follow-ups without further migrations.

This is **for fun and education**, not investment advice. The disclaimer in `AnalystPredictionModal.vue` stays in front of every user trade action.

## 2. Goals & Success Criteria

**Goals**
- Schema additions exist and are shaped to host autotrading + day-trader work without further migrations.
- Arbitrator and three day-trader portfolios are seeded at $1M.
- The user can fill a buy or sell at the current cached price immediately, bypassing the existing 5pm queue.
- A master-detail view lists every actor with summary columns and expands to positions + recent trades.
- Monthly reset returns every actor to $1M and writes a row to the bailout ledger per portfolio.
- A SPY benchmark series ingests daily.
- Daily P&L snapshots populate every weekday at 22:00 UTC for every portfolio.
- Books-balance invariant `current_balance + Σ(open_position_value) = initial + Σ(realized_pnl) + Σ(bailouts)` holds for every actor.

**Done when**
- All quality gates pass on the effort branch.
- A real run shows: a manual user trade filling at current price; every actor visible in master-detail at $1M; manual `monthly-reset` writes ledger rows; one day's worth of SPY in `benchmark_series`; one day's daily P&L snapshots present.
- Phase 6 functionality (existing user trade queue, EOD settlement, disclaimer flow, dashboard widgets) is unchanged.

## 3. User Stories / Use Cases

- **As the user**, I open a prediction detail view, see the analyst signals, decide I want 25 shares of NVDA, click Buy, click "I Understand" on the disclaimer, and the trade fills at the current cached price immediately. It appears in my expanded portfolio row when I refresh the master-detail.
- **As the user**, I open my own portfolio row, see my open positions, see the reference 5%/10% stop/take levels for each (informational, manual exit), and click Sell on one of them to close at the current price.
- **As an observer**, I open `/portfolios`, see a single table with the user, every analyst, the arbitrator, and three day traders all at $1M. I click any row and see that actor's positions and recent trades expand below.
- **As an admin**, I trigger `POST /markets/portfolios/admin/monthly-reset` and every actor's balance returns to $1M. The bailout ledger has one new row per portfolio recording the gap that was filled.

## 4. Technical Requirements

### 4.1 Architecture

**Backend** (NestJS, `apps/api`)

New / extended services in `apps/api/src/markets/services/`:

- **Extend `UserPortfolioService`** (`user-portfolio.service.ts`) with:
  - `executeImmediate({userId, predictionId, instrumentId, quantity, direction})` — reads `instruments.current_state.price`, opens a `user_positions` row directly (skips `user_trade_queue`), records `trigger_reason='manual'`, `trigger_prediction_id`. Idempotent on `(user_id, prediction_id, instrument_id)` within the current trading day.
  - `closePosition({userId, positionId})` — closes at current cached price, sets `exit_price` / `closed_at` / `realized_pnl`, updates `current_balance`, marks `status='closed'`.
- **Extend `AnalystPortfolioService`** (`analyst-portfolio.service.ts`) only as needed to read across new `kind` values for the master-detail summary. No behavioral changes.
- **New `MonthlyResetService`** (`apps/api/src/markets/services/monthly-reset.service.ts`):
  - Cron `0 0 1 * *` (00:00 UTC on the 1st)
  - For every portfolio in `prediction.analyst_portfolios` and `prediction.user_portfolios`: close any open positions at last cached price, compute gap to $1M, write a `bailout_ledger` row, reset `current_balance = 1000000`.
  - Idempotent: skip portfolios that already have a ledger entry for the current month.
- **New `BenchmarkIngestService`** (`benchmark-ingest.service.ts`):
  - Cron `0 23 * * 1-5` (23:00 UTC weekdays — after settlement)
  - Fetches SPY daily close via the existing FMP adapter from Phase 2 (`apps/api/src/markets/adapters/`), upserts into `benchmark_series`.
- **New `LeaderboardService`** (`leaderboard.service.ts`) — skeleton only:
  - `getAllPortfoliosSummary()` — drives the master-detail table. Returns one row per portfolio with: `kind`, name, `current_balance`, total return % since lifetime start, total bailouts, open position count.
  - `getPortfolioDetail({kind, id})` — positions (open + recently closed) plus last 30 daily P&L snapshots.
  - Other metrics (Sharpe, drawdown, calibration, etc.) deferred to the day-traders/leaderboard follow-up.
- **Extend `EodSettlementService`** (`eod-settlement.service.ts`) to write one `daily_pnl_snapshot` row per portfolio after its existing settlement steps complete. Reuses the existing 22:00 UTC cron — no new cron added for snapshots.

**Frontend** (Vue 3, `apps/web`)

- **Refactor `apps/web/src/views/PortfolioDashboardView.vue`** into a master-detail table:
  - Rows: user + each analyst + arbitrator + each day trader
  - Columns: name, kind, current balance, total return %, total bailouts, open positions count
  - Click row → expanded panel with positions list (with reference 5%/10% levels for user positions) + recent trades
  - Existing dashboard widgets (balance, queue) move into the user's expanded row
- **Extend `apps/web/src/stores/portfolio.store.ts`** with `fetchAllPortfolios`, `fetchPortfolioDetail`, `executeTrade`, `closePosition`.
- **Extend `apps/web/src/components/AnalystPredictionModal.vue`** to accept buy/sell intent + share-count input + Buy/Sell submit, calling the new immediate-fill endpoint. Reuse the existing disclaimer ack flow before submitting.
- **Add a "Trade" button** on the prediction view, the analysis view, and the challenges view. (Exact component file names to be confirmed during implementation; the existing `AnalystPredictionModal.vue` is reused as the modal for all three.)
- **Router**: `/portfolios` route pointing at the refactored view.

### 4.2 Data Model Changes

All changes live in the `prediction.*` schema, applied via the existing `MarketsSchemaService` in `apps/api/src/markets/schema/markets-schema.service.ts` (1106-line file containing all DDL for the markets feature). New blocks added at the end of the existing schema sequence; all use `IF NOT EXISTS` guards.

**ID convention**: the existing portfolio tables use `text` primary keys (not `uuid`). All new columns and tables follow the same convention — `text` IDs, `gen_random_uuid()::text` for generated IDs, plain `numeric` for monetary values to match the existing `analyst_positions.entry_price numeric` pattern.

**Modify existing tables**

```sql
ALTER TABLE prediction.analyst_portfolios
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'analyst'
    CHECK (kind IN ('analyst','arbitrator','day_trader'));
ALTER TABLE prediction.analyst_portfolios
  ADD COLUMN IF NOT EXISTS strategy_name text NULL;
ALTER TABLE prediction.analyst_portfolios
  ADD COLUMN IF NOT EXISTS strategy_state jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE prediction.analyst_positions
  ADD COLUMN IF NOT EXISTS trigger_reason text NOT NULL DEFAULT 'manual'
    CHECK (trigger_reason IN
      ('signal_cross','eod_sweep','stop_loss','take_profit','trailing_stop','manual','strategy'));
ALTER TABLE prediction.analyst_positions
  ADD COLUMN IF NOT EXISTS trigger_prediction_id text NULL;
ALTER TABLE prediction.analyst_positions
  ADD COLUMN IF NOT EXISTS trigger_conviction numeric NULL;
ALTER TABLE prediction.analyst_positions
  ADD COLUMN IF NOT EXISTS trigger_strategy text NULL;
ALTER TABLE prediction.analyst_positions
  ADD COLUMN IF NOT EXISTS high_water_mark numeric NULL;

ALTER TABLE prediction.user_positions
  ADD COLUMN IF NOT EXISTS trigger_reason text NOT NULL DEFAULT 'manual'
    CHECK (trigger_reason IN ('manual','eod_sweep'));
ALTER TABLE prediction.user_positions
  ADD COLUMN IF NOT EXISTS trigger_prediction_id text NULL;
```

The `trigger_prediction_id` columns are nullable text with no foreign key, matching the existing `analyst_positions.prediction_id text` convention. Provenance lookups join on the column without enforced referential integrity.

The `high_water_mark` column on `analyst_positions` is added now so the autotrading follow-up does not need a migration. It's left null until the autotrading effort starts populating it.

**New tables**

```sql
CREATE TABLE IF NOT EXISTS prediction.bailout_ledger (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  portfolio_kind text NOT NULL CHECK (portfolio_kind IN ('user','analyst')),
  portfolio_id text NOT NULL,
  reset_date date NOT NULL,
  balance_before numeric NOT NULL,
  topup_amount numeric NOT NULL,
  cumulative_bailouts numeric NOT NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (portfolio_kind, portfolio_id, reset_date)
);

CREATE INDEX IF NOT EXISTS idx_bailout_portfolio
  ON prediction.bailout_ledger (portfolio_kind, portfolio_id, reset_date DESC);

CREATE TABLE IF NOT EXISTS prediction.benchmark_series (
  symbol text NOT NULL,
  trading_date date NOT NULL,
  close_price numeric NOT NULL,
  source text NOT NULL,
  PRIMARY KEY (symbol, trading_date)
);

CREATE TABLE IF NOT EXISTS prediction.daily_pnl_snapshot (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  portfolio_kind text NOT NULL CHECK (portfolio_kind IN ('user','analyst')),
  portfolio_id text NOT NULL,
  snapshot_date date NOT NULL,
  starting_balance numeric NOT NULL,
  ending_balance numeric NOT NULL,
  realized_pnl numeric NOT NULL,
  unrealized_pnl numeric NOT NULL,
  open_position_count int NOT NULL,
  trades_today int NOT NULL,
  UNIQUE (portfolio_kind, portfolio_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_pnl_snapshot_portfolio
  ON prediction.daily_pnl_snapshot (portfolio_kind, portfolio_id, snapshot_date DESC);
```

The `bailout_ledger` UNIQUE constraint on `(portfolio_kind, portfolio_id, reset_date)` enforces monthly-reset idempotency at the database level.

**Seeding** (also runs from `MarketsSchemaService` after DDL, idempotent):

- Locate the arbitrator analyst row (by name/role used in `prediction-runner.service.ts`). If absent, create a synthetic row in `analysts` named `arbitrator` with `role='arbitrator'`.
- Insert/upsert one `analyst_portfolios` row for the arbitrator with `kind='arbitrator'`, `initial_balance = 1000000`, `current_balance = 1000000`.
- Insert/upsert three `analysts` rows named `momentum_breakout`, `mean_reversion`, `gap_and_go` with `role='day_trader'`, then three `analyst_portfolios` rows with `kind='day_trader'`, `strategy_name` set, $1M balance, `strategy_state = '{}'::jsonb`.

### 4.3 API Changes

All under `markets.controller.ts`. Existing endpoints preserved.

**New endpoints**

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| POST | `/markets/portfolios/me/execute-trade` | `{predictionId, instrumentId, direction:'long', quantity}` | `201` + created `user_positions` row |
| POST | `/markets/portfolios/me/positions/:positionId/close` | — | `200` + updated `user_positions` row |
| GET | `/markets/portfolios` | — | `200` + array of summary rows (one per portfolio across all kinds) |
| GET | `/markets/portfolios/:kind/:id` | `:kind` ∈ `user|analyst` | `200` + `{portfolio, positions, snapshots}` |
| POST | `/markets/portfolios/admin/monthly-reset` | — | `200` + count of ledger rows written |

**Auth**: all `me/*` endpoints require the existing JWT guard. The admin endpoint requires the existing admin-role guard. The disclaimer ack guard already in place for trade actions remains in front of `execute-trade`.

**Untouched** (Phase 6 endpoints stay as-is): `GET /portfolios/me`, `GET /portfolios/me/positions`, `GET /portfolios/me/queue`, `POST /portfolios/me/queue-trade`, `POST /portfolios/me/queue-trade/:tradeId/cancel`, `GET /portfolios/leaderboard`, `GET /trades/decisions`, `POST /trades/acknowledge-disclaimer`. The new `GET /markets/portfolios` (no `/me`) is the master-detail summary; the old `GET /portfolios/leaderboard` continues to power the existing widget until the day-traders/leaderboard effort replaces it.

### 4.4 Frontend Changes

- `PortfolioDashboardView.vue` — refactored into master-detail.
- `portfolio.store.ts` — new actions: `fetchAllPortfolios`, `fetchPortfolioDetail`, `executeTrade`, `closePosition`. Existing actions retained.
- `AnalystPredictionModal.vue` — adds quantity input + Buy/Sell submit; calls `POST /portfolios/me/execute-trade` after disclaimer ack.
- New "Trade" button placed on the prediction view, analysis view, and challenges view. Each opens `AnalystPredictionModal.vue` in trade-action mode.
- On user open-position rows in the expanded panel, render reference 5% / 10% / trailing-stop levels labelled "reference levels (manual exit)." No auto-sell.
- New router entry `/portfolios` → refactored view. Existing `/portfolio` (if present) either redirects or is the same route — confirmed in implementation.

### 4.5 Infrastructure Requirements

- No new external services.
- Two new cron jobs in NestJS scheduler:
  - `MonthlyResetService` — `0 0 1 * *`
  - `BenchmarkIngestService` — `0 23 * * 1-5`
- Existing `eod-settlement.service.ts` cron (`0 22 * * 1-5`) is extended with the daily snapshot writer; no new cron.
- Both new services registered in `MarketsModule`.

## 5. Non-Functional Requirements

- **Performance**: master-detail summary query returns in < 500ms with up to 50 portfolios. Use the `idx_pnl_snapshot_portfolio` index and aggregate at SQL level.
- **Correctness — books invariant**: `current_balance + Σ(open_position_value) = initial_balance + Σ(realized_pnl) + Σ(bailouts)` for every actor on every snapshot. Enforced in tests.
- **Idempotency**: monthly reset must be safe to run twice on the same date — DB UNIQUE constraint + service-level skip-if-exists. `executeImmediate` must be safe against double-clicks within a trading day for the same `(user_id, prediction_id, instrument_id)`.
- **Provenance**: every fill row has a non-null `trigger_reason`. CHECK constraint enforces this.
- **Legal**: every user-initiated trade goes through the existing disclaimer ack. UI copy uses "analysis" / "signal" — never "advice" or "recommendation."
- **Auth**: all new `me/*` endpoints behind JWT. Admin endpoint behind admin-role guard.
- **Compatibility**: existing user trade queue, EOD settlement, dashboard widgets, and disclaimer flow remain functional. No deprecations in this effort.
- **Trading mechanics (locked)**: long-only, whole shares, no shorting, no leverage, no margin, no fractional shares. Instant fill at the cached `instruments.current_state.price`, zero slippage, zero commission. Cleanest model for cross-actor comparison and matches paper-trading intent.

## 6. Out of Scope

- Conviction-threshold autotrading for analysts and arbitrator (→ `agent-autotrading` future effort)
- 5%/10%/trailing stop watcher (→ `agent-autotrading`)
- EOD forced-buy sweep (→ `agent-autotrading`)
- Day-trader strategy implementations and runner (→ `day-traders-and-leaderboard`)
- Full leaderboard with Sharpe / drawdown / win rate / streaks / calibration (→ `day-traders-and-leaderboard`)
- Equity curve charts and calibration view (→ `day-traders-and-leaderboard`)
- Real broker integration
- Sub-15-minute price feeds
- Shorting, leverage, options, fractional shares
- Tax-lot accounting beyond simple FIFO realized P&L
- Reset cadences other than monthly

## 7. Dependencies & Risks

**External dependencies**
- Existing FMP / Twelve Data adapter (Phase 2) for SPY benchmark.
- Existing 15-min price refresh in `OutcomeTrackingService` for the cached `current_state.price`.

**Risks**

| Risk | Mitigation |
|---|---|
| Reusing `analyst_portfolios` for non-analyst actors couples concepts | Add `kind` column with CHECK constraint; all queries filter by kind; rename in a follow-up effort if it becomes painful. |
| Arbitrator may not have an `analysts` row today | Seeding routine looks for it by name/role and creates a synthetic row if missing. Idempotent on re-run. |
| Monthly reset closes positions at stale prices | Reset runs at 00:00 UTC on the 1st when markets are closed; uses last cached price; this is fine for paper. UNIQUE constraint on `(portfolio_kind, portfolio_id, reset_date)` prevents double-billing. |
| Day-trader portfolios sit empty until the day-traders effort ships | Acceptable. Master-detail just shows them at $1M with zero positions. |
| `executeImmediate` could allow a double-fill on rapid clicks | Idempotency guard on `(user_id, prediction_id, instrument_id, trading_day)` returns the existing position rather than creating a new one. |
| Daily snapshot write inside `eod-settlement.service.ts` could fail and corrupt settlement state | Snapshot write happens last in the cron; failures are logged but don't roll back the settlement. UNIQUE constraint on `(portfolio_kind, portfolio_id, snapshot_date)` allows safe retry next day. |
| Trade button placement requires touching three Vue views I haven't read yet | Implementation phase opens those files and confirms exact placement before editing. |

## 8. Phasing

Six small phases, each scoped to fit a single focused work session. Phases 1–4 are backend (curl-testable). Phases 5–6 are frontend.

### Phase 1 — Schema & Seeding

**Goal**: all schema additions present in the DB; arbitrator + 3 day-trader portfolios seeded at $1M.

**Scope**: migrations in `markets-schema.service.ts` per §4.2; idempotent seeding routine for the arbitrator analyst row (created if missing) and three day-trader analyst+portfolio rows.

**Validates**: `psql` confirms new columns exist on `analyst_portfolios`/`analyst_positions`/`user_positions`; new tables exist; one arbitrator portfolio + three day-trader portfolios at `current_balance = 1000000`.

### Phase 2 — Manual Immediate-Fill Trading

**Goal**: the user can fill a buy or close a position at the current cached price via API, bypassing the queue.

**Scope**: `UserPortfolioService.executeImmediate()` + `closePosition()`; endpoints `POST /markets/portfolios/me/execute-trade` and `POST /markets/portfolios/me/positions/:positionId/close`; idempotency tests.

**Validates**: curl POST execute-trade returns a position with `trigger_reason='manual'`; second identical POST returns the same position id; close endpoint flips status to `closed` and computes `realized_pnl`.

### Phase 3 — Master-Detail Read API

**Goal**: a single endpoint returns the master-detail summary across all portfolio kinds, plus a per-portfolio detail endpoint.

**Scope**: `LeaderboardService.getAllPortfoliosSummary()` and `getPortfolioDetail()`; endpoints `GET /markets/portfolios` and `GET /markets/portfolios/:kind/:id`.

**Validates**: curl `GET /portfolios` returns one row per actor (user + analysts + arbitrator + 3 day traders) all at $1M; `GET /portfolios/analyst/<arbitrator-id>` returns the detail object with empty positions and snapshots arrays initially.

### Phase 4 — Background Jobs (Reset, Benchmark, Daily P&L)

**Goal**: monthly reset writes bailout ledger rows; SPY benchmark ingests daily; daily P&L snapshots populate every weekday at 22:00 UTC.

**Scope**: `MonthlyResetService` (cron + admin endpoint); `BenchmarkIngestService` (cron); daily P&L snapshot writer inside `eod-settlement.service.ts`; idempotency tests; books-balance invariant test.

**Validates**: curl `POST /admin/monthly-reset` writes one bailout row per portfolio and resets balances; second invocation writes zero new rows; `psql` shows SPY rows in `benchmark_series` after manual `BenchmarkIngestService.ingestSpy()`; `psql` shows snapshot rows after `eod-settlement.service.ts` runs.

### Phase 5 — Frontend Master-Detail View

**Goal**: `/portfolios` route renders the master-detail table with every actor; clicking expands to positions + recent trades.

**Scope**: refactor `PortfolioDashboardView.vue` into master-detail; extend `portfolio.store.ts` with `fetchAllPortfolios` + `fetchPortfolioDetail`; preserve the existing dashboard widgets inside the user's expanded row; render reference 5%/10%/trailing levels on user open positions; router entry `/portfolios`.

**Validates**: Chrome confirms every actor visible at $1M; click-to-expand works; existing Phase 6 widgets still render inside the user's expanded panel.

### Phase 6 — Trade Action UI

**Goal**: one-click Buy/Sell from any prediction view with disclaimer ack, visible immediately in the user's portfolio row.

**Scope**: extend `AnalystPredictionModal.vue` with a trade-action mode (direction, quantity input, cost display, submit); add Trade button on prediction / analysis / challenges views; `executeTrade` + `closePosition` actions in `portfolio.store.ts`; reuse existing disclaimer ack flow.

**Validates**: Chrome confirms a human can open a prediction view, click Trade, set quantity, accept disclaimer, fill at current price, and see the new position in their expanded portfolio row within seconds. Manual close of that position works from the UI.
