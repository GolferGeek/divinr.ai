---
name: divinr-analysts-browser-skill
description: Playwright + Chrome-MCP patterns for the Divinr analysts facet. Covers the /analysts grid, the per-analyst performance / calibration view, and the contract editor with version history + diff + rollback.
allowed-tools: Read Write Edit Grep Glob Bash
---

# Divinr Analysts Browser Skill

Deep skill for the `analysts` facet. Always load `divinr-workflow-browser-skill` first for the shared Playwright/Chrome-MCP patterns and `assertions.md` invariants.

## Facet summary

- Routes:
  - `/analysts` — grid of analyst cards (system defaults + user-created)
  - `/analysts/:id/performance` — calibration metrics, per-instrument breakdown, resolved analyses with reasoning drilldown
  - `/analysts/:id/contract` — markdown contract viewer with version history, diff, rollback, edit
- Capability slug: `analysts`
- Playwright project: `analysts`

## Key views / components

- `AnalystsView.vue` — `IonGrid` of `IonCard`s. Each card: display name, type/weight/scope subtitle, persona excerpt, Contract + Performance buttons, optional Default / Disabled chips, optional enable toggle (admin/owner). `<FirstTouchPanel surface-key="analysts" />` mounted at the bottom.
- `AnalystPerformanceView.vue` — heading `{name} -- Performance`, persona/status/tier-instructions cards, `Calibration` section with four headline tiles (Accuracy / Avg Confidence / Calibration Score / Sample Size), per-instrument table, `CalibrationScatter` (lazy), and an inline-expandable list of resolved analyses with rationale + lazy-loaded LLM reasoning (`GET /predictions/:id/llm-calls`). `<FirstTouchPanel surface-key="analyst.detail" />`.
- `ContractEditorView.vue` — heading `{name} — Contract`, three modes: viewer / edit (textarea) / diff (two-column LCS-ish line diff). Version history list with `versionNumber`, source chip, ACTIVE marker. Rollback button. `<FirstTouchPanel surface-key="analyst.contract-viewer" />`.

## Vocabulary notes

- `AnalystPerformanceView.vue` uses the heading "Resolved Analyses" and section name "Calibration" — vocab compliant. Inline copy uses "analysis" / "Projected" rather than "predicted." (Variable names like `predictedDirection`, `resolvedPredictions`, `predictionId` and the API path `/predictions/:id/llm-calls` are code identifiers and exempt per AGENTS.md.)
- The contract editor has no inline `<LegalDisclaimer>`; the disclaimer lives at the parent dashboard level.

## API endpoints exercised

- `GET /analysts` — list
- `POST /analysts` — create custom analyst (admin/owner gated)
- `PATCH /analysts/:id` — toggle enabled / update fields
- `GET /analysts/:id/calibration` — calibration payload (aggregate + per-instrument + resolvedPredictions[])
- `GET /analysts/:id/contract` — contract markdown + versions[]
- `PUT /analysts/:id/contract` — save edit (returns 400 with `missingSections` / `forbiddenPhrases` / `extraSections` on validation failure)
- `POST /analysts/:id/rollback` — roll active version back one step
- `GET /predictions/:id/llm-calls` — lazy-load reasoning trace

## File map

- `what.md` — architecture narrative of the facet
- `where.md` — exact Playwright locators per action
- `expectations.md` — pass/fail invariants the spec must encode
- `tests.md` — numbered Playwright cases + secondary Chrome-MCP exploratory section
- `completeness.md` — known coverage gaps + human demo script
