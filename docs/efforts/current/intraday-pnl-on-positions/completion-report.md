# Intraday P&L on Positions — Completion Report

**Plan**: ./plan.md
**PRD**: ./prd.md
**Completed**: 2026-04-18
**Final Status**: All Phases Complete

## Summary
- Total phases: 4
- Phases completed: 4
- Phases remaining: 0

## Phase Results

### Phase 1: Bulk bars-latest endpoint (API) — Complete
Shipped `GET /markets/bars/latest?symbols=...` returning `{ [symbol]: bar | null }`. New `MarketsBarsService` (`getIntradayBarsForSymbols`) reads cached bars from `prediction.instruments.current_state.intraday_bars`; when the market is open and some symbols have empty bars, it triggers `IntradayBarRefresherService.refreshBarsFor()` for only the missing subset, then re-reads. Refresher errors are logged and absorbed (never 5xx). Symbol validation: `^[A-Z0-9.\-]{1,10}$/i`, uppercase + dedupe, ≤50 per request.

### Phase 2: Positions endpoint returns `intraday_pct` — Complete
`GET /portfolios/me/positions` now returns `today_open` and `intraday_pct` per row. Implementation:
- `UserPortfolioService` takes two new injected deps: `MarketsBarsService`, `MarketHoursService`.
- `enrichWithIntraday()` collects symbols from `status === 'open'` rows (single batch fetch), gates on `isUsEquityMarketOpen(now)`, and per row derives `today_open` from the first bar whose ET date equals today's ET date.
- Null semantics: closed market → both null; non-open row → both null; no today-bar → both null; `today_open <= 0` → pct null (preserves open value); null/NaN `current_price` → pct null.
- One bar fetch per request regardless of row count.

Notable fix surfaced by unit tests: `Number(null) === 0` is finite; added an explicit `rawPrice == null` guard before `Number.isFinite` to stop null prices silently producing `intraday_pct = -1`.

### Phase 3: MY POSITIONS intraday segment (web) — Complete
- Extracted `colorClass()` into `apps/web/src/utils/colorClass.ts`.
- `TournamentDetailView.vue` kept its `isPreSprint()` zero-blank branch via a thin local wrapper around the shared helper; no visual change.
- `PortfolioDashboardView.vue` imports `colorClass`, adds a `| Today: X.XX%` / `| Today: —` segment inside the existing `<p>` block for user open positions, and colocates `.positive/.negative/.neutral` in its scoped style.

### Phase 4: Validation & effort close — Complete
All repo-wide gates run. Only pre-existing failures remain (confirmed identical on main).

## Gate Results

| Gate | Phase 1 | Phase 2 | Phase 3 | Phase 4 (full repo) |
|------|---------|---------|---------|---------------------|
| Lint | clean | clean | clean | clean |
| Build | clean | clean | clean | clean |
| Typecheck | clean | clean | pre-existing DOM errors only, none new | — |
| Unit tests | 45 new assertions pass | 24 new assertions pass; full API suite clean | web stub pass | full API unit suite clean |
| E2E / smoke | pre-existing deadlock | pre-existing deadlock | n/a | pre-existing deadlock |
| Curl | covered by unit | covered by unit | n/a | deferred to live validation |
| Chrome | n/a | n/a | deferred to live validation | deferred to live validation |

**Pre-existing failures** (all confirmed identical on `main` via stash round-trip; out of scope for this effort):
- `pnpm --filter @divinr/api run test:markets:smoke` — `Schema creation failed: deadlock detected` in `MarketsSchemaService.ensureSchema` during local Supabase setup.
- `pnpm --filter @orchestrator-ai/transport-types test` — `Cannot find module 'jest/bin/jest.js'` (missing jest install in that package).
- `pnpm --filter @divinr/api run test:compliance` — assertion `11 !== 1` in compliance runner (unrelated to portfolios).
- Web typecheck — DOM lib types (`document`, `window`, `alert`, `confirm`, `HTMLSelectElement`, `HTMLElement`) missing from the vue-tsc config in 10+ files.

## Deviations from PRD

1. **Step 3.3** originally instructed extending a `Position` interface in `portfolio.store.ts`. That store uses `Record<string, unknown>` for position rows; no typed interface exists to extend. The new fields flow through the generic record shape without code changes. No runtime or type-safety regression. Documented inline in the plan.
2. **Phase 3 Chrome tests** deferred to post-merge live validation (per the long-session-ergonomics memory: UI tests belong in a fresh context, not bolted onto a long backend session). Plan marked accordingly.

## Scope Delivered vs PRD §2 Success Criteria

- [x] Intraday % visible on every equity row during market hours — template segment + shared `colorClass` wired.
- [x] One client→server round-trip per positions poll — bar fetch inlined into `listPositions`; verified by "bars fetched once for AAPL" assertion.
- [x] Closed-market state visually distinct (`—`) — `v-else` branch renders em dash when `intraday_pct == null`.
- [x] Bulk endpoint available and auth-protected — `GET /markets/bars/latest` uses the standard middleware path; unit test covers missing-user → `BadRequestException`.
- [x] Null semantics correct for stale/unavailable data — 24 intraday assertions lock in every edge case (closed market, closed position, no bars, non-today bars, zero/negative open, null/NaN price).

## Files Touched

**New**:
- `apps/api/src/markets/services/markets-bars.service.ts`
- `apps/api/tests/unit/markets-bars-service.test.ts`
- `apps/api/tests/unit/markets-bars-controller.test.ts`
- `apps/api/tests/unit/user-portfolio-intraday.test.ts`
- `apps/web/src/utils/colorClass.ts`
- `docs/efforts/current/intraday-pnl-on-positions/{prd,plan,completion-report}.md`

**Modified**:
- `apps/api/src/markets/markets.module.ts` — registered `MarketsBarsService`.
- `apps/api/src/markets/markets.controller.ts` — added `GET /markets/bars/latest`, `parseSymbolsParam()` helper.
- `apps/api/src/markets/services/user-portfolio.service.ts` — injected `MarketsBarsService` + `MarketHoursService`, added `enrichWithIntraday` / `deriveTodayOpen` / ET-date helpers, wired into `listPositions`.
- `apps/api/tests/unit/day-trader-admin-endpoint.test.ts` — added `MarketsBarsService` slot in controller positional-arg list.
- `apps/api/tests/unit/user-portfolio-immediate.test.ts` — added stubs for bars + market-hours to the `UserPortfolioService` constructor.
- `apps/api/package.json` — chained 3 new unit tests into `test:unit`.
- `apps/web/src/views/TournamentDetailView.vue` — imports shared helper; local wrapper preserves `isPreSprint()` zero-blank behavior.
- `apps/web/src/views/PortfolioDashboardView.vue` — imports `colorClass`, appends intraday segment, adds scoped `.positive/.negative/.neutral`.

## Tests Added
- `apps/api/tests/unit/markets-bars-service.test.ts` — 27 assertions.
- `apps/api/tests/unit/markets-bars-controller.test.ts` — 18 assertions.
- `apps/api/tests/unit/user-portfolio-intraday.test.ts` — 24 assertions.
- DI decorator assertions baked into every new test (CLAUDE.md `@Inject(ClassName)` rule).

## Next Steps
- Golden-path browser walkthrough after merge:
  - With `DAY_TRADER_IGNORE_MARKET_HOURS=true`, an open user position should show `Today: X.XX%` colored green/red/neutral.
  - With the env flag off outside market hours, every user open position should show `Today: —`.
  - Tournament leaderboard coloring should be unchanged.
- Follow-ups explicitly out of scope (per PRD §6; no change):
  - US holiday calendar (`isUsEquityMarketOpen` still returns `true` on holidays; `today_open` then nulls out naturally because no today-bar exists, but the flag itself is imprecise).
  - Websocket streaming for sub-15-min freshness.
  - Retroactive `today_open` for positions opened before today.
