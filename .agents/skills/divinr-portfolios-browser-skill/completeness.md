# Completeness — Portfolios facet

## What the smoke covers

- `/portfolios` route loads without redirect to `/login`.
- `<h1>Portfolios</h1>` heading renders within 10s.
- A `.portfolio-row` is visible OR the `No portfolios yet.` whole-page empty note is visible.
- Vocabulary check outside `<LegalDisclaimer>` / `[surface-key]` regions (no `prediction*`, `recommendation`, `advice`).
- No 5xx responses from `divinr.ai` / `127.0.0.1:7100` / `127.0.0.1:7101`.

## Known gaps (not yet automated)

1. **Segment tab switching** — `mine` → `analysts` → `triples` tab transitions and their per-tab content (kind chips, AddTripleFlow, triples list). Smoke is read-only and stays on the default `mine` tab.
2. **Row expansion** — clicking a `.portfolio-row` toggles the expanded detail panel; not exercised in smoke.
3. **Search and filter** — `[data-testid="portfolio-search"]` typing, kind chips, sort select, sort-direction chip; none asserted.
4. **Auto-expanded user row content** — Account cards, Queued Trades list, Decisions list, position `Sell` button (canWrite path).
5. **Charts** — `EquityCurveChart`, `CalibrationChart` rendering; no canvas/data assertions.
6. **Triples tab** — `AddTripleFlow` open → pick instrument → enable triples → disable triple. Needs deterministic instrument fixtures.
7. **Calibration link → analyst performance route** — anchor to `/analysts/:id/performance` not exercised.
8. **Reference-levels copy** — informational `5% stop / 10% stop / 8% trail` line under user open positions; not asserted.
9. **Sell action** — closing a user position; would mutate prod state, deferred to a fixture-backed harness.

## Human demo script (manual)

1. Log in as testing-team; navigate to `/portfolios`.
2. Verify heading `Portfolios` and three segment tabs: `My Portfolio`, `Analyst Portfolios`, `My Triples`.
3. On the default `My Portfolio` tab, confirm the user's own row is auto-expanded showing Account cards, Equity Curve chart, Positions list (or `No positions in last 30 days.`), Queued Trades section, and Decisions section.
4. Click the user row to collapse it. Click again to re-expand.
5. Switch to `Analyst Portfolios`. Confirm kind chips show `user / analyst / arbitrator / day_trader`, with `analyst`, `arbitrator`, `day_trader` active by default.
6. Type a partial analyst name into the search box; confirm rows filter live.
7. Pick `Sort: Return`; toggle the direction chip between `High to Low` and `Low to High`. Confirm row order changes within each group.
8. Click an analyst row and verify the expanded panel shows secondary metrics, Equity Curve, and Calibration chart.
9. Click the Calibration percentage link; confirm navigation to `/analysts/:id/performance`.
10. Switch to `My Triples`. Confirm either the empty-state note or grouped instrument-analyst triples and the `AddTripleFlow` button.

## Promotion criteria

To promote a gap into the smoke spec, the fixture must be either: (a) idempotent against prod data (read-only), or (b) backed by a dedicated seed fixture in the `testing-team` scope that no human user touches. Anything that creates / cancels trades or enables / disables triples must run against a non-prod backend.
