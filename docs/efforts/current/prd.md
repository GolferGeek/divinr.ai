# Calibration Drilldown — Product Requirements Document

## 1. Overview

Finish `AnalystPerformanceView.vue` by replacing its placeholder section with a real
calibration reading room: per-analyst performance metrics from
`prediction.analyst_performance_profiles`, a list of resolved predictions surfaced
worst-first, a confidence-vs-accuracy scatter plot, and per-row expansion that shows
the captured LLM reasoning next to the actual market outcome. Read-only diagnostic
surface; no calibration computation, no analyst tuning.

## 2. Discovery Findings That Override The Intention

Three findings from discovery reshape the architecture from what the intention assumed.
These are deliberate deviations and the rest of the PRD is written against them.

1. **`AnalystPerformanceView.vue` is already a placeholder for exactly this work.**
   Lines 90–119 contain a `<ion-note>` saying "Performance metrics … will populate
   once the nightly evaluation has run and produced analyst_performance_profiles
   data" plus three em-dash cards for 1-Day / 3-Day / 5-Day Accuracy. The view was
   stubbed expecting this effort. **Decision:** no new tab structure. Replace the
   placeholder section in-place. The intention's "Calibration tab" decision is
   superseded — the entire view is the calibration view, the persona/status/tier
   cards stay above the new content.

2. **`analyst_performance_profiles` has no all-instruments aggregate rows.** All 41
   rows in dev are per-instrument, `period='30d'`, `horizon_window=3`. The intention
   assumed `instrument_id IS NULL` aggregate rows would exist; they don't. **Decision:**
   render the per-instrument rows as a small breakdown table, and compute a single
   weighted aggregate (weighted by `sample_size`) at query time for the headline
   metric cards. The per-instrument breakdown delivers the "see systematic patterns
   without filtering" benefit the intention's per-instrument-filter discussion was
   reaching for, for free.

3. **`actual_outcome_data` has a clean stable shape.** All sampled rows are
   `{symbol, changePercent, priceAtPrediction, priceAtHorizon, startBarTimestamp,
   endBarTimestamp}`. **Decision:** the defensive key-value-dump fallback from the
   intention is unnecessary. Render inline as `Δ −0.16%` and `$372.88 → $372.29`.

A fourth, smaller finding: only `horizon_window=3` data exists today. The placeholder
view's three cards (1-Day / 3-Day / 5-Day) are aspirational. **Decision:** render one
"3-Day Horizon" headline metric block, not three. If/when other horizons populate, a
follow-on adds them.

## 3. Goals & Success Criteria

Goals:
- Replace the placeholder section in `AnalystPerformanceView.vue` with real
  calibration content driven by a new admin-gated read endpoint.
- For any analyst with at least one resolved prediction, a user can: see the headline
  calibration metrics, see a per-instrument breakdown, see a confidence-vs-accuracy
  scatter, scan the resolved predictions wrong-first, and click any row to read the
  captured LLM reasoning next to the actual outcome.
- The drilldown exercises the `getPredictionLlmCalls` endpoint shipped by
  see-your-reasoning in a new context with no changes to that endpoint.

Success criteria:
- Visiting `/analysts/:id/performance` for an analyst with resolved evaluations
  shows: weighted accuracy / avg confidence / calibration score / sample size
  cards; per-instrument breakdown table; scatter chart; resolved-predictions list
  sorted `was_correct asc, evaluation_date desc`.
- Clicking a row expands an inline panel that fetches `GET
  /markets/predictions/:id/llm-calls` and renders `reasoning_content` in a `<pre>`
  block, alongside the predicted direction, actual outcome rendering
  (`Δ %change` + `$start → $end`), confidence at prediction time, and the analyst
  persona prompt.
- Analyst with zero resolved evaluations renders an empty-state note in the
  metrics + list region; the persona/status/tier cards above continue to render.
- All existing markets gates pass: `pnpm ci:markets`, `pnpm test:unit`, smoke flows.
- No regressions in `AnalystsView`, `AnalystPerformanceView` persona/status/tier
  region, or any see-your-reasoning surface.

## 4. User Stories

- **Founder reading calibration:** "The Sentiment Analyst is at 42% accuracy on
  bearish AAPL calls. I open `/analysts/sentiment-analyst/performance`, the headline
  cards confirm it, the per-instrument table shows AAPL is the worst row, the
  scatter shows the bin around 80% confidence is way below the y=x line, the
  resolved list is sorted wrong-first, I click the top row, I read the model's
  rationale next to a `Δ −0.16%` outcome and confirm the model's reasoning was
  about a catalyst that didn't move the price meaningfully."
- **Founder forming a tuning hypothesis:** after reading 5–10 wrong rows the
  founder can decide whether the model is hallucinating, misweighing real signals,
  or correctly bearish on noisy days — the input that justifies a future
  prompt-tuning effort.

## 5. Technical Requirements

### 5.1 Architecture

One new admin-gated read endpoint on `markets.controller.ts`, one new service method
on `markets.service.ts`, no schema changes, no migrations, no new permission. Reuses
`getPredictionLlmCalls` for per-row expansion. New chart library added to
`apps/web` (the first chart library in the repo — explicit decision in §5.5).

### 5.2 Data Model

No changes. Tables consumed:
- `prediction.analyst_performance_profiles` — one row per `(analyst_id,
  organization_slug, instrument_id, horizon_window, period)`. Today: 41 rows, all
  `period='30d'`, `horizon_window=3`.
- `prediction.prediction_horizon_evaluations` — joined to `prediction.market_predictions`
  on `prediction_id` (FK, indexed via `prediction_horizon_evals_prediction_idx`).
- `prediction.market_predictions` — for `predicted_direction`, `confidence`,
  `rationale`, `llm_usage_id`, `created_at`, `instrument_id`.
- `markets.market_analysts` — for `display_name`, `persona_prompt`, scoping.
- `markets.market_instruments` — for `symbol` lookup on the per-instrument breakdown.
- `prediction.llm_usage` — already accessed by `getPredictionLlmCalls`; not
  re-touched.

### 5.3 API

**New endpoint:**

```
GET /markets/analysts/:analystId/calibration?organizationSlug=...
```

Auth: same admin pattern as `getPredictionLlmCalls` and `getPredictionProvenance` —
`getUser(req)` + `resolveIdentity(user, { query: organizationSlug })`. Reuses
`markets.instruments.read` permission per intention dependency rule.

Service method: `markets.service.ts::getAnalystCalibration(orgSlug, userId,
analystId)`. IDOR-safe (every query filters on `organization_slug`). Constructor
injection via `@Inject(...)` per CLAUDE.md.

Response shape (TypeScript-style):

```ts
{
  analyst: {
    id: string;
    displayName: string;
    personaPrompt: string;
    analystType: string | null;
  };
  metrics: {
    period: '30d';
    horizonWindow: 3;
    aggregate: {
      // weighted by sample_size across all per-instrument rows
      accuracyRate: number | null;       // 0..1
      avgConfidence: number | null;      // 0..1
      calibrationScore: number | null;   // raw avg, not weighted — see §5.6
      sampleSize: number;                // sum of per-instrument sample_size
    };
    perInstrument: Array<{
      instrumentId: string;
      symbol: string;
      accuracyRate: number | null;
      avgConfidence: number | null;
      calibrationScore: number | null;
      sampleSize: number;
      systematicBiases: Record<string, unknown>; // verbatim JSONB
    }>;
  };
  resolvedPredictions: Array<{
    predictionId: string;
    evaluationId: string;
    instrumentId: string;
    symbol: string;
    predictedDirection: string;          // bullish/bearish/neutral
    actualDirection: string | null;      // from evaluation row
    wasCorrect: boolean;
    confidence: number | null;           // 0..1, from market_predictions
    predictionDate: string;              // ISO, from market_predictions.created_at
    evaluationDate: string;              // ISO, from prediction_horizon_evaluations
    actualOutcome: {
      changePercent: number;
      priceAtPrediction: number;
      priceAtHorizon: number;
    } | null;                            // null if actual_outcome_data is empty
    hasReasoning: boolean;               // market_predictions.llm_usage_id is not null
  }>;
}
```

Sort: `ORDER BY was_correct ASC, evaluation_date DESC`. Hard cap: `LIMIT 100`. No
pagination affordance in this effort (37 rows in dev; cap is 2.7× headroom).

Empty cases:
- Analyst exists, no profile rows: `metrics.aggregate` filled with nulls + sampleSize 0,
  `perInstrument: []`.
- Analyst exists, no resolved evaluations: `resolvedPredictions: []`.
- Analyst doesn't exist or wrong org: 404 (matches existing controller pattern).

**Reused endpoint** (no change): `GET /markets/predictions/:predictionId/llm-calls`.
Called from the row expansion to fetch `reasoning_content`.

### 5.4 Frontend

`apps/web/src/views/AnalystPerformanceView.vue`:

- Keep existing persona / status / tier cards (lines 42–88) unchanged.
- **Replace** lines 90–119 (the placeholder note + three em-dash cards) with the
  new calibration content, structured as:
  1. Headline cards: Accuracy / Avg Confidence / Calibration Score / Sample Size
     — sourced from `metrics.aggregate`. Each card renders `—` if the value is
     null. A small subtitle on the row reads "30d, 3-day horizon."
  2. Per-instrument breakdown: a small `<ion-card>`-wrapped table (one row per
     `perInstrument` entry) with columns Symbol / Samples / Accuracy / Avg Conf /
     Calibration / Biases. The Biases column renders the count of keys in
     `systematicBiases` and tooltips the JSON, or shows `—` for empty objects.
  3. Confidence-vs-accuracy scatter plot (see §5.5).
  4. Resolved predictions list: scrollable table of rows, each row a clickable
     band showing Symbol · Predicted → Actual · `was_correct` chip · Confidence ·
     Δ%change · Prediction date / Evaluation date. Click expands an inline panel
     below the row.

- Inline expansion panel content:
  - "Predicted: bearish — Actual: bullish (Δ −0.16%)"
  - "$372.88 → $372.29 (Apr 6 → Apr 7)"
  - Confidence at prediction time: `78%`
  - Original `rationale` from the prediction row (already in payload? — see
    §5.6).
  - Captured LLM reasoning: lazy-fetched from `getPredictionLlmCalls` on first
    expand, cached in a local `Map<predictionId, ReasoningPayload>`. Rendered in
    the same `<pre>` block treatment as `AnalystPredictionModal.vue`'s reasoning
    tab — copy the styling, do not invent a new one.
  - Persona prompt is already shown above in the existing Persona card; do not
    duplicate it inside every row.

- Empty state: when `resolvedPredictions.length === 0`, render an `<ion-note>`
  reading "No resolved predictions yet — the nightly evaluation will populate this
  view once predictions reach their horizon."

- Loading: a single `ion-progress-bar` while the calibration endpoint is in flight,
  same pattern as the existing view.

- Errors: a banner with the error message; existing surface continues to render.

A new pinia store is **not** introduced — the view fetches via `useApi()` directly,
matching the current `AnalystPerformanceView.vue` pattern.

### 5.5 Charting Library

Adds the first charting dependency to `apps/web`. Per the intention's pinned
decision:

- `chart.js` (latest 4.x — pin exact in `package.json`)
- `vue-chartjs` (latest 5.x compatible with Chart.js 4)
- `chartjs-plugin-annotation` (latest compatible)

Component: a small `<CalibrationScatter />` SFC under
`apps/web/src/components/`. Lazy-imported via dynamic `import()` so the chart
bundle only loads when this view mounts. Bucketing: 5 bins (50–60, 60–70, 70–80,
80–90, 90–100). For each bin: x = bin midpoint, y = `correct / total` for rows
whose `confidence` falls in that bin. Bins with < 2 rows render with a smaller
radius; bins with 0 rows are dropped. The y=x reference line is drawn via
`chartjs-plugin-annotation`. Axis range fixed to `[0.5, 1.0]`.

The bucketing happens client-side off `resolvedPredictions` so the endpoint stays
generic.

### 5.6 Open Implementation Details (resolved here, not deferred)

- **Calibration score aggregation:** `analyst_performance_profiles.calibration_score`
  is per-instrument and not trivially weight-aggregatable in a meaningful way
  without re-deriving from samples. The endpoint emits the **un-weighted average**
  of the per-instrument scores into `aggregate.calibrationScore`, and the response
  shape documents this. Per-instrument scores are also surfaced in the breakdown
  table so the un-weighted aggregate is never the only number a reader sees.
- **`rationale` in payload:** included on each `resolvedPredictions` entry as
  `rationale: string | null`. Cheap (a few hundred bytes per row), avoids a second
  fetch when expanding a row, fits inside the 100-row cap comfortably.
- **`actualDirection` source:** `prediction_horizon_evaluations` has its own
  direction column; if absent, derived from `sign(changePercent)` of
  `actual_outcome_data` server-side. Decision deferred one level: the service
  method reads whichever evaluation column is present (`actual_direction` /
  `outcome_direction` — implementation phase confirms exact name) and falls back
  to the sign-of-change derivation only if both columns are missing.
- **Sample size cap:** the `LIMIT 100` is applied to `resolvedPredictions` only;
  `metrics.aggregate.sampleSize` reflects the true row count from the profile
  table, not the capped list.

## 6. Non-Functional Requirements

- **Performance:** endpoint payload < 50 KB for an analyst with 100 resolved
  predictions. Single round-trip on view mount; per-row LLM-calls fetch is lazy.
  Chart library loads only on this view (dynamic import).
- **Security:** every SQL query filters on `organization_slug`. Same admin gate
  pattern as the two prior efforts. No new permission. IDOR-safe by construction.
- **DI:** every constructor parameter uses explicit `@Inject(ClassName)` per
  `CLAUDE.md` — required for `tsx`-driven tests.
- **Compatibility:** Chart.js 4 + vue-chartjs 5 must build cleanly under the
  existing Vite config. No SSR concerns (web app is SPA).
- **Bundle impact:** ~70 KB gzipped for chart deps, lazy-loaded — not in the
  initial app shell. Documented in commit message.
- **No regressions** in `pnpm ci:markets`, `pnpm test:unit`, or smoke flows.

## 7. Out Of Scope

Inherits all out-of-scope items from intention §"Out Of Scope". Additionally
out of scope per discovery:
- Adding 1-day / 5-day horizon cards back. Only horizon_window=3 data exists.
- Pagination, search, filtering across the resolved-predictions list.
- A new pinia store.
- Cross-analyst comparison views.
- Touching `AnalystPredictionModal.vue` or any see-your-reasoning surface.
- Any change to `getPredictionLlmCalls` or its service method.
- Per-instrument filter dropdown (the breakdown table replaces the need).
- Risk-debate drilldown.

## 8. Dependencies & Risks

Dependencies (all merged, all verified):
- `see-your-reasoning` (commit `11e79a9`) — provides `getPredictionLlmCalls`.
- `auth-bootstrap` (commit `ad1004d`) — admin gate.
- `llm-reasoning-capture` (commit `c36e3e1`) — `llm_usage.reasoning_content`.
- Nightly evaluation pipeline keeps populating
  `prediction_horizon_evaluations` and `analyst_performance_profiles`.
- `prediction_horizon_evaluations.prediction_id → market_predictions.id` (verified).

Risks:
- **R1: actual_direction column name uncertainty.** Discovery sampled
  `actual_outcome_data` but did not lock the direction column name on
  `prediction_horizon_evaluations`. Mitigation: implementation phase 1 confirms
  the exact column via `\d` and adjusts the service query before any UI work.
- **R2: Chart.js + Vite integration friction.** First chart lib in the repo;
  unknown until installed. Mitigation: phase 4 is dedicated to charting and is
  validated independently before being wired into the view.
- **R3: Calibration score aggregation may mislead.** The un-weighted avg can
  hide a single noisy instrument. Mitigation: per-instrument table is rendered
  prominently below the headline so the aggregate is never the only number.
- **R4: Empty `actualOutcome` rows.** If any evaluation row has `'{}'::jsonb`
  outcome data, the row renders without the Δ% pill. Mitigation: handled
  explicitly in the response shape (`actualOutcome: ... | null`) and the
  template's v-if branch.
- **R5: Bundle bloat surprise.** ~70 KB gzipped is acceptable; if it lands
  bigger (Chart.js 4 tree-shaking has gotchas), phase 4's gate measures the
  built bundle and the PRD-compliance check fails if it exceeds 150 KB gzipped
  for the chart chunk.

## 9. Phasing

Each phase ends with quality gates: `pnpm ci:markets`, `pnpm test:unit`,
manual smoke of the affected surface. Each phase is independently mergeable.

**Phase 1 — Service + endpoint, no UI.**
Add `getAnalystCalibration` to `markets.service.ts`. Confirm the
`actual_direction` column name on `prediction_horizon_evaluations`. Wire the
endpoint into `markets.controller.ts` following the
`getPredictionLlmCalls`/`getPredictionProvenance` shape exactly. Add a focused
unit test that hits the endpoint with a fixture analyst and asserts the
response shape, the wrong-first sort, the IDOR filter, and the empty cases.
Validate with `pnpm ci:markets`. Payload validated against real dev data via
curl.

**Phase 2 — View wiring without chart.**
Replace the placeholder section in `AnalystPerformanceView.vue` with: headline
metric cards, per-instrument breakdown table, resolved-predictions list with
wrong-first sort. No row expansion yet, no chart yet. Empty state and loading
states wired. Validate against an analyst with data and one without.

**Phase 3 — Row expansion + reasoning fetch.**
Add the inline expansion panel. Wire the lazy fetch to
`getPredictionLlmCalls` with a local `Map` cache. Match the `<pre>` styling
from `AnalystPredictionModal.vue` exactly. Validate by reading reasoning for
several wrong predictions end-to-end.

**Phase 4 — Charting library + scatter plot.**
Add `chart.js`, `vue-chartjs`, `chartjs-plugin-annotation` to
`apps/web/package.json` with pinned versions. Build the
`<CalibrationScatter />` component with dynamic import. Drop it into the view
between the per-instrument table and the resolved-predictions list. Validate
chart renders with real data, y=x line is correct, low-sample bins are
visually distinct, and the chart chunk is lazy-loaded (verified via build
output). Gate: chart chunk < 150 KB gzipped.

**Phase 5 — Polish + completion report.**
Tighten copy, ensure error states are graceful, check the empty-state path
once more, check that the persona/status/tier cards above are unchanged. Run
`pnpm ci:markets`, `pnpm test:unit`, smoke the view for an analyst with data
and an analyst with none. Write completion report. PR.
