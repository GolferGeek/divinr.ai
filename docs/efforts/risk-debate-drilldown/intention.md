# Effort: Risk-Debate Drilldown

## Problem

The risk debate system runs a three-way adversarial exchange (Blue defender → Red challenger → Arbiter synthesizer) on every risk assessment. The structured outputs (summaries, challenges, accepted/rejected items) are already displayed in `DebateSummary.vue`, but the **raw LLM reasoning** behind each agent's response is invisible. Each debate step's `llm_usage_id` is captured in the `transcript` array, and `llm_usage.reasoning_content` stores the extended thinking — but no UI fetches or renders it.

Users can see *what* each agent concluded but not *how* it got there. For an explainability-first platform, this gap matters: admins and beta readers should be able to drill into the actual chain of thought behind each debate position.

## Intention

Enhance the existing debate display so users can expand any agent's panel to see its full LLM reasoning — the raw `reasoning_content` from the corresponding `llm_usage` record. This is the debate equivalent of what `see-your-reasoning` did for predictions.

## Scope

- **Reasoning expansion**: Each agent panel (Blue, Red, Arbiter) in `DebateSummary.vue` gets an expandable section that lazy-loads and displays the `reasoning_content` from `llm_usage` via the `llm_usage_id` in the debate's `transcript` array.
- **API endpoint**: Add `GET /risk-debates/:debateId/reasoning` that returns the reasoning for all three agents by joining `transcript[].llm_usage_id` to `llm_usage.reasoning_content`. Single call, returns all three.
- **Transcript metadata**: Show the model name and token counts for each agent's call alongside the reasoning (already on `llm_usage`).
- **No reasoning available**: Gracefully handle cases where `reasoning_content` is null (older debates, models without reasoning support). Show "No extended reasoning captured" instead of an empty panel.

## Success Criteria

- Clicking an agent panel in the debate summary reveals its LLM reasoning.
- Reasoning is lazy-loaded (not fetched until the user expands a panel).
- Model name and token counts are displayed with each agent's reasoning.
- Debates with no reasoning data show a clear "not available" message.
- No changes to the debate pipeline itself — this is read-only visualization.

## Out of Scope

- Changing how debates run or how reasoning is captured.
- Adding debate history or re-run tracking UI.
- Cross-linking debate reasoning to specific dimension assessments or signals.
- Modifying the `DebateSummary` layout or the three-column structure (just adding expandable sections within each column).
