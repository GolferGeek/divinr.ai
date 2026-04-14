# Effort: Test — Calibration & Performance

## Covers
- `calibration-drilldown` — Analyst performance view: metrics, per-instrument breakdown, confidence-vs-accuracy scatter, wrong-first prediction list, inline reasoning expansion
- `leaderboard-calibration-affordance` — One-click link from leaderboard calibration score to analyst drilldown
- `performance-dashboard` — Equity curve with SPY benchmark overlay, PnL summary, analyst leaderboard with trend indicators, key metrics cards
- `day-traders-and-leaderboard` — Trading strategies, leaderboard with Sharpe/drawdown/calibration/equity curves

## Testing Scope
- PerformanceDashboardView: equity curve renders, benchmark overlay, time range selector works
- PnL summary bar: realized/unrealized/avg gain/avg loss
- Analyst leaderboard: accuracy, calibration, sample size, trend arrows
- Click leaderboard calibration score → navigates to analyst drilldown
- AnalystPerformanceView: aggregate stats, per-instrument table, scatter plot, prediction list
- Prediction list sorted wrong-first, expandable reasoning
- Portfolio dashboard: all portfolios listed, sortable, expandable detail rows with equity curves

## Marketing Angle
Track every analyst's accuracy over time. See who's right, who's wrong, and how the system calibrates. Full performance transparency.

## Chrome Testing
- Navigate to /performance — verify equity curve, metrics, leaderboard
- Click leaderboard calibration → drills into analyst detail
- Verify scatter plot renders at various data amounts
- Check portfolio dashboard sorting, expansion, equity sparklines
- Test all time range segments (1W, 1M, 3M, All)

## Out of Scope
- Manual trade execution (separate effort)
