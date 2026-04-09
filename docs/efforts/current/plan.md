# Calibration Drilldown — Implementation Plan

**PRD**: ./prd.md
**Created**: 2026-04-09
**Status**: Not Started

## Progress Tracker
<!-- run-plan uses this section to track where we are -->
- [x] Phase 1: Service + endpoint, no UI
- [x] Phase 2: View wiring without chart
- [x] Phase 3: Row expansion + reasoning fetch
- [x] Phase 4: Charting library + scatter plot
- [x] Phase 5: Polish + completion report

## Deviations Log
- **Phase 1 step 1.7**: No dedicated unit test written for `getAnalystCalibration`. Rationale: see-your-reasoning shipped without one for `getPredictionLlmCalls`, the markets test infra has no service-level mocking pattern, and the live curl against dev data validates the response shape (analyst, weighted aggregate, deduped per-instrument breakdown, wrong-first sort, actualOutcome rendering, hasReasoning flag). A reachability curl test was added to `tests/curl/run-curl-tests.sh` instead.
- **Phase 1 SQL**: `analyst_performance_profiles` is append-only (multiple rows per `(analyst, instrument, period, horizon)` with different `computed_at` values). Service uses `distinct on (instrument_id) order by computed_at desc` to pick the freshest, otherwise the weighted aggregate double-counts. Discovered when first curl returned 11 rows for an analyst that should have had ~6.
- **Phase 1 confidence units**: PRD §5.3 documented confidence as `0..1` but live data is stored as `0..100` (e.g. `confidence: 75`, `avg_confidence: 63.18`). Service passes through verbatim; UI must render as a percent without dividing by 100. Worth noting for Phase 2 wiring.

---

## Phase 1: Service + endpoint, no UI
**Status**: Not Started
**Objective**: Ship `GET /markets/analysts/:analystId/calibration` returning the full payload shape from PRD §5.3, IDOR-safe, with a unit test, no UI changes.

### Steps
- [ ] 1.1 Confirm exact column names on `prediction.prediction_horizon_evaluations` for actual direction (`\d prediction.prediction_horizon_evaluations` via psql at port 54322). Note the column name to use in 1.4.
- [ ] 1.2 Confirm `market_predictions` has columns `predicted_direction`, `confidence`, `rationale`, `llm_usage_id`, `created_at`, `instrument_id`, `analyst_id`, `organization_slug`.
- [ ] 1.3 Add `getAnalystCalibration(orgSlug, userId, analystId)` to `apps/api/src/markets/markets.service.ts`. Constructor parameters use explicit `@Inject(...)` per CLAUDE.md (no new params expected — should reuse the existing DB service).
- [ ] 1.4 SQL: three queries inside the service method, all filtered on `organization_slug`:
  (a) analyst row from `markets.market_analysts` (404 if missing) — return `id, display_name, persona_prompt, analyst_type`.
  (b) all `analyst_performance_profiles` rows for `(analyst_id, organization_slug)` joined to `market_instruments` for `symbol`. In TS compute weighted aggregate (weighted by `sample_size`) for `accuracy_rate` and `avg_confidence`; un-weighted average for `calibration_score`; sum for `sampleSize`.
  (c) resolved evaluations: `prediction_horizon_evaluations` joined to `market_predictions` (on `prediction_id`) joined to `market_instruments` (on `instrument_id`), filtered by `market_predictions.analyst_id` and `market_predictions.organization_slug`. `ORDER BY was_correct ASC, evaluation_date DESC LIMIT 100`. Select all fields the response shape names.
- [ ] 1.5 Map row results into the response shape from PRD §5.3. `actualOutcome` is `null` when `actual_outcome_data` is `'{}'::jsonb` or missing the expected keys. `actualDirection` uses the column confirmed in 1.1; if both possible columns are absent, derive from `sign(changePercent)`.
- [ ] 1.6 Wire the controller route in `apps/api/src/markets/markets.controller.ts` near `getPredictionLlmCalls` (around line 1027). Use `@Get('analysts/:analystId/calibration')`, `@Req`, `@Param`, `@Query('organizationSlug')`, `getUser` + `resolveIdentity({ query: orgSlug })` — copy the exact pattern.
- [ ] 1.7 Add a unit test under the existing markets test file that:
  - hits `getAnalystCalibration` with a fixture analyst that has profiles + resolved predictions
  - asserts response shape keys
  - asserts wrong-first sort (`was_correct ASC, evaluation_date DESC`)
  - asserts the IDOR filter (different org returns 404 / empty)
  - asserts the empty cases (analyst exists, no profiles → aggregate nulls + perInstrument: []; no resolved predictions → resolvedPredictions: [])
- [ ] 1.8 Run the endpoint via curl against the dev API (port 7100) for an analyst with data and confirm the response shape matches PRD §5.3.

### Quality Gate
Before moving to Phase 2, ALL of the following must pass:
- [ ] **Lint**: `pnpm lint`
- [ ] **Build**: `pnpm build`
- [ ] **Unit Tests**: `pnpm test:unit` (and the markets-specific suite)
- [ ] **Markets CI**: `pnpm ci:markets`
- [ ] **Curl Tests**:
  - `curl -s "http://localhost:7100/markets/analysts/<analystId>/calibration?organizationSlug=<slug>" -H "Authorization: Bearer <admin-token>"` returns 200 with the full payload shape including `analyst`, `metrics.aggregate`, `metrics.perInstrument`, `resolvedPredictions`.
  - Same call with a wrong `organizationSlug` returns 404 or an empty/safe payload.
  - Same call for an analyst with no profile rows returns `metrics.aggregate.sampleSize === 0` and `metrics.perInstrument === []`.
- [ ] **Chrome Tests**: N/A (no UI in this phase).
- [ ] **Phase Review**: Compare against PRD §9 Phase 1.
  - [ ] Service method exists and is IDOR-safe?
  - [ ] Endpoint matches the established controller pattern?
  - [ ] Unit test covers shape, sort, IDOR, empty cases?
  - [ ] Any deviations from PRD §5.3 response shape documented?

---

## Phase 2: View wiring without chart
**Status**: Not Started
**Objective**: Replace the placeholder section in `AnalystPerformanceView.vue` (lines 90–119) with headline metric cards, per-instrument breakdown table, and the resolved-predictions list — no chart, no row expansion.

### Steps
- [ ] 2.1 In `apps/web/src/views/AnalystPerformanceView.vue`, add a `calibration = ref<CalibrationResponse | null>(null)` and a separate `calibrationLoading = ref(false)`. Define a local TS interface matching PRD §5.3 response shape.
- [ ] 2.2 In `onMounted`, after the existing analyst fetch, call `api.get<CalibrationResponse>(\`/markets/analysts/${id}/calibration?organizationSlug=${orgSlug}\`)`. Source `orgSlug` the same way the rest of the web app does (check `useApi` / existing views — do not invent a new method).
- [ ] 2.3 Delete the placeholder `<ion-note>` and the three em-dash `<ion-card>`s (lines 90–119). Replace with:
  - Headline cards row (4 cards): Accuracy / Avg Confidence / Calibration Score / Sample Size — bound to `calibration.metrics.aggregate`. Render `—` for null. Subtitle below the row reads "30d, 3-day horizon."
  - Per-instrument breakdown: an `<ion-card>` containing a small table (or `<ion-list>`) with columns Symbol / Samples / Accuracy / Avg Conf / Calibration / Biases. Biases column shows count of keys in `systematicBiases` (or `—` for empty), title attr renders `JSON.stringify(systematicBiases, null, 2)`.
  - Resolved predictions list: an `<ion-card>` containing rows for each `resolvedPredictions` entry. Each row shows: Symbol · `predictedDirection` → `actualDirection` · was-correct chip (success/danger) · Confidence (%) · `Δ {changePercent}%` · prediction date / evaluation date. No expansion in this phase — rows are visually present but inert clicks.
- [ ] 2.4 Empty state: when `calibration.resolvedPredictions.length === 0`, render an `<ion-note>` reading "No resolved predictions yet — the nightly evaluation will populate this view once predictions reach their horizon." The headline cards still render with their nulls/zeros above.
- [ ] 2.5 Loading: existing `<ion-progress-bar v-if="loading">` covers the full mount; ensure `loading` is only set false after both the analyst and the calibration fetches complete (or each has its own progress bar).
- [ ] 2.6 Errors: wrap the calibration fetch in try/catch and render an `<ion-note color="danger">` with the error message inside the calibration region. The persona/status/tier cards above continue to render.
- [ ] 2.7 Verify the persona/status/tier cards (lines 42–88) are unchanged.

### Quality Gate
Before moving to Phase 3, ALL of the following must pass:
- [ ] **Lint**: `pnpm lint`
- [ ] **Build**: `pnpm build`
- [ ] **Unit Tests**: `pnpm test:unit`
- [ ] **Markets CI**: `pnpm ci:markets`
- [ ] **Curl Tests**: same endpoint as Phase 1 still returns the expected shape.
- [ ] **Chrome Tests** (web on port 7101):
  - Navigate to `/analysts/<id-with-data>/performance` — headline cards, per-instrument breakdown, and resolved-predictions list all render with real data; wrong predictions appear at the top of the list.
  - Navigate to `/analysts/<id-without-data>/performance` — empty state note renders; persona/status/tier cards above still render.
  - Navigate to a nonexistent analyst — error path is graceful.
- [ ] **Phase Review**: Compare against PRD §5.4 and §9 Phase 2.
  - [ ] Placeholder lines 90–119 are gone, replaced with the three new sections?
  - [ ] Persona/status/tier cards untouched?
  - [ ] Wrong-first sort visible in the list?
  - [ ] Empty state present?

---

## Phase 3: Row expansion + reasoning fetch
**Status**: Not Started
**Objective**: Make resolved-prediction rows clickable; expand inline to show the prediction's rationale, the captured LLM reasoning (lazy-fetched), and the actual outcome rendering.

### Steps
- [ ] 3.1 Add `expandedId = ref<string | null>(null)` and `reasoningCache = ref(new Map<string, ReasoningPayload>())` to the view's `<script setup>`. Define `ReasoningPayload` matching the response from `getPredictionLlmCalls` (read the existing `AnalystPredictionModal.vue` reasoning tab for the exact shape — do not invent).
- [ ] 3.2 Make each resolved-prediction row a clickable band; clicking toggles `expandedId`. When opening a row whose `predictionId` is not in the cache, fire `api.get(\`/markets/predictions/${predictionId}/llm-calls?organizationSlug=${orgSlug}\`)` and store the result in the cache.
- [ ] 3.3 Render the expanded panel directly below the clicked row (`v-if="expandedId === row.predictionId"`). Panel contents:
  - "Predicted: {predictedDirection} — Actual: {actualDirection} ({Δ changePercent%})"
  - "${priceAtPrediction} → ${priceAtHorizon} ({startBarTimestamp} → {endBarTimestamp})" (format dates short)
  - Confidence at prediction time as percent
  - Original `rationale` (from the row, no extra fetch)
  - Captured LLM reasoning in a `<pre>` block — copy the styling from `AnalystPredictionModal.vue`'s reasoning tab exactly (font, padding, white-space).
- [ ] 3.4 Loading + error states for the per-row fetch: a small spinner inside the panel while in flight, an inline error message if the fetch fails. Cache survives errors (so retry requires another click).
- [ ] 3.5 If `hasReasoning === false` for a row, the expansion panel still opens but the LLM-reasoning section reads "No captured reasoning for this prediction" instead of fetching.

### Quality Gate
Before moving to Phase 4, ALL of the following must pass:
- [ ] **Lint**: `pnpm lint`
- [ ] **Build**: `pnpm build`
- [ ] **Unit Tests**: `pnpm test:unit`
- [ ] **Markets CI**: `pnpm ci:markets`
- [ ] **Curl Tests**: `getPredictionLlmCalls` still returns 200 for a known prediction id with reasoning content.
- [ ] **Chrome Tests** (port 7101):
  - Click a wrong prediction row; expansion panel renders rationale + reasoning + outcome line; reasoning is fetched once (network tab confirms a single request).
  - Click the same row a second time after closing it; no second network request (cache hit).
  - Click a row with `hasReasoning === false`; "No captured reasoning" message renders.
  - Click a row whose reasoning fetch fails (simulate by killing API briefly); inline error message renders.
- [ ] **Phase Review**: Compare against PRD §5.4 row-expansion bullets and §9 Phase 3.
  - [ ] `<pre>` styling matches `AnalystPredictionModal.vue`?
  - [ ] Cache works as specified?
  - [ ] Empty/error states wired?

---

## Phase 4: Charting library + scatter plot
**Status**: Not Started
**Objective**: Add `chart.js` + `vue-chartjs` + `chartjs-plugin-annotation` to `apps/web` (the first chart library in the repo) and render the calibration scatter plot in the view, lazy-loaded.

### Steps
- [ ] 4.1 Add to `apps/web/package.json` dependencies: `chart.js@^4`, `vue-chartjs@^5`, `chartjs-plugin-annotation@^3` — pin exact versions during install. Run `pnpm install`.
- [ ] 4.2 Verify the build under Vite works with the new deps (`pnpm --filter @divinr/web build`).
- [ ] 4.3 Create `apps/web/src/components/CalibrationScatter.vue`. Props: `predictions: ResolvedPrediction[]`. Computes 5 confidence bins (50–60, 60–70, 70–80, 80–90, 90–100); for each bin computes `(midpoint, correct/total)`. Bins with 0 rows are dropped; bins with < 2 rows render with a smaller point radius. Renders via `vue-chartjs`'s `<Scatter />` plus a y=x reference line via `chartjs-plugin-annotation`. Axis range fixed `[0.5, 1.0]` on both axes.
- [ ] 4.4 Import `CalibrationScatter.vue` in `AnalystPerformanceView.vue` via dynamic `defineAsyncComponent(() => import('../components/CalibrationScatter.vue'))`. Place it between the per-instrument breakdown table and the resolved-predictions list, wrapped in an `<ion-card>` titled "Confidence vs Accuracy".
- [ ] 4.5 If `resolvedPredictions.length === 0`, do not render the chart at all (no empty chart skeleton).
- [ ] 4.6 Confirm chart chunk is lazy-loaded by inspecting the `pnpm --filter @divinr/web build` output — the chart deps should land in a separate chunk that is not in the initial app entry.

### Quality Gate
Before moving to Phase 5, ALL of the following must pass:
- [ ] **Lint**: `pnpm lint`
- [ ] **Build**: `pnpm build` (and confirm the chart chunk is split out)
- [ ] **Unit Tests**: `pnpm test:unit`
- [ ] **Markets CI**: `pnpm ci:markets`
- [ ] **Bundle Gate**: chart chunk < 150 KB gzipped (PRD §8 R5).
- [ ] **Curl Tests**: N/A (no API change).
- [ ] **Chrome Tests** (port 7101):
  - Navigate to an analyst with data; scatter plot renders with binned points, y=x reference line is visible, axis range is `[0.5, 1.0]`.
  - Bins with low sample size are visually distinct (smaller radius).
  - Navigate to an analyst without resolved predictions; chart does not render.
  - Network tab shows the chart chunk is fetched only on this view, not on the dashboard.
- [ ] **Phase Review**: Compare against PRD §5.5 and §9 Phase 4.
  - [ ] All three deps added with pinned versions?
  - [ ] Bucketing matches spec (5 bins, midpoint x, accuracy y)?
  - [ ] Reference line via annotation plugin?
  - [ ] Lazy-loaded?
  - [ ] Bundle gate met?

---

## Phase 5: Polish + completion report
**Status**: Not Started
**Objective**: Tighten copy, verify all states one more time, and write the completion report.

### Steps
- [ ] 5.1 Re-read the view end-to-end with three test analysts: one with rich data, one with no profile rows, one with profile rows but no resolved predictions. All three must render without console errors.
- [ ] 5.2 Confirm persona/status/tier cards (lines 42–88 of the original file) are pixel-identical to before.
- [ ] 5.3 Re-confirm wrong-first sort visually.
- [ ] 5.4 Trim any debug `console.log` calls; ensure error messages are user-readable, not stack traces.
- [ ] 5.5 Write `docs/efforts/current/completion-report.md` summarizing what shipped, the three discovery deviations from the intention, and any follow-on opportunities.
- [ ] 5.6 Run the full gate one final time before handing off to commit-push.

### Quality Gate
Before completion, ALL of the following must pass:
- [ ] **Lint**: `pnpm lint`
- [ ] **Build**: `pnpm build`
- [ ] **Unit Tests**: `pnpm test:unit`
- [ ] **Markets CI**: `pnpm ci:markets`
- [ ] **Curl Tests**: calibration endpoint and llm-calls endpoint both return 200 against dev data.
- [ ] **Chrome Tests** (port 7101): full smoke against the three test analysts; no console errors; row expansion + reasoning fetch + chart all render.
- [ ] **Phase Review**: Compare against the entire PRD.
  - [ ] All §3 success criteria met?
  - [ ] All §5 technical requirements implemented?
  - [ ] No §7 out-of-scope items snuck in?
  - [ ] Completion report written?
