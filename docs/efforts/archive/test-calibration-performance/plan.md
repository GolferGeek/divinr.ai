# Test: Calibration & Performance — Implementation Plan

**PRD**: ./intention.md
**Created**: 2026-04-13
**Status**: Complete

## Progress Tracker
- [x] Phase 1: Chrome Testing — Performance Dashboard & Portfolios
- [x] Phase 2: Chrome Testing — Analyst Drilldown
- [x] Phase 3: Bug Fixes & Marketing

---

## Phase 1: Chrome Testing — Performance Dashboard & Portfolios
**Status**: Complete
**Note**: All views rendering correctly. Data is early-stage (platform just started) but all structural elements present.

### Steps
- [x] 1.1 Navigate to `/performance` → dashboard loads with key metric cards (Portfolio Value, Realized PnL, Win Rate, Active Positions)
- [x] 1.2 Equity Curve renders with Portfolio line, SPY Benchmark legend, time range selector (1M, 3M)
- [x] 1.3 "Collecting data" message shown (appropriate for early data)
- [x] 1.4 PnL summary bar: Realized PnL, Unrealized PnL, Avg Gain, Avg Loss
- [x] 1.5 Analyst Leaderboard: 6 analysts ranked with Accuracy, Calibration, Samples, Trend columns
- [x] 1.6 Navigate to `/portfolios` → portfolio dashboard with kind filter chips (user, analyst, arbitrator, day_trader)
- [x] 1.7 Search box and Sort dropdown present
- [x] 1.8 MY PORTFOLIO section: demo-user at $1M
- [x] 1.9 ANALYSTS section: 6 analysts with balances, returns (color-coded green/red), win rates, open positions
- [x] 1.10 DAY TRADERS section: 3 day traders at $1M (newly started)
- [x] 1.11 Click analyst row → expanded detail: Realized, Unrealized, Bailouts, Sharpe, Max DD, Streak metrics
- [x] 1.12 Equity curve chart renders with SPY overlay checkbox
- [x] 1.13 Open positions list with symbol, direction badges (long/short), quantity, entry price, source tags

### Quality Gate
- [x] All portfolio types visible and filterable
- [x] Equity curve with benchmark overlay working
- [x] Expanded detail shows extended metrics

---

## Phase 2: Chrome Testing — Analyst Drilldown
**Status**: Complete
**Note**: Rich calibration data for Macro Strategist (279 samples). Per-instrument breakdown with accuracy/confidence/calibration per symbol.

### Steps
- [x] 2.1 Navigate to analyst performance view → loads with persona, status, tier instructions cards
- [x] 2.2 Calibration section: Accuracy (38%), Avg Confidence (67.9%), Calibration Score (0.446), Sample Size (279)
- [x] 2.3 Per-Instrument Breakdown table: 13 instruments with Samples, Accuracy, Avg Conf, Calibration, Biases
- [x] 2.4 Resolved Predictions (wrong first) section present — "No resolved predictions yet" (awaiting nightly evaluation)
- [x] 2.5 Back button navigates correctly

### Quality Gate
- [x] Analyst drilldown fully functional
- [x] Per-instrument calibration data populated
- [x] Wrong-first prediction list ready (pending nightly eval)

---

## Phase 3: Bug Fixes & Marketing
**Status**: Complete

### Steps
- [x] 3.1 No bugs discovered — all features working correctly
- [x] 3.2 No code changes needed
- [x] 3.3 Write marketing blurb → saved to `marketing-blurb.md`

### Quality Gate
- [x] **Build**: clean (no code changes)
- [x] **Marketing blurb written**
