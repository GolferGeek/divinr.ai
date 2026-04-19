---
name: divinr-predictions-browser-skill
description: Playwright + Chrome-MCP patterns for the Divinr predictions (analyses) facet. Covers the /predictions list, role filter, reasoning/detail inspection, and the trade-CTA hand-off to tournaments.
allowed-tools: Read Write Edit Grep Glob Bash
---

# Divinr Predictions Browser Skill

Deep skill for the `predictions` facet. Always load `divinr-workflow-browser-skill` first for the shared Playwright/Chrome-MCP patterns and `assertions.md` invariants.

## Facet summary

- Route: `/predictions`
- View: `apps/web/src/views/PredictionsView.vue`
- Capability slug: `predictions`
- Playwright project: `predictions`

## Key components / patterns

- `IonList` + `IonItem` per prediction — no tabular grid
- `IonSelect` role filter: All / Analysts Only / Arbitrator Only
- Direction chip: `up` (success), `down` (danger), neutral (medium)
- Confidence shown as `NN%` in the subhead
- First-touch panel on first visit: `<FirstTouchPanel surface-key="predictions">`

## Trade-CTA hand-off

Clicking a prediction's trade action (when present) navigates to the active tournament's trade form. That flow is owned by `divinr-tournaments-browser-skill/`; this skill validates only the origin — the click-target resolves to a non-404 route within 3 s.

## API endpoints exercised

- `GET /predictions?role=<role>` — list the analyses. Role values: `all`, `analyst`, `arbitrator`.
- `GET /markets/predictions/dashboard` — dashboard aggregate (loaded from `DashboardView.vue` on the home route).

## File map

- `what.md` — architecture narrative of the facet
- `where.md` — exact Playwright locators per action
- `expectations.md` — pass/fail invariants (what the spec must assert)
- `tests.md` — numbered Playwright cases + secondary Chrome-MCP exploratory section
- `completeness.md` — known coverage gaps + human demo script
