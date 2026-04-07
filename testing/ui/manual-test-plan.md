# Divinr.ai — Manual UI Test Plan

**Last updated**: 2026-04-07
**Driven by**: Claude via the `mcp__claude-in-chrome__*` tools (no Playwright / Cypress / Puppeteer)
**How to invoke**: ask Claude to "run the UI test plan" — Claude opens Chrome, walks the tiers top-down, captures screenshots/GIFs of anything broken, and reports findings.

## Pre-flight

Before any tier runs, verify the stack is up:

1. **API** healthy: `curl -s http://localhost:7100/health` returns `{"ok":true,...}`
2. **Web** healthy: `curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/` returns `200`
3. **Browser tab context**: call `mcp__claude-in-chrome__tabs_context_mcp` and either reuse a current Divinr tab or create a new one with `tabs_create_mcp` pointed at `http://localhost:5173/`.
4. **Auth**: dev mode uses the `MARKETS_DEV_AUTH_BYPASS` flag with an `x-user-id` header. The Vue app handles login via `LoginView.vue`. Confirm a logged-in session exists before running tier 2+.

## Run order

```
Tier 1: Smoke
  └─ if all pass → Tier 2: Per-screen
       └─ if all pass → Tier 3: Edge
```

Stop at the first tier that has any failure. Report findings, fix, re-run.

---

## Tier 1: Smoke (every route loads, no console errors)

**Goal**: prove the app boots, every top-level route renders without throwing, no red errors in the browser console. Fast — should complete in under a minute.

For **each** route below: navigate, wait for the page to settle, call `read_console_messages` filtered for errors, capture the page title, assert the URL matches, assert the console has zero errors at level `error`.

| # | Route | Component | Smoke check |
|---|---|---|---|
| 1.1 | `/login` | `LoginView.vue` | Login form renders. Email + password inputs visible. |
| 1.2 | `/` (dashboard) | `DashboardView.vue` | Top nav visible. Page title contains "Dashboard" or similar. |
| 1.3 | `/instruments` | `InstrumentsView.vue` | List of instruments renders (or empty-state). |
| 1.4 | `/instruments/:id` | `InstrumentDetailView.vue` | Pick the first instrument from 1.3 and navigate to its detail. Symbol + name visible. |
| 1.5 | `/analysts` | `AnalystsView.vue` | List of analysts renders. Should include the new arbitrator + day-trader rows seeded by portfolio-foundation Phase 1. |
| 1.6 | `/analysts/:id/performance` | `AnalystPerformanceView.vue` | Pick the first analyst from 1.5 and navigate. P&L / win-rate visible. |
| 1.7 | `/runs` | `RunsView.vue` | Recent run history visible. |
| 1.8 | `/runs/:id` | `RunDetailView.vue` | Pick the most recent run from 1.7 and navigate. Run timeline visible. |
| 1.9 | `/risk` | `RiskDashboardView.vue` | Risk score panels render. |
| 1.10 | `/sources` | `SourcesView.vue` | List of data sources renders. |
| 1.11 | `/portfolio` | `PortfolioDashboardView.vue` | Portfolio balance + open positions render. With agent-autotrading shipped, this should now show analyst + arbitrator positions opened by `ConvictionTraderService`. |
| 1.12 | `/evaluations` | `EvaluationsView.vue` | Evaluation history renders. |
| 1.13 | `/learning` | `LearningDashboardView.vue` | Learning panel renders. |
| 1.14 | `/learning/canonical/:id` | `CanonicalDayDetailView.vue` | Skip if no canonical days exist. |
| 1.15 | `/predictions` | `PredictionsView.vue` | Recent predictions render. |
| 1.16 | `/domain/:domain` | `DomainDashboardView.vue` | Skip if no non-default domains. |
| 1.17 | `/terms` | `TermsOfServiceView.vue` | Legal copy renders. |

**Pass criteria**: every navigated route returns HTTP 200 in the network log, the page renders something other than a blank/error component, and `read_console_messages` shows zero entries at level `error`.

**Common smoke failures to call out explicitly**:
- 401 redirect to `/login` → auth session not established
- Network 500 from `/markets/*` → API not healthy or DB connection lost
- Vue runtime warnings about missing props → likely a recent component change broke a binding

---

## Tier 2: Per-screen (elements + interactions)

**Goal**: for each top-level screen, verify the primary visible elements + the primary interactions work. Slower — expect a few minutes per screen.

Each screen below has its own subsection with element checks and interaction checks. Element checks use `find` + `read_page` to assert the element exists and contains expected text. Interaction checks use `find` to locate, then `form_input` / a synthetic click via `javascript_tool` if needed, then re-read to verify the result.

### 2.1 LoginView (`/login`)

**Elements**:
- Email input
- Password input
- Submit button
- Link to terms of service

**Interactions**:
- Empty submit → validation error displayed
- Invalid credentials → error toast / inline error
- Valid dev credentials → redirect to `/`

### 2.2 DashboardView (`/`)

**Elements**:
- Top navigation with links to all major routes
- "Recent activity" or equivalent summary panel
- Any leaderboard / portfolio summary widget

**Interactions**:
- Click each top-nav link → navigates to the right route
- Click any "view all" link in a summary panel → navigates correctly

### 2.3 InstrumentsView (`/instruments`)

**Elements**:
- Table or grid of instruments
- Per-row symbol, name, current price (from `instruments.current_state.price`)
- Search / filter input if present

**Interactions**:
- Search by symbol → list filters
- Click an instrument row → navigates to `/instruments/:id`
- If a sort control exists → sorting works

### 2.4 InstrumentDetailView (`/instruments/:id`)

**Elements**:
- Symbol + name header
- Current price + change %
- Recent predictions list
- Recent run history for this instrument

**Interactions**:
- Click a recent prediction → opens the prediction detail (modal or route)
- Click a recent run → navigates to `/runs/:id`

### 2.5 AnalystsView (`/analysts`)

**Elements**:
- List of all analysts
- **Should include new rows seeded by portfolio-foundation Phase 1**: `arbitrator`, `momentum-breakout`, `mean-reversion`, `gap-and-go`. Verify these exist.
- Per-analyst summary (display name, type, win rate)

**Interactions**:
- Click an analyst → navigates to `/analysts/:id/performance`
- Filter by analyst_type if a filter exists

### 2.6 AnalystPerformanceView (`/analysts/:id/performance`)

**Elements**:
- Analyst name + persona summary
- Performance chart (P&L over time)
- Recent positions table
- **For agent-autotrading verification**: positions with `trigger_reason='signal_cross'` should be visible if this analyst was active recently

**Interactions**:
- Date-range picker if present → updates chart
- Click a position row → expands or navigates to detail

### 2.7 RunsView (`/runs`)

**Elements**:
- List of recent orchestration runs
- Per-run: id, status (running/completed/failed), instrument symbol, started/completed timestamps
- Filter by status

**Interactions**:
- Click a run → navigates to `/runs/:id`
- Filter by status → list updates

### 2.8 RunDetailView (`/runs/:id`)

**Elements**:
- Run header (id, status, instrument, timing)
- Per-step timeline with logs
- Per-analyst output cards
- Arbitrator synthesis card
- Trade recommendation card (if Phase 6 logic ran)

**Interactions**:
- Expand a step → shows logs / artifacts
- Re-trigger button if present (be careful — may actually re-run)

### 2.9 RiskDashboardView (`/risk`)

**Elements**:
- Composite risk scores per instrument
- Risk dimension breakdowns
- Per-analyst risk perspectives (from analyst-intelligence-platform Phase 4)

**Interactions**:
- Filter by instrument or analyst → updates display
- Click a risk dimension → expands details

### 2.10 SourcesView (`/sources`)

**Elements**:
- List of data sources from `data_source_registry` (Twelve Data, FMP, SEC EDGAR, Finnhub, FRED, Polygon, Reddit)
- Per-source: status, last fetch, configured analysts
- Recent articles per source

**Interactions**:
- Click a source → expands or navigates to source detail
- Click a recent article → opens article drill-down

### 2.11 PortfolioDashboardView (`/portfolio`)

**Most-changed screen** — agent-autotrading just shipped positions into many portfolios.

**Elements**:
- Current balance
- Total realized P&L
- Total unrealized P&L
- Open positions table (should now include positions with `trigger_reason='signal_cross'` and `'eod_sweep'` from this effort)
- Recent closed positions (should now include positions closed by `StopLossWatcherService` with `trigger_reason` of `stop_loss` / `take_profit` / `trailing_stop`)
- Queued trades (existing Phase 6 path)
- Leaderboard panel

**Interactions**:
- Click an open position → expands or navigates to detail
- Click "queue trade" on a recommendation → queues a trade (paper)
- Confirm disclaimer flow still gates trade actions
- Sort the leaderboard by win rate / P&L %

**Specific agent-autotrading verifications** (this is the screen that's most affected by recent backend changes):
- If positions exist with `trigger_reason` in `('signal_cross','eod_sweep','stop_loss','take_profit','trailing_stop')`, verify they render. The tooltip / provenance display is **deferred** to a later effort, so for now just verifying they appear in the table is enough.
- The arbitrator portfolio (`pf-portfolio-arbitrator`) should be visible in the leaderboard with non-zero positions.

### 2.12 EvaluationsView (`/evaluations`)

**Elements**:
- Evaluation history (from nightly evaluation runs)
- Per-evaluation: horizon (1d/3d/5d), accuracy, calibration

**Interactions**:
- Filter by horizon
- Click an evaluation → expands details

### 2.13 LearningDashboardView (`/learning`)

**Elements**:
- Per-analyst memory entries (from analyst-intelligence-platform Phase 1)
- Learning cycle history
- Canonical days list

**Interactions**:
- Click a memory entry → expands
- Click a canonical day → navigates to `/learning/canonical/:id`

### 2.14 PredictionsView (`/predictions`)

**Elements**:
- Recent predictions across all instruments
- Per-prediction: instrument, analyst, direction, confidence, role
- Filter by role / analyst / direction

**Interactions**:
- Click a prediction → opens detail
- Filter changes update the list

### 2.15 TermsOfServiceView (`/terms`)

**Elements**:
- Legal copy renders fully
- "I accept" button if interactive

**Interactions**:
- Accept → records acknowledgment

---

## Tier 3: Edge cases

**Goal**: hard cases, error states, accessibility, multi-step user journeys. Run on demand or weekly.

### 3.1 Auth + session

- Logged-out user navigating to a protected route → redirect to `/login`
- Session expiry → redirect to `/login` with notice
- Logout from any screen → returns to `/login`

### 3.2 Empty states

- An analyst with zero predictions → `AnalystPerformanceView` renders empty state, not a crash
- An instrument with zero runs → `InstrumentDetailView` renders empty state
- A user with zero positions → `PortfolioDashboardView` renders empty state

### 3.3 Error states

- API down (kill the API mid-session) → screens render an error banner, not white-screen
- Partial data load (some calls fail, others succeed) → partial render with an error indicator

### 3.4 Trade flow end-to-end (paper)

1. Open `/predictions`, find a recent prediction with confidence ≥ 70
2. Click into the prediction detail
3. Open the trade modal (`AnalystPredictionModal.vue`)
4. Accept the disclaimer ("for fun and education, not advice")
5. Queue a trade
6. Verify it appears in `/portfolio` queued trades list
7. Trigger EOD settlement via admin endpoint (or wait for cron)
8. Verify the queued trade became an open position

### 3.5 Multi-actor portfolio comparison (after agent-autotrading)

1. Open `/portfolio`
2. Verify the leaderboard shows multiple analyst portfolios + the new arbitrator portfolio
3. Verify the user portfolio is also listed (or in its own panel)
4. Sort by P&L → ranking changes
5. Click into the top-ranked analyst → drills into their performance

### 3.6 Console hygiene sweep

After running tier 2 end-to-end, walk every screen one more time and confirm zero new console errors / warnings have accumulated. Vue prop warnings, missing translations, deprecated lifecycle hooks all count.

### 3.7 Network panel sweep

Walk every screen with the Chrome network panel filter set to status `>=400`. Any 4xx/5xx that isn't an expected auth-redirect is a finding.

---

## What to deliver after a run

When Claude executes this plan:

1. **Tier-by-tier pass/fail summary** at the top
2. **Per-row results** for tier 1 (route, status, console-error count)
3. **Per-screen findings** for tier 2 (what worked, what didn't, screenshots of anything broken)
4. **Tier 3 findings** if reached
5. **Console hygiene summary** — list every distinct error / warning seen, with the screen where it appeared
6. **Recommended fixes** prioritized by severity (broken > regression > polish)

Optional: capture a single GIF of the smoke walkthrough using `gif_creator` for sharing.

## Maintenance

This plan is meant to grow as the app does. Whenever a new route or major component lands, add a smoke entry (tier 1) and a screen subsection (tier 2). The legend at the top of each subsection should always answer: **what does a healthy version of this screen look like?**

## Known deferred items

- **Master-detail portfolio view** is **not built yet** — when portfolio-foundation Phases 5–6 ship, replace section 2.11 with the new layout (`/portfolios` route, expandable rows per actor, equity sparklines).
- **Provenance tooltip** on trade rows is **deferred** along with master-detail. Until then, tier 2 only verifies the trade rows appear; the tooltip content lands later.
- **Day-trader portfolios** exist (seeded by portfolio-foundation Phase 1) but have **no positions** (the day-traders effort hasn't shipped). Tier 2 should confirm they appear in the leaderboard at $1M with zero positions.
