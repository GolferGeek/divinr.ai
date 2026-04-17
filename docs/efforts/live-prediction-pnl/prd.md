# Live Prediction PnL — Product Requirements Document

## 1. Overview

Give the three base day-trader strategies (`momentum-breakout`, `mean-reversion`, `gap-and-go`) a real intraday runtime so day-trader portfolios stop showing $0 PnL. Two things change:

1. **Cadence.** A new env-configurable hourly cron — gated on US market hours — becomes the sole entry point for strategy runs. Decoupled from the 15-min `OutcomeTrackingService` tick, which has no market-hours gate and fires 24/7.
2. **Inputs.** Strategies receive **hourly OHLC bars** instead of (today's) daily OHLC bars. Bars are fetched from Twelve Data's `time_series` endpoint, cached on `instruments.current_state.intraday_bars`, and refreshed once per hourly tick. No strategy logic changes — all three strategies already consume `Bar[]` and compute SMA / stdev / high-window internally; they just need the right interval fed to them.

This is a first-cut ship: hourly is coarse enough to stay inside Twelve Data's free-tier 8/min rate limit even with tens of instruments, and is the minimum granularity that actually moves the day-trader leaderboard during the day. Authored day-trader analysts (which don't exist yet) will iterate only their enabled instruments via `prediction.user_enabled_triples`; base day-trader analysts keep the all-active fan-out.

## 2. Goals & Success Criteria

Goals:
- Day-trader portfolios generate non-zero realized PnL during a real market day.
- `gap-and-go`, which was designed for intraday bars, actually fires (today it can't, because daily bars don't exhibit intra-session gap patterns).
- Cron cadence is env-overrideable so we can tighten to every 15 min or loosen to every 2h without a deploy.
- Authored day-trader analysts (zero today; arriving via `user-authored-custom-content`) automatically scope to their enabled instruments when they appear.
- Existing nightly evaluation, EOD flat-close, conviction auto-trade, and `OutcomeTrackingService` bar-refresh paths are undisturbed.

Success criteria:
- After a full US market day with the new cron active, **at least two of the three base day-trader portfolios** show `current_balance ≠ 1_000_000`. The "at-least-two" bar is what makes `gap-and-go` load-bearing: mean-reversion and momentum-breakout can both fire on daily bars in principle, so requiring two divergent portfolios forces real intraday signal coverage. Stretch: all three diverge.
- `analyst_positions` contains at least one row across those portfolios with `status='closed'`, `trigger_reason='eod_flat'`, and `exit_price ≠ entry_price`, confirming a real open-during-day / close-at-EOD lifecycle.
- `prediction.instruments.current_state.intraday_bars` is populated for every active instrument after the cron has run at least twice.
- The existing 15-min `OutcomeTrackingService.runTracking()` no longer invokes `DayTraderRunnerService.runStrategies()`; the only invoker during market hours is the new hourly cron.
- Off-hours firings (e.g., running the cron manually at 03:00 UTC without `DAY_TRADER_IGNORE_MARKET_HOURS`) produce a log message and return immediately, writing zero positions and one `market_day_trader_runs` row with `market_open=false`.
- Unit tests cover: market-hours gate, scoping branch (base vs. authored), intraday-bar loader fallback to daily when Twelve Data returns empty, EOD flat-close preserved.
- `pnpm lint`, `pnpm build`, `pnpm ci:markets` all green.

## 3. User Stories

- **Beta user viewing the analyst leaderboard:** "The three day-trader portfolios show realistic PnL movement — some win, some lose — rather than a dead-flat $1M across all of them."
- **Founder monitoring the engine:** "I can see in `analyst_positions` that positions opened at an intraday price and closed at a different intraday (or EOD) price."
- **Future authored day-trader analyst (when one exists):** "My analyst only considers the instruments I enabled it for; it doesn't fan out to all 30 active base instruments."
- **Operator:** "I can change the day-trader cadence by setting `DAY_TRADER_CRON` and restarting the API — no code deploy required."

## 4. Technical Requirements

### 4.1 Architecture

**New service:** `DayTraderSchedulerService` (in `apps/api/src/markets/services/`). Owns the hourly cron, the market-hours gate, and orchestration of "refresh intraday bars → run strategies." Injected with `DayTraderRunnerService`, `IntradayBarRefresherService` (new, see 4.2), database service, and `MarketHoursService` (new, see 4.1.2).

**DI convention (per `CLAUDE.md`).** Every constructor parameter on every new service (`DayTraderSchedulerService`, `IntradayBarRefresherService`, `MarketHoursService`) must use explicit `@Inject(ClassName)` / `@Inject(TOKEN)` on **every** param — tests run via `tsx`, which does not emit `design:paramtypes` metadata, so type-based DI fails at runtime. No exceptions.

**Module registration.** All new providers — `DayTraderSchedulerService`, `IntradayBarRefresherService`, `MarketHoursService` — are registered in `apps/api/src/markets/markets.module.ts` alongside the existing `DayTraderRunnerService`, `TwelveDataAdapter`, and data-source providers. The new admin endpoint (§4.6) routes via the existing `MarketsController` (or a lightweight new controller if that keeps concerns cleaner; plan decides).

**Cron schedule:**
- Env var: `DAY_TRADER_CRON` (default `0 14-21 * * 1-5` UTC — hourly 14:00–21:00 UTC Mon–Fri, which covers ~09:30 ET open through ~17:00 ET, one hour past close).
- Env kill-switch: `DAY_TRADER_DISABLE_CRON=true` skips execution entirely (pattern copied from `ATTRIBUTION_DISABLE_NIGHTLY_REFRESH`).
- Handler re-checks market hours at execution time (belt + suspenders: cron schedule is coarse, the gate is authoritative).

#### 4.1.1 Decouple from OutcomeTrackingService

`apps/api/src/markets/services/outcome-tracking.service.ts` currently calls `DayTraderRunnerService.runStrategies()` at the end of its 15-min tick (`outcome-tracking.service.ts:138-149`). Remove that invocation. `OutcomeTrackingService` continues to do its real job (refreshing daily bars + resolving horizon evaluations); strategy runs are now exclusively driven by the hourly cron.

#### 4.1.2 Market-hours gate

New helper `MarketHoursService.isUsEquityMarketOpen(now: Date): boolean`. Logic:
- Mon–Fri only (reject weekends).
- 14:30 UTC ≤ now < 21:00 UTC (9:30 AM ET – 4:00 PM ET, no DST awareness in v1 — we ship on standard market hours; DST drift fixed in a later effort).
- Env override: `DAY_TRADER_IGNORE_MARKET_HOURS=true` returns true unconditionally (for manual smoke tests outside market hours).
- No US market-holiday calendar in v1 (list maintenance is its own problem; acceptable to fire on holidays and have strategies no-op because bars won't refresh).

#### 4.1.3 Scoping: base vs. authored analysts

`DayTraderRunnerService.loadCandidateInstruments()` today (line 259) returns all `is_active=true` instruments regardless of analyst. Change the runner to load candidates **per portfolio**:

- Load the portfolio's owning analyst (`market_analysts.user_id`, `market_analysts.analyst_type`).
- If `analyst_type='day_trader'` and `user_id IS NULL` → **base** analyst → keep current behavior (all active instruments).
- If `analyst_type='day_trader'` and `user_id IS NOT NULL` → **authored** analyst → join `prediction.user_enabled_triples` on `(author_user_id = market_analysts.user_id, analyst_id = market_analysts.id, disabled_at IS NULL)` and return only those `instrument_id` values.
- If the authored analyst has zero enabled triples → no-op for that portfolio (log once).

Base-analyst behavior is untouched; the authored path is new.

### 4.2 Data Model Changes

#### 4.2.1 `instruments.current_state.intraday_bars` (JSONB field)

Piggyback on the existing `current_state` JSONB column. No DDL migration required; the field is added by the first writer and read defensively by the strategies (empty / missing → fall back to daily `recent_bars`).

Shape: `Bar[]`, matching the existing `RecentBar` type used elsewhere (`{ t, o, h, l, c, v }`). Hold last ~24 hourly bars (roughly 3 trading days of intraday history — enough for `LOOKBACK=20` on mean-reversion and momentum-breakout).

Constants in new file `apps/api/src/markets/constants.ts` (or co-located with `RECENT_BARS_CAP`):

```
export const INTRADAY_BARS_CAP = 24;
export const INTRADAY_BAR_INTERVAL = '1h';
```

#### 4.2.2 `market_day_trader_runs` audit table (new)

One row per cron fire. Lets us confirm the cron is actually running without grepping logs.

```
create table if not exists prediction.market_day_trader_runs (
  id text primary key default gen_random_uuid()::text,
  fired_at timestamptz not null default now(),
  market_open boolean not null,
  bars_refreshed int not null default 0,
  bars_refresh_failed int not null default 0,
  portfolios_run int not null default 0,
  opens_written int not null default 0,
  closes_written int not null default 0,
  duration_ms int not null default 0,
  error text
);
create index if not exists idx_day_trader_runs_fired_at on prediction.market_day_trader_runs (fired_at desc);
```

Added via `markets-schema.service.ts` DDL alongside other tables. Not exposed via API in v1; read directly in SQL for smoke tests.

#### 4.2.3 No changes to existing schema

`analyst_portfolios`, `analyst_positions`, `market_analysts`, `user_enabled_triples`, `instruments` table structures — all untouched. Changes are purely additive (new table, new JSONB field on an existing JSONB column).

### 4.3 New Service: `IntradayBarRefresherService`

`apps/api/src/markets/services/intraday-bar-refresher.service.ts`. Responsibilities:

- For a given set of instruments, fetch 1-hour OHLC bars via `TwelveDataAdapter` (extended — see 4.4).
- Write the bars into `instruments.current_state.intraday_bars` (last `INTRADAY_BARS_CAP` entries).
- Rate-limiting is handled inside the adapter (existing `RateLimiter(8)`); the refresher just iterates instruments serially.
- Per-instrument failures are caught and logged; other instruments continue. Returns `{ refreshed, failed }`.

Call-site: `DayTraderSchedulerService.handleCron()` invokes the refresher **once per cron tick, before** `DayTraderRunnerService.runStrategies()`. Refresher is idempotent — re-running mid-hour is safe (adapter cache short-circuits).

### 4.4 Adapter Extension

`TwelveDataAdapter.fetchIntradayBars(symbol: string, intervalMinutes: number, limit: number): Promise<Bar[]>` — new method.

- Endpoint: `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=1h&outputsize=${limit}&apikey=...`
- Parse Twelve Data's `values: [{ datetime, open, high, low, close, volume }]` into `Bar[]` (oldest-first, matching `recent_bars` ordering).
- Missing API key → return `[]` (same pattern as existing `fetchData`).
- Uses existing `this.limiter` and `this.cache` (900s TTL).
- Does **not** touch `fetchData()` (LLM-prompt text-sections path stays as-is).

### 4.5 Runner Changes

`DayTraderRunnerService.runStrategies()` — minimal surgery:

- Accept a per-portfolio candidate-instrument list (from the new scoping in 4.1.3) instead of a global one.
- `loadRecentBarsMap()` (line 287) — read `current_state.intraday_bars` first; if empty or `< LOOKBACK`, fall back to `current_state.recent_bars`. Strategies are bar-interval-agnostic by construction, so either works; this ensures we never starve a strategy with empty intraday data on day one.
- `loadCandidateInstruments()` signature changes to `loadCandidateInstruments(analyst: { id: string; user_id: string | null })`.

### 4.6 API Changes

One new admin endpoint:

- `POST /markets/admin/day-trader/run-now` — manually triggers `DayTraderSchedulerService.handleCron()`, bypassing the cron schedule (but not the market-hours gate unless `DAY_TRADER_IGNORE_MARKET_HOURS=true`). Returns the new `market_day_trader_runs` row. Admin-gated via the existing admin guard.

Used for smoke tests this weekend.

### 4.7 Frontend Changes

None. The day-trader leaderboard, analyst performance views, and existing PnL surfaces already read from `analyst_portfolios` / `analyst_positions` — they'll show the new PnL automatically.

## 5. Non-Functional Requirements

- **Rate-limit budget.** Twelve Data free tier = 8 req/min. At hourly cadence with N active instruments, total requests/hour = N (one `time_series` call per symbol). At N=30, that's 30 calls in ~4 minutes — well inside the 8/min ceiling when serialized.
- **No new cost.** All API calls hit free-tier endpoints; no pricing change.
- **No regressions** in `pnpm lint`, `pnpm build`, `pnpm ci:markets`, existing nightly evaluation, EOD settlement, conviction trader, or the 15-min outcome tracking tick (minus its day-trader hook).
- **Idempotent cron handler.** Firing it twice in the same hour must produce the same final state (bars get cache-hit, strategies re-evaluate but skip held instruments).
- **Graceful degradation.** If Twelve Data is down (network error, rate-limit exceeded, missing API key), the refresher logs failures and the runner falls back to daily `recent_bars`. Day-trader PnL generation may be weaker that day, but nothing crashes.

## 6. Out of Scope

- **Strategy logic changes.** Entry/exit rules, conviction modifier, EOD force-close — all preserved exactly.
- **Numerical RSI/MACD/BBands indicator wiring.** The existing Twelve Data adapter has indicator endpoints for LLM-prompt text use, but none of the three strategies consume them. A follow-up effort can add `current_state.intraday_indicators` if/when an authored strategy wants them.
- **Intraday bars for non-day-trader analysts.** Predictor generation, prediction generation, audit, nightly evaluation — all continue to see daily `recent_bars` only.
- **DST-aware market hours.** v1 ships on standard-time UTC offsets (14:30–21:00 UTC). DST drift during EDT periods is accepted; a follow-up can add a calendar.
- **US market-holiday calendar.** Accepted that the cron fires on holidays; strategies no-op because bars don't refresh.
- **New data adapters.** FMP, Finnhub, FRED, Reddit, SEC EDGAR, Polygon intraday — untouched in this effort.
- **ConvictionTraderService changes.** The prediction-side auto-trade path (`≥70%` confidence) is correct as-is and unrelated.
- **Onboarding or UI for authored day-trader analysts.** Zero exist today. This effort only ensures the runner does the right thing when one appears.
- **Overnight positions.** EOD flat-close at 22:00 UTC stays.
- **Frontend changes.** The existing dashboards surface the new PnL automatically.

## 7. Dependencies & Risks

Dependencies (all met):
- `TwelveDataAdapter` wired and tested against Twelve Data free tier ✅ (`apps/api/src/markets/adapters/twelve-data.adapter.ts`)
- `DayTraderRunnerService` wired with strategies ✅ (`apps/api/src/markets/services/day-trader-runner.service.ts`)
- `prediction.user_enabled_triples` schema exists ✅ (from `slot-based-enablement-ui`)
- Base day-trader analysts seeded ✅ (`market_analysts` rows for momentum-breakout / mean-reversion / gap-and-go)
- Base day-trader portfolios seeded ✅ (`analyst_portfolios` rows with `kind='day_trader'`)
- EOD flat-close service ✅ (`eod-settlement.service.ts`)

Risks:

- **R1: Twelve Data free tier can't keep up.** 8 req/min ceiling; 30 instruments per hourly tick. *Mitigation:* rate limiter serializes, each call is <1s, 30 calls fits in ~4 minutes. Alert threshold: if `bars_refresh_failed / portfolios_run > 0.2` on any single run, log a warning. If demand outgrows the ceiling, the first move is increasing `DAY_TRADER_CRON` to every 2h, then caching across ticks, then paying for a tier bump.
- **R2: `gap-and-go` fires aggressively on hourly bars.** It was designed for 15-min bars, so hourly may be too coarse to catch morning gaps; or it may fire every hour of a trending day (once-per-session guard is in `state.daily_armed_date` — already enforced). *Mitigation:* the once-per-day guard is correct by construction; acceptable behavior. Review after weekend testing.
- **R3: Removing the 15-min invocation breaks something unseen.** `OutcomeTrackingService`'s day-trader call may be relied on by tests or side effects I don't see. *Mitigation:* unit tests cover the decoupling. Full `pnpm ci:markets` before merge.
- **R4: Authored-analyst scoping has no real test subject.** Zero authored day-trader analysts exist. *Mitigation:* unit tests with synthetic analyst rows cover both branches (`user_id IS NULL` and `user_id IS NOT NULL`).
- **R5: Intraday bars format drift.** If Twelve Data returns decimal strings or a different time format, the parser needs coercion. *Mitigation:* explicit `Number()` + `Number.isFinite` guards in the parser; bars that fail validation get skipped.

## 8. Phasing

**Phase 1 — Schema & Adapter**
- Add `market_day_trader_runs` DDL to `markets-schema.service.ts`.
- Add `fetchIntradayBars()` method to `TwelveDataAdapter`.
- Unit tests for adapter parse logic with fixture responses.
- Quality gate: lint + build + unit.

**Phase 2 — Core Services**
- Create `MarketHoursService`.
- Create `IntradayBarRefresherService`.
- Unit tests for both (market-hours edge cases; refresher success + failure paths).
- Quality gate: lint + build + unit.

**Phase 3 — Scheduler & Runner Changes**
- Create `DayTraderSchedulerService` with hourly cron, gate, kill-switch env.
- Modify `DayTraderRunnerService` to accept per-analyst candidate instruments and read `intraday_bars` first.
- Remove day-trader invocation from `OutcomeTrackingService.runTracking()`.
- Register all new providers (`DayTraderSchedulerService`, `IntradayBarRefresherService`, `MarketHoursService`) in `apps/api/src/markets/markets.module.ts`.
- Verify all new constructors use explicit `@Inject(ClassName)` per `CLAUDE.md` before running tests — missing `@Inject` annotations fail silently at runtime under `tsx`.
- Unit tests: base vs. authored scoping branches, intraday/daily fallback.
- Quality gate: lint + build + unit + curl for the new admin endpoint.

**Phase 4 — Admin Endpoint & Observability**
- Add `POST /markets/admin/day-trader/run-now`.
- Verify `market_day_trader_runs` rows write on each fire.
- Manual smoke test: run the admin endpoint, confirm `intraday_bars` populates, confirm runs table has a row.
- Quality gate: lint + build + unit + curl + admin-run smoke test.

**Phase 5 — Live Beta-Day Verification**
- On the next open market day, confirm cron fires hourly during 14:30–21:00 UTC.
- Confirm `analyst_positions` grows during the day, not just at EOD.
- Confirm at least one day-trader portfolio's `current_balance` diverges from $1M.
- Completion report with before/after balances and position counts.
