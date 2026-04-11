# Performance Dashboard — Product Requirements Document

## 1. Overview

Divinr has all the data for understanding portfolio performance — daily PnL snapshots, positions, benchmark prices, calibration scores, leaderboard metrics — but no single subscriber-facing view that answers "is this system making me money?" The current PortfolioDashboardView is admin-oriented and leaderboard-heavy. This effort builds a clean, subscriber-focused performance page: equity curve with SPY overlay, PnL breakdown, analyst leaderboard, and key metrics cards. This is the view that justifies the $20/mo subscription.

## 2. Goals & Success Criteria

| Goal | Success Criterion |
|------|-------------------|
| Equity curve with benchmark | Line chart of user portfolio equity over time with SPY overlay, time range selector (1W/1M/3M/All) |
| PnL breakdown | Total realized PnL, unrealized PnL, win rate, average gain vs average loss displayed clearly |
| Analyst leaderboard | Ranked table with calibration score, accuracy rate, sample size, trend indicator (improving/declining) linking to existing analyst performance drilldown |
| Key metrics cards | Portfolio value, today's change ($ and %), active positions count, next evaluation time — visible at a glance |
| Page load <2s | All data exists — just needs aggregation. Single API call returns all dashboard data |
| Mobile responsive | All sections stack cleanly on mobile viewports; chart is touch-friendly with adequate tap targets |
| Read-only for all users | Beta readers and subscribers both see this page; no mutation endpoints |

## 3. User Stories / Use Cases

**Subscriber checking daily performance:**
- As a subscriber, I open the Performance page and immediately see my portfolio value, today's change, and how many positions are open — without scrolling.
- As a subscriber, I see the equity curve over the last month with SPY overlaid, so I know if the system is beating the market.
- As a subscriber, I switch to 3M view to see longer-term trend.

**Subscriber evaluating analyst panel:**
- As a subscriber, I scroll to the analyst leaderboard and see who's contributing most (by calibration and accuracy). I click an analyst to drill into their performance.
- As a subscriber, I see trend indicators showing which analysts are improving vs declining, so I understand the panel's trajectory.

**Beta reader getting a feel for the system:**
- As a beta reader, I can see the same performance page (read-only) to evaluate whether the product is worth subscribing to.

## 4. Technical Requirements

### 4.1 Architecture

The performance dashboard is a new Vue page backed by a single aggregation endpoint. It reuses existing data (no new tables) and existing service methods from `LeaderboardService` and the portfolio query infrastructure.

```
Existing Services                    New Endpoint              New View
────────────────                    ────────────              ────────
LeaderboardService ──┐
  getAllPortfoliosSummary()  │
                            ├──→ GET /markets/performance ──→ PerformanceDashboardView.vue
  getPortfolioDetail()      │     (single aggregation call)
                            │
BenchmarkIngestService ─────┘
  (benchmark_series table)
```

### 4.2 Data Model Changes

None. All data comes from existing tables:
- `daily_pnl_snapshot` — equity curve data points
- `benchmark_series` — SPY close prices
- `analyst_positions` / `user_positions` — win/loss, PnL, open positions
- `analyst_performance_profiles` — accuracy, calibration per analyst
- `analyst_portfolios` / `user_portfolios` — current balance, PnL totals

### 4.3 API Changes

One new endpoint:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/markets/performance` | Returns aggregated performance dashboard data for the authenticated user |

**Query params:** `days` (default 30, max 365) — controls equity curve and benchmark range.

**Response shape:**
```typescript
interface PerformanceDashboardResponse {
  // Key metrics cards
  metrics: {
    portfolio_value: number;       // current_balance from user_portfolios
    today_change: number;          // ending_balance - starting_balance from latest snapshot
    today_change_pct: number;      // today_change / starting_balance * 100
    active_positions: number;      // count of open user_positions
    total_realized_pnl: number;    // from user_portfolios
    total_unrealized_pnl: number;  // from user_portfolios
    win_rate: number | null;       // wins / closed_count * 100
    avg_gain: number | null;       // avg realized_pnl where realized_pnl > 0
    avg_loss: number | null;       // avg realized_pnl where realized_pnl < 0
  };

  // Equity curve
  equity_curve: Array<{
    date: string;                  // ISO date
    balance: number;               // ending_balance
    daily_pnl: number;             // realized_pnl from snapshot
  }>;

  // Benchmark overlay
  benchmark: Array<{
    date: string;                  // ISO date
    close: number;                 // SPY close_price
  }>;

  // Analyst leaderboard
  analysts: Array<{
    analyst_id: string;
    name: string;
    accuracy_rate: number | null;
    calibration_score: number | null;
    sample_size: number;
    accuracy_7d: number | null;    // For trend: compare 7d vs 30d accuracy
    accuracy_30d: number | null;
    trend: 'improving' | 'declining' | 'stable';
  }>;

  // Next evaluation
  next_evaluation_at: string | null; // ISO timestamp of next nightly eval
}
```

This endpoint is accessible to all authenticated users (including beta readers). No `requireWriteAccess` guard.

### 4.4 Frontend Changes

**New view: `PerformanceDashboardView.vue`** at route `/performance`

Layout (top to bottom):

1. **Metrics Cards Row** — 4 cards in a responsive grid:
   - Portfolio Value (large number, today's $ change with green/red color, % change)
   - Realized PnL (cumulative total)
   - Win Rate (percentage with win/loss count)
   - Active Positions (count, links to existing positions view)

2. **Equity Curve** — `vue-chartjs` Line chart:
   - Primary line: portfolio equity (from `equity_curve`)
   - Secondary line: SPY benchmark (from `benchmark`, normalized to same starting point for visual comparison)
   - Time range selector: `ion-segment` with 1W / 1M / 3M / All buttons
   - Tooltip showing date, balance, daily PnL, and benchmark price on hover
   - Responsive: fills container width, minimum height 300px

3. **PnL Summary** — Horizontal stats bar:
   - Total Realized PnL
   - Unrealized PnL
   - Average Gain
   - Average Loss

4. **Analyst Leaderboard** — Sortable table:
   - Columns: Rank, Analyst Name, Accuracy, Calibration, Sample Size, Trend
   - Trend column: green up-arrow (improving), red down-arrow (declining), gray dash (stable)
   - Trend logic: if `accuracy_7d - accuracy_30d > 5` → improving; if `< -5` → declining; else stable
   - Click row → navigate to `/analysts/:id/performance` (existing route)
   - Sorted by calibration_score descending by default

**Navigation:** Add "Performance" link to nav in `DefaultLayout.vue`, positioned after "Dashboard" (first item after home). Import `trendingUpOutline` from `ionicons/icons`.

**Store:** New `performance.store.ts` Pinia store with `fetchDashboard(days?)` action that calls the single endpoint and populates all refs.

### 4.5 Infrastructure Requirements

None. Uses existing Postgres, NestJS API, Vue frontend, and Chart.js.

## 5. Non-Functional Requirements

- **Performance**: Dashboard endpoint must respond in <500ms. Frontend page load (including chart render) <2 seconds. All data is pre-computed in existing tables — the endpoint is SELECT-only aggregation.
- **Mobile responsiveness**: Metrics cards wrap to 2×2 on tablets, stack 1-column on phones. Chart has minimum touch-target height. Table scrolls horizontally on narrow viewports.
- **Backwards compatibility**: No changes to existing pages or endpoints. Performance dashboard is purely additive.
- **Data freshness**: Equity curve updates once per EOD settlement. Benchmark updates once per trading day at 23:00 UTC. Analyst leaderboard reflects latest nightly evaluation.

## 6. Out of Scope

- Per-instrument drilldown (existing instrument detail view handles this).
- Trade execution from the dashboard.
- Customizable widgets or layout.
- Historical backtesting visualization.
- New portfolio types or data collection.
- Real-time price streaming or live equity updates (EOD granularity is sufficient).

## 7. Dependencies & Risks

| Dependency / Risk | Impact | Mitigation |
|-------------------|--------|------------|
| User portfolio may not exist yet | New users see empty state | Check for portfolio existence; show "Portfolio will be created when you queue your first trade" message |
| Insufficient snapshot data (<10 days) | Sharpe/drawdown return null, chart is sparse | Show chart with available data; hide Sharpe/drawdown metrics when null; show "Collecting data — performance metrics available after 10 trading days" |
| SPY benchmark data starts from BenchmarkIngestService first run | Benchmark line may be shorter than equity curve | Only overlay benchmark for dates where data exists; note "Benchmark data available from [date]" if truncated |
| Analyst with <20 resolved predictions | Calibration score is null | Show "—" in leaderboard; note "Needs 20+ predictions" in tooltip |

## 8. Phasing

### Phase 1: API Endpoint & Metrics
- Create `PerformanceService` in `apps/api/src/markets/services/`
- Implement `getDashboardData(userId, days)` method aggregating from existing tables
- Add `GET /markets/performance` endpoint
- Register service in module, inject in controller
- Unit tests for metrics computation (win rate, avg gain/loss, today's change, trend detection)
- **Gate**: Endpoint returns correct aggregated data; metrics match manual calculation from raw tables.

### Phase 2: Frontend — Metrics Cards & Equity Curve
- Create `performance.store.ts` Pinia store
- Create `PerformanceDashboardView.vue` with metrics cards row and equity curve chart
- Equity curve uses `vue-chartjs` Line component with SPY benchmark overlay (normalized)
- Time range selector (1W/1M/3M/All) wired to store, re-fetches with different `days` param
- Add route and nav link
- **Gate**: Page loads, metrics cards show correct values, equity curve renders with benchmark overlay, time range switching works.

### Phase 3: PnL Summary, Analyst Leaderboard & Mobile Polish
- Add PnL summary stats bar below equity curve
- Add analyst leaderboard table with trend indicators and click-to-drill navigation
- Responsive CSS: metrics cards 2×2 on tablet, 1-column on phone; chart min-height; table horizontal scroll on mobile
- Handle empty states (no portfolio, insufficient data, no analysts)
- **Gate**: All sections render, leaderboard links work, page is usable on 375px-wide mobile viewport, empty states display correctly.
