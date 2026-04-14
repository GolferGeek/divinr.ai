# Test: Trading & Portfolios — Implementation Plan

**PRD**: ./intention.md
**Created**: 2026-04-13
**Status**: Complete

## Progress Tracker
- [x] Phase 1: API Verification
- [x] Phase 2: Chrome Testing
- [x] Phase 3: Bug Fixes & Marketing

---

## Phase 1: API Verification
**Status**: Complete
**Note**: 13 portfolios (5 analyst, 1 arbitrator, 3 day_trader, 4 user). Trade recommendations include Kelly fraction, calibration-adjusted confidence, position sizing, entry/stop/take-profit, analyst consensus.

### Steps
- [x] 1.1 List portfolios (`GET /markets/portfolios`) → 13 portfolios across 4 kinds
- [x] 1.2 Portfolio metrics: balance, return_pct, win_rate, open_positions present
- [x] 1.3 Get trade recommendation (`GET /markets/runs/:runId/trade-recommendation`) → full recommendation with action (buy/sell/hold), kelly_fraction, entry/stop/take-profit, consensus, rationale
- [x] 1.4 AMD recommendation: BUY, 408 shares (10%), entry $245.04, stop $242.59, target $249.94, Kelly 0.456, calibration-adjusted confidence 63.7%

### Quality Gate
- [x] All portfolio kinds present
- [x] Trade recommendations with full position sizing data

---

## Phase 2: Chrome Testing
**Status**: Complete
**Note**: Portfolio dashboard, expanded detail, equity curves, instrument detail, and dashboard trade cards all verified. Found and fixed confidence display bug.

### Steps
- [x] 2.1 Navigate to `/portfolios` → table with kind filter chips, search, sort dropdown
- [x] 2.2 MY PORTFOLIO: demo-user at $1M
- [x] 2.3 ANALYSTS: 6 analysts with balances ($965K-$1.04M), returns, win rates, open positions
- [x] 2.4 DAY TRADERS: 3 traders at $1M (just started)
- [x] 2.5 Click Arbitrator row → expanded: Realized (-$61.9K), Unrealized ($0), Bailouts ($37.4K), Sharpe, Max DD, Streak
- [x] 2.6 Equity curve chart with SPY overlay checkbox
- [x] 2.7 Open positions list: 7 positions with symbol, long/short badges, quantity, entry price, signal_cross source
- [x] 2.8 Dashboard prediction cards: CRM (SELL), AMD (BUY), META (HOLD) with position sizing, entry/stop/target
- [x] 2.9 TRADE button → navigates to instrument detail with analyst cards
- [x] 2.10 Instrument detail: Arbitrator synthesis + individual analyst signals with direction, confidence, rationale

### Quality Gate
- [x] All portfolio types visible and filterable
- [x] Trade recommendations on dashboard cards
- [x] Instrument detail shows correct confidence percentages (after fix)

---

## Phase 3: Bug Fixes & Marketing
**Status**: Complete

### Steps
- [x] 3.1 **Bug fixed**: Confidence display showing 7800% instead of 78% — `fmtConfidence()` was multiplying integer percentages by 100. Fixed in `InstrumentDetailView.vue` and `InstrumentAnalystPanel.vue`
- [x] 3.2 Verified fix in browser — now shows correct 78%, 70%, 68%
- [x] 3.3 Write marketing blurb → saved to `marketing-blurb.md`

### Quality Gate
- [x] **Bug fix verified in browser**
- [x] **Marketing blurb written**
