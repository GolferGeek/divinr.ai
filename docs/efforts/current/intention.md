# See Your Reasoning — Intention

## What This Effort Is

Make the LLM reasoning content that's now being captured into `public.llm_usage` and linked to markets analysis rows actually *visible* in the divinr web app. Today the data lands silently every time the pipeline runs — 1500–2500 chars of real model thinking per analyst call — but there is no surface in the UI that lets you click a prediction (or a predictor row, or a risk assessment) and see what the model was actually thinking. The reasoning capture effort deliberately deferred all UI work to a follow-on. This is that follow-on.

## Why It Matters For Divinr

Divinr's product story is *explainability over black-box trading bots*. The LLM reasoning capture effort built the data path. The Calibration column built the leaderboard surface. But the moment a user (or you) clicks an analyst with an interesting prediction, the next question is "why did the model say that?" — and right now the answer is silence in the UI even though the answer exists in the database.

Concretely, surfacing reasoning unlocks four things:

1. **The reasoning capture effort starts paying its rent.** As of right now we're persisting an extra 1.5–3 KB per LLM call into `llm_usage.reasoning_content`. That's storage cost with zero user-facing benefit until something reads it. This effort closes the loop.

2. **You stop having to drop into psql to inspect the model.** The current verification flow for "what did gemma4 actually say about MSFT?" is to write a join query, run it in a terminal, and read raw text. That's fine for one-off debugging but it's not going to scale to "I want to spot-check 20 analyst calls before tomorrow's market open."

3. **Calibration becomes diagnosable.** A low calibration score is currently a dead-end on the leaderboard. Pair it with the reasoning behind each resolved-and-wrong prediction and you can finally tell whether the model is hallucinating facts, misweighing signals, or correctly bearish on something that just didn't pan out. This is not the full "calibration drilldown" effort — that's its own thing — but it's the minimum surface needed to even start that investigation.

4. **It validates the data quality before you commit to bigger UX investments.** Right now you have two assumptions that haven't been visually pressure-tested: (a) gemma4:e4b's reasoning is actually useful, not just verbose; (b) the markets prompt patterns produce reasoning that's worth showing to a user. Until reasoning is rendered in the UI you can't tell. A small, ugly proof-of-concept view answers both questions in an afternoon.

## Why Now

The data has been flowing for under a day but the capture rate is already at 96% (22/23 calls in the verification window) with 100% trace coverage on `market_predictors → llm_usage`. The plumbing is solid. Every hour that passes, the dataset of captured reasoning grows — but right now the only consumer is psql, which means the dataset isn't actually being *used*. The longer you wait to put even a minimal viewer in front of yourself, the more reasoning piles up unseen and the harder it is to spot whether the capture is producing useful content vs garbage.

There's also a momentum reason: the auth bootstrap landed in the same session, so for the first time the web app is actually authenticated against real users with real RBAC. Adding a new admin-ish view is the natural shakedown of "does the new auth path actually carry the right identity through to a new endpoint." Putting it off lets the auth + reasoning efforts cool separately, which loses the benefit of testing them together.

## What Good Looks Like

- The dashboard's existing prediction cards (or the prediction detail view, whichever is closer to the user's mental model) gain a "Show reasoning" affordance that's only visible when there is reasoning to show.
- Clicking it lazy-loads the captured reasoning for that prediction's underlying LLM calls — analyst row, arbitrator row, whatever else is linked via `llm_usage_id` — and renders the text in a `<pre>`-style block with a small header showing model + provider + token counts.
- The fetch is a new admin-gated endpoint on the API: `GET /markets/predictions/:id/llm-calls` (or similar — naming is a PRD decision, not an intention decision). It joins `market_predictions → llm_usage` via `llm_usage_id` and returns whatever fields the UI needs. **It does not bloat the existing dashboard payload** — leaderboard endpoints stay byte-identical; this is opt-in.
- Same surface for `market_predictors` rows on the predictors view and `analyst_risk_assessments` on the risk view, *if* it's cheap to extend the same pattern. If it requires per-table specialization, scope it to predictions for this effort and follow on for the others.
- The endpoint requires authentication and returns 403 to users who don't have permission on the org owning the prediction. Default markets RBAC permissions cover this; no new permission rows.
- "No reasoning available" is a graceful empty state, not an error. Reasoning may be null on legacy rows, on non-reasoning-capable model calls, on truncated rows.
- All existing markets gates pass. No regressions in `pnpm ci:markets`, `pnpm test:unit`, or any of the smoke flows we just verified.

## Out Of Scope

- **A real "analyst post-mortem" page.** That's the calibration drilldown effort. This effort is not "design a beautiful diagnostic experience" — it's "make the captured reasoning visible in the simplest possible way so you can read it without psql."
- **Token streaming** of reasoning. The reasoning capture effort was explicit that streaming was out of scope; that hasn't changed. Reasoning is fetched as a complete string from the existing column, not streamed live from the model.
- **Per-call cost rollups.** `llm_usage` has `total_cost` and the markets pipeline knows token counts, but computing $/prediction is its own concern and should not block this view.
- **Sanitization.** Reasoning content goes from `llm_usage.reasoning_content` straight to the UI. The PII sanitization concerns flagged in the reasoning capture completion report are still real, but they're a separate effort. The mitigation here is that the endpoint is admin-gated, so reasoning is only visible to authenticated users with markets-write on the org — same audience that already sees raw trade data.
- **Editing reasoning, exporting reasoning, sharing a link to a reasoning view, deep-linking from leaderboard rows, search inside reasoning text.** All of these are reasonable follow-ons. None of them are required for "make it visible at all."
- **A separate admin route hierarchy.** Putting the reasoning view inline on existing prediction cards is the goal. A dedicated `/admin/reasoning` page is over-engineering for this scope.
- **Touching the Challenge SSE stream.** The reasoning capture effort flagged "challenge stream prompt enrichment" as a follow-on; that's a different effort. This one is read-only UI, not prompt rewriting.
- **The risk debate per-turn reasoning surface.** Risk debates store the arbiter's `llmUsageId` on the row plus blue/red usage ids inside the `transcript` JSON. Visualizing that three-way debate is a bigger interaction-design problem than scopes here. If the same predictions endpoint can return risk-debate reasoning as a side-effect of being "all LLM calls touching this run," fine — but no separate debate UI.

## Where It Fits In The Roadmap

**Immediately after** `llm-reasoning-capture` and `auth-bootstrap`. Both just merged. The data is flowing, auth works, the new endpoint will be the first one built against the post-bypass auth path — which is exactly the kind of small, well-scoped, end-to-end shakedown that should land while both prior efforts are still fresh in your head.

**Before** any of the bigger reasoning-driven efforts (calibration drilldown, challenge stream enrichment, post-mortem dashboards). Each of those depends on you having actually *looked at* the captured reasoning. Without this effort you're designing those features blind.

## Decisions (answered before PRD-build)

- **Affordance**: accordion or second modal, depending on which fits the existing prediction display pattern. Either way it lives **inline near the existing prediction view**, not as a separate admin route. PRD discovery picks the pattern that matches the current dashboard.
- **Endpoint shape**: lean toward **many** (one endpoint per analysis-table type), with the predictions endpoint being the only one in scope for this effort. If the same pattern is cheap to extend to predictors / risk-assessments, do it; otherwise follow-on. Plural for predictions (`/predictions/:id/llm-calls` — a single prediction can have multiple LLM calls behind it: analyst, arbitrator, debate turns), singular for the per-row tables when they get added (`/predictors/:id/llm-call`, `/risk-assessments/:id/llm-call`).
- **Auth gating**: **reuse the existing `markets.instruments.read` permission** for now. New admin-only permissions can be added later if reasoning content turns out to be more sensitive than other markets data. PRD documents the rationale + the trivial follow-on path.
- **Prediction-detail route**: **discover whether one exists in the current router**; if yes, attach the affordance there. If no, **create a minimal one** as part of this effort — a simple `/predictions/:id` route that renders enough context to make "show reasoning" meaningful.
- **Legacy / null reasoning rows**: when `llm_usage_id` is null on the analysis row, OR `reasoning_content` is null on the joined `llm_usage` row, **render the affordance in a disabled state** (greyed out, optional tooltip explaining "this call did not produce reasoning content"). Many existing agents — confirmed against the user's parallel Orchestrator AI work — don't use thinking-capable models, so null is a normal state rather than an error.

## Open Questions To Settle When This Effort Starts

- **Where does the "Show reasoning" affordance live?** Three plausible homes: (a) inline expander on the dashboard's prediction cards, (b) a new tab or section on a dedicated prediction-detail view that may not exist yet, (c) a column on the predictors / risk views. Cheapest first; pick one and ship.
- **What's the endpoint's response shape?** The PRD has to decide whether the response is flat (`{calls: [{model, reasoning, tokens}]}`) or grouped by call_purpose / analyst / role. Lean toward flat unless the UI immediately needs grouping.
- **One endpoint or many?** A single `/markets/predictions/:id/llm-calls` endpoint that returns everything (analyst + arbitrator + risk debate) is one option. Per-table endpoints (`/predictors/:id/llm-call`, `/risk-assessments/:id/llm-call`) is another. Single endpoint is probably right for the UI but may pull more than the view needs.
- **Auth gating.** Admin-only via a new permission, or just gated behind the existing `markets.instruments.read` (which any authenticated user with org access has)? The reasoning content is sensitive enough that "any read user" might be too permissive, but introducing a new permission is over-engineering for a shakedown effort. Probably reuse existing read permission and call out the sharper question as a follow-up.
- **What about reasoning on the older / legacy prediction rows?** Pre-effort rows have `llm_usage_id = null`. The UI should handle that gracefully (no "Show reasoning" link, or a disabled state with a tooltip). PRD should specify which.
- **Does the existing dashboard have a prediction-detail route at all?** If yes, that's the obvious home. If no, this effort either creates one or piggybacks on whatever modal/expander pattern the dashboard already uses for prediction details.

## Dependencies

- `llm-reasoning-capture` must be merged. ✅ It is.
- `auth-bootstrap` must be merged. ✅ It is.
- The web app must currently be able to render any new UI we add — i.e. the current dashboard or detail views must have a place to attach the affordance, or this effort needs to add a small new view from scratch. PRD discovery confirms which.
- Captured reasoning must continue accumulating in `llm_usage.reasoning_content` for the duration of this effort so there's data to render against. (It is, at ~26 rows per pipeline cycle.)
- No concurrent refactor of `markets.controller.ts`, `markets.service.ts`, the auth controller, or the tenant store. All three are in scope for adjacent edits.
