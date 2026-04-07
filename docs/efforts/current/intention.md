# Portfolio Foundation & Manual Trading — Intention

## What this effort is

Set up the multi-actor paper-trading game's foundation: every actor — the user, every analyst, the arbitrator "mini-me," and three day-trader actors — gets a $1M paper portfolio that lives in a single master-detail view. The user can buy and sell from any prediction view at the current cached price, immediately, with one disclaimer click. Monthly reset + bailout tracking work. Daily P&L snapshots and a SPY benchmark series ingest so later phases have data to graph.

This effort does **not** include any auto-trading logic, stop-loss watchers, day-trader strategies, or the leaderboard. Those are tracked separately in two follow-up efforts (see "Follow-ups" below). This is just the table-stakes plumbing every later phase will sit on.

This is **for fun and education**, not investment advice. The disclaimer plumbing already exists and stays in front of every user trade action.

## Why now

Phase 6 (analyst-intelligence-platform) shipped the *mechanism*: Kelly-based position sizing, analyst/user portfolios, a trade queue, EOD settlement, the disclaimer flow, and a portfolio dashboard. What it doesn't have:

- The **arbitrator** has no portfolio.
- There's no concept of **day traders** in the data model.
- The user trade flow is queue-then-settle-at-5pm-ET. We want an **immediate-fill** path so manual trades happen at the current price right now.
- **Monthly reset + bailout tracking** doesn't exist.
- No daily P&L snapshots persisted as a source of truth for equity curves.
- No SPY benchmark series.

Until those exist, the auto-trading and leaderboard work in the follow-up efforts has nothing to sit on.

## What exists today (extend, don't duplicate)

- **Position sizing**: `position-sizing.service.ts` + `trade-recommendation.service.ts`. Conviction tier → Kelly fraction → risk-adjusted → calibration-damped. Reused by later efforts; not touched here.
- **Portfolios**: `analyst_portfolios`, `analyst_positions`, `user_portfolios`, `user_positions` tables and their services. **Extend** `analyst_portfolios` with a `kind` column so it can host arbitrator + day-trader rows alongside analysts.
- **Trade queue + EOD settlement**: `user_trade_queue`, `eod-settlement.service.ts`. **Keep** as-is for the existing 5pm flow. We add an immediate-fill *alternative* for the user; we do not remove the queue.
- **Disclaimer**: `AnalystPredictionModal.vue` + `trade_decision_disclaimers` table. **Reuse**.
- **Current price**: `instruments.current_state` jsonb, refreshed every 15 minutes by `OutcomeTrackingService`. **Reuse**. Honest limitation: 15-min cadence is fine for manual trading and analyst signals; day traders in the follow-up effort accept the same limitation.
- **Arbitrator**: `prediction-runner.service.ts` produces an arbitrator prediction with conviction. Doesn't trade. This effort just gives it a portfolio row; the actual trading wires up in the autotrading follow-up.

## What's in scope

- **Schema groundwork** (so follow-up efforts don't need their own migrations):
  - `kind` / `strategy_name` / `strategy_state` columns on `analyst_portfolios` (`kind` ∈ `analyst|arbitrator|day_trader`)
  - Trade provenance columns on `analyst_positions` and `user_positions` (`trigger_reason`, `trigger_prediction_id`, `trigger_conviction`, `trigger_strategy`) — populated only with `manual` for user positions in this effort; later efforts populate the rest
  - `bailout_ledger` table
  - `benchmark_series` table
  - `daily_pnl_snapshot` table
- **Seeding**: arbitrator portfolio at $1M; three day-trader portfolios (`momentum_breakout`, `mean_reversion`, `gap_and_go`) at $1M with empty strategy state
- **Backend**:
  - `UserPortfolioService.executeImmediate()` — fills at current cached price, bypasses the queue, idempotent
  - `UserPortfolioService.closePosition()` — manual close at current price
  - `MonthlyResetService` — monthly cron + admin endpoint, writes bailout ledger rows, idempotent
  - `BenchmarkIngestService` — daily SPY ingest via existing FMP/Twelve Data adapter
  - `LeaderboardService` skeleton — only the methods needed for the master-detail summary (return, current balance, total bailouts). Full leaderboard is in the day-traders/leaderboard follow-up.
  - Daily P&L snapshot writing inside the existing `eod-settlement.service.ts` cron
- **API**:
  - `POST /markets/portfolios/me/execute-trade` (immediate fill)
  - `POST /markets/portfolios/me/positions/:id/close`
  - `GET /markets/portfolios` (master-detail summary)
  - `GET /markets/portfolios/:kind/:id` (detail with positions + last 30 snapshots)
  - `POST /markets/portfolios/admin/monthly-reset` (manual trigger, admin-only)
- **Frontend**:
  - Refactor `PortfolioDashboardView.vue` into a master-detail table listing every actor (user + analysts + arbitrator + 3 day traders), expandable to show positions + recent trades
  - Trade button + share-count input + Buy/Sell submit on prediction / analysis / challenges views, reusing the existing disclaimer modal
  - Reference 5%/10% stop/take levels displayed on user open positions (informational only, no auto-sell)
  - Router entry `/portfolios`

## Trading mechanics (locked decisions)

- **Long-only, whole shares**, no shorting, no leverage, no margin. Cleanest model for cross-actor comparison.
- **Instant fill at the cached current price**, zero slippage, zero commission. With ~15-min price cadence, modeling slippage would be theater.
- **Monthly reset to $1M** for every actor on the 1st of each month at 00:00 UTC. The gap is recorded in the bailout ledger. Going broke is allowed; it shows up later on the leaderboard's "shame" column.
- **Disclaimer**: every user-initiated trade goes through the existing "for fun and education, not advice" ack.

## Out of scope (in scope for follow-ups)

- Conviction-threshold auto-trading for analysts and arbitrator → **Agent Autotrading** effort
- 5%/10%/trailing stop watcher → **Agent Autotrading** effort
- EOD forced-buy sweep for still-strong predictions → **Agent Autotrading** effort
- Day-trader strategy implementations and runner → **Day Traders & Leaderboard** effort
- Full leaderboard (Sharpe, drawdown, win rate, holding period, streaks, calibration) → **Day Traders & Leaderboard** effort
- Equity curve charts and calibration view → **Day Traders & Leaderboard** effort

## Out of scope (permanently)

- Real broker integration. Paper only.
- Real-time / sub-15-minute price feeds.
- Shorting, leverage, options, fractional shares.
- Tax-lot accounting beyond simple FIFO realized P&L.
- Reset cadences other than monthly.

## Success criteria

- Every actor (user, every analyst, arbitrator, three day traders) has a $1M portfolio visible in the master-detail view.
- A human can click Buy on a prediction view, accept the disclaimer, fill at current price, and immediately see the position in their expanded portfolio row.
- Books-balance invariant holds: `current_balance + Σ(open_position_value) = initial + Σ(realized_pnl) + Σ(bailouts)` for every actor on every snapshot.
- Manual `/admin/monthly-reset` writes a bailout ledger row per portfolio and resets balances to $1M.
- SPY benchmark series has daily rows from the day this effort ships forward.
- Daily P&L snapshots populate at 22:00 UTC for every portfolio.
- The schema additions are present and shaped correctly so the autotrading and day-traders/leaderboard efforts don't need their own migrations.

## Follow-ups (separate efforts)

- `docs/efforts/future/agent-autotrading/` — analysts + arbitrator auto-trade on conviction, stop/take/trailing watcher, EOD forced-buy sweep, full provenance.
- `docs/efforts/future/day-traders-and-leaderboard/` — three day-trader strategies, the runner, full leaderboard with all metrics, equity curves, calibration view, UI polish.
