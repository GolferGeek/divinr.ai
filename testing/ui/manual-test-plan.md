# Divinr.ai — Manual UI Test Plan

**Last updated**: 2026-04-07 (after agent-autotrading deep-test session)
**Driven by**: Claude via the `mcp__claude-in-chrome__*` tools (no Playwright / Cypress / Puppeteer)
**How to invoke**: ask Claude to "run the UI test plan" — Claude opens Chrome, walks the tiers top-down, captures screenshots/GIFs of anything broken, and reports findings.

**Companion Tier 4** below (added 2026-04-07): **DB-level capability tests** for backend efforts that have no UI yet (agent-autotrading is the first). These run via direct SQL + admin endpoints, not the browser. Run them after a backend phase ships and before declaring the work done.

## Pre-flight

Before any tier runs, verify the stack is up:

1. **API** healthy: `curl -s http://localhost:7100/health` returns `{"ok":true,...}`
2. **Web** healthy: `curl -s -o /dev/null -w "%{http_code}" http://localhost:7101/` returns `200`
3. **Browser tab context**: call `mcp__claude-in-chrome__tabs_context_mcp` and either reuse a current Divinr tab or create a new one with `tabs_create_mcp` pointed at `http://localhost:7101/`.
4. **Auth**: dev mode uses the `MARKETS_DEV_AUTH_BYPASS` flag with an `x-user-id` header. The Vue app handles login via `LoginView.vue`. Confirm a logged-in session exists before running tier 2+. Fast path for Claude: set `localStorage.divinr_org='alpha-capital'` and `localStorage.divinr_user='admin@alpha-capital.demo'` then navigate to `/`. The auth guard in `router/index.ts:37` checks only those two keys.

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
| 1.1 | `/login` | `LoginView.vue` | Login form renders. Three demo-org radios (Alpha Capital / Steadfast Advisors / Apex Quant) + a "User ID" text input + "Sign In" button. (NOT email/password — corrected 2026-04-07.) |
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

---

## Tier 4: Backend capability deep-tests (no UI)

**Goal**: prove backend services do what their PRDs claim, against the live DB. Run after a backend phase ships and before declaring it done. Each subsection below has been **executed at least once** and the recipes are known to work end-to-end.

**Tooling**: direct SQL via `psql` (DATABASE_URL from `.env`, default `postgresql://postgres:postgres@127.0.0.1:54322/postgres`) + `POST` admin endpoints under `/markets/admin/`.

**Admin endpoints relevant to autotrade testing** (all require dev auth headers `x-user-id` + `x-org-slug`):
- `POST /markets/admin/run-settlement` — full EOD settlement (slow, ~2 min)
- `POST /markets/admin/run-outcome-tracking` — captureSnapshots → stop-loss sweep → resolve → expire (slow; **overwrites `instruments.current_state.price` from external feed**, so can't be used for price-injection tests)
- `POST /markets/admin/run-stop-loss-sweep` — calls `StopLossWatcherService.sweep()` directly, no snapshot capture (added 2026-04-07 for testing — preserves injected prices)
- `POST /markets/admin/run-eod-forced-buy` — calls `EodForcedBuyService.runSweep({manual:true})` directly (added 2026-04-07)

### 4.1 agent-autotrading — ConvictionTraderService (signal_cross)

**What it does**: when an analyst publishes a prediction with `confidence >= CONVICTION_TRADE_THRESHOLD` (default 70), opens a position in the analyst's portfolio with `trigger_reason='signal_cross'` and full provenance. Wired in `prediction-runner.service.ts` after each analyst publish + after the arbitrator synthesis.

**Static invariants** (run anytime):
```sql
-- Provenance fields populated on every signal_cross row
SELECT count(*) total, count(trigger_prediction_id) has_pred,
       count(trigger_conviction) has_conv, count(NULLIF(organization_slug,'')) has_org
FROM prediction.analyst_positions WHERE trigger_reason='signal_cross';
-- expect total = has_pred = has_conv = has_org

-- Threshold gate respected by current process
SELECT min(trigger_conviction), max(trigger_conviction)
FROM prediction.analyst_positions
WHERE trigger_reason='signal_cross' AND opened_at > now() - interval '1 day';
-- expect min >= 70 (or whatever CONVICTION_TRADE_THRESHOLD is set to)

-- Idempotency — zero duplicates on (portfolio, instrument, prediction)
SELECT count(*) FROM (
  SELECT portfolio_id, instrument_id, trigger_prediction_id
  FROM prediction.analyst_positions WHERE trigger_prediction_id IS NOT NULL
  GROUP BY 1,2,3 HAVING count(*) > 1) d;
-- expect 0

-- Day-trader portfolios untouched
SELECT count(*) FROM prediction.analyst_positions p
  JOIN prediction.analyst_portfolios ap ON ap.id=p.portfolio_id
  WHERE ap.kind='day_trader';
-- expect 0

-- Arbitrator routing — arbitrator-role predictions land in pf-portfolio-arbitrator
SELECT count(*) FROM prediction.analyst_positions
WHERE portfolio_id='pf-portfolio-arbitrator' AND trigger_reason='signal_cross';
-- expect > 0 once any arbitrator prediction has crossed threshold
```

**Live trigger**: hit `POST /markets/admin/run-pipeline` (or `run-prediction-generation`) and watch new signal_cross rows appear. Cross-check via the API logs for `Autotrade open: portfolio=... reason=signal_cross`.

**Unit tests**: `apps/api/tests/unit/conviction-trader.test.ts` — 21 assertions covering threshold gating (incl. inclusive `>=70` boundary), env override, idempotency, missing-portfolio guard, missing-price guard, arbitrator routing, direction mapping, organization_slug source. Run via `npx tsx apps/api/tests/unit/conviction-trader.test.ts`.

### 4.2 agent-autotrading — StopLossWatcherService (stop / take / trailing)

**What it does**: every outcome-tracking cycle, sweeps all open `analyst` + `arbitrator` positions and closes any that hit −5% (stop_loss), +10% (take_profit), or have given back 5% from their high-water mark after arming at +5% (trailing_stop). Constants live at `stop-loss-watcher.service.ts:33-36`.

**Live price-injection recipes** (PROVEN 2026-04-07):

These use `/admin/run-stop-loss-sweep` because `/admin/run-outcome-tracking` overwrites `instruments.current_state.price` from the external feed before the sweep gets to read it.

#### 4.2.A stop_loss fire (long side)

```sql
-- pick an instrument with open longs
SELECT i.symbol, i.id, (i.current_state->>'price')::numeric AS current_price,
       count(p.*) FILTER (WHERE p.direction='long' AND p.status='open') AS open_longs
FROM prediction.instruments i
LEFT JOIN prediction.analyst_positions p ON p.instrument_id=i.id
GROUP BY 1,2,3 HAVING count(p.*) FILTER (WHERE p.direction='long' AND p.status='open') > 0
ORDER BY 4 DESC LIMIT 5;

-- bump price down >5% from typical entry
UPDATE prediction.instruments
   SET current_state = jsonb_set(current_state, '{price}', '110.00'::jsonb)
 WHERE id = '<instrument_id>';
```
```bash
curl -s -X POST http://localhost:7100/markets/admin/run-stop-loss-sweep \
  -H "x-user-id: admin@alpha-capital.demo" -H "x-org-slug: alpha-capital"
# expect {"closed":N,"updated":M,"skipped":S} with N matching the open-long count
```
```sql
SELECT trigger_reason, count(*), round(avg(realized_pnl)::numeric,2) avg_pnl
FROM prediction.analyst_positions
WHERE symbol='<symbol>' AND closed_at > now()-interval '60 seconds'
GROUP BY trigger_reason;
-- expect stop_loss rows with negative avg_pnl
```

**Verified 2026-04-07**: SHOP entry $118.80 → bumped to $110.00 → 4 longs closed `stop_loss` with realized P&L −$6,644 to −$7,128.

#### 4.2.B take_profit fire (long side, plus short-side stop_loss bonus)

Same recipe with price bumped UP > 10% from entry. **Verified 2026-04-07**: MSFT entry $372.88 → bumped to $420.00 → 55 longs closed `take_profit` (+$5,796 to +$17,057). The 1 open MSFT short closed `stop_loss` for −$6,361, simultaneously proving short-side rules work.

#### 4.2.C trailing_stop arm-then-fire

Two-step. Pick a symbol with open longs, then:

**Step 1 — arm**: clear HWM and set price at entry, then bump to +8% → sweep. After sweep, longs should have `high_water_mark = new_price`.
```sql
UPDATE prediction.analyst_positions SET high_water_mark = NULL
  WHERE symbol='<symbol>' AND status='open';
UPDATE prediction.instruments SET current_state = jsonb_set(current_state, '{price}', '<entry_x_1.08>'::jsonb)
  WHERE id='<instrument_id>';
```
```bash
curl -X POST http://localhost:7100/markets/admin/run-stop-loss-sweep -H "x-user-id: ..." -H "x-org-slug: ..."
```

**Step 2 — fire**: bump price down to ~5.4% below the new HWM (still above entry, so trailing not stop_loss).
```sql
UPDATE prediction.instruments SET current_state = jsonb_set(current_state, '{price}', '<hwm_x_0.946>'::jsonb)
  WHERE id='<instrument_id>';
```
```bash
curl -X POST http://localhost:7100/markets/admin/run-stop-loss-sweep -H "x-user-id: ..." -H "x-org-slug: ..."
```
Verify the longs closed as `trailing_stop` with **positive** realized P&L (they captured most of the favorable move).

**Verified 2026-04-07**: AAPL entry $258.86 → +8% to $279.57 (25 longs armed with HWM=279.57) → −5.36% to $264.59 → 25 closed `trailing_stop` with avg P&L **+$1,276**, exactly matching theory ((264.59−258.86)*qty).

#### 4.2.D Static HWM monotonicity

```sql
SELECT
  sum(case when direction='long' and high_water_mark < entry_price then 1 else 0 end) AS long_violations,
  sum(case when direction='short' and high_water_mark > entry_price then 1 else 0 end) AS short_violations
FROM prediction.analyst_positions WHERE status='open' AND high_water_mark IS NOT NULL;
-- expect 0,0
```

**Unit tests**: `apps/api/tests/unit/stop-loss-watcher.test.ts` — 36 assertions covering every branch of `decide()` for long+short, HWM monotonicity, trailing arm, stop/take precedence, sweep integration, SELECT-filter shape.

### 4.3 agent-autotrading — EodForcedBuyService (backstop sweep)

**What it does**: at EOD, finds today's high-conviction (`>= threshold`) analyst+arbitrator predictions whose opening was missed in-pipeline and inserts positions with `trigger_reason='eod_sweep'` + full provenance. Wired BEFORE `createAnalystPositions` in `eod-settlement.service.ts:92`.

**Static invariants**:
```sql
-- Every eod_sweep row has full provenance
SELECT count(*) total, count(trigger_prediction_id) has_pred,
       count(trigger_conviction) has_conv, count(NULLIF(organization_slug,'')) has_org
FROM prediction.analyst_positions WHERE trigger_reason='eod_sweep';

-- Threshold gate respected
SELECT min(trigger_conviction) FROM prediction.analyst_positions
WHERE trigger_reason='eod_sweep' AND opened_at > now() - interval '1 day';
-- expect >= CONVICTION_TRADE_THRESHOLD

-- No day-trader pollution
SELECT count(*) FROM prediction.analyst_positions p
  JOIN prediction.analyst_portfolios ap ON ap.id=p.portfolio_id
  WHERE ap.kind='day_trader' AND p.trigger_reason='eod_sweep';
-- expect 0
```

**Live trigger**:
```bash
curl -X POST http://localhost:7100/markets/admin/run-eod-forced-buy \
  -H "x-user-id: admin@alpha-capital.demo" -H "x-org-slug: alpha-capital"
# returns {"rowsWritten":N,"skipped":M,"errors":[]}
```
On a clean slate where today's high-conviction predictions have already been opened in-pipeline, expect `rowsWritten=0, skipped=N>0` (every candidate hits idempotency). To force a real write, delete a known signal_cross row first then re-run the sweep.

**Unit tests**: `apps/api/tests/unit/eod-forced-buy.test.ts` — 29 assertions covering threshold gating, idempotency, arbitrator routing, mixed-batch handling, missing-portfolio guard, day-trader exclusion, SELECT-filter shape.

### 4.4 Cross-cutting checks (run after any of the above)

```sql
-- Total recent close history by reason (sanity)
SELECT trigger_reason, count(*) FROM prediction.analyst_positions
WHERE closed_at > now() - interval '1 hour' GROUP BY trigger_reason ORDER BY 1;

-- Portfolio kinds + position counts
SELECT ap.kind, count(DISTINCT ap.id) AS portfolios,
       sum((SELECT count(*) FROM prediction.analyst_positions p WHERE p.portfolio_id=ap.id)) AS positions
FROM prediction.analyst_portfolios ap GROUP BY ap.kind;
```

### 4.5 Running the unit suites

```bash
cd /home/golfergeek/projects/divinr.ai/apps/api
npx tsx tests/unit/conviction-trader.test.ts && \
npx tsx tests/unit/eod-forced-buy.test.ts && \
npx tsx tests/unit/stop-loss-watcher.test.ts
# expect: 21 passed, 29 passed, 36 passed (= 86 assertions total for agent-autotrading)
```

---

## Maintenance

This plan is meant to grow as the app does. Whenever a new route or major component lands, add a smoke entry (tier 1) and a screen subsection (tier 2). The legend at the top of each subsection should always answer: **what does a healthy version of this screen look like?**

When a new **backend-only effort** ships (no UI), add a Tier 4 subsection: brief description, static SQL invariants, live trigger recipe with proven values, and the unit-test command. Keep the recipe concrete enough that the next session can paste-and-run.

## Known deferred items

- **Master-detail portfolio view** is **not built yet** — when portfolio-foundation Phases 5–6 ship, replace section 2.11 with the new layout (`/portfolios` route, expandable rows per actor, equity sparklines).
- **Provenance tooltip** on trade rows is **deferred** along with master-detail. Until then, tier 2 only verifies the trade rows appear; the tooltip content lands later.
- **Day-trader portfolios** exist (seeded by portfolio-foundation Phase 1) but have **no positions** (the day-traders effort hasn't shipped). Tier 2 should confirm they appear in the leaderboard at $1M with zero positions.
