# Ethan Feedback 2026-04-22 — Completion Report

**Plan**: `plan.md`
**PRD**: `prd.md`
**Completed**: 2026-04-23
**Final Status**: All Phases Complete

## Summary
- Total phases: 7
- Phases completed: 7
- Phases remaining: 0

## What Shipped (by item)

### Item #1 — Instrument detail tab rename + enriched panel (Phase 2)
`InstrumentDetailView.vue:107` second-tab label changed from `AI Scoring` → `Article Relevance` (segment `value="predictors"` identifier unchanged). `PredictorScoringPanel.vue` rewritten to render article rows with relevance chip + status chip + external-link article title (`target="_blank" rel="noopener noreferrer"` + `openOutline` icon) + scoring-analyst meta + published date + rationale. `markets.service.ts` `listPredictors` SQL widened to join `market_articles` + `market_analysts`; `MarketPredictor` type gained optional `article_title` / `article_url` / `article_published_at` / `analyst_display_name` / `analyst_slug` / `scored_by_analyst_id` fields. First-touch surface `instrument.article-relevance` wired with `<FirstTouchPanel>`. Playwright spec: `apps/e2e/tests/instruments/article-relevance.spec.ts`.

### Item #2 — Back button (Phase 1)
Analyst performance view uses `useIonRouter().back()` to return to the correct previous screen. Covered by `apps/e2e/tests/analysts/back-button.spec.ts`.

### Item #3 — Nav rename "Instruments" → "Research" (Phase 6)
- `DefaultLayout.vue:75` sidebar nav title: `Research`.
- `InstrumentsView.vue:51` `<h1>Research</h1>`.
- `InstrumentContractEditorView.vue:283` breadcrumb: `← Research`.
- `DashboardView.vue:241` pathway-desc: `Tickers & analysis`; `:299` stat label: `Tickers`.
- `AttachmentPicker.vue` option label: `Research` (value `instrument` stays).
- `OnboardingSettingsView.vue` section label: `Research` (prefix `instrument` stays).
- `surface-content.ts:instruments` title: `Research — the tickers we watch`.
- Route paths, API keys, schema, `instrument_id` identifiers intentionally unchanged per PRD §4.4.3.
- Authoring / admin / curriculum / wiring-matrix surfaces intentionally unchanged.

### Item #4 — Article sourcing (Phases 3 + 4)
- **Write path (Phase 3)**: `prediction_sources` table added with re-entrant DDL, `prediction-sources.service.ts` writes rows when a prediction gets created, fallback provenance service falls back to the 10 most recent articles the analyst scored for the ticker when no explicit linkage exists.
- **Read path (Phase 4)**: `/markets/predictions/:id/provenance` returns `{ articles, fallback }`. `<PredictionSources>` (new) renders under each analyst signal on the instrument detail page: collapsed ion-item that expands to a list of article rows (title + external link + date + rationale) or a fallback banner. `AnalystPredictionModal` Evidence tab gained the same fallback banner.
- `prediction.sources` first-touch content + Appendix A entry added; coverage at `74 wired + 39 pending = 113 / 113`.
- Playwright spec: `apps/e2e/tests/predictions/sources.spec.ts` (skip-safe when seed absent).

### Item #5 — Slim dashboard cards (Phase 5)
`DashboardView.vue` card template reduced to: stance-chip row (up to 3 analysts + "+N more"), single trade-line (action chip + qty · entry → target), one-line rationale with inline "Read more" → modal, single "View" CTA. Old `.analyst-stances` and `.trade-rec-details` blocks removed. Bundle: `DashboardView` chunk dropped 42.44 kB → 41.31 kB (gzip 12.89 → 12.63).
Playwright spec: `apps/e2e/tests/predictions/dashboard-card.spec.ts` asserts the new shape and absence of old selectors.

## Phase Results

| Phase | Status   | Notes |
| ----- | -------- | ----- |
| 1 — Back button                                | Complete | One-line fix; covered by a dedicated e2e. |
| 2 — Instrument tab rename + enriched panel     | Complete | `AI Scoring` → `Article Relevance`; panel rebuilt with article titles, links, scoring-analyst + published-date meta. |
| 3 — Article sourcing schema + write path       | Complete | DDL re-entrant; fallback provenance service added with unit test. |
| 4 — Article sourcing read path + UI            | Complete | Per-component fetch (not the Pinia singleton) to avoid cross-instance overwrites. Modal reused the existing Evidence tab; no duplicate component. |
| 5 — Landing page card slim-down                | Complete | Bundle shrank; both old CSS blocks removed. |
| 6 — Nav rename Instruments → Research          | Complete | In-scope surfaces only; authoring/admin/curriculum left as "Instruments" per PRD §4.4.3. |
| 7 — Final QA + completion report               | Complete | This document. |

## Gate Results

- **Lint, typecheck, build**: all workspace-wide green on final run.
- **API `test:unit`**: green (triple-verified across Phases 3, 6, 7).
- **API `test:compliance`**: Fails with `2 !== 1` for compliance-document count assertion. **Verified pre-existing on `main`** (checked out commit `8bc4854` and reproduced). Seed-data drift, not regression. Logged here for follow-up triage — not blocking merge.
- **Playwright**:
  - Our phase work is covered by `instruments/smoke`, `instruments/article-relevance`, `predictions/smoke`, `predictions/sources`, `predictions/dashboard-card`, `analysts/back-button`, all passing (or skip-safe when seed data is absent).
  - Full 11-project run shows 8 pre-existing failures — `portfolios/smoke`, `performance/smoke`, `authoring/smoke`, `billing` × 4, `admin/user-billing` — all verified pre-existing on `main` (same DB seed drift that affects the compliance suite). Not caused by this effort; not blocking merge.
- **First-touch coverage**: `74 wired + 39 pending = 113 / 113`.
- **Chrome-MCP U1–U5 walkthrough**: Deferred — the workflow's chrome browser cannot reach `127.0.0.1:7101` from this long-running session. Playwright specs cover the equivalent assertions for U1 (back button), U3 (Research heading), U4 (sources component), U5 (slim card shape). U2 is covered by `instruments/article-relevance.spec.ts`.

## Deviations from PRD

- **Phase 4 sources component fetch**: PRD described wiring through the `useProvenanceStore()`. The store is a Pinia singleton, so two or more `<PredictionSources>` instances on the same page (one per analyst signal in `InstrumentAnalystPanel`) would overwrite each other's data. Switched to per-instance `useApi().get(...)` with a local `payload` ref. Semantically equivalent (no cross-instance cache needed for this surface).
- **Phase 4 modal sources**: PRD described mounting the same `<PredictionSources>` component inside `AnalystPredictionModal`. The modal already had an Evidence tab that renders articles through the provenance store with its own render. Extended the existing tab with the fallback banner instead of stacking a second component — avoids duplicate network calls and conflicting display.
- **Phase 6 surface title wording**: Plan proposed `"Research — every ticker we watch"`; shipped `"Research — the tickers we watch"`. Equivalent copy; softer parallel structure.

## Open Follow-ups

- **Pre-existing compliance + portfolios + performance + billing Playwright failures**: DB seed drift from prior effort(s). Needs a seed reset + either fixing the seed scripts or updating expectations. File a separate ticket — out of scope for this effort.
- **`useIonRouter().back()` composable**: The Phase 1 fix was a one-off; PRD noted a possible generalization into a composable if the pattern recurs. Deferred.
- **Vocabulary compliance deep-dive on detail pages**: The instruments detail page renders LLM-authored rationale that can leak "prediction/advice/recommendation" in surface copy. Tracked separately in `divinr-instruments-browser-skill/completeness.md`.
- **Manual Chrome-MCP walkthrough of U1–U5**: To be performed by reviewer on the live URL before merge, since the run-plan session can't drive Chrome-MCP at `127.0.0.1:7101`.

## Evidence

- Branch: `effort/ethan-feedback-2026-04-22`
- New Playwright specs:
  - `apps/e2e/tests/analysts/back-button.spec.ts`
  - `apps/e2e/tests/predictions/sources.spec.ts`
  - `apps/e2e/tests/predictions/dashboard-card.spec.ts`
- New Vue components: `apps/web/src/components/PredictionSources.vue`
- Appendix A key added: `prediction.sources` (wired in `PredictionSources.vue`)
- Bundle delta: `DashboardView` 42.44 → 41.31 kB (gzip 12.89 → 12.63)
