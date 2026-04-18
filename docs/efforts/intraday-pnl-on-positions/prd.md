# Intraday P&L on Positions — Product Requirements Document

## 1. Overview
PR #58 shipped the MY POSITIONS table with entry price + current price columns but deferred the intraday % move column. The blocker was architectural: the single‑symbol bars path (`TwelveDataAdapter.fetchIntradayBars`) would produce N+1 requests per poll, and Twelve Data is rate‑limited to 8 req/min.

This effort closes that gap in two parts:
1. A **bulk** bars‑latest endpoint keyed by symbol that reads the already‑cached `prediction.instruments.current_state.intraday_bars` and falls back to a batched refresh only when needed.
2. An **intraday %** column on MY POSITIONS rendered with the shared `colorClass()` helper, with a distinct closed‑market state so users never see a stale number.

## 2. Goals & Success Criteria

### Goals
- Give day‑trader users the single number they check most often ("is today green or red for this position?") without leaving the positions view.
- Establish a reusable bulk bars endpoint the rest of the app can consume (autotrade UI, tournaments, dashboards).
- Avoid N+1 behavior regardless of how many positions a user holds.

### Success Criteria
- MY POSITIONS renders an intraday % cell on every equity row during US‑equity market hours.
- Polling the positions view with N positions produces **≤ 1 bounded API round‑trip per poll** (positions response carries `intraday_pct` inline; no per‑symbol fan‑out from the web).
- When US‑equity markets are closed (weekends, holidays, outside 09:30–16:00 ET) the intraday % cell shows `—`, not a stale or zero value.
- `GET /markets/bars/latest?symbols=A,B,C` returns a single JSON payload keyed by symbol, includes every requested symbol (value or `null`), and issues **at most one** upstream call per uncached symbol per cache TTL.
- All new constructor params use the `@Inject(ClassName)` convention (per CLAUDE.md); nothing dies at runtime under `tsx`.
- Unit + integration tests pass; `pnpm test` and `pnpm lint` clean.

## 3. User Stories / Use Cases

1. **Day‑trader checking the tape** — As an active user with 5+ open positions, I expand my portfolio card and instantly see which positions are green vs red today, color‑coded, without scrolling into per‑row detail.
2. **Off‑hours review** — As a user opening the app at 7pm ET, I see `—` in the intraday % cell so I know the value isn't live, rather than a misleading 0.00% or yesterday's final number.
3. **Weekend planning** — As a user opening the app Saturday, intraday % reads `—`; entry and current price columns are unaffected.
4. **Future bulk quote consumer** — As a future feature author (e.g., autotrade dashboard), I can call `GET /markets/bars/latest?symbols=...` and receive a single response keyed by symbol instead of fanning out.

## 4. Technical Requirements

### 4.1 Architecture

Existing primitives we reuse:
- `apps/api/src/markets/adapters/twelve-data.adapter.ts:102` — `fetchIntradayBars(symbol, 60, limit)` returning `IntradayBar[]` (`{t,o,h,l,c,v}`). Single‑symbol, cache‑wrapped (15‑min TTL), rate‑limited (8 req/min).
- `apps/api/src/markets/services/intraday-bar-refresher.service.ts` — `refreshBarsFor(instruments)` serially fetches bars and persists them to `prediction.instruments.current_state.intraday_bars` (JSONB).
- `apps/api/src/markets/services/market-hours.service.ts` — `isUsEquityMarketOpen(now)`; handles weekends, ET 09:30–16:00 window with DST via `Intl.DateTimeFormat`, and the `DAY_TRADER_IGNORE_MARKET_HOURS` env override. (Note: holiday calendar is not currently modeled; on a US market holiday the service reports "open" if it's a weekday in the window. That inherited behavior is out of scope for this effort.)
- `apps/api/src/markets/services/user-portfolio.service.ts:298` — `listPositions(userId, status?)` returns rows from `prediction.user_positions`.

Existing data we read:
- `prediction.instruments.current_state` (JSONB). Keys already written include `price` / `last_price` (by the existing price refresher) and `intraday_bars` (by `IntradayBarRefresherService`). We add no new columns.

New service boundary: `MarketsBarsService` (thin read‑through service)
- Lives at `apps/api/src/markets/services/markets-bars.service.ts`.
- Method `getIntradayBarsForSymbols(symbols: string[]): Promise<Map<string, IntradayBar[]>>` — returns the full cached day's bars per symbol (empty array when no data; never `null`).
- Strategy: batch‑read `intraday_bars` from `prediction.instruments` for the requested symbols → any symbol with an empty array AND market is open triggers a refresh via `IntradayBarRefresherService.refreshBarsFor([...missing])` (the existing loop is already serial — `intraday-bar-refresher.service.ts:26` — and gated by the adapter's rate limiter at `twelve-data.adapter.ts:125`) → re‑read → return map.
- Callers pick what they need:
  - The bulk bars controller picks the **last element** of each array (oldest‑first ordering per `twelve-data.adapter.ts:160`) and serializes it as the "latest bar".
  - The positions enricher picks the **first bar whose `t` is today in ET** for `today_open`, and the last element for "current close" reference if needed. Twelve Data 1h bars for US equities start at 9:30 ET, so today's first bar's `o` is the day's open.
- When market is closed, the service does not trigger a refresh; callers see whatever is cached (positions endpoint will null out `intraday_pct` in that state).

Controller route:
- `GET /markets/bars/latest?symbols=A,B,C` in `apps/api/src/markets/markets.controller.ts`.
- Auth: `@UseGuards(JwtAuthGuard)` (class‑level guard already in place).
- Validates: `symbols` required, comma‑separated, 1–50 symbols, uppercased, dedupes.
- Response shape: `{ [symbol: string]: { t: string, o: number, h: number, l: number, c: number, v: number } | null }`.
- Errors: `400` on empty / oversize / malformed `symbols`; upstream failures yield `null` entries, not a 5xx.

Positions enrichment:
- `UserPortfolioService.listPositions` gains a second step after the primary SELECT:
  1. Collect distinct symbols from rows whose `status === 'open'`.
  2. Call `MarketsBarsService.getIntradayBarsForSymbols(symbols)` (skip entirely when no open rows — closed positions get `intraday_pct: null`).
  3. For each open row: if the market is closed, if the symbol has no bars, or if no bar's `t` matches today's ET date → `today_open: null, intraday_pct: null`.
  4. Otherwise `today_open` = the first today‑bar's `o`, and `intraday_pct = (Number(current_price) - today_open) / today_open`. Guard against `today_open <= 0` and non‑finite `current_price` (both → `null`).
- Keeps the method backwards‑compatible: callers that don't read `today_open` / `intraday_pct` are unaffected.

### 4.2 Data Model Changes

**None.** All work reads existing columns:
- `prediction.instruments.current_state.intraday_bars` (already populated by `IntradayBarRefresherService`).
- `prediction.user_positions.symbol`, `current_price`, `status`.

No migrations, no new tables, no new columns.

### 4.3 API Changes

#### New endpoint — `GET /markets/bars/latest`

Query params:
| name | required | shape |
|---|---|---|
| `symbols` | yes | Comma‑separated. 1–50 tickers. Case‑insensitive; server uppercases and dedupes. |

Response `200`:
```json
{
  "AAPL": { "t": "2026-04-18 15:30:00", "o": 210.50, "h": 211.20, "l": 210.10, "c": 210.90, "v": 125000 },
  "NVDA": null
}
```

Errors:
- `400 Bad Request` — missing/empty `symbols`, >50 entries, or non‑alnum ticker.
- `401 Unauthorized` — JWT missing/invalid.
- Upstream provider failure for a specific symbol → that symbol's value is `null`, request still returns `200`.

Behavior:
- Reads `prediction.instruments.current_state.intraday_bars`.
- On missing bars *and* market open, triggers `IntradayBarRefresherService.refreshBarsFor(...)` for the missing subset; resolves before responding. Bounded latency: serial fan‑out gated by Twelve Data's 8 req/min limiter.
- When market is closed: does **not** trigger refresh; returns cached bars (may be stale — this is expected; positions endpoint is the one that nulls `intraday_pct` in closed state).

#### Modified endpoint — `GET /portfolios/me/positions`

No shape breakage. New fields added per row (for positions the service can compute; other rows see `null`):
- `today_open`: `number | null` — today's first 1h bar open, ET timezone.
- `intraday_pct`: `number | null` — `(current_price - today_open) / today_open`. `null` if market is closed, no today bar, `today_open <= 0`, or `current_price` unusable.

The rest of the row is unchanged.

### 4.4 Frontend Changes

#### Shared helper
Extract `colorClass(v)` from `apps/web/src/views/TournamentDetailView.vue:20` into `apps/web/src/utils/colorClass.ts` and import from both sites. The `isPreSprint()` branch is tournament‑specific — the extracted helper takes the full `v == null → '' ; v>0 → 'positive'; v<0 → 'negative'; v===0 → 'neutral'` rule and keeps the pre‑sprint zero‑exception inside the tournament view (either wrap the call or inline the guard there).

#### MY POSITIONS
File: `apps/web/src/views/PortfolioDashboardView.vue` (the `ion-item` block at lines ~455–476 inside the expanded `p.kind === 'user'` portfolio panel).

Layout note: the current positions UI uses `ion-list` + `ion-item` with an `<h3>` and a `<p>` of pipe‑separated segments — **not** a grid/table with discrete columns. So "add the intraday % column" from the intention translates to "add an intraday % **segment** in the existing layout", not a grid restructure. This preserves the existing sticky/overflow behavior trivially (nothing table‑like to break).

Change:
- In the `<p>` that currently reads `Qty: ... | Entry: ... | Exit: ... | Unrealized: ...`, append a segment `Today: <span class="colorClass(...)">X.XX%</span>` when `pos.intraday_pct != null`, and `Today: —` when `null`.
- Use the extracted `colorClass(pos.intraday_pct)` (not `isPreSprint()` — that branch is tournament‑specific and does not apply to live trading positions; a zero move should render `neutral` here).
- The `.positive`, `.negative`, `.neutral` classes are already styled at the tournament‑view scope. If those styles are not globally reachable, co‑locate a copy in `PortfolioDashboardView.vue`'s `<style>` block rather than promoting them to global.

Polling:
- No new timer. `fetchMyPositions()` already runs on‑mount and after trade actions (`apps/web/src/stores/portfolio.store.ts:71`). Since `intraday_pct` is returned inline, the existing refresh path covers it.

TypeScript:
- Extend the position row type in `portfolio.store.ts` (and any Vue `Position` type) with `today_open?: number | null` and `intraday_pct?: number | null` so TS stays clean.

### 4.5 Infrastructure Requirements

- **None new.** Twelve Data API key is already configured (`TWELVE_DATA_API_KEY`).
- Respect the existing `DAY_TRADER_IGNORE_MARKET_HOURS` env override — tests that fake market hours continue to work.
- The existing `DataCache` 15‑min TTL inside the Twelve Data adapter is the effective refresh cadence for intraday bars. No tuning needed.

## 5. Non‑Functional Requirements

### Performance
- Positions endpoint: **O(1)** upstream calls per poll for an all‑cached symbol set; **O(k)** serial upstream calls where `k` = symbols with missing today‑bars and market is open. `k` is bounded by the user's distinct open‑position symbols (typically <10).
- Bulk bars endpoint: same bounds. Response size ≤ ~20KB for 50 symbols.
- Web: no new render cost; appending one inline `<span>` per row.

### Security
- Both endpoints protected by `JwtAuthGuard` (class‑level on `MarketsController`).
- Symbol param validated — reject any non‑`[A-Z0-9.-]{1,10}` entry to prevent injection into downstream URLs and DB queries.
- No PII in bar data.

### Scalability
- Bulk endpoint is a pure DB read when cached; scales with Supabase read capacity.
- Serial upstream refresh is bounded by the existing Twelve Data rate limiter. First user of the day for a given symbol pays the refresh cost; subsequent requests within TTL hit cache.

### Compatibility
- Additive change only. No breaking changes to `GET /portfolios/me/positions` (extra fields are ignored by unaware clients).
- `@Inject(ClassName)` DI convention applied to every new constructor param.
- No change to DB schema → no migration rollout concerns.

## 6. Out of Scope

- Real‑time / WebSocket price streaming (deferred).
- Intraday P&L on tournament leaderboards (tracked separately).
- Options Greeks / options intraday %.
- Closing the Twelve Data dependency or introducing a new market‑data provider.
- A dedicated polling timer on MY POSITIONS (existing cadence is sufficient).
- Persisting `today_open` or `intraday_pct` in the DB — these are computed on read.
- Backfilling historical intraday % for closed positions.

## 7. Dependencies & Risks

### Dependencies
- Twelve Data free tier (8 req/min) is the upstream bar source. Already integrated.
- `IntradayBarRefresherService` already writes `current_state.intraday_bars` — but only for symbols the day‑trader watches. User‑held symbols outside that set will have no cached bars until the bulk endpoint triggers a refresh for them.

### Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| First poll after login for a symbol outside the day‑trader watchlist stalls on upstream fetch (8 req/min limiter) | Slow first render for that row | Fetch is serial but bounded by user's symbol count. We do **not** block the positions response on refresh failures — return `null` for that symbol, render `—`, next poll retries. |
| `intraday_bars` cache stale past today's open (first bar timestamp is yesterday's) | Wrong `today_open` used, misleading % | `MarketsBarsService` must select the first bar **whose `t` is on today's ET date**; if no such bar exists, treat as missing and trigger refresh. |
| Timezone drift between server TZ and ET | Off‑by‑one‑day on `today_open` near midnight ET | Use `MarketHoursService`'s existing ET date derivation; never rely on `Date.getUTCDate()`. |
| DI failure under `tsx` because a new param lacks `@Inject` | Runtime crash on first request | CLAUDE.md is explicit; plan's quality gate includes grep for constructor params missing `@Inject`. |
| Extracting `colorClass()` breaks the tournament view's `isPreSprint()` zero‑exception | Tournament rows render wrong color at sprint start | Keep `isPreSprint()` branch inside the tournament view (wrap the call) — the extracted helper is strictly the sign→class map. |
| Twelve Data returns an empty array or errors upstream | Null bars surface as `—` | Already handled by adapter (returns `[]`); service treats `[]` as "no today bar" → `null` propagates cleanly. |

## 8. Phasing

Four phases. Each is independently validatable and includes its own quality gate.

### Phase 1 — Bulk bars endpoint (API only)

**Deliverables:**
- New `MarketsBarsService` at `apps/api/src/markets/services/markets-bars.service.ts` with `getLatestBarsForSymbols(symbols)`.
- New route `GET /markets/bars/latest` on `MarketsController`.
- Wiring in `markets.module.ts`.
- Unit tests: service resolves cached, uncached‑market‑open, uncached‑market‑closed, malformed symbol list, upstream failure → `null`.
- Integration test (via existing Nest test harness pattern) hitting the controller with a mocked refresher.

**Validation:** `pnpm test` + `pnpm lint` pass; manual curl against dev API returns expected shape.

### Phase 2 — Positions endpoint returns `intraday_pct`

**Deliverables:**
- Extend `UserPortfolioService.listPositions` to enrich rows with `today_open` and `intraday_pct`.
- Unit tests covering: market open + today bar present, market open + no today bar, market closed, invalid `today_open` (0 / negative), closed position.
- Regression test: existing callers that don't read the new fields behave unchanged.

**Validation:** `pnpm test` + `pnpm lint` pass; hand‑check positions response shape via authenticated curl.

### Phase 3 — MY POSITIONS column on web

**Deliverables:**
- Extract `colorClass(v)` into `apps/web/src/utils/colorClass.ts`; update imports in `TournamentDetailView.vue` and `PortfolioDashboardView.vue`.
- Render `Today: <intraday_pct>%` / `Today: —` in the user positions block of `PortfolioDashboardView.vue`.
- Update `portfolio.store.ts` types.

**Validation:** `pnpm --filter @orchestratorai/web typecheck`, `pnpm --filter @orchestratorai/web build`; smoke‑test in browser (dev server on port 7101 / API on 7100) during market hours and simulated closed hours (`DAY_TRADER_IGNORE_MARKET_HOURS=false` + fake time).

### Phase 4 — Validation & effort close

**Deliverables:**
- Full `pnpm test` + `pnpm lint` from repo root, green.
- Manual golden‑path walkthrough: log in, expand user portfolio, confirm `Today: X.XX%` during market hours, `Today: —` outside.
- Completion report (`docs/efforts/current/intraday-pnl-on-positions/completion-report.md`).
- Commit + push via `commit-push` skill; CI green.

**Validation:** PR opened and `pr-eval` passes.
