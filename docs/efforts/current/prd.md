# Risk-Debate Drilldown — Product Requirements Document

## 1. Overview

The risk debate system runs Blue/Red/Arbiter agents on every risk assessment, producing structured outputs that `DebateSummary.vue` already renders. But the raw LLM reasoning behind each agent's response — captured in `llm_usage.reasoning_content` via `transcript[].llm_usage_id` — is invisible to users. This effort adds expandable reasoning panels to each agent column so users can drill into the chain of thought, completing the explainability story for risk debates.

## 2. Goals & Success Criteria

| Goal | Measurable Criterion |
|---|---|
| Reasoning expansion | Clicking an agent panel reveals its `reasoning_content` from `llm_usage` |
| Lazy loading | Reasoning is not fetched until the user clicks to expand |
| Transcript metadata | Model name and token counts displayed alongside reasoning |
| Graceful null handling | "No extended reasoning captured" shown when `reasoning_content` is null |
| Read-only | No changes to the debate pipeline or data capture |

## 3. User Stories / Use Cases

**Admin investigates a surprising score adjustment:** "The arbiter moved the risk score +25 points. I expand the Arbiter panel and read its full chain of thought — it weighted a macro indicator the Blue agent cited but the Red agent dismissed. Now I understand *why* the adjustment was so large."

**Beta reader explores debate reasoning:** "I expand the Blue panel and see the model's reasoning alongside its provider and token count. I compare that with the Red panel's reasoning to understand both sides."

**Older debate with no reasoning:** "I expand a panel from a debate run before reasoning capture was enabled. I see 'No extended reasoning captured for this agent' instead of a broken or empty view."

## 4. Technical Requirements

### 4.1 Architecture

One new API endpoint on `markets.controller.ts`. One enhancement to `DebateSummary.vue`. No new services, pages, or stores.

### 4.2 Data Model Changes

None. All data already exists:
- `risk_debates.transcript` — JSONB array of `{role, content, llm_usage_id}`
- `public.llm_usage` — `run_id`, `provider`, `model`, `input_tokens`, `output_tokens`, `reasoning_tokens`, `reasoning_content`, `reasoning_truncated`

### 4.3 API Changes

#### `GET /risk-debates/:debateId/reasoning`

Returns reasoning data for all three agents in one call.

**Implementation:**
1. Load the debate row to get `transcript` JSONB.
2. Extract up to 3 `llm_usage_id` values from transcript entries (blue, red, arbiter).
3. Query `public.llm_usage` for those IDs: `SELECT run_id, provider, model, input_tokens, output_tokens, reasoning_tokens, reasoning_content, reasoning_truncated FROM public.llm_usage WHERE run_id::text = ANY($1)`.
4. Map results back to roles using the transcript's role field.

**Response shape:**
```ts
{
  blue: AgentReasoning | null;
  red: AgentReasoning | null;
  arbiter: AgentReasoning | null;
}

interface AgentReasoning {
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  reasoningContent: string | null;
  reasoningTruncated: boolean;
}
```

Agents with no `llm_usage_id` in transcript or no matching `llm_usage` row return `null`. Agents with a row but `reasoning_content = null` return the metadata with `reasoningContent: null`.

**Auth:** Read access (all authenticated users). Uses existing `resolveIdentity` + org_slug filter on the debate row.

### 4.4 Frontend Changes

#### `DebateSummary.vue` enhancements

Add to each agent column (Blue, Red, Arbiter):
1. **"Show Reasoning" button** at the bottom of each column. Styled as `<ion-button size="small" fill="clear">`.
2. **On click:** Emit or call `fetchReasoning()` if not already loaded. Lazy-load from `GET /risk-debates/:debateId/reasoning`. Cache the result so subsequent toggles don't re-fetch.
3. **Expanded section:** Below the existing content, render:
   - Provider + model chip (e.g., `ollama_local / gemma4:26b`)
   - Token counts: `input: X | output: Y | reasoning: Z`
   - `reasoning_content` in a `<pre style="white-space:pre-wrap">` block
4. **Null reasoning:** If `reasoningContent` is null, show `<ion-note>No extended reasoning captured for this agent.</ion-note>`.
5. **Null agent:** If the entire agent slot is null (no `llm_usage_id` in transcript), hide the "Show Reasoning" button for that column.

The `DebateSummary` component currently receives `debate` as a prop (the full `risk_debates` row). It already has access to `debate['id']` for the API call and `debate['transcript']` to check which agents have `llm_usage_id`.

#### No changes to `RiskDashboardView.vue`

The parent view already passes the full debate object. No new props or data flow needed.

### 4.5 Infrastructure Requirements

None.

## 5. Non-Functional Requirements

- **Performance:** Single API call fetches all three agents' reasoning. The `llm_usage` query uses `run_id = ANY(...)` with at most 3 values — trivial.
- **Security:** Debate row filtered by org_slug. The `llm_usage` IDs come from the debate's transcript, not user input, so no IDOR risk.
- **Accessibility:** Expandable sections use standard buttons. Reasoning is plain text in a `<pre>` block.

## 6. Out of Scope

- Changing how debates run or how reasoning is captured.
- Adding debate history or re-run tracking UI.
- Cross-linking debate reasoning to specific dimension assessments or signals.
- Modifying the `DebateSummary` three-column layout structure.

## 7. Dependencies & Risks

| Risk | Mitigation |
|---|---|
| Older debates may have empty transcript arrays or null `llm_usage_id` values | Frontend checks transcript for `llm_usage_id` presence before showing button; API returns null for missing agents |
| `reasoning_content` may be very large for verbose models | `<pre>` block with `max-height` and `overflow-y:auto` prevents layout blowout |
| `llm_usage.run_id` join uses `::text` cast (established pattern) | Same pattern used by `getPredictionLlmCalls` — proven in production |

## 8. Phasing

### Phase 1: API endpoint — debate reasoning

Add `GET /risk-debates/:debateId/reasoning` to controller and service. Returns reasoning for blue/red/arbiter from `llm_usage`. Unit test with MockDb.

### Phase 2: Frontend — expandable reasoning panels

Add "Show Reasoning" buttons and expandable sections to `DebateSummary.vue`. Lazy-load from the new endpoint. Handle null reasoning and missing agents.
