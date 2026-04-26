---
name: divinr-instruments-browser-skill
description: Playwright + Chrome-MCP patterns for the Divinr instruments facet. Covers the /instruments grid, the Add Instrument modal, the /instruments/:id detail with Analysts vs AI Scoring tabs, the Arbitrator Synthesis card, and the per-analyst InstrumentAnalystPanel debate cards.
allowed-tools: Read Write Edit Grep Glob Bash
---

# Divinr Instruments Browser Skill

Deep skill for the `instruments` facet. Always load `divinr-workflow-browser-skill` first.

## Routes

- `/instruments` — grid of instruments (cards, one per symbol)
- `/instruments/:id` — detail view with two segment tabs (`analysts`, `predictors`)
- `/instruments/:id/contract` — author/edit instrument contract (admin/canWrite only)

## View files

- `apps/web/src/views/InstrumentsView.vue`
- `apps/web/src/views/InstrumentDetailView.vue`

## Key components

- `IonCard` instrument tiles with `IonCardTitle` (symbol) + `IonCardSubtitle` (name) and a per-field row driven by `domain.instrumentCardFields` (Symbol / Price / Change / Direction / Confidence)
- `Add Instrument` button + `IonModal` create form (symbol regex `/^[A-Z.]{1,10}$/`, name optional)
- Detail header: `<h1>{{ symbol }}</h1>` + `<p>{{ name }}</p>` + optional `Edit Contract` (canWrite)
- `TripleVariantSwitcher` — query-param-driven analyst-scoped variant selector at the top of the detail page
- `IonSegment` tab bar on detail (values: `analysts`, `predictors`)
- `Arbitrator Synthesis` `IonCard` (`data-tour="arbitrator-synthesis"`) — composite signal + composite risk
- Per-analyst debate cards rendered by `InstrumentAnalystPanel` inside `data-tour="analyst-panel"` (Latest Signal / Latest Risk View / View history toggle)
- `PredictorScoringPanel` on the AI Scoring tab
- `FirstTouchPanel surface-key="instruments"` (list) and `surface-key="instrument.detail"` (detail)

## Vocabulary risk hot spots

The detail page renders **LLM-authored rationale strings** (`prediction.rationale`, `risk.rationale`) directly into the InstrumentAnalystPanel. AGENTS.md forbids `prediction|advice|recommendation` in user-visible copy outside `<LegalDisclaimer>`. Because rationale strings are model-authored, they may legitimately leak the forbidden vocabulary. Treat that leak as a real bug, not a test bug — see `completeness.md`.

The list page (`/instruments`) is safe today: `domain.instrumentCardFields` labels are `Symbol`, `Price`, `Change`, `Direction`, `Confidence`. The smoke spec scopes its vocabulary check to the list page only.

## File map

- `what.md` — architecture narrative
- `where.md` — exact Playwright locators
- `expectations.md` — pass/fail invariants
- `tests.md` — numbered Playwright cases + Chrome-MCP exploratory section
- `completeness.md` — gaps + human demo script
