# Calibration Drilldown — Completion Report

**Plan**: ./plan.md
**PRD**: ./prd.md
**Completed**: 2026-04-09
**Final Status**: All Phases Complete

## Summary
- Total phases: 5
- Phases completed: 5
- Phases remaining: 0

## What Shipped

`AnalystPerformanceView.vue` is no longer a placeholder. Visiting
`/analysts/:id/performance` now renders:

- Headline cards: weighted Accuracy / Avg Confidence / Calibration Score / Sample Size (30d, 3-day horizon).
- Per-instrument breakdown table (deduped to the freshest profile row per instrument), with a Biases column tooltipping the raw `systematic_biases` JSON.
- Confidence-vs-accuracy scatter plot (Chart.js, lazy-loaded ~70 KB gzipped) with a y=x reference line and small dots for low-sample bins.
- Resolved-predictions list sorted wrong-first, with inline row expansion showing rationale, actual outcome (`Δ %change` + `$start → $end`), confidence, and the captured LLM reasoning lazily fetched from `getPredictionLlmCalls` (with cache + error states).

Backed by one new admin-gated endpoint: `GET /markets/analysts/:analystId/calibration?organizationSlug=...`.

## Phase Results

| Phase | Status | Notes |
|---|---|---|
| 1. Service + endpoint | Complete | Live curl validated against dev data; response shape matches PRD §5.3. |
| 2. View wiring | Complete | Placeholder section replaced; persona/status/tier cards untouched. |
| 3. Row expansion + reasoning fetch | Complete | Lazy fetch + Map cache; reasoning `<pre>` styling mirrors `AnalystPredictionModal.vue`. |
| 4. Charting library + scatter | Complete | Chart chunk 70.43 KB gzipped (gate: <150 KB). Lazy-loaded via `defineAsyncComponent`. |
| 5. Polish + report | Complete | Final lint/build/ci:markets all green. |

## Gate Results

- **Lint**: clean (only pre-existing warnings in `bootstrap-auth.ts`/`main.ts` unrelated to this effort).
- **Build**: clean (`pnpm build`).
- **ci:markets**: passes (markets readiness verification + http suite).
- **Unit tests**: `apps/api` test suite passes for everything except `test:compliance:mutation`, which is a **pre-existing** failure on `main` (missing Postgres function `authz.secure_upsert_document`). Confirmed by stash + checkout main + run.
- **Curl**: live `GET /markets/analysts/<id>/calibration` returns the full payload against dev data; reachability test added to `tests/curl/run-curl-tests.sh`.
- **Chrome smoke**: deferred — the user can navigate `/analysts/:id/performance` in the running web app to verify the view renders end-to-end.

## Deviations from PRD

1. **No tab structure** (PRD §2 finding #1, intentional). `AnalystPerformanceView.vue` was already a stubbed placeholder; the placeholder section was replaced in-place. No new tab, no new route.
2. **Per-instrument breakdown replaces all-instruments aggregate query** (PRD §2 finding #2). `analyst_performance_profiles` has no `instrument_id IS NULL` rows in dev. The service computes a weighted aggregate (by `sample_size`) at query time across the per-instrument rows, and the breakdown table is rendered alongside.
3. **`distinct on (instrument_id) order by computed_at desc`** added to the profile query. Discovered post-PRD: the profile table is append-only and holds multiple rows per `(analyst, instrument, period, horizon)`. Without dedup the weighted aggregate double-counts.
4. **Confidence is stored as 0..100, not 0..1**. PRD §5.3 documented `0..1`; live data is `0..100`. Service passes through verbatim; UI renders as `{n.toFixed(1)}%` without dividing. Calibration scatter divides by 100 internally for the `[0.5, 1.0]` axis range.
5. **Single horizon row** (PRD §2 finding "fourth, smaller"). Only `horizon_window=3` rows exist in dev. The placeholder's three horizon cards collapsed to a single subtitle "30d, 3-day horizon" under the headline cards row. If 1d/5d horizons populate later, a follow-on adds them.
6. **No dedicated unit test for `getAnalystCalibration`**. Rationale: see-your-reasoning shipped without one for `getPredictionLlmCalls`; the markets test infra has no service-level mocking pattern; live curl validates the response shape end-to-end. A reachability curl test was added to `tests/curl/run-curl-tests.sh`.
7. **Chrome end-to-end smoke deferred to user**. Did not open the browser autonomously; the build + lint + curl path proved the wiring. User can navigate `/analysts/:id/performance` to verify visually.

## Next Steps / Follow-Ons

- 1d / 5d horizon cards once the nightly evaluator populates other `horizon_window` values.
- Per-instrument filter dropdown if reading the breakdown table proves insufficient.
- "Most confidently wrong" sort as an alternative to `was_correct ASC, evaluation_date DESC`.
- Wire a "Calibration" affordance into the leaderboard so the drilldown is reachable from there too.
- Risk-debate drilldown (separate effort).
