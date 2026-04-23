# Effort: Ethan Feedback — 2026-04-22

## Background

Ethan (beta tester; `bernierethanw@gmail.com`, also the author of the "EA" custom analyst) sent in a five-item feedback list on 2026-04-22, the day after `user-billing-model` finished on disk. Two items are straight bugs, one is a vocabulary cleanup that post-dates the `ui-vocabulary-and-marketing-refresh` sweep, and two are UX improvements (article sourcing discoverability + shorter landing-page reports with a "read more" affordance).

This effort bundles them into one focused pass since each is small on its own and the coordination cost of splitting into five efforts outweighs the scope-isolation benefit. It follows the same "beta-coolness polish" shape as `club-tournament-experience-polish` — tight, user-driven, ships in days, not weeks.

## Problem

Concrete beta-tester pain right now:

1. **Portfolio stocks: Analysts vs. AI Scoring tabs show the same content.** On `InstrumentDetailView.vue` the "analysts" tab renders `InstrumentAnalystPanel`s filtered from the shared `predictions` store; the "AI Scoring" tab renders `PredictorScoringPanel` off the `predictors` store. Preliminary diagnosis from an Explore-agent pass: either (a) the `predictors` store is not being populated distinctly, so `PredictorScoringPanel` renders the same analyst-authored predictions the first tab shows, or (b) both tabs are legitimately showing analyst output with no visible differentiation in the UI. Needs a closer look to confirm which.
2. **Back navigation from analyst performance is broken.** `AnalystPerformanceView.vue:152-154` hard-codes `router-link="/analysts"` as its back button, which always dumps the user on the `/analysts` grid regardless of where they came from (the performance dashboard route `/performance` → analyst click is one common entry point). Ethan's "can't click the back button" is really "the back button always goes to the wrong place." Also, the browser back button *may* work fine — worth confirming whether Ethan meant the in-page button or the browser chrome button.
3. **"Instruments" reads as engineering vocabulary.** To a beta tester, the sidebar label "Instruments" lands colder than "Research." The `ui-vocabulary-and-marketing-refresh` effort swept "prediction → analysis/signal" but did not touch the "Instruments" nav label, because at the time the rename was not on the table. It is now.
4. **Article sourcing is not discoverable from an analyst recommendation.** Ethan cannot find where, in an analyst's recommendation, to see the articles the analyst's reasoning drew from. Either the surface exists and is buried (discoverability bug), or it genuinely does not exist on the recommendation detail (feature gap). Needs a code walk to decide which.
5. **Per-stock reports on the landing page are too long.** Ethan wants a short rundown per stock on the landing page (so more stocks fit without scrolling) with a "read more" affordance that opens the full report including sourced articles (ties to item #4). Current behavior appears to render the full report inline.

## Intention

Ship all five items in one focused branch, in roughly this order:

1. **Fix item #2** — back-button regression on `AnalystPerformanceView`. Smallest and most self-contained.
2. **Diagnose and fix item #1** — verify whether the two portfolio-stock tabs are genuinely divergent in data but visually indistinguishable, or actually rendering the same data. Either way, ship a fix: either (a) populate the `predictors` store correctly so the AI Scoring tab shows non-analyst output, or (b) remove / merge the tab if the distinction is artificial.
3. **Investigate item #4** — walk `InstrumentDetailView` / `PredictionDrawer` / `AnalystPanel` to determine whether article sources are stored and surface-able. If stored but hidden, add a collapsible "Sources" section under each analyst's reasoning. If not stored on the prediction record, this item splits out as a separate follow-up effort (ingest + schema work).
4. **Ship item #5** — shorter per-stock reports on the landing page with "read more" → full detail + sources (ties to #4's outcome). If #4 turns out to need its own effort, #5 ships the "read more" shell with sources intentionally omitted and a TODO pointer.
5. **Item #3 vocabulary** — rename "Instruments" nav label to "Research" everywhere it's user-visible. Route paths stay `/instruments`, `instrument.*` identifiers stay. Follows the `ui-vocabulary-and-marketing-refresh` pattern: user-visible strings only.

## Scope

### 1. Analyst Performance Back Button

- **File**: [apps/web/src/views/AnalystPerformanceView.vue:152-154](apps/web/src/views/AnalystPerformanceView.vue)
- **Current**: hard-coded `router-link="/analysts"`
- **Fix shape**: use `useIonRouter().back()` (Ionic's history-aware back) with a fallback to `/analysts` when there's no history (deep-link case). Confirm no other views rely on this specific hard-coded link.

### 2. Portfolio Stocks Tabs Differentiation

- **Files**: [apps/web/src/views/InstrumentDetailView.vue:105-147](apps/web/src/views/InstrumentDetailView.vue), `PredictorScoringPanel.vue`, `predictors.store.ts`
- **Diagnosis needed**: trace `PredictorScoringPanel`'s data source vs. `InstrumentAnalystPanel`'s. If they both resolve to analyst-produced predictions, the "AI Scoring" tab name is misleading; it's just a different visual treatment of the same data.
- **Fix shape (pending diagnosis)**:
  - If AI Scoring is supposed to show *non-analyst* / arbitrator / composite output, wire `PredictorScoringPanel` to the correct data source (probably `arbitratorPrediction` + `compositeScore`).
  - If the tabs legitimately show the same analysts just grouped differently, either merge them or retitle the second tab to describe the actual differentiation (e.g., "Score Breakdown" or "By Dimension").

### 3. "Instruments" → "Research" Nav Rename

- Sidebar nav label (top-level Divinr nav group)
- Breadcrumb labels
- Empty-state copy that references "instruments" in user-facing contexts
- `<title>` / page headers on `/instruments` and `/instruments/:id`
- First-touch `surface-content.ts` entries keyed by `instruments.*` — **update the `title` / `body` fields, not the keys**. Keys stay stable.
- **Out of scope**: route paths, identifiers, schema, API, `instrument.*` surface keys

### 4. Article Sourcing Discoverability

- **Investigation first**: search the prediction / analyst-reasoning data model for stored article IDs. Likely locations: `prediction.predictions.reasoning_refs`, `prediction.analyst_adaptation_diffs`, article cross-refs in predictor-stage output.
- **If sources are stored on the prediction record**:
  - Add a collapsible "Sources" section to `InstrumentAnalystPanel` / `PredictionDrawer`
  - Each source: article title + publish date + link to source (or `/articles/:id` if an internal article view exists)
  - Thread the same component into the "read more" detail from item #5
- **If sources are NOT stored on the prediction record**:
  - Split out a `source-attribution-on-predictions` effort into `next/`
  - This effort ships items 1, 2, 3, 5 without the sources in #5's expanded view; add a "Sources (coming soon)" stub there

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
- An analyst recommendation has a clearly visible path to "which articles did this draw from" (either inline sources section, or an explicit "Coming soon" stub if #4 splits out)
- Landing-page stock cards are scannable — ~5+ fit above the fold on a typical desktop viewport without scrolling — with a "Read more" affordance for the full report
- All five changes wired into the existing first-touch inventory + testing-harness deep skills per Definition of Done

## Open Questions for PRD Phase

- **Item #1 root cause**: is `PredictorScoringPanel` genuinely broken, or is the tab intentionally redundant? Need to trace `predictors.store` before writing PRD.
- **Item #2**: does Ethan mean the *browser* back button or the in-page back button? If browser back doesn't work, there's a second bug (probably `router.replace` somewhere in the analyst navigation path). Confirm with Ethan.
- **Item #3 naming**: "Research" is Ethan's suggestion. Is there a more-durable name (e.g., "Coverage," "Watchlist," "Symbols")? Probably stick with "Research" if it reads well; avoid bikeshed.
- **Item #4 data-model question**: are article IDs currently stored on the prediction record? PRD phase gates on the answer — drives whether #4 stays in scope or splits out.
- **Item #5 extract heuristic**: first sentence vs. first 200 chars vs. LLM-generated summary? Probably start with "first paragraph, max 200 chars" and refine based on how the extracts read.
- **Testing coverage**: items #1, #2, #5 extend existing deep skills (instruments, analysts, predictions). #3 affects every facet's `where.md` that references "instruments" — mechanical update.

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
- Soft dependency on item #4's data-model question — if article IDs are not on the prediction record, #4 splits to a follow-up effort and this one ships four items instead of five.

## Adjacent Efforts

- **`ui-vocabulary-and-marketing-refresh`** (shipped, PR #66) — item #3 is a follow-up to that sweep. The rename pattern and centralized surface-content update process copies from that effort.
- **`custom-source-ingestion`** (in `future/`) — if item #4 requires source attribution infrastructure that isn't already on the prediction record, this effort may surface a partial spec for that one to pick up.
- **Testing harness findings in `in-fix/`** — the three "dashboard empty" findings (portfolios, performance, authoring) are separate from Ethan's items, but if fixing item #1 uncovers data-population bugs, there may be overlap worth noting during PRD phase.

---

*Drafted 2026-04-22 after Ethan sent a five-item feedback batch. Queued into `current/` immediately after `user-billing-model` archived. Beta-coolness polish shape — short, bundled, ship in days.*
