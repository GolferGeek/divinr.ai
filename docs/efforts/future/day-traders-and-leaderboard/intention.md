# Day Traders & Leaderboard — Intention

## What this effort is

Add three day-trader actors with distinct strategies, the runner that drives them, and the full leaderboard that ranks every actor in the game on a meaningful set of metrics — including a "shame" column for monthly bailouts and a calibration column that calls out analysts whose claimed conviction doesn't match their actual hit rate. Equity curves with SPY benchmark overlay and a per-analyst calibration chart finish the picture.

This is the third and final effort in the multi-actor paper-trading game arc, sitting on top of:
1. **Portfolio Foundation & Manual Trading** — schema, portfolios, master-detail UI, manual trading, monthly reset, benchmark ingest
2. **Agent Autotrading** — analysts and arbitrator auto-trading on conviction, stop/take/trailing rules, EOD sweep

## Why now

After the first two efforts ship, the game has the user, every analyst, and the arbitrator playing — but it's missing the third class of player (day traders) and a way to actually compare everyone. The leaderboard is the centerpiece of the whole game: it's where bragging rights, shame, and signal calibration become visible at a glance.

## Prerequisites (must be in main before this effort starts)

From the Portfolio Foundation effort:
- Three day-trader rows in `prediction.analyst_portfolios` with `kind='day_trader'`, `strategy_name` set, $1M balance, empty `strategy_state` jsonb
- `bailout_ledger`, `benchmark_series`, `daily_pnl_snapshot` tables populated
- Master-detail `PortfolioDashboardView.vue` exists and lists all actors

From the Agent Autotrading effort:
- `OutcomeTrackingService` already invokes a synchronous post-price-refresh hook (used by `StopLossWatcherService`); we slot the day-trader runner in alongside it
- Trade provenance fields are populated for agent trades

## Locked decisions

- **Three day-trader strategies**:
  1. **Momentum / Breakout** — buy on N-bar high breakout, sell on first lower-high
  2. **Mean Reversion** — buy when price drops below `SMA - k×stdev`, sell on cross back to mean
  3. **Gap-and-Go** — at first tick of session, check gap vs prior close; buy on gap-up + continuation tick, sell on first reversal tick
- **Universe**: day traders trade only the instruments our system already covers. Same universe as analysts.
- **Signal access**: day traders see the latest analyst signal set for their candidate instrument and use it as a confidence boost (size up) or veto (skip), never as the primary trigger.
- **Cadence**: day traders run on the same 15-minute price refresh tick the watcher uses. Honest limitation acknowledged: they get ~13 decision points per session. This is paper. Faster feeds are a future monetization story.
- **Flat by EOD**: at the last tick before 22:00 UTC settlement, the runner force-closes any open day-trader positions at last cached price with `trigger_reason='strategy'`, `trigger_strategy='eod_flat'`.
- **5/10 stop/take rules do NOT apply** to day-trader positions. Each strategy owns its own exit logic.
- **Strategy state**: each strategy persists whatever it needs (recent bars, range markers, high-water marks) in the `strategy_state` jsonb on its portfolio row. Each strategy is responsible for trimming its own state.
- **Position sizing**: day traders use simple percent-of-portfolio sizing per strategy, not the analyst Kelly calculator. Default 5% per trade, configurable per strategy.
- **Benchmark**: SPY (already ingested by the foundation effort). Equal-weight-of-universe is computed in SQL on read if needed.

## Leaderboard metrics (the centerpiece)

- Total return (current month and lifetime)
- Sharpe ratio
- Max drawdown
- Win rate
- **Total bailouts received** — the "shame" column
- **Avg holding period** — visually separates day traders from analysts
- **Best & worst single trade**
- **Longest winning streak**
- **Calibration**: per-analyst, conviction bucket vs realized hit rate. Shows "—" with tooltip when fewer than 20 resolved predictions.

All metrics readable against the SPY benchmark line.

## What's in scope

**Backend**
- `Strategy` interface in `apps/api/src/markets/strategies/strategy.interface.ts`. Contract: `decide({recentBars, latestSignals, state}) → {action, instrumentId, quantity?, newState}`. Documents that strategies must trim their own state.
- Three implementations: `MomentumBreakoutStrategy`, `MeanReversionStrategy`, `GapAndGoStrategy`
- `DayTraderRunnerService` — invoked after `StopLossWatcherService` on each 15-min tick. Iterates the three day-trader portfolios, loads their state, calls the matching strategy, executes via `AnalystPortfolioService`, persists `newState`. On the EOD tick, force-closes open positions.
- `LeaderboardService` full implementation — all metrics from the list above. Aggregates at SQL level using `daily_pnl_snapshot` + `analyst_positions` + `prediction.market_predictions` + `bailout_ledger` + `benchmark_series`.

**API**
- `GET /markets/leaderboard?range=current-month|lifetime&sort=...`
- `GET /markets/leaderboard/:kind/:id/calibration`
- `GET /markets/leaderboard/:kind/:id/equity-curve?benchmark=SPY`

**Frontend**
- `LeaderboardView.vue` at `/leaderboard` — sortable table with all metrics, including bailouts shame column and calibration column
- `EquityCurveChart.vue` with `mode='full'|'sparkline'` prop. Sparkline mode in master-detail row headers; full mode in leaderboard detail and per-actor portfolio detail
- `CalibrationChart.vue` — bucket-bar chart per analyst with "—" fallback
- Polish pass on master-detail: column sort, search by name, kind filter chips (`user`/`analyst`/`arbitrator`/`day_trader`)
- Nav link to `/leaderboard`

## Out of scope

- Per-strategy parameter tuning UI (params live in code/config for v1)
- Backtest mode for strategies
- Adding a fourth or fifth day-trader strategy
- Faster than 15-minute price feeds
- Per-user customizable leaderboard views
- Historical backfill of leaderboard for actors that didn't exist before this effort

## Success criteria

- A full session run produces day-trader trades from all three strategies, every day trader is flat by EOD, and their trades are visible in the master-detail with `trigger_strategy` populated.
- The leaderboard ranks every actor (user, analysts, arbitrator, day traders) with every metric from the list above.
- Sorting by bailouts on the leaderboard surfaces a meaningful "shame" ranking.
- Sorting by calibration shows analysts with ≥ 20 resolved predictions sorted by how honest their convictions are; analysts below the threshold show "—".
- Equity curve renders for any selected actor with optional SPY overlay.
- Calibration chart renders per analyst.
- All Phase Foundation + Agent Autotrading functionality continues to work — no regressions.
