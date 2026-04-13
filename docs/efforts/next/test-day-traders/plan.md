# Test: Day Traders & Leaderboard — Implementation Plan

**PRD**: ../../../day-traders-and-leaderboard/prd.md
**Created**: 2026-04-13
**Status**: Not Started
**Depends on**: test-prediction-pipeline (core run infrastructure), test-trading-portfolios (portfolio mechanics)

## Progress Tracker
- [ ] Phase 1: API Verification — Strategies & Portfolio Metrics
- [ ] Phase 2: Chrome Testing — Leaderboard, Charts, Sorting
- [ ] Phase 3: Bug Fixes & Marketing

---

## Phase 1: API Verification — Strategies & Portfolio Metrics
**Status**: Not Started
**Objective**: Verify day trader strategies fire, positions open/close, leaderboard metrics compute correctly.

### Steps
- [ ] 1.1 List portfolios (`GET /markets/portfolios`) → day trader portfolios present with kind=day_trader
- [ ] 1.2 Verify each strategy type exists: momentum_breakout, mean_reversion, gap_and_go
- [ ] 1.3 Check portfolio metrics: sharpe_30d, max_drawdown_30d, longest_win_streak, calibration_score present
- [ ] 1.4 Verify leaderboard sorting — sort by sharpe_30d descending → correct order
- [ ] 1.5 Get portfolio detail (`GET /markets/portfolios/:kind/:id?days=30`) → snapshot_history with equity/realized/unrealized per date
- [ ] 1.6 Verify calibration_buckets returned for day trader portfolios with enough data (≥20 resolved predictions)
- [ ] 1.7 Verify benchmark_series (SPY prices) returned in portfolio detail
- [ ] 1.8 Check recent-bars ring buffer — instrument current_state has recent bars (capped at 32)
- [ ] 1.9 Verify EOD-flat behavior — no positions open past 22:00 UTC (check closed positions timestamps)
- [ ] 1.10 Verify strategies have stateful decide() — check state persistence across ticks
- [ ] 1.11 RBAC: beta_reader can read portfolios but not modify → GET works, POST/actions blocked

### Quality Gate
- [ ] All 3 strategies producing trades
- [ ] Leaderboard metrics non-null for active traders
- [ ] Calibration buckets populated for qualifying traders

---

## Phase 2: Chrome Testing — Leaderboard, Charts, Sorting
**Status**: Not Started
**Objective**: Verify portfolio dashboard UI with day trader data, charts, and filtering.

### Steps
- [ ] 2.1 Navigate to `/portfolios` → portfolio dashboard loads with all portfolio types
- [ ] 2.2 Click "Day Trader" filter chip → only day trader portfolios shown
- [ ] 2.3 Verify 4 new columns visible: Sharpe, Max DD, Win Streak, Calibration
- [ ] 2.4 Click sortable headers (Sharpe, Max DD) → sorting works correctly
- [ ] 2.5 Use search box → filters by display name
- [ ] 2.6 Expand a day trader row → equity curve chart loads
- [ ] 2.7 Toggle SPY overlay on equity curve → benchmark line appears
- [ ] 2.8 Verify calibration chart shows for qualifying day traders (bucket bars)
- [ ] 2.9 Verify calibration shows "—" with tooltip for non-qualifying actors
- [ ] 2.10 Multi-select kind filters (Day Trader + User) → combined results
- [ ] 2.11 As beta_reader, verify portfolio dashboard is read-only (view but no actions)

### Quality Gate
- [ ] All 11 browser scenarios pass
- [ ] Charts render correctly (equity curve, calibration)
- [ ] Screenshots of key flows

---

## Phase 3: Bug Fixes & Marketing
**Status**: Not Started
**Objective**: Fix any bugs found, write marketing blurb.

### Steps
- [ ] 3.1 Fix any bugs discovered in Phases 1-2
- [ ] 3.2 Re-run failed tests to verify fixes
- [ ] 3.3 Write marketing blurb covering: AI day trader strategies competing on live leaderboard, transparent performance metrics, equity curves with SPY benchmark. Save to `marketing-blurb.md`

### Quality Gate
- [ ] **Build**: clean
- [ ] **Lint**: clean
- [ ] **Unit Tests**: no new failures
- [ ] **Marketing blurb written**
