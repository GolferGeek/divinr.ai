# Agent Autotrading — Intention

## What this effort is

Make the analysts and the arbitrator "mini-me" actually trade their own convictions. When an analyst (or the arbitrator) crosses a conviction threshold on one of their predictions, they immediately open a position in their own paper portfolio. Their open positions are managed by standard rules: 5% stop-loss, 10% take-profit, trailing stop. At end of day, anything still above threshold without an existing position gets a forced buy.

This is the autotrading layer on top of the **Portfolio Foundation & Manual Trading** effort. It assumes that effort has already shipped: portfolios for analysts + arbitrator + day traders exist, the schema has trade-provenance columns and the `kind` column on `analyst_portfolios`, and `executeImmediate` exists.

This effort does **not** include day traders or the leaderboard — those live in the next follow-up.

## Why now

The Portfolio Foundation effort gives every actor a portfolio but no agent actually trades itself. The arbitrator just synthesizes predictions. Analysts publish predictions but don't own their conclusions. Without autotrading, there's nothing to compare across the actors except whatever the user manually does, which defeats the point of the game.

## Prerequisites (must be in main before this effort starts)

From the Portfolio Foundation effort:
- `kind` / `strategy_name` / `strategy_state` columns on `prediction.analyst_portfolios`
- `trigger_reason` / `trigger_prediction_id` / `trigger_conviction` / `trigger_strategy` columns on `prediction.analyst_positions`
- Arbitrator `analyst_portfolios` row seeded at $1M
- `daily_pnl_snapshot` table populated daily
- `UserPortfolioService.executeImmediate()` and `closePosition()` (referenced as a pattern; the agent path uses `AnalystPortfolioService`)

## Locked decisions (carried from the umbrella conversation)

- **Conviction threshold**: single env var `CONVICTION_TRADE_THRESHOLD`, default 70, applied uniformly to analysts and arbitrator. Per-actor override is a future enhancement.
- **Position sizing**: reuse the existing Phase 6 Kelly calculator in `position-sizing.service.ts` unchanged.
- **Exit rules** (apply to analyst + arbitrator positions only — never to user positions or day traders):
  - 5% stop-loss
  - 10% take-profit
  - Trailing stop (high-water-mark based)
- **Eval cadence**: stop/take/trailing watcher runs synchronously after each 15-minute price refresh in `OutcomeTrackingService` to avoid races.
- **Arbitrator real-time**: arbitrator conviction is evaluated each time the arbitrator synthesis step runs in `prediction-runner.service.ts`. Pipeline runs frequently enough that this approximates real-time. Incremental arbitrator synthesis on every analyst publish is a future enhancement.
- **Idempotency**: forced buys check for an existing position on `(portfolio_id, instrument_id, trigger_prediction_id)` before opening. EOD sweep can re-run safely.
- **Long-only, whole shares, instant fill at cached price**, same as the Portfolio Foundation effort.

## What's in scope

- **Env var**: `CONVICTION_TRADE_THRESHOLD` (default 70), documented in `.env.example`.
- **`ConvictionTraderService`** with two methods:
  - `evaluateAnalyst(prediction)` — called from `prediction-runner.service.ts` after each analyst publish
  - `evaluateArbitrator(prediction)` — called after the arbitrator synthesis step
  - Both: if `conviction >= threshold` AND no existing open position for `(portfolio_id, instrument_id, prediction_id)` → open via `AnalystPortfolioService.openPosition()`, sized via existing Kelly calculator, with full provenance fields populated
- **`StopLossWatcherService`** — invoked synchronously by `OutcomeTrackingService` after each price refresh. Iterates open positions where `analyst_portfolios.kind IN ('analyst','arbitrator')`. Closes any position whose unrealized P&L hits -5% / +10% / trailing-stop band. Sets `trigger_reason` on the close fill to `stop_loss` / `take_profit` / `trailing_stop`.
- **High-water-mark column** on `analyst_positions` if not added in the foundation effort, to support trailing stop.
- **`EodForcedBuyService`** (or extension to `eod-settlement.service.ts`): after the existing user-queue settlement runs at 22:00 UTC, scan open predictions where `conviction >= threshold` AND no existing analyst position for `(portfolio_id, instrument_id, prediction_id)` → forced buy at last cached price with `trigger_reason='eod_sweep'`.
- **Frontend**: provenance tooltip on each trade row in the master-detail expanded panels, showing `trigger_reason`, `trigger_conviction`, and a clickable link to the source prediction.

## Out of scope

- Day-trader actors and strategies
- Full leaderboard, equity curves, calibration view
- Per-actor conviction threshold overrides
- Incremental arbitrator synthesis on every analyst publish
- User position auto-management (user positions remain manual exit only — they show reference levels but don't auto-close)

## Success criteria

- After a real pipeline run, analyst + arbitrator portfolios show auto-opened positions with non-null `trigger_reason='signal_cross'` and `trigger_conviction` populated.
- At least one stop or take-profit fires across a real session and the closing fill carries the right reason.
- The EOD sweep produces forced buys for still-strong predictions and is idempotent on re-run.
- Every agent fill in the master-detail UI exposes a tooltip with reason + conviction + prediction link.
- Books-balance invariant from the foundation effort still holds after a full session of agent autotrading.
- Day traders are demonstrably excluded from the 5/10/trailing rules (covered in test).
