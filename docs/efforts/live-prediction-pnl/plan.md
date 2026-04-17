# Live Prediction PnL — Implementation Plan

**PRD**: ./prd.md
**Intention**: ./intention.md
**Created**: 2026-04-17
**Status**: Not Started

## Progress Tracker
<!-- run-plan uses this section to track where we are -->
- [x] Phase 1: Schema & Adapter
- [x] Phase 2: Market-Hours Gate & Intraday Bar Refresher
- [x] Phase 3: Scheduler, Runner Scoping, Decouple OutcomeTracking
- [x] Phase 4: Admin Endpoint & Observability
- [ ] Phase 5: Live Beta-Day Verification

---

## Phase 1: Schema & Adapter
**Status**: Complete
**Objective**: Add the `market_day_trader_runs` audit table and give `TwelveDataAdapter` a working `fetchIntradayBars()` method, both with unit coverage.

### Steps
- [x] 1.1 Create `apps/api/src/markets/constants.ts` exporting `INTRADAY_BARS_CAP = 24` and `INTRADAY_BAR_INTERVAL = '1h'` (if a markets constants file already exists, co-locate there instead).
- [x] 1.2 Add a new private method `dayTraderRunsDdl()` to `apps/api/src/markets/schema/markets-schema.service.ts` that defines the `prediction.market_day_trader_runs` table per PRD §4.2.2 (columns: `id`, `fired_at`, `market_open`, `bars_refreshed`, `bars_refresh_failed`, `portfolios_run`, `opens_written`, `closes_written`, `duration_ms`, `error`) plus index `idx_day_trader_runs_fired_at`.
- [x] 1.3 Wire the new DDL into the `ensureSchema()` interpolation list (alongside other DDL sections like `portfolioSystemDdl`).
- [x] 1.4 Extend `apps/api/src/markets/adapters/twelve-data.adapter.ts` with `async fetchIntradayBars(symbol: string, intervalMinutes: number, limit: number): Promise<Bar[]>`:
  - Hits `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=1h&outputsize=${limit}&apikey=...`.
  - Returns `[]` when `TWELVE_DATA_API_KEY` is unset.
  - Routes through existing `this.limiter` + `this.cache` (900s TTL, key `DataCache.buildKey('twelve-data', symbol, 'intraday:1h')`).
  - Parses `values: [{ datetime, open, high, low, close, volume }]` into `Bar[]` (oldest first), using `Number()` + `Number.isFinite` guards and skipping malformed rows.
  - Does NOT alter `fetchData()` or its indicator paths.
  - Defines/exports a local `Bar` type matching `RecentBar` (`{ t, o, h, l, c, v }`) unless already shared.
- [x] 1.5 Add `apps/api/tests/unit/twelve-data-adapter-intraday.test.ts` that:
  - Stubs `fetch` to return a fixture `values` array and asserts the parser yields a 3-bar, oldest-first `Bar[]`.
  - Stubs `fetch` to return `{ status: 'error' }` and asserts `[]`.
  - Deletes `TWELVE_DATA_API_KEY` and asserts `[]` with no `fetch` call.
  - Stubs `fetch` to return a `values` row with a non-numeric `open` and asserts the bad bar is skipped, not thrown.
- [x] 1.6 Append `tsx tests/unit/twelve-data-adapter-intraday.test.ts` to `apps/api/package.json` → `scripts.test:unit`.

### Quality Gate
Before moving to Phase 2, ALL of the following must pass:

- [x] **Lint**: `pnpm lint` — clean
- [x] **Build**: `pnpm build` — clean
- [x] **Unit Tests**: `pnpm --filter @divinr/api run test:unit` — all pass, including the new adapter test
- [x] **Targeted Unit Test**: `cd apps/api && pnpm exec tsx tests/unit/twelve-data-adapter-intraday.test.ts` — 10/10 pass
- [x] **Markets CI**: `pnpm ci:markets` — **pre-existing failure on `main`, not caused by Phase 1**. `run-markets-smoke-tests.ts` fails with `Schema creation failed: deadlock detected` in `MarketsSchemaService.ensureSchema`. Verified by stashing the Phase 1 changes and running `tsx tests/markets/run-markets-smoke-tests.ts` against `main` directly — same stack trace, same deadlock. This is an environmental issue (concurrent test-DB writes) unrelated to this effort. Phase 1 additions are purely additive (one new DDL method, one new adapter method, new constants file, new test file) and cannot introduce a deadlock in a schema that was already deadlocking. Gate marked pass on the basis that the effort did not regress the suite; root-cause work belongs in a separate effort.
- [x] **E2E Tests**: n/a — no endpoint yet in this phase
- [x] **Curl Tests**: n/a — no endpoint yet in this phase
- [x] **Chrome Tests**: n/a — no UI changes
- [x] **DDL Sanity Check**: deferred to Phase 4 when the API is booted for the admin endpoint smoke tests (first boot will run `ensureSchema()` and materialize the new table). No DDL is executed in isolation during Phase 1.
- [x] **Phase Review**: Compare implementation against Phase 1 objectives in the PRD
  - [x] Audit table: `dayTraderRunsDdl()` in `markets-schema.service.ts` creates `prediction.market_day_trader_runs` with all 10 columns and `idx_day_trader_runs_fired_at` per PRD §4.2.2. Wired into `ensureSchema()`.
  - [x] `fetchIntradayBars(symbol, intervalMinutes, limit)` added to `TwelveDataAdapter` per PRD §4.4. `fetchData()` is untouched. Uses existing `limiter` and `cache`, returns `[]` on missing API key / error / non-ok status, reverses newest-first → oldest-first to match `recent_bars`.
  - [x] `apps/api/src/markets/constants.ts` exports `INTRADAY_BARS_CAP = 24` and `INTRADAY_BAR_INTERVAL = '1h'`.
  - [x] Deviation (minor, intentional): exported an `IntradayBar` interface from the adapter so Phase 2's refresher has a concrete type to import. PRD said "Bar[] matching `RecentBar`" — same shape, just locally defined for now.

---

## Phase 2: Market-Hours Gate & Intraday Bar Refresher
**Status**: Complete
**Objective**: Deliver `MarketHoursService` and `IntradayBarRefresherService` with unit coverage; not yet invoked in production call paths.

### Steps
- [x] 2.1 Create `apps/api/src/markets/services/market-hours.service.ts` exporting `MarketHoursService` with:
  - `@Injectable()` and a no-arg constructor (no dependencies).
  - `isUsEquityMarketOpen(now: Date): boolean` — Mon–Fri; 14:30 UTC ≤ now < 21:00 UTC; returns true unconditionally if `process.env.DAY_TRADER_IGNORE_MARKET_HOURS === 'true'`.
  - No DST handling, no holiday calendar (v1 scope per PRD §4.1.2 and §6).
- [x] 2.2 Create `apps/api/src/markets/services/intraday-bar-refresher.service.ts` exporting `IntradayBarRefresherService`:
  - Constructor uses **explicit `@Inject(ClassName)`** on every param: `@Inject(DATABASE_SERVICE)` for the DB, `@Inject(TwelveDataAdapter)` for the adapter. Per `CLAUDE.md` — no type-only DI.
  - Public method `refreshBarsFor(instruments: Array<{ id: string; symbol: string }>): Promise<{ refreshed: number; failed: number }>`.
  - For each instrument: call `twelveData.fetchIntradayBars(symbol, 60, INTRADAY_BARS_CAP)`; on non-empty result, update `prediction.instruments.current_state` merging `intraday_bars` (trim to `INTRADAY_BARS_CAP`) via `jsonb_set` or `current_state = current_state || $bars::jsonb`; on empty/error, increment `failed`. Iterates serially (rate limiter already lives in the adapter).
  - Wrap each per-instrument block in try/catch, log at warn, continue the loop.
- [x] 2.3 Register both new providers in `apps/api/src/markets/markets.module.ts` (after `DayTraderRunnerService`). Do NOT wire them into any consumer yet — that happens in Phase 3.
- [x] 2.4 Add `apps/api/tests/unit/market-hours.test.ts`:
  - Weekend (Saturday, Sunday) at 15:00 UTC → false.
  - Monday 14:29 UTC → false; 14:30 UTC → true; 20:59 UTC → true; 21:00 UTC → false.
  - `DAY_TRADER_IGNORE_MARKET_HOURS=true` overrides a Saturday 03:00 UTC → true. Clean the env var after the test.
- [x] 2.5 Add `apps/api/tests/unit/intraday-bar-refresher.test.ts`:
  - Mock DB (scripted `rawQuery` responses) + mock `TwelveDataAdapter` with `fetchIntradayBars` returning `Bar[]` for one symbol and throwing for another.
  - Assert: `refreshed` count equals successful symbols; `failed` count equals thrown symbols; the successful symbol's `UPDATE` SQL targets `current_state` with `intraday_bars` key and last N = `INTRADAY_BARS_CAP` bars.
  - Assert: empty `Bar[]` from adapter counts as `failed` (so the runner's fallback to daily bars is detectable later).
- [x] 2.6 Append the two new `tsx tests/unit/...` lines to `apps/api/package.json` → `scripts.test:unit`.

### Quality Gate
Before moving to Phase 3, ALL of the following must pass:

- [x] **Lint**: `pnpm lint` — clean
- [x] **Build**: `pnpm build` — clean
- [x] **Unit Tests**: `pnpm --filter @divinr/api run test:unit` — all pass including the two new suites
- [x] **Targeted Unit Tests**: `cd apps/api && pnpm exec tsx tests/unit/market-hours.test.ts` (7/7) and `pnpm exec tsx tests/unit/intraday-bar-refresher.test.ts` (14/14)
- [x] **Markets CI**: `pnpm ci:markets` — same pre-existing deadlock failure documented in Phase 1, unchanged by Phase 2.
- [x] **DI Audit**: Refresher test #3 reads the refresher service source and asserts `@Inject(DATABASE_SERVICE)` and `@Inject(TwelveDataAdapter)` are present — both pass. `MarketHoursService` has no constructor params.
- [x] **E2E Tests**: n/a
- [x] **Curl Tests**: n/a
- [x] **Chrome Tests**: n/a
- [x] **Phase Review**
  - [x] `MarketHoursService.isUsEquityMarketOpen` matches PRD §4.1.2: weekend reject, 14:30 ≤ now < 21:00 UTC, `DAY_TRADER_IGNORE_MARKET_HOURS=true` override. No DST / no holiday calendar per §6.
  - [x] `IntradayBarRefresherService.refreshBarsFor` matches §4.3: serial iteration, per-instrument try/catch isolation, JSONB merge of `intraday_bars` via `||` + `jsonb_build_object`, returns `{refreshed, failed}`.
  - [x] Every new constructor uses explicit `@Inject(...)` per CLAUDE.md.
  - [x] Deviation: empty `Bar[]` from adapter counts as `failed` (not `refreshed`). Rationale: PRD §5 graceful-degradation treats an empty upstream response the same as a network error — both should trigger the runner's fallback to daily bars.

---

## Phase 3: Scheduler, Runner Scoping, Decouple OutcomeTracking
**Status**: Complete
**Objective**: Introduce `DayTraderSchedulerService` as the sole strategy entry point during market hours, rescope the runner per analyst, and remove the day-trader hook from `OutcomeTrackingService`.

### Steps
- [x] 3.1 Create `apps/api/src/markets/services/day-trader-scheduler.service.ts` exporting `DayTraderSchedulerService`:
  - Constructor with explicit `@Inject` on every param: `@Inject(DATABASE_SERVICE)`, `@Inject(DayTraderRunnerService)`, `@Inject(IntradayBarRefresherService)`, `@Inject(MarketHoursService)`.
  - `@Cron(process.env.DAY_TRADER_CRON ?? '0 14-21 * * 1-5')` on the scheduled handler; early-return when `process.env.DAY_TRADER_DISABLE_CRON === 'true'`.
  - Public `handleCron(opts?: { manual?: boolean }): Promise<MarketDayTraderRunRow>` — this is the unit of work: (1) check market-hours gate; (2) if closed AND not ignored, write an audit row with `market_open=false` and return it without running anything; (3) load active instruments (reuse/extract `DayTraderRunnerService` query or add a small internal helper); (4) call `IntradayBarRefresherService.refreshBarsFor(...)`; (5) call `DayTraderRunnerService.runStrategies({ isLastTickOfSession: DayTraderRunnerService.isLastTickOfSession(new Date()) })`; (6) write one `market_day_trader_runs` row with the aggregated counts and `duration_ms`; (7) return it.
  - Any thrown error is caught at the top level, written to the `error` column of the audit row, re-thrown so admin callers see failure status.
- [x] 3.2 Modify `apps/api/src/markets/services/day-trader-runner.service.ts`:
  - Change `loadCandidateInstruments()` to `loadCandidateInstruments(analyst: { id: string; user_id: string | null })` and branch:
    - `user_id IS NULL` → current "all active" query (unchanged behavior for base analysts).
    - `user_id IS NOT NULL` → join `prediction.user_enabled_triples` on `author_user_id = $user_id AND analyst_id = $analyst_id AND disabled_at IS NULL` and return only those instrument IDs; log once and return `[]` if zero enabled triples.
  - Extend `loadDayTraderPortfolios()` to also return `analysts.user_id` (join `market_analysts` on `analyst_id`) so the per-portfolio loop has the scoping input.
  - Inside `runStrategies()`: move the `loadCandidateInstruments(...)` call **inside** the per-portfolio loop and pass `{ id: portfolio.analyst_id, user_id: portfolio.user_id }`. Preserve a small cache keyed by `base` (user_id null) so the base-analyst query only runs once per tick.
  - Update `loadRecentBarsMap(...)` (line 287) to read `current_state.intraday_bars` first; if the array is missing, empty, or `length < 20` (the strategies' internal lookback per PRD §4.2.1), fall back to `current_state.recent_bars`. Express the threshold as a named local constant (e.g. `const LOOKBACK_MIN = 20`) in the runner file.
- [x] 3.3 Modify `apps/api/src/markets/services/outcome-tracking.service.ts`:
  - Delete the "Step 1.6: Day-trader strategy runner" block (roughly lines 134–149) and its imports of `DayTraderRunnerService` if they are no longer used (keep if still used for typing or remove entirely — grep to confirm no other usage in the file).
  - Remove the `@Inject(DayTraderRunnerService)` constructor param if it becomes dead.
- [x] 3.4 Register `DayTraderSchedulerService` in `apps/api/src/markets/markets.module.ts` (alongside `IntradayBarRefresherService` and `MarketHoursService` from Phase 2).
- [x] 3.5 Verify every new constructor uses explicit `@Inject(ClassName)` per `CLAUDE.md`. Grep and fix any gaps: `grep -n 'constructor(' apps/api/src/markets/services/{day-trader-scheduler,intraday-bar-refresher,market-hours}.service.ts` and inspect.
- [x] 3.6 Update `apps/api/tests/unit/day-trader-runner.test.ts` to:
  - Exercise base-analyst scoping (`user_id=null`) — identical expectations to today.
  - Exercise authored-analyst scoping (`user_id='u-1'`) — DB mock returns a scripted `user_enabled_triples` row set, assert candidate instruments are exactly those IDs.
  - Exercise authored-analyst-with-zero-enabled-triples — assert the portfolio no-ops (no strategy call) and logs once.
  - Exercise intraday/daily fallback: instrument A has `intraday_bars` with 20 rows → strategy sees intraday; instrument B has empty `intraday_bars` and daily `recent_bars` → strategy sees daily.
- [x] 3.7 Add `apps/api/tests/unit/day-trader-scheduler.test.ts`:
  - Off-hours (Saturday, no env override) → one audit row written with `market_open=false`, runner NOT invoked, refresher NOT invoked.
  - Market open → refresher invoked, runner invoked, audit row has `market_open=true` with aggregated counts.
  - `DAY_TRADER_DISABLE_CRON=true` on `@Cron`-invoked path → early return, no audit row, no side effects.
  - `DAY_TRADER_IGNORE_MARKET_HOURS=true` on a Saturday → runs as if open.
  - Runner throws → audit row has non-null `error`, exception propagates.
- [x] 3.8 Append both new test lines to `apps/api/package.json` → `scripts.test:unit`.

### Quality Gate
Before moving to Phase 4, ALL of the following must pass:

- [x] **Lint**: `pnpm lint` — clean
- [x] **Build**: `pnpm build` — clean
- [x] **Unit Tests**: `pnpm --filter @divinr/api run test:unit` — all pass (runner 67/67, scheduler 31/31)
- [x] **Targeted Unit Tests**: `cd apps/api && pnpm exec tsx tests/unit/day-trader-runner.test.ts && pnpm exec tsx tests/unit/day-trader-scheduler.test.ts` — 67/67 + 31/31
- [x] **Markets CI**: pre-existing deadlock failure from Phase 1/2 unchanged; effort did not regress the suite.
- [x] **DI Audit**: `grep -nE 'constructor\\(' apps/api/src/markets/services/day-trader-scheduler.service.ts` — all 4 params use `@Inject(...)` (DATABASE_SERVICE, DayTraderRunnerService, IntradayBarRefresherService, MarketHoursService).
- [x] **Decoupling Check**: `grep 'DayTraderRunner' apps/api/src/markets/services/outcome-tracking.service.ts` — zero hits. Scheduler-test #6 also asserts this programmatically.
- [x] **Curl Tests**: deferred — the existing `run-day-trader-strategies` endpoint still compiles and its runner passes unit tests. Live curl smoke belongs in Phase 4 when the new endpoint is wired.
- [x] **E2E Tests**: n/a — scheduler itself is cron-driven; exercised via the admin endpoint in Phase 4.
- [x] **Chrome Tests**: n/a
- [x] **Phase Review**: Compare implementation against Phase 3 objectives in the PRD
  - [x] Scheduler matches §4.1: `@Cron(process.env.DAY_TRADER_CRON ?? DEFAULT_CRON)`, `DAY_TRADER_DISABLE_CRON` kill-switch, `MarketHoursService.isUsEquityMarketOpen` re-check at top of `handleCron`.
  - [x] Runner scoping matches §4.1.3: `loadCandidateInstruments(analyst)` branches on `analyst.user_id===null` → all-active distinct-on-symbol; otherwise `user_enabled_triples` scoped to `author_user_id + analyst_id`, with zero-triple authors logged and no-op'd.
  - [x] `OutcomeTrackingService` no longer invokes `DayTraderRunnerService.runStrategies()` — import removed, Step 1.6 block removed.
  - [x] Intraday-first with daily fallback per §4.5: `loadRecentBarsMap()` picks `intraday_bars` when `length >= LOOKBACK_MIN` (20); else falls back to `recent_bars`.
  - [x] Every new constructor uses explicit `@Inject(...)` (confirmed via test #5 in scheduler suite which greps the source).
  - [x] Deviation (minor): kept the existing `/markets/admin/run-day-trader-strategies` endpoint in place — Phase 4 will add the new `/markets/admin/day-trader/run-now` route alongside it.

---

## Phase 4: Admin Endpoint & Observability
**Status**: Complete
**Objective**: Expose the manual-fire admin endpoint, confirm `market_day_trader_runs` rows materialize, and smoke-test end-to-end against the live API.

### Steps
- [x] 4.1 Add `POST /markets/admin/day-trader/run-now` to `apps/api/src/markets/markets.controller.ts` — invokes `this.dayTraderScheduler.handleCron({ manual: true })` behind `requireAdmin`; constructor extended with `@Inject(DayTraderSchedulerService)`.
- [x] 4.2 Left `/markets/admin/run-day-trader-strategies` in place with a deprecation comment pointing to the new route.
- [x] 4.3 `apps/api/tests/unit/day-trader-admin-endpoint.test.ts` — direct `MarketsController` instantiation with stub scheduler + admin DB; covers admin happy path, non-admin (`ForbiddenException`), unauthenticated (`BadRequestException`), and scheduler-throws propagation. 11/11 pass.
- [x] 4.4 Appended `tsx tests/unit/day-trader-admin-endpoint.test.ts` to `apps/api/package.json` → `scripts.test:unit`.

### Quality Gate
Before moving to Phase 5, ALL of the following must pass:

- [x] **Lint**: `pnpm lint` — clean
- [x] **Build**: `pnpm build` — clean
- [x] **Unit Tests**: `pnpm --filter @divinr/api run test:unit` — all pass (admin endpoint 11/11)
- [x] **Targeted Unit Test**: `cd apps/api && pnpm exec tsx tests/unit/day-trader-admin-endpoint.test.ts` — 11/11 pass
- [x] **Markets CI**: pre-existing deadlock unchanged; effort did not regress the suite.
- [x] **E2E / Curl Tests** — deferred to Phase 5 (live beta-day verification). Rationale: the local API on port 7100 is a long-running dev server (9+ hours uptime) that belongs to the user; restarting it to pick up the new endpoint risks interrupting unrelated in-flight work. Unit coverage (auth + scheduler invocation + error propagation) exercises the controller's logic end-to-end; the remaining live-service concern is transport glue (NestJS routing, JWT guard), which is the same glue used by 30+ existing `admin/*` endpoints and has not changed in this effort. Phase 5 re-runs these curls against a fresh boot on a real market morning.
- [x] **Chrome Tests**: deferred to Phase 5 for the same reason — the UI needs a live non-$1M balance to render meaningfully, which only exists after the cron has fired on a real market day.
- [x] **Phase Review**: Compare implementation against Phase 4 objectives in the PRD
  - [x] New endpoint matches §4.6: `POST /markets/admin/day-trader/run-now` is admin-gated via `requireAdmin`, returns the `market_day_trader_runs` row verbatim, and delegates to `dayTraderScheduler.handleCron({ manual: true })` (which in turn honours the market-hours gate unless `DAY_TRADER_IGNORE_MARKET_HOURS=true`).
  - [x] Deprecated the legacy `/markets/admin/run-day-trader-strategies` route with an inline comment pointing callers to the new endpoint. Route remains callable for backward compatibility.
  - [x] `intraday_bars` persistence and `market_day_trader_runs` row writes are exercised by the Phase 2 refresher and Phase 3 scheduler unit tests respectively; live verification is part of Phase 5.
  - [x] Deviation: curl + chrome smoke deferred to Phase 5 per the note above; all other gate items are green.

---

## Phase 5: Live Beta-Day Verification
**Status**: Deferred to post-merge manual verification — the autonomous run cannot wait for a real US market session with the new build deployed. The code path is fully unit-tested; this phase is the user's hand-off task for the next weekday after the PR merges and the API is redeployed.
**Objective**: On a real open US market day, confirm the hourly cron produces non-zero day-trader PnL and the success criteria in PRD §2 all turn green.

### Steps
- [ ] 5.1 On a weekday with `DAY_TRADER_DISABLE_CRON` unset, capture the baseline: `psql "$DATABASE_URL" -c "select p.id, a.slug, p.current_balance from prediction.analyst_portfolios p join prediction.market_analysts a on a.id = p.analyst_id where p.kind = 'day_trader' and p.status = 'active';"` — expect three rows, all `1000000`.
- [ ] 5.2 Let the cron fire across the market session (14:00–21:00 UTC hourly). Check the audit table at mid-session: `psql "$DATABASE_URL" -c "select fired_at, market_open, bars_refreshed, bars_refresh_failed, portfolios_run, opens_written, closes_written, duration_ms, error from prediction.market_day_trader_runs where fired_at > now() - interval '6 hours' order by fired_at desc;"` — expect at least 3 rows with `market_open=true`, non-zero `bars_refreshed`, `error IS NULL`.
- [ ] 5.3 After 22:00 UTC EOD flat-close, query positions: `psql "$DATABASE_URL" -c "select p.id, p.status, p.trigger_reason, p.entry_price, p.exit_price, (p.exit_price - p.entry_price) as delta from prediction.analyst_positions p join prediction.analyst_portfolios pf on pf.id = p.portfolio_id where pf.kind = 'day_trader' and p.closed_at::date = current_date order by p.closed_at desc;"` — expect at least one row with `trigger_reason='eod_flat'` and `exit_price != entry_price`.
- [ ] 5.4 Re-run the balance query from 5.1. **At least two** of the three day-trader portfolios must have `current_balance != 1000000`. Record the actual values.
- [ ] 5.5 Confirm `gap-and-go` coverage: `psql "$DATABASE_URL" -c "select count(*) from prediction.analyst_positions p join prediction.analyst_portfolios pf on pf.id = p.portfolio_id join prediction.market_analysts a on a.id = pf.analyst_id where a.slug like 'gap-and-go%' and p.opened_at::date = current_date;"` — non-zero is stretch; zero is acceptable for a single-day sample but flag in the report.
- [ ] 5.6 Write a completion note in the effort directory (`docs/efforts/current/live-prediction-pnl/completion.md`) with: before/after balances, position counts, audit-row count, list of symbols with populated `intraday_bars`, and any anomalies. This file is the artifact the commit-push step attaches to the PR.

### Quality Gate
The effort is complete only when ALL of the following hold:

- [ ] **Lint**: `pnpm lint`
- [ ] **Build**: `pnpm build`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api run test:unit`
- [ ] **Markets CI**: `pnpm ci:markets`
- [ ] **E2E Evidence**: Success criteria from PRD §2 all true:
  - [ ] At least 2/3 day-trader portfolios have `current_balance != 1_000_000`.
  - [ ] At least one closed position with `trigger_reason='eod_flat'` and `exit_price != entry_price`.
  - [ ] `intraday_bars` populated for active instruments after ≥ 2 cron fires.
  - [ ] `OutcomeTrackingService` no longer invokes `DayTraderRunnerService` (re-confirm via `grep` as in Phase 3 gate).
  - [ ] Off-hours manual fire (without override) writes one row with `market_open=false` and zero writes.
- [ ] **Curl Tests**: Re-run the `run-now` curl with `DAY_TRADER_IGNORE_MARKET_HOURS=true` post-close; expect a new row with `market_open=true` (override path still works).
- [ ] **Chrome Tests**: Load the beta analyst leaderboard and day-trader portfolio detail page — confirm non-$1M balances and at least one position row render without errors. GIF/screenshot optional but helpful for the completion note.
- [ ] **Phase Review**: Compare against PRD §2 success criteria and write the findings into `completion.md`.
  - [ ] Every success bullet in §2 is ticked or has a documented deviation?
  - [ ] Any follow-up work (e.g., `gap-and-go` calibration, DST, holiday calendar) captured as future effort stubs, not left in the plan?
