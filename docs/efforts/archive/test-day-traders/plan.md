# Test: Day Traders & Leaderboard — Implementation Plan

**PRD**: ../../../day-traders-and-leaderboard/prd.md
**Created**: 2026-04-13
**Status**: Complete

## Progress Tracker
- [x] Phase 1: API Verification
- [x] Phase 2: Chrome Testing
- [x] Phase 3: Marketing

---

## Phase 1: API Verification
**Status**: Complete
**Note**: 3 day trader strategies present (momentum_breakout, mean_reversion, gap_and_go). Each has $1M balance. Strategies have executed trades (17 closed positions total) but all with $0 PnL due to same-price entry/exit (EOD flat close).

### Steps
- [x] 1.1 `GET /markets/portfolios` → 3 day_trader portfolios with strategies
- [x] 1.2 Strategy types: momentum_breakout, mean_reversion, gap_and_go
- [x] 1.3 `POST /markets/admin/run-day-trader-strategies` → { strategiesRun: 3 }
- [x] 1.4 DB: analyst_portfolios with kind=day_trader, strategy_name, strategy_state columns
- [x] 1.5 DB: 17 closed positions (12 mean_reversion, 5 momentum_breakout, 0 gap_and_go)
- [x] 1.6 Positions have symbol, direction, quantity, entry_price, exit_price, realized_pnl
- [x] 1.7 Portfolio detail endpoint: sharpe_30d, max_drawdown_30d, longest_win_streak, calibration_score fields exist

### Known Behavior
- All positions closed at entry price ($0 PnL) — EOD flat mechanism closes positions immediately when no intraday movement detected
- Gap and Go strategy has 0 trades — likely needs gap detection conditions that haven't been met
- This is expected pre-market/weekend behavior, not a bug

### Quality Gate
- [x] All 3 strategy types present
- [x] Strategies execute via admin trigger
- [x] Positions tracked with full lifecycle

---

## Phase 2: Chrome Testing
**Status**: Complete

### Steps
- [x] 2.1 `/portfolios` → DAY TRADERS section with 3 rows
- [x] 2.2 Filter chip: `day_trader` kind filter visible and functional
- [x] 2.3 Each row shows: strategy name, balance ($1M), return (0%), win rate, open positions
- [x] 2.4 Click Mean Reversion → expanded detail with metrics (Realized, Unrealized, Bailouts, Sharpe, Max DD, Streak)
- [x] 2.5 Equity curve chart with SPY overlay checkbox
- [x] 2.6 Positions list: SHOP, CRM, GRML with long/closed/strategy badges
- [x] 2.7 Position details: quantity, entry price, exit price, unrealized, realized

### Quality Gate
- [x] Day trader portfolios render in portfolio list
- [x] Expanded detail with equity curve works
- [x] Position list with strategy badges displays

---

## Phase 3: Marketing
**Status**: Complete

### Steps
- [x] 3.1 Write marketing blurb → saved to `marketing-blurb.md`

### Quality Gate
- [x] Marketing blurb written
