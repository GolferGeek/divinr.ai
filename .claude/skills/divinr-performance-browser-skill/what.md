# What — Performance facet

## User flow

1. User lands on `/performance`.
2. `performance.store.fetchDashboard(days)` fires; `IonSpinner` renders in `.loading-state`.
3. Response shapes the page:
   - `has_portfolio === false` → `.empty-state` with portfolio-bootstrap copy.
   - `equity_curve.length === 0` → all metric cards render but the equity-curve card shows `.no-data`.
   - Otherwise → metric cards + equity-curve `<canvas>` (chart.js Line) + PnL bar + analyst leaderboard table.
4. User changes the range segment (`1W` / `1M` / `3M` / `All`) — `selectedDays` watcher refetches.
5. Clicking a leaderboard row calls `router.push('/analysts/:id/performance')`.
6. `/analysts/:id/performance` fetches calibration metrics + a list of resolved analyses,
   rendered via `CalibrationScatter` (lazy-loaded SVG).
7. `/attribution/mine` and `/attribution/admin` are sibling surfaces under the same facet.

## Surface shape (dashboard)

```
Performance
+------------------+ +-------------+ +----------+ +--------------+
| Portfolio Value  | | Realized    | | Win Rate | | Active Pos.  |
| $X (today change)| | PnL $Y      | | Z%       | | N (next eval)|
+------------------+ +-------------+ +----------+ +--------------+

[Equity Curve card]
   (chart.js <canvas>) OR "No equity data yet."
   [1W] [1M] [3M] [All]

[PnL bar: realized | unrealized | avg gain | avg loss]

[Analyst Leaderboard table]
   # | Analyst | Accuracy | Calibration | Samples | Trend
```

## Data invariants

- `metrics.portfolio_value` is always present once `has_portfolio` is true.
- `equity_curve[]` may be empty for a brand-new account; a `<canvas>` is rendered only when length > 0.
- `analysts[]` may be empty; the table is replaced with "Analyst performance data collecting." copy.
- The four range-segment buttons (`1W`/`1M`/`3M`/`All`) are always present once the dashboard branch renders.
- `<FirstTouchPanel surface-key="performance">` always mounts at the bottom; its content is exempt from the vocabulary check.

## Vocabulary considerations

The leaderboard header label "Calibration" and the column "Samples" are both safe.
**Watch out**: the analyst-detail view (`/analysts/:id/performance`) intentionally renders
"predicted direction" / "actual direction" headers — that's a domain term tied to the API
response shape. Smoke for `/performance` only; do not pull `/analysts/:id/performance` into
the smoke vocabulary check.
