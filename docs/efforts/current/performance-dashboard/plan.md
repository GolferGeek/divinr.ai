# Performance Dashboard — Implementation Plan

**PRD**: ./prd.md
**Created**: 2026-04-11
**Status**: In Progress

## Progress Tracker
- [x] Phase 1: API Endpoint & Metrics
- [x] Phase 2: Frontend — Metrics Cards & Equity Curve
- [x] Phase 3: PnL Summary, Analyst Leaderboard & Mobile Polish

---

## Phase 1: API Endpoint & Metrics
**Status**: Complete
**Objective**: Create a single aggregation endpoint that returns all performance dashboard data from existing tables.

### Steps
- [ ] 1.1 Create `apps/api/src/markets/services/performance.service.ts` — `@Injectable()` class with `@Inject(DATABASE_SERVICE)` and `@Inject(MarketsSchemaService)` constructor params.
- [ ] 1.2 Implement `getDashboardData(userId: string, days: number)` method that runs queries in parallel:
  - Query `user_portfolios` for current balance, total PnL
  - Query `daily_pnl_snapshot` for equity curve (portfolio_kind='user', last N days)
  - Query `benchmark_series` for SPY closes over same date range
  - Query `user_positions` for active position count, win rate (wins/closed where realized_pnl > 0), avg gain, avg loss
  - Query latest `daily_pnl_snapshot` for today's change (ending_balance - starting_balance)
  - Query `analyst_performance_profiles` for analyst leaderboard (period='30d' and period='7d' for trend), JOIN `market_analysts` for display_name
  - Compute trend: if `accuracy_7d - accuracy_30d > 5` → 'improving', `< -5` → 'declining', else 'stable'
  - Compute `next_evaluation_at` as next midnight UTC (nightly eval runs at midnight)
  - Return `PerformanceDashboardResponse` shape per PRD section 4.3
- [ ] 1.3 Handle edge cases: no user portfolio (return null metrics with `has_portfolio: false`), insufficient snapshots (<10 days), no benchmark data, no analyst profiles.
- [ ] 1.4 Register `PerformanceService` in `apps/api/src/markets/markets.module.ts` providers array.
- [ ] 1.5 Add `GET /markets/performance` endpoint to `apps/api/src/markets/markets.controller.ts`: inject `PerformanceService`, accept `@Query('days')` param (default 30, clamp to 1-365), call `getDashboardData(user.id, days)`, return JSON.
- [ ] 1.6 Add coordination test to `apps/api/tests/unit/performance-service.test.ts` covering: metrics computation (win rate, avg gain/loss, today's change), trend detection logic (improving/declining/stable), edge cases (no portfolio, empty snapshots, null calibration).
- [ ] 1.7 Add test to `test:unit` chain in `apps/api/package.json`.

### Quality Gate
Before moving to Phase 2, ALL of the following must pass:

- [ ] **Lint**: `pnpm -C apps/api lint` passes
- [ ] **Build**: `pnpm -C apps/api build` compiles without errors
- [ ] **Typecheck**: `pnpm -C apps/api typecheck` passes
- [ ] **Unit Tests**: `pnpm -C apps/api test:unit` — all tests pass including new performance tests
- [ ] **Smoke Tests**: `pnpm -C apps/api test:markets:smoke` — existing smoke tests still pass
- [ ] **Curl Tests**: Deferred to live integration (endpoint requires auth + populated DB)
- [ ] **Phase Review**: Compare against PRD Phase 1 (section 8)
  - [ ] Single endpoint returns all dashboard data in PRD response shape?
  - [ ] Metrics include portfolio_value, today_change, active_positions, PnL, win_rate, avg_gain, avg_loss?
  - [ ] Equity curve sourced from daily_pnl_snapshot?
  - [ ] Benchmark sourced from benchmark_series?
  - [ ] Analyst leaderboard includes accuracy, calibration, sample_size, trend?
  - [ ] Edge cases handled (no portfolio, insufficient data)?

---

## Phase 2: Frontend — Metrics Cards & Equity Curve
**Status**: Complete
**Objective**: Build the performance page with metrics cards and interactive equity curve chart with SPY benchmark overlay.

### Steps
- [ ] 2.1 Create `apps/web/src/stores/performance.store.ts` Pinia store with: `dashboard` ref (typed to PerformanceDashboardResponse), `loading` ref, `selectedDays` ref (default 30), `fetchDashboard(days?)` method using `useApi().get('/performance?days=...')`.
- [ ] 2.2 Create `apps/web/src/views/PerformanceDashboardView.vue` with:
  - **Metrics cards row**: 4 `ion-card` components in a CSS grid (responsive: 4-col on desktop, 2×2 on tablet, 1-col on phone).
    - Card 1: Portfolio Value — large number, today's change ($) with green/red color, percentage change below.
    - Card 2: Realized PnL — cumulative total with green/red color.
    - Card 3: Win Rate — percentage with "(W wins / L losses)" subtitle.
    - Card 4: Active Positions — count number.
  - **Equity curve section**: `ion-card` containing:
    - Time range selector: `ion-segment` with 1W (7) / 1M (30) / 3M (90) / All (365) buttons. On change, update `selectedDays` and re-fetch.
    - Line chart using `vue-chartjs` Line component. Two datasets:
      - Primary (blue): portfolio equity from `equity_curve` array
      - Secondary (gray, dashed): SPY benchmark, normalized to portfolio starting value for visual comparison (`benchmark_close / benchmark_first * equity_first`)
    - X-axis: dates. Y-axis: dollar value. Tooltip with date, balance, daily PnL, benchmark price.
  - Handle empty state: if `has_portfolio === false`, show message "Portfolio will be created when you queue your first trade."
  - Handle sparse data: if equity_curve has <10 points, show chart with available data + note "Collecting data — full metrics available after 10 trading days."
- [ ] 2.3 Add route `{ path: 'performance', name: 'performance', component: () => import('../views/PerformanceDashboardView.vue') }` to `apps/web/src/router/index.ts` inside default layout children.
- [ ] 2.4 Add navigation item `{ title: 'Performance', icon: trendingUpOutline, to: '/performance' }` to `navItems` in `apps/web/src/layouts/DefaultLayout.vue`, positioned after "Dashboard" (second item). Import `trendingUpOutline` from `ionicons/icons`.

### Quality Gate
Before moving to Phase 3, ALL of the following must pass:

- [ ] **Lint**: `pnpm -C apps/web lint` passes
- [ ] **Build**: `pnpm -C apps/web build` compiles without errors
- [ ] **Typecheck**: Pre-existing errors only (none from performance code)
- [ ] **Unit Tests**: `pnpm -C apps/api test:unit` — all API tests still pass
- [ ] **Smoke Tests**: `pnpm -C apps/api test:markets:smoke` — existing tests still pass
- [ ] **Chrome Tests**: Deferred to Phase 3 (full UI verification after all sections built)
- [ ] **Phase Review**: Compare against PRD Phase 2 (section 8) and PRD section 4.4
  - [ ] 4 metrics cards present with correct data?
  - [ ] Equity curve renders with vue-chartjs Line?
  - [ ] SPY benchmark overlaid and normalized to portfolio start?
  - [ ] Time range selector (1W/1M/3M/All) re-fetches data?
  - [ ] Empty state handled for no portfolio?
  - [ ] Route and nav link added?

---

## Phase 3: PnL Summary, Analyst Leaderboard & Mobile Polish
**Status**: Complete
**Objective**: Complete the page with PnL summary, analyst leaderboard with trend indicators, and responsive mobile layout.

### Steps
- [ ] 3.1 Add **PnL summary stats bar** below equity curve in PerformanceDashboardView.vue:
  - Horizontal row of 4 stats: Total Realized PnL, Unrealized PnL, Avg Gain, Avg Loss
  - Green/red coloring for positive/negative values
  - Responsive: wraps to 2×2 on narrow viewports
- [ ] 3.2 Add **Analyst leaderboard** section below PnL summary:
  - `ion-card` with sortable table (default sort: calibration_score desc)
  - Columns: Rank (#), Analyst Name, Accuracy (%), Calibration, Sample Size, Trend
  - Trend column: green `arrowUpOutline` (improving), red `arrowDownOutline` (declining), gray `removeOutline` (stable)
  - Click row → `router.push('/analysts/' + analyst_id + '/performance')` to existing drilldown
  - Show "—" for null calibration with title="Needs 20+ predictions"
  - Handle empty state: "No analyst data available yet"
- [ ] 3.3 **Mobile responsive CSS**:
  - Metrics cards: `grid-template-columns: repeat(auto-fit, minmax(160px, 1fr))` — 4-col desktop, 2×2 tablet, 1-col phone
  - Equity curve chart: `min-height: 300px`, fills container width, touch-friendly
  - PnL stats: flex-wrap for narrow viewports
  - Leaderboard table: `overflow-x: auto` wrapper for horizontal scroll on mobile
  - Test at 375px (iPhone SE), 768px (iPad), 1024px+ (desktop)
- [ ] 3.4 Add `next_evaluation_at` display — small note below metrics cards: "Next evaluation: [time]" formatted as relative time or clock time.
- [ ] 3.5 Handle all empty states consistently:
  - No portfolio: centered message with explanation
  - Insufficient snapshot data: chart shows available data + note
  - No benchmark data: chart shows equity only, legend notes "Benchmark data collecting"
  - No analyst profiles: leaderboard section shows "Analyst performance data collecting"

### Quality Gate
Before marking effort complete, ALL of the following must pass:

- [ ] **Lint**: `pnpm -C apps/web lint` and `pnpm -C apps/api lint` pass
- [ ] **Build**: `pnpm -C apps/web build` and `pnpm -C apps/api build` pass
- [ ] **Typecheck**: `pnpm -C apps/api typecheck` passes
- [ ] **Unit Tests**: `pnpm -C apps/api test:unit` — all tests pass
- [ ] **Smoke Tests**: `pnpm -C apps/api test:markets:smoke` — all pass
- [ ] **Chrome Tests** (manual verification with dev server on port 7101):
  - [ ] Navigate to `/performance` — page loads without errors
  - [ ] 4 metrics cards display at top with values (or empty state)
  - [ ] Equity curve chart renders with portfolio line
  - [ ] SPY benchmark line overlaid (if data exists)
  - [ ] Time range selector (1W/1M/3M/All) switches chart data
  - [ ] PnL summary bar shows 4 stats with green/red coloring
  - [ ] Analyst leaderboard table renders with trend indicators
  - [ ] Clicking analyst row navigates to `/analysts/:id/performance`
  - [ ] Next evaluation time shown
  - [ ] Empty states display correctly when data is missing
  - [ ] Page is usable at 375px mobile width (cards stack, table scrolls)
  - [ ] Navigation sidebar shows "Performance" link after "Dashboard"
  - [ ] Console shows no errors during interaction
- [ ] **Phase Review**: Compare against PRD sections 4.4, 5, and intention
  - [ ] All 4 sections present: metrics cards, equity curve, PnL summary, analyst leaderboard?
  - [ ] Trend indicators show improving/declining/stable?
  - [ ] Responsive layout works on mobile?
  - [ ] Read-only — no mutation actions on the page?
  - [ ] Beta readers can access (no write access guard)?
