# Completeness — Performance facet

## What the smoke covers

- `/performance` route loads, heading renders.
- One terminal state (empty-state, no-data, or chart canvas) becomes visible.
- Vocabulary check inside `.performance-page` (excluding `<LegalDisclaimer>` + `[surface-key]` nodes).
- No 5xx from `divinr.ai` / `127.0.0.1:7100` / `127.0.0.1:7101`.
- Welcome modal dismissed via `dismissWelcomeModal(page)`.

## Known gaps (not yet automated)

1. **Range segment refetch** — clicking `1W` / `3M` / `All` should refetch the dashboard. Not asserted in smoke; covered manually via Chrome-MCP.
2. **Leaderboard navigation** — clicking a row should route to `/analysts/:id/performance`. Needs a populated leaderboard fixture.
3. **`/analysts/:id/performance`** — calibration drilldown view. Has its own vocabulary considerations (intentionally renders "predicted direction" domain copy in some fixtures); a dedicated spec with a narrower vocabulary scope (or a stricter element-list scope that excludes table headers) is needed.
4. **`/attribution/mine`** — sparkline rendering + GraduationSuggestionBanner gating not asserted.
5. **`/attribution/admin`** — five segment tabs + filter inputs not asserted.
6. **Equity-curve benchmark overlay** — SPY normalization logic not asserted.
7. **Empty-state copy strings** — exact wording not asserted; the smoke only tests the `.empty-state` element is visible.

## Human demo script (manual)

1. Log in as testing-team; navigate to `/performance`.
2. Verify heading, four metric cards (Portfolio Value, Realized PnL, Win Rate, Active Positions), equity-curve card, PnL bar, leaderboard table.
3. Click each range segment (`1W`, `1M`, `3M`, `All`) — confirm the network panel shows a new `/performance/dashboard?days=...` request and the chart re-renders.
4. Click any populated leaderboard row → confirm URL becomes `/analysts/<uuid>/performance` and the calibration scatter renders.
5. Navigate to `/attribution/mine` — confirm sparkline (if history exists) and disclaimer.
6. Navigate to `/attribution/admin` — switch through Triple / Analyst / Instrument / Source / Author tabs; tweak the year-month filter and re-fetch.

## Promotion criteria

A gap promotes into smoke when (a) the fixture is read-only against prod data, (b) the
selector is stable and labelled, and (c) the assertion has a clear pass/fail without
flakiness from async chart paint.
