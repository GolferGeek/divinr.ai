---
name: divinr-authoring-browser-skill
description: Playwright + Chrome-MCP patterns for the Divinr authoring facet. Covers /settings/authored-content (Your Content) with tabs Analysts / Instruments / Wiring / API Keys / Billing, plus the analyst & instrument contract editors and curriculum authoring entry points.
allowed-tools: Read Write Edit Grep Glob Bash
---

# Divinr Authoring Browser Skill

Deep skill for the `authoring` facet. Always load `divinr-workflow-browser-skill` first for the shared Playwright/Chrome-MCP patterns and `assertions.md` invariants.

## Facet summary

- Primary route: `/settings/authored-content` — "Your Content" hub with five segment tabs.
- Secondary routes:
  - `/analysts/:id/contract` — `ContractEditorView.vue` for an authored analyst.
  - `/instruments/:id/contract` — `InstrumentContractEditorView.vue` for an authored instrument.
  - `/clubs/:clubId/curricula/create` — `CurriculumCreateView.vue`.
  - `/clubs/:clubId/curricula/:id` — `CurriculumDetailView.vue`.
  - `/clubs/:clubId/curricula/:id/dashboard` — `CurriculumDashboardView.vue`.
- View files (under `apps/web/src/views/`):
  - `AuthoredContentView.vue` — tab host (`<h1>Your Content</h1>`, `IonSegment` with values `analysts | instruments | wiring | apikeys | billing`).
  - `authored/AnalystsTab.vue` — list + Create + Edit Contract / Delete actions.
  - `authored/InstrumentsTab.vue` — same shape for instruments.
  - `authored/WiringMatrixView.vue` — analyst x instrument grid.
  - `authored/LlmCredentialsTab.vue` — BYO LLM API keys.
  - `authored/BillingTab.vue` — monthly cost preview for authored items.
  - `authored/CreateAnalystWizard.vue`, `authored/CreateInstrumentWizard.vue` — modals.
  - `ContractEditorView.vue`, `InstrumentContractEditorView.vue` — secondary contract editors.
  - `CurriculumCreateView.vue` / `CurriculumDetailView.vue` / `CurriculumDashboardView.vue`.
- Capability slug: `authoring` (paid-tier surface — see "Tier gating" in `expectations.md`).
- Playwright project: `authoring`.

## Key components / patterns

- `<h1>Your Content</h1>` is the page heading (NOT "Authored Content"). The route slug uses `authored-content` but copy says "Your Content".
- `IonSegment` with `IonSegmentButton` values `analysts | instruments | wiring | apikeys | billing`.
- Per-tab pattern: `IonSpinner` while loading -> empty-state `<div>` ("No authored analysts yet — create your first one." / "No authored instruments yet — create your first one.") OR `IonCard` rows.
- First-touch: page-level `<FirstTouchPanel surface-key="authored.overview">`; tab-level `authoring.custom-analyst.create` / `authoring.custom-instrument.create`.
- Contract editors are reached via the per-row "Edit Contract" button; they live on separate routes.

## Trade-CTA / cross-facet hand-offs

Authoring does not directly host trade or prediction CTAs. The cross-facet edges are:

1. Editing an analyst contract -> `/analysts/:id/contract` (separate `analysts` facet for grid view; this skill owns the contract editor).
2. Editing an instrument contract -> `/instruments/:id/contract` (same: contract editor lives here, instrument grid is a separate facet).
3. Curriculum authoring is a club-scoped surface; cross-link with `divinr-clubs-browser-skill` for the curricula tab origin.

## API endpoints exercised

- `GET /authored-content/analysts` — `useAuthoredContentApi().listMyAnalysts()`.
- `GET /authored-content/instruments` — `listMyInstruments()`.
- `GET /authored-content/wirings` — `listMyWirings()`.
- `GET /billing/preview` — `useBillingApi().getBillingPreview()`.
- Credentials endpoints under `useCredentialsApi()` (LLM API keys tab).

## File map

- `what.md` — architecture narrative of the facet.
- `where.md` — exact Playwright locators per action.
- `expectations.md` — pass/fail invariants (what the spec must assert), including the tier-gate branch.
- `tests.md` — numbered Playwright cases + secondary Chrome-MCP exploratory section.
- `completeness.md` — known coverage gaps + human demo script.
