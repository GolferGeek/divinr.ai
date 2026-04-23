# Effort: Ethan Feedback — 2026-04-22

## Background

Ethan (beta tester; `bernierethanw@gmail.com`, also the author of the "EA" custom analyst) sent in a five-item feedback list on 2026-04-22, the day after `user-billing-model` finished on disk. Two items are straight bugs, one is a vocabulary cleanup that post-dates the `ui-vocabulary-and-marketing-refresh` sweep, and two are UX improvements (article sourcing discoverability + shorter landing-page reports with a "read more" affordance).

This effort bundles them into one focused pass since each is small on its own and the coordination cost of splitting into five efforts outweighs the scope-isolation benefit. It follows the same "beta-coolness polish" shape as `club-tournament-experience-polish` — tight, user-driven — but item #4 takes the "right" implementation path (new schema column + write-path wiring + migration, not a UI-only affordance over the existing imprecise endpoint), which bumps this to a several-days effort rather than ship-in-a-day.

## Problem

Concrete beta-tester pain right now:

1. **Portfolio stocks: Analysts vs. AI Scoring tabs show the same content.** On `InstrumentDetailView.vue` the "analysts" tab renders `InstrumentAnalystPanel`s filtered from the shared `predictions` store; the "AI Scoring" tab renders `PredictorScoringPanel` off the `predictors` store. Preliminary diagnosis from an Explore-agent pass: either (a) the `predictors` store is not being populated distinctly, so `PredictorScoringPanel` renders the same analyst-authored predictions the first tab shows, or (b) both tabs are legitimately showing analyst output with no visible differentiation in the UI. Needs a closer look to confirm which.
2. **Back navigation from analyst performance is broken.** `AnalystPerformanceView.vue:152-154` hard-codes `router-link="/analysts"` as its back button, which always dumps the user on the `/analysts` grid regardless of where they came from (the performance dashboard route `/performance` → analyst click is one common entry point). Ethan's "can't click the back button" is really "the back button always goes to the wrong place." Also, the browser back button *may* work fine — worth confirming whether Ethan meant the in-page button or the browser chrome button.
3. **"Instruments" reads as engineering vocabulary.** To a beta tester, the sidebar label "Instruments" lands colder than "Research." The `ui-vocabulary-and-marketing-refresh` effort swept "prediction → analysis/signal" but did not touch the "Instruments" nav label, because at the time the rename was not on the table. It is now.
4. **Article sourcing is not discoverable from an analyst recommendation.** Ethan cannot find where, in an analyst's recommendation, to see the articles the analyst's reasoning drew from. **Confirmed via code review (2026-04-22):** article IDs are *not* stored on the prediction record. The write path (`prediction-runner.service.ts:222-226`) consumes articles during prompt construction but does not persist which specific articles were used; the only existing endpoint (`GET /markets/predictions/:predictionId/provenance`, served by `markets.service.ts:845-932`) returns up to 10 articles the analyst recently scored for that instrument, not the articles actually consulted for that specific prediction. The fix therefore requires schema + write-path + endpoint changes, not a UI-only affordance.
5. **Per-stock reports on the landing page are too long.** Ethan wants a short rundown per stock on the landing page (so more stocks fit without scrolling) with a "read more" affordance that opens the full report including sourced articles (ties to item #4). Current behavior appears to render the full report inline.

## Intention

Ship all five items in one focused branch, in roughly this order:

1. **Fix item #2** — back-button regression on `AnalystPerformanceView`. Smallest and most self-contained.
2. **Diagnose and fix item #1** — verify whether the two portfolio-stock tabs are genuinely divergent in data but visually indistinguishable, or actually rendering the same data. Either way, ship a fix: either (a) populate the `predictors` store correctly so the AI Scoring tab shows non-analyst output, or (b) remove / merge the tab if the distinction is artificial.
3. **Ship item #4 the right way** — add a `contributing_article_ids JSONB` column to `prediction.market_predictions`, capture article IDs in the prediction-runner write path, update `getPredictionProvenance()` to filter by the stored column, and add a collapsible "Sources" section to `InstrumentAnalystPanel` / `PredictionDrawer` that renders the returned articles. Migration backfills existing rows with `NULL` (acceptable — new predictions onward carry accurate sources; old rows fall back to the old "recent for this instrument" behavior or show "Sources not captured for predictions made before 2026-04-XX").
4. **Ship item #5** — shorter per-stock reports on the landing page with "read more" → full detail + sources (reusing the Sources component from #4).
5. **Item #3 vocabulary** — rename "Instruments" nav label to "Research" everywhere it's user-visible. Route paths stay `/instruments`, `instrument.*` identifiers stay. Follows the `ui-vocabulary-and-marketing-refresh` pattern: user-visible strings only.

## Scope

### 1. Analyst Performance Back Button

- **File**: [apps/web/src/views/AnalystPerformanceView.vue:152-154](apps/web/src/views/AnalystPerformanceView.vue)
- **Current**: hard-coded `router-link="/analysts"`
- **Confirmed with Ethan**: he meant the **in-page** back button on that view, not the browser back button.
- **Fix shape**: use `useIonRouter().back()` (Ionic's history-aware back) with a fallback to `/analysts` when there's no history (deep-link case). Confirm no other views rely on this specific hard-coded link.

### 2. Portfolio Stocks Tabs Differentiation

- **Files**: [apps/web/src/views/InstrumentDetailView.vue:105-147](apps/web/src/views/InstrumentDetailView.vue), `PredictorScoringPanel.vue`, `predictors.store.ts`
- **Diagnosis needed**: trace `PredictorScoringPanel`'s data source vs. `InstrumentAnalystPanel`'s. If they both resolve to analyst-produced predictions, the "AI Scoring" tab name is misleading; it's just a different visual treatment of the same data.
- **Fix shape (pending diagnosis)**:
  - If AI Scoring is supposed to show *non-analyst* / arbitrator / composite output, wire `PredictorScoringPanel` to the correct data source (probably `arbitratorPrediction` + `compositeScore`).
  - If the tabs legitimately show the same analysts just grouped differently, either merge them or retitle the second tab to describe the actual differentiation (e.g., "Score Breakdown" or "By Dimension").

### 3. "Instruments" → "Research" Nav Rename

- **Decided name**: "Research" (Ethan's suggestion). Evaluated against "Coverage" (too business-y) and "Stocks" (narrows if options/futures appear later). "Research" leans into Divinr's explainability brand and reads warmly to beta testers.
- Sidebar nav label (top-level Divinr nav group)
- Breadcrumb labels
- Empty-state copy that references "instruments" in user-facing contexts
- `<title>` / page headers on `/instruments` and `/instruments/:id`
- First-touch `surface-content.ts` entries keyed by `instruments.*` — **update the `title` / `body` fields, not the keys**. Keys stay stable.
- **Out of scope**: route paths, identifiers, schema, API, `instrument.*` surface keys

### 4. Article Sourcing on Analyst Recommendations

Ship the "right" implementation: capture which articles actually fed into each prediction, not the approximation the existing provenance endpoint returns.

**Schema:**
- Add column `contributing_article_ids JSONB` (nullable, default `NULL`) to `prediction.market_predictions`
- Migration: in-place `ALTER TABLE ADD COLUMN`; no backfill needed (existing rows remain `NULL`)
- `ensureSchema()` pattern matches the rest of the markets schema; add the column to the DDL service

**Write path:**
- In [apps/api/src/markets/services/prediction-runner.service.ts](apps/api/src/markets/services/prediction-runner.service.ts): the runner already calls `loadPredictorLines()` (lines 222-226) to pull per-analyst article-relevance rows. Capture the `article_id`s from those rows into an array and pass them through the insert at lines 332-344 alongside `source_context` / `rationale` / etc.
- Same capture needs to happen at any other prediction-write site (e.g. day-trader prediction writes). Audit via grep for `INSERT INTO ... market_predictions`.

**Read path:**
- Update [apps/api/src/markets/markets.service.ts:845-932](apps/api/src/markets/markets.service.ts) (`getPredictionProvenance`): if the prediction row has a populated `contributing_article_ids`, return those exact articles (joined to `market_articles` for title/url/date). If the column is `NULL` (pre-migration rows), fall back to the current "recent articles this analyst scored for this instrument" behavior with a `fallback: true` flag in the response so the UI can label it differently ("Recent articles {analyst} scored for {symbol}" vs "Articles used in this analysis").

**UI:**
- Add collapsible "Sources" section to `InstrumentAnalystPanel.vue` and `PredictionDrawer.vue` that fetches `/markets/predictions/:id/provenance` on expand
- Each article row: title + publish date + external link (to the article URL) + one-line relevance rationale if present
- When `fallback: true` is set on the response, render a subtle note: *"Articles used in this specific analysis weren't captured — showing recent articles this analyst scored for {symbol} instead."*

**Tests:**
- API unit: assert new column is populated on prediction write, and round-trips through `getPredictionProvenance`
- Playwright (predictions facet): assert Sources section renders and opens article links

**Edge cases:**
- Runner computes predictor lines but ends up generating a prediction without citing any → `contributing_article_ids` is an empty JSONB array `[]`, not `NULL`. UI renders "No articles were used in this analysis" in that case. `NULL` remains reserved for "pre-migration row, sources unknown" (fallback).

### 5. Per-Stock Landing Page Reports

- **Files**: identify the landing-page stock list (likely `DashboardView.vue` or a `PredictionCard` / `StockReportCard` component; not yet confirmed)
- **Shape**:
  - Collapsed card: analyst name, direction + confidence, 1-2 sentence rationale extract, "Read more" CTA
  - Expanded detail: full reasoning, Sources section (from #4), related-predictions, trade-CTA
  - Expansion is in-page (drawer or modal), not a route push, so the user's scroll position in the landing list is preserved
- **Edge cases**: long rationales need a clean extract heuristic (first sentence? first ~200 chars?). Pick the simpler rule and fix later if it reads poorly.

## Success Criteria

- Ethan can click from `/performance` → analyst row → analyst performance detail → in-page back button → lands on `/performance` (not `/analysts`)
- Portfolio stock detail shows genuinely different content on Analysts vs. AI Scoring tabs, OR the tabs are merged/renamed to reflect actual differentiation
- Sidebar reads "Research" instead of "Instruments" in every user-visible label (route path `/instruments` unchanged)
- An analyst recommendation has a clearly visible Sources section listing the articles that fed into that specific prediction, populated from the new `contributing_article_ids` column. Pre-migration predictions gracefully fall back to the old behavior with an explanatory label.
- Landing-page stock cards are scannable — ~5+ fit above the fold on a typical desktop viewport without scrolling — with a "Read more" affordance for the full report
- All five changes wired into the existing first-touch inventory + testing-harness deep skills per Definition of Done

## Open Questions for PRD Phase

- **Item #1 root cause**: is `PredictorScoringPanel` genuinely broken, or is the tab intentionally redundant? Need to trace `predictors.store` before writing PRD.
- **Item #4 write-site audit**: are there prediction-write sites beyond `prediction-runner.service.ts` (e.g. day-trader prediction writer) that also need to capture `contributing_article_ids`? Grep during PRD phase to build the full list.
- **Item #5 extract heuristic**: first sentence vs. first 200 chars vs. LLM-generated summary? Probably start with "first paragraph, max 200 chars" and refine based on how the extracts read.
- **Testing coverage**: items #1, #2, #5 extend existing deep skills (instruments, analysts, predictions). #3 affects every facet's `where.md` that references "instruments" — mechanical update. #4 extends the predictions deep skill with a Sources-section assertion.

## Resolved (no longer open)

- **Item #2 back-button scope** — Ethan confirmed he means the in-page button, not browser back. Single fix in `AnalystPerformanceView.vue`.
- **Item #3 naming** — "Research" is the name. Evaluated alternatives; "Research" wins on warmth + brand fit.
- **Item #4 data-model question** — article IDs are NOT currently stored on the prediction record. Decision: ship the "right" implementation (new column + write-path + migration), not the UI-only shim over the existing imprecise endpoint.

## Out of Scope

- Stripe integration (that's `future/stripe-integration`, next queued effort)
- Any billing / payment work beyond what `user-billing-model` already shipped
- Custom analyst UX for authors (Ethan-specific, but a different surface)
- Multi-language / i18n of the new "Research" label
- New article-ingestion sources (would be `custom-source-ingestion` in `future/`)
- "Admin user billing" 401 bug — already tracked as finding `dd97ef65-divinr-admin-user-billing-401` in `docs/testing/findings/in-fix/`
- Any of the four testing-harness findings currently in `docs/testing/findings/in-fix/` (authoring-hub-empty, portfolios-dashboard-empty, performance-dashboard-empty, admin-user-billing-401) — those route through the testing-team fix queue, not this effort

## Dependencies

- None blocking. The `user-billing-model` effort is merged; this effort branches off clean `main`.

## Adjacent Efforts

- **`ui-vocabulary-and-marketing-refresh`** (shipped, PR #66) — item #3 is a follow-up to that sweep. The rename pattern and centralized surface-content update process copies from that effort.
- **`custom-source-ingestion`** (in `future/`) — unrelated to the source *attribution* work in item #4, but touches the same `market_articles` table. Worth reading when #4's PRD is drafted so terminology and column names don't drift between the two efforts.
- **Testing harness findings in `in-fix/`** — the three "dashboard empty" findings (portfolios, performance, authoring) are separate from Ethan's items, but if fixing item #1 uncovers data-population bugs, there may be overlap worth noting during PRD phase.

---

*Drafted 2026-04-22 after Ethan sent a five-item feedback batch. Queued into `current/` immediately after `user-billing-model` archived. Beta-coolness polish shape — short, bundled, ship in days.*
