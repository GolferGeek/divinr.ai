# LLM Reasoning Capture — Intention

## What This Effort Is

Capture the *thinking tokens* that reasoning-capable LLMs produce during analyst calls, persist them alongside the existing per-call telemetry, and surface them in the places where "why did the analyst say this?" is the next question a user is going to ask: the Challenge stream, the Calibration drilldown, and prediction provenance.

This is **not** a streaming-UX effort. It's a buffered, additive capability inside the LLM client. Streaming is purely an internal implementation detail so the provider can split the thinking channel from the output channel before returning a single buffered response.

## Why It Matters For Divinr

Divinr's whole product story is *explainability over black-box trading bots*. The recently shipped Calibration column makes that promise visible at the leaderboard level — but the moment a user clicks an analyst with 40% calibration, the next question is "why was it wrong?" Today the answer is silence: the model's reasoning is discarded inside `callLLM` before the response ever reaches the analyst service.

Concretely, reasoning capture unlocks four things that are already partially built and waiting for it:

1. **Challenge feature gets real teeth.** `/predictions/:id/challenge` already streams analysts re-evaluating each other's conclusions. With captured reasoning, a challenger can rebut the *argument*, not just the label — turning a multi-analyst consensus check into an actual debate the user can follow.
2. **Calibration becomes diagnosable.** A low calibration score is currently a dead-end. Pair it with the analyst's reasoning on each resolved-and-wrong prediction and a user (or a future "analyst tuning" feature) can see whether the model is hallucinating facts, misweighing signals, or correctly bearish on something that just didn't pan out.
3. **Provenance becomes complete.** `getPredictionProvenance` already exists. It returns the inputs and the conclusion. The middle layer — the chain of reasoning that connects them — is the missing field.
4. **Arbitrator (Mini-Me) becomes evaluable.** The Arbitrator synthesizes multiple analyst outputs. With per-analyst reasoning captured, we can ask whether the Arbitrator actually weighed the *arguments* or just averaged the labels. That's the difference between "AI ensemble" and "AI assembly line."

There's also a defensive legal angle: divinr is required to frame everything as "analysis/signal" not "advice/recommendation." Showing the reasoning behind a signal strengthens that posture — *the system didn't recommend, the analyst observed X and Y and labeled it bearish.*

## What Good Looks Like

- An analyst run that uses a reasoning-capable model captures the thinking content and stores it alongside the existing LLM-call telemetry, scoped to the prediction that triggered the call.
- An analyst run that uses a non-reasoning model behaves exactly as it does today — no new fields populated, no UI surface, no errors.
- The Challenge SSE stream optionally includes the original analyst's reasoning when a challenger is reacting to a specific prediction.
- The prediction-detail / provenance read path returns reasoning content when present.
- A read endpoint exists to fetch reasoning for a given prediction + analyst combo, so the front-end can lazy-load it from a Calibration drilldown without bloating the leaderboard payload.
- All existing markets gates still pass. No regressions in `pnpm ci:markets`, `pnpm test:unit`, or the manual UI test plan.

## Out Of Scope

- **Token-level streaming to the front-end.** No SSE thinking channel to the browser, no live "watch the analyst think" UX. Buffered only.
- **Non-Ollama providers in the first cut.** Whatever provider divinr's analysts hit first (likely the local Ollama setup on the Spark) is the first wired path. OpenAI, Anthropic extended thinking, OpenRouter, etc. follow only when there's a real product reason.
- **Day-trader strategies.** They're deterministic price-pattern code, not LLM calls. Reasoning capture doesn't apply.
- **Schema redesign of `daily_pnl_snapshot`, `analyst_predictions`, or any leaderboard-relevant table.** The capture lives in the LLM-call telemetry layer; consumers join when they need it.
- **Training-data harvesting.** Capturing reasoning for the purpose of fine-tuning is a separate, downstream effort with its own privacy and cost considerations.
- **Front-end Calibration drilldown beyond a minimal proof point.** A real "analyst post-mortem" view is its own effort. This phase ships the data path and exactly enough UI to prove it works.

## Where It Fits In The Roadmap

**After `markets-integration-test-infra`.** This effort touches the LLM client, a telemetry table, the Challenge stream, the provenance read path, and at least one front-end view. That's exactly the cross-cutting surface area that benefits from a deterministic integration test harness already being in place. Shipping this before the test infra means every regression hides in the smoke-test noise.

It also depends on having stable analyst-run plumbing, which Phase 7/8 of the day-traders effort just settled. So: integration test infra first, reasoning capture second.

## Open Questions To Settle When This Effort Starts

- **Storage shape and retention.** Reasoning content can be 5–20× the size of the final output. Cap, expire, compress, or offload to object storage? Probably a TEXT column with a length cap and a retention sweep, but worth confirming against expected daily LLM-call volume.
- **Which telemetry table.** Divinr has existing per-call telemetry somewhere in the markets pipeline; need to confirm whether it's a dedicated `llm_usage`-style table, an embedded JSONB column on `analyst_predictions`, or scattered. The answer determines whether this is an additive migration or a small refactor.
- **Provider channel detection.** Whichever provider is first in line — does it expose a separate `thinking` channel natively, or is the reasoning inline as `<think>...</think>` tags in the output? Different providers use different conventions; the capture path needs to handle whichever convention divinr's first reasoning model uses.
- **Privacy.** Reasoning sometimes surfaces internal model uncertainty in ways that are awkward to expose to paying users ("I am not sure if this is correct…"). Decide upfront whether the captured content is internal-only (for calibration analysis), exposed only to admins, or surfaced verbatim to end users.
- **Cost accounting.** Reasoning tokens are billable on most paid providers and they dominate the call cost. The telemetry should record reasoning token count separately from output token count so cost-per-prediction stays accurate.

## Dependencies

- `markets-integration-test-infra` must land first so this effort has a deterministic gate to lean on.
- A reasoning-capable model reachable from the divinr API (currently the Spark Ollama setup with Gemma 4 family or similar — confirm at start).
- The existing analyst-run pipeline + Challenge stream + provenance read path remain stable through this effort. No concurrent refactors of those surfaces.
