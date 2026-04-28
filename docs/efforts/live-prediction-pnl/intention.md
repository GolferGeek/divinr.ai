# Effort: Live Prediction PnL

## Problem

Day-trader portfolios show $0 PnL because no strategy run ever happens during a real price movement. The three base day-trader strategies (`momentum-breakout`, `mean-reversion`, `gap-and-go`) exist and are wired in, but the only thing that invokes them today is `OutcomeTrackingService.runTracking()` on its 15-minute tick — which runs 24/7 with no market-hours gate, and feeds them 32 **daily** OHLC bars from Polygon. Strategies that enter a position and force-close at EOD (22:00 UTC) end up opening and closing at effectively the same cached price, so every day-trader portfolio flatlines at $1,000,000 with zero realized PnL. `gap-and-go` in particular was designed for 15-min intraday bars — its once-per-session gap-up logic cannot fire on daily bars at all. Beta testers looking at the day-trader leaderboard see a dead engine.

## Intention

Give the day-trader strategies a real intraday runtime. Two things change together: **cadence** (hourly cron during US market hours, env-configurable) and **inputs** (hourly OHLC bars fetched from Twelve Data's `time_series` endpoint, stashed on a new `instruments.current_state.intraday_bars` field and fed to strategies alongside — or in place of — the daily `recent_bars`). The three strategies already consume `Bar[]` generically and compute their own SMA / stdev / high-window internally, so nothing about their decision logic changes; they just get the right interval fed to them. Positions opened during the trading day accumulate real movement by the time the 22:00 UTC EOD flat-close settles them.

Each hourly tick also writes one row to a new `prediction.market_day_trader_runs` audit table — enough observability to confirm the cron is firing without grepping logs.

## Scope

- New env-configurable cron (env var `DAY_TRADER_CRON`, default `0 14,17,20 * * 1-5` UTC — three demo ticks during the US equity session). A market-hours gate inside the handler is authoritative; off-hours firings no-op with a log line.
- Env kill-switch (`DAY_TRADER_DISABLE_CRON=true`) and off-hours override (`DAY_TRADER_IGNORE_MARKET_HOURS=true`) for weekend smoke tests.
- Decouple the strategy invocation from the 15-min `OutcomeTrackingService` tick. The hourly day-trader cron becomes the sole entry point for strategy runs during the day.
- Extend the market data adapters with `fetchIntradayBars()` (1-hour interval) and build an `IntradayBarRefresherService` that writes the results to `instruments.current_state.intraday_bars`. Polygon is the primary intraday source; Twelve Data remains the fallback.
- Per-analyst instrument scoping:
  - **Base day-trader analysts** (`user_id IS NULL`, `analyst_type='day_trader'`) continue to iterate all active instruments — that's the intended default for the shared analysts.
  - **User-authored day-trader analysts** (`user_id IS NOT NULL`, `analyst_type='day_trader'`) iterate only the instruments they're enabled against in `prediction.user_enabled_triples`. The relationship already exists from the slot-based-enablement effort; the day-trader runner just needs to honor it. No authored day-trader analysts exist today; this effort makes the infrastructure ready for when one appears.
- Per-tick observability: one row in a new `prediction.market_day_trader_runs` audit table with timing, bar-refresh counts, open/close counts, and any error. No API surface in v1 — read directly in SQL.
- A single new admin endpoint (`POST /markets/admin/day-trader/run-now`) to trigger a manual fire for smoke tests.
- EOD flat-close at 22:00 UTC stays exactly as-is. It's the guarantee that nothing carries overnight.
- Success looks like: after a full market day's hourly ticks, day-trader portfolios show non-zero realized PnL, at least one strategy has opened and closed a real position during the day, and the analyst leaderboard reflects live performance.

## Out of Scope

- Changing any strategy logic (entry/exit rules, conviction modifier, EOD force-close).
- Pre-computed numerical indicators (RSI, MACD, Bollinger Bands). The Twelve Data adapter has indicator endpoints, but none of the three strategies consume them — they compute their own from `Bar[]`. A follow-up effort can wire numerical indicators if an authored strategy wants them.
- Intraday feeds from other adapters (FMP, Finnhub, FRED, Reddit, SEC EDGAR, Polygon intraday). v1 uses Twelve Data's `time_series` only; the rest stay on their existing daily/LLM-prompt paths.
- Intraday bars for non-day-trader analysts. Predictor generation, prediction generation, audit, nightly evaluation — all continue to see the daily `recent_bars` they see today.
- Onboarding authored day-trader analysts themselves. No authored day-trader analysts exist yet; this effort ensures the runner will do the right thing when one appears.
- DST-aware market hours and a US market-holiday calendar. v1 ships on fixed standard-time UTC offsets; DST drift during EDT periods and holiday firings (which no-op because bars don't refresh) are accepted.
- Any change to `ConvictionTraderService` (prediction-side auto-trading on ≥70% confidence). That path is correct as-is and unrelated to day-trader cadence.
- Overnight positions.
- Frontend changes. The existing day-trader leaderboard and PnL surfaces already read from `analyst_portfolios` / `analyst_positions` and will reflect the new PnL automatically.
