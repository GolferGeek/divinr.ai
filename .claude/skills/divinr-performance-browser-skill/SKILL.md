---
name: divinr-performance-browser-skill
description: Playwright + Chrome-MCP patterns for the Divinr performance facet. Covers the /performance dashboard (metrics, equity curve, PnL bar, analyst leaderboard), per-analyst performance, and the my/admin attribution surfaces.
allowed-tools: Read Write Edit Grep Glob Bash
---

# Divinr Performance Browser Skill

Deep skill for the `performance` facet. Always load `divinr-workflow-browser-skill` first.

## Routes

- `/performance` — main dashboard: metric cards, equity curve, PnL bar, analyst leaderboard
- `/analysts/:id/performance` — per-analyst calibration drilldown (uses `CalibrationScatter`)
- `/attribution/mine` — user-scoped attribution summary (sparkline SVG)
- `/attribution/admin` — admin attribution roll-up (segment tabs + filters)

## View files

- `apps/web/src/views/PerformanceDashboardView.vue`
- `apps/web/src/views/AnalystPerformanceView.vue`
- `apps/web/src/views/AttributionMineView.vue`
- `apps/web/src/views/AttributionAdminView.vue`

## Key components

- `EquityCurveChart` (also rendered inline as `<Line>` from `vue-chartjs` in the dashboard)
- `CalibrationChart` / `CalibrationScatter`
- `EquitySparkline`
- `RiskDimensionChart`
- `LegalDisclaimer` (short variant) on attribution surfaces

## Render model

The dashboard fetches `performance.store.fetchDashboard()` on mount and re-fetches when the
range segment (`1W`/`1M`/`3M`/`All`) changes. Until the dashboard payload arrives, the page
shows an `IonSpinner` in `.loading-state`. After arrival there are three branches:

1. `!has_portfolio` → `.empty-state` with "Portfolio will be created when you queue your first trade."
2. `equity_curve.length === 0` → `.no-data` text inside the equity-curve card.
3. populated → `<canvas>` from `vue-chartjs` inside `.chart-container` plus the leaderboard table.

The smoke spec must accept any of (canvas attached, `.no-data` visible, `.empty-state`
visible) as a pass.

## File map

- `what.md` — architecture narrative
- `where.md` — exact Playwright locators
- `expectations.md` — pass/fail invariants
- `tests.md` — numbered Playwright cases + Chrome-MCP exploratory section
- `completeness.md` — gaps + human demo script
