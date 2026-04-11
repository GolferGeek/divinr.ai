# Effort: Performance Dashboard

## Problem

The data for understanding portfolio performance exists — portfolio snapshots, calibration scores, position history, PnL calculations, leaderboard rankings — but there's no single view that tells a subscriber "here's how the system is doing for you." The current dashboard is activity-oriented (recent runs, recent predictions). A subscriber paying $20/mo needs to see their equity curve, their win rate, which analysts are earning their keep, and whether the system is making money.

## Intention

Build a performance dashboard that gives subscribers an at-a-glance view of system performance: portfolio equity over time, PnL breakdown, analyst leaderboard, and key metrics. This is the view that justifies the subscription.

## Scope

- **Equity curve**: Line chart of portfolio value over time, sourced from existing portfolio_snapshots. Overlaid with SPY benchmark (already ingested by BenchmarkIngestService). Time range selector (1W, 1M, 3M, all).
- **PnL summary**: Total realized PnL, unrealized PnL, win/loss ratio, average gain vs average loss. Sourced from existing positions table.
- **Analyst leaderboard**: Ranked by calibration score with accuracy rate, sample size, and trend indicator (improving/declining). Links to existing analyst performance drilldown. Sourced from existing analyst_performance_profiles and leaderboard service.
- **Key metrics cards**: At the top — total portfolio value, today's change, active positions count, next evaluation time. Quick-glance numbers.
- **Responsive design**: Must look good on mobile (this feeds into the mobile polish effort).
- **Read-only**: No actions from this page. It's a consumption view, not an admin tool. Beta readers and subscribers both see it.

## Success Criteria

- Subscriber sees equity curve with benchmark overlay on a single page.
- PnL breakdown shows realized, unrealized, win rate.
- Analyst leaderboard shows who's performing and who's not.
- Page loads in <2 seconds (all data already exists, just needs aggregation endpoints).
- Works on mobile viewports.

## Out of Scope

- Per-instrument drilldown (that's the existing instrument detail view).
- Trade execution from the dashboard.
- Customizable widgets or layout.
- Historical backtesting visualization.
