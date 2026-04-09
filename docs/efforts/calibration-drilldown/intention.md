# Calibration Drilldown — Intention

## What This Effort Is

Build the post-mortem view that lets you click an analyst (or a single resolved-and-wrong prediction) and see the original LLM reasoning side-by-side with what actually happened in the market. The goal is not to assign blame to a model — it's to *understand* why the model was wrong, in the model's own words, on the rows that matter.

This is the calibration story divinr.ai was conceived around. The leaderboard already has the *what* (accuracy rate, calibration score, sample size). The reasoning capture effort built the *why is data*. The see-your-reasoning effort surfaced the *why* in a single-prediction modal. **This effort connects them**: pick an analyst with low calibration → see all their wrong predictions → click one → read the model's actual chain of thought next to the ground-truth outcome.

It's not a calibration *engine* — divinr already has `prediction.analyst_performance_profiles` populated by the nightly evaluation. It's a calibration *reading room*.

## Why It Matters For Divinr

Today on the dashboard you can see "Sentiment Analyst — 42% accuracy on AAPL bearish calls last 30d." That number is currently a dead-end. There's no path from the number to "OK, *which* bearish calls were wrong, and *why* did the model think they'd be bearish?"

Without that path, the calibration metric is decoration. It tells you the model is wrong but gives you nothing to do about it. You can't:
- Tell whether a low calibration analyst is hallucinating facts vs misweighing real signals vs correctly bearish on stocks that just didn't move
- Decide whether an analyst's tier should change (the user's product strategy involves tier-gated analysts, 5 per domain)
- Improve the analyst's prompt because you have no idea what's actually going wrong inside the LLM's head
- Tell whether the model is producing genuinely bad analysis or producing genuinely good analysis that happens to lose on noisy days

With the drilldown, all four become possible — within an evening of reading reasoning rows.

There's also a defensive product angle. Divinr's whole story is "explainability over black-box trading bots" and "analysis/signal not advice/recommendation." Right now that story is rhetoric — the system has the data to be explainable but the explainability is invisible. The drilldown is the moment the rhetoric becomes a thing a user can see.

## Why Now

- The reasoning capture rate is 96% on real calls. The data is there.
- 37 resolved horizon evaluations exist in dev right now. Small but enough to design against; the pipeline keeps producing more every cycle.
- `prediction.analyst_performance_profiles` already has `accuracy_rate`, `avg_confidence`, `calibration_score`, `sample_size`, and `systematic_biases` — populated nightly by the existing learning pipeline. No new computation needed.
- Both `prediction_horizon_evaluations` and `analyst_performance_profiles` already have the right indexes (`analyst_id, organization_slug` for both). No schema work needed.
- The see-your-reasoning effort just shipped the rendering pattern (modal-tab with monospace pre-block + provider/model/token header). This effort copies that pattern, so the UI work is "wire up new data into proven components."
- This effort exercises everything that just shipped (auth, reasoning capture, see-your-reasoning) end-to-end against real product data. Anything fragile surfaces here before a real user sees it.

## What Good Looks Like

- A new view (or a new section on an existing view) lets you pick an analyst from a list and see their resolved predictions, ordered with the wrong ones surfaced first.
- Each row shows: instrument symbol, predicted direction, actual direction, was_correct, confidence at prediction time, prediction date, evaluation date.
- Clicking a row opens a detail surface (modal, panel, or expander — PRD picks the cheapest one) showing:
  - The original prediction's full rationale (already in `market_predictions.rationale`)
  - The captured LLM reasoning content from `llm_usage.reasoning_content`, joined via `llm_usage_id` (the data path the see-your-reasoning effort already proved)
  - The actual outcome data from `prediction_horizon_evaluations.actual_outcome_data` (a JSONB blob with whatever the nightly evaluator wrote)
  - The analyst's persona prompt for context (from `market_analysts.persona_prompt`)
- An admin-gated read endpoint backs all of this, following the pattern established by `getPredictionLlmCalls` and `getPredictionProvenance`.
- A calibration summary at the top of the analyst view shows the existing `analyst_performance_profiles` metrics: `accuracy_rate`, `avg_confidence`, `calibration_score`, `sample_size`, and a brief breakdown of `systematic_biases` if non-empty.
- Empty state: when an analyst has no resolved evaluations, the view shows "no resolved predictions yet" rather than crashing.
- All existing markets gates pass. No regressions in `pnpm ci:markets`, `pnpm test:unit`, or any of the smoke flows we just verified.

## Out Of Scope

- **Actually changing analyst behavior** (tuning prompts, retiring underperforming analysts, swapping models). The drilldown is read-only. A future "analyst tuning" effort builds the write path; this one builds the diagnostic path that informs it.
- **A new calibration *computation*.** `analyst_performance_profiles` is populated by the existing nightly evaluation pipeline; this effort consumes it as-is. If the metrics turn out to be wrong or the pipeline is slow, that's a separate effort.
- **A real "what should I do about it" recommendation engine.** No "this analyst is hallucinating, demote them" automation. Humans read the reasoning and form opinions; the drilldown surfaces the data, not the recommendation.
- **Export, share, comment on, or annotate reasoning rows.** All reasonable follow-ons. None required for "let me read what went wrong."
- **Pagination, search, filtering across thousands of evaluations.** With 37 resolved evals in dev today, naive list rendering is fine. PRD picks a reasonable upper bound (maybe 100 rows) with a "fetch more" affordance only if needed.
- **Cross-analyst comparison views.** "Sentiment vs Fundamentals on the same instrument" is a different shape of view. Out of scope. Per-analyst only.
- **Per-prediction risk debate / arbitrator drilldown.** The risk debates table already has reasoning linked through `llm_usage_id` (from the reasoning capture effort), but visualizing the three-way blue/red/arbiter debate is its own interaction-design problem. Stick to the analyst-prediction pairing; defer debates.
- **Touching the leaderboard view.** The leaderboard already shows the metric that motivates this effort. A "click an analyst → drilldown" affordance from the leaderboard is a nice-to-have but not required if the dedicated calibration view exists.
- **A new permission.** Reuse `markets.instruments.read` per the pattern the prior two efforts established.

## Where It Fits In The Roadmap

**Immediately after** `see-your-reasoning`. That effort surfaced reasoning for a *single* prediction in the modal. This effort surfaces it across an analyst's history of resolved predictions. The two views share the same `llm_usage_id` join, the same `<pre>` rendering, the same auth gate, the same lazy-fetch pattern. This is the natural upward progression: from one prediction to many to (eventually) cross-analyst patterns.

**Before** any analyst-tuning / prompt-editing / model-swapping efforts. You can't justify changes to a model's prompt or weight without first having a view of *why* that model is wrong. This is the diagnostic step that informs everything downstream.

**Before** any "share with a beta user" effort. The drilldown is the demo moment that takes divinr from "shows predictions" to "explains why predictions were right or wrong." Until that moment exists, the explainability story is invisible.

## Decisions (answered before PRD-build)

- **Wide vs deep first cut**: **deep**. No top-level "Calibration" list view in this effort. Pick an analyst (from the existing `Analysts` view, a dropdown, or whatever attachment point PRD discovery picks) and land directly in their detail view. The detail view does the actual work — list of resolved predictions + reasoning links + persona prompt + calibration summary. A "scan all analysts" leaderboard surface is a follow-on if the existing analyst list turns out to be insufficient. Reasons: (a) the existing `Analysts` view already lists analysts so a new list duplicates 80% of that surface; (b) the user is the only user today, so leaderboard triage is less useful than per-analyst depth; (c) one view + one new endpoint is ~1 day vs 1.5 days for wide, and the saved budget goes into making the detail view rich enough to actually read.

- **Entry point**: a new **Calibration tab on the existing `AnalystPerformanceView`** (router path `analysts/:id/performance`). Zero new routes, zero new top-level nav items, the URL is already analyst-scoped so deep-linking works for free. PRD discovery first reads `AnalystPerformanceView.vue` to confirm it has (or can cheaply get) a tab structure — if it's a flat scrolling page today, the PRD escalates to either (a) introducing a tab structure + putting Calibration in it, or (b) appending the calibration content as a new section instead. The mental model is the same as the see-your-reasoning effort's choice to add a tab to the existing modal: extend an existing surface rather than build a new one.

- **Endpoints**: **one new endpoint, plus reuse of the see-your-reasoning endpoint**.
  - **New**: `GET /markets/analysts/:analystId/calibration?organizationSlug=...` returns the analyst summary (display name + persona prompt) + calibration metrics from `analyst_performance_profiles` (`accuracy_rate`, `avg_confidence`, `calibration_score`, `sample_size`, `systematic_biases`) + the list of resolved predictions joined from `prediction_horizon_evaluations` to `market_predictions` (instrument symbol, predicted/actual direction, was_correct, confidence at prediction time, prediction_id, llm_usage_id presence flag, dates). **No reasoning content in this payload** — that comes from the second endpoint on demand. Expected size: ~5 KB for ~40 rows. PRD pins the exact response shape.
  - **Reused**: `GET /markets/predictions/:predictionId/llm-calls` (shipped by see-your-reasoning) for per-row reasoning fetch when the user expands a prediction. Already proven; lazy; one indexed join. Fetched only when the user clicks a row.
  - Why this split: keeps the tab-open payload small (snappy on slow connections), matches the "scan list → focus on a few rows" reading pattern, exercises the see-your-reasoning endpoint in a new context which is good shakedown, and avoids duplicating join logic.

- **Default sort for the resolved-predictions list**: **wrong predictions first, then by evaluation date desc** (`order by was_correct asc, evaluation_date desc`). Matches the diagnostic frame of the whole effort — the point of opening the tab is to read what went wrong, so the wrong rows surface to the top with the freshest mistakes first within that bucket. Mechanically simple SQL, no derived columns. No sort dropdown in this effort; if the default turns out to be wrong, swap it in a follow-on. A more clever "confidence × wrongness" sort (which would surface the most confidently-wrong predictions first) was considered and rejected as marginally better but harder to explain — it's a reasonable follow-on if first-cut reading reveals the simple sort isn't surfacing the right rows.

- **Per-instrument filter**: **all instruments at once, no filter in this effort**. The new endpoint queries `analyst_performance_profiles where instrument_id is null` for the metrics (the nightly pipeline already writes these all-instruments aggregates) and returns every resolved evaluation across every instrument for the predictions list. The `systematic_biases` JSONB column from `analyst_performance_profiles` is surfaced verbatim — the nightly pipeline writes per-instrument patterns into it, so cross-instrument bias is *summarized* in the aggregate view without needing UI filtering. Reasons: (a) the entry point is `AnalystPerformanceView` so context is "this analyst," not "this instrument"; (b) ~37 resolved evals total today means per-instrument slicing leaves 2-3 rows per instrument, too small to see a pattern; (c) a filter is the right follow-on once you've read enough all-view drilldowns to know the systematic_biases summary isn't enough.

- **`actual_outcome_data` rendering**: PRD-build discovers the real shape during its discovery phase by reading 5 sample rows out of `prediction_horizon_evaluations` (`select actual_outcome_data from prediction.prediction_horizon_evaluations where actual_outcome_data <> '{}'::jsonb limit 5;`), then specifies a clean per-key rendering against that shape. Most likely the nightly evaluator writes a stable structure (e.g. `{start_price, end_price, percent_change}`) and we render "Δ −2.49%" or similar inline next to the predicted vs actual direction. If discovery reveals heterogeneous shapes across rows (different keys per row, deep nesting, etc.), the PRD falls back to a defensive debug-style key-value dump in the row detail expander rather than risk a misleading clean rendering. Skipping the column entirely was considered and rejected — without "how big was the move," the diagnostic value drops a lot (a wrong prediction by 0.1% is very different from a wrong prediction by 8%).

- **Confidence vs accuracy chart**: **included in this effort**. The calibration view renders the canonical confidence-vs-accuracy scatter plot (confidence buckets on x-axis, actual accuracy in each bucket on y-axis, with a y=x ideal line). The point cloud's deviation from the ideal line is the visual answer to "is this analyst overconfident, underconfident, or well-calibrated?" — the signature visualization for the word "calibration."

  **Charting library**: **`chart.js` + `vue-chartjs` + `chartjs-plugin-annotation`**. ⚠️ **This becomes divinr.ai's default charting library** — no charting deps exist in `apps/web` today, so this effort introduces the first one. Chosen because: (a) the chart we need (scatter + reference line) is first-class in Chart.js with the official annotation plugin; (b) ~70 KB gzipped is acceptable for a desktop dev tool; (c) `vue-chartjs` exports `<Scatter />` directly importable in Vue 3 SFCs, no wrapper code; (d) Chart.js handles bar/line/donut/radar/etc. so future charts in divinr won't need a second library; (e) it's the boring correct answer with the most StackOverflow coverage. Rejected: ECharts (overkill bundle for one chart), Plotly (3 MB, scientific-grade overkill), hand-rolled SVG (saves bundle but means rebuilding axis math + tooltips + legend for every future chart). The PRD pins exact versions and adds the deps to `apps/web/package.json`.

  **Bucketing**: confidence is bucketed into ~5 bins (50–60%, 60–70%, 70–80%, 80–90%, 90–100%). For each bin, the chart plots one point at `(midpoint_confidence, percentage_correct_in_bin)`. With ~37 resolved evals total today, some bins will have 1-2 rows; the PRD specifies that bins with fewer than N rows (probably 2 or 3) either render with a smaller dot to indicate low sample size, or are dropped entirely. This is honest about the small dataset rather than pretending the chart is more reliable than it is.

  **The chart is rendered inside the calibration tab**, so it loads lazily — only when the user opens the tab. Zero impact on dashboard load latency.

## Open Questions To Settle When This Effort Starts

- **Where does the entry point live?** Three plausible homes: (a) a new top-level "Calibration" route in the nav, (b) an addition to the existing `Analysts` view (which already lists analysts — clicking one currently goes to `AnalystPerformanceView`, which may or may not be the right home), (c) an addition to the existing `Evaluations` view. PRD checks what these views currently render and picks the cheapest attachment point.
- **List view or per-analyst view first?** Two scopes:
  - *Wide*: a list of all analysts with their calibration scores, click one to see their predictions
  - *Deep*: jump directly into a specific analyst's view, picking the analyst from a dropdown
  Wide is more leaderboard-y; deep is more drilldown-y. PRD picks one based on what the existing nav feels like.
- **One endpoint or two?** A single `GET /markets/analysts/:analystId/calibration?orgSlug=...` could return the profile + the list of evaluations + reasoning links in one shot. Or two endpoints: one for the analyst summary, one for the per-prediction reasoning (reusing `getPredictionLlmCalls`). The two-endpoint approach reuses the see-your-reasoning endpoint as-is — leaning that way.
- **Confidence vs accuracy chart?** The leaderboard might benefit from a small calibration plot (confidence on x-axis, actual accuracy on y-axis, ideal line at y=x). It's a real diagnostic tool but it adds a charting library decision. Likely defer to a follow-on; first cut is text-and-table only.
- **Sorting and filtering**: by date desc? by was_correct first then date? by abs(confidence - actual)? The "wrong predictions surfaced first" framing in §What Good Looks Like is a default, not a settled choice. PRD picks one.
- **`actual_outcome_data` JSONB shape**: I haven't read what the nightly evaluator actually writes into it. Could be price moves, percent changes, settlement notes, anything. PRD discovery checks before designing the rendering.
- **Per-instrument vs all-instruments view for a single analyst**: a "Sentiment Analyst on AAPL" filter is more useful than "Sentiment Analyst across everything." `analyst_performance_profiles` has `instrument_id` (nullable) so the data supports either. PRD picks default + filter affordance.

## Dependencies

- `see-your-reasoning` is merged. ✅ (commit `11e79a9`)
- `auth-bootstrap` is merged. ✅ (commit `ad1004d`)
- `llm-reasoning-capture` is merged. ✅ (commit `c36e3e1`)
- The nightly evaluation pipeline must keep populating `prediction_horizon_evaluations` and `analyst_performance_profiles`. Verified: 37 resolved evals exist now. No changes to the pipeline are required by this effort.
- `prediction_horizon_evaluations.prediction_id` continues to FK back to `market_predictions.id`. Verified in schema — the index `prediction_horizon_evals_prediction_idx` confirms it's the lookup key.
- No concurrent refactors of `markets.controller.ts`, `markets.service.ts`, the analyst views, or the auth middleware while this effort is in flight.
