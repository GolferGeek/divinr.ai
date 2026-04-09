# Risk-Debate Drilldown — Implementation Plan

**PRD**: prd.md
**Created**: 2026-04-09
**Status**: Complete

## Progress Tracker

- [x] Phase 1: API endpoint — debate reasoning
- [x] Phase 2: Frontend — expandable reasoning panels

---

## Phase 1: API endpoint — debate reasoning
**Status**: Complete
**Objective**: Add `GET /risk-debates/:debateId/reasoning` returning LLM reasoning for all three debate agents from `llm_usage`.

### Steps
- [ ] 1.1 In `apps/api/src/markets/markets.service.ts`, add a `getDebateReasoning(debateId, organizationSlug)` method that:
  - Loads the debate row from `prediction.risk_debates` filtered by id and org_slug
  - Extracts `llm_usage_id` values from the `transcript` JSONB array for each role (blue, red, arbiter)
  - Queries `public.llm_usage` with `WHERE run_id::text = ANY($1)` for those IDs
  - Maps results back to roles, returning `{ blue, red, arbiter }` where each is `AgentReasoning | null`
  - `AgentReasoning` includes: provider, model, inputTokens, outputTokens, reasoningTokens, reasoningContent, reasoningTruncated
- [ ] 1.2 In `apps/api/src/markets/markets.controller.ts`, add `@Get('risk-debates/:debateId/reasoning')` endpoint wired to `getDebateReasoning`, using `resolveIdentity` for org slug.
- [ ] 1.3 Write a unit test `apps/api/tests/unit/debate-reasoning.test.ts` that:
  - Tests `getDebateReasoning` with a debate that has all 3 transcript entries with `llm_usage_id` — returns reasoning for all 3
  - Tests with a debate that has no transcript entries — returns `{ blue: null, red: null, arbiter: null }`
  - Tests with `reasoning_content: null` on a matched `llm_usage` row — returns metadata with `reasoningContent: null`
  - Uses MockDb pattern (sequential response array)

### Quality Gate

- [ ] **Build**: `cd apps/api && pnpm build` — no errors
- [ ] **Lint**: `cd apps/api && pnpm lint` — no errors
- [ ] **Unit Tests**: `cd apps/api && npx tsx tests/unit/debate-reasoning.test.ts` — all pass
- [ ] **Existing Tests**: `cd apps/api && npx tsx tests/unit/contract-editor.test.ts` — still pass
- [ ] **Curl Tests** (API on port 7100):
  ```
  # GET reasoning for a debate (requires a real debate ID from the DB)
  curl -s http://localhost:7100/risk-debates/<debateId>/reasoning -H "Authorization: Bearer <token>" | jq 'keys'
  # → ["arbiter","blue","red"]
  ```
- [ ] **Phase Review**:
  - [ ] Endpoint returns reasoning for all three agents in a single call
  - [ ] Agents with no `llm_usage_id` return null
  - [ ] Agents with `reasoning_content = null` return metadata with `reasoningContent: null`
  - [ ] Org_slug filtering applied on debate row (security)

---

## Phase 2: Frontend — expandable reasoning panels
**Status**: Complete
**Objective**: Add "Show Reasoning" buttons and expandable sections to each agent column in `DebateSummary.vue`, lazy-loading from the new endpoint.

### Steps
- [ ] 2.1 In `apps/web/src/components/DebateSummary.vue`, add script logic:
  - Import `useApi` composable
  - Add refs: `reasoningData` (cached response), `reasoningLoading`, `reasoningError`, `expandedAgents` (Set of 'blue'|'red'|'arbiter')
  - Add `fetchReasoning()` function that calls `GET /risk-debates/${debate['id']}/reasoning` once and caches in `reasoningData`
  - Add `toggleAgent(role)` function that adds/removes from `expandedAgents` and calls `fetchReasoning()` on first expand
  - Add `hasLlmUsageId(role)` helper that checks `debate['transcript']` array for matching role with non-null `llm_usage_id`
- [ ] 2.2 In each agent column template (Blue, Red, Arbiter), add at the bottom:
  - "Show Reasoning" / "Hide Reasoning" toggle button, visible only if `hasLlmUsageId(role)` returns true
  - Expanded section when toggled, showing:
    - Provider + model as `<ion-chip>` (e.g., `ollama_local / gemma4:26b`)
    - Token counts line: `input: X | output: Y | reasoning: Z`
    - `reasoningContent` in `<pre style="white-space:pre-wrap;max-height:400px;overflow-y:auto">`
    - If `reasoningContent` is null: `<ion-note>No extended reasoning captured for this agent.</ion-note>`
  - Loading state: `<ion-progress-bar type="indeterminate">` while fetching
  - Error state: `<ion-note color="danger">` if fetch fails
- [ ] 2.3 Verify the `debate['id']` and `debate['transcript']` are available from the existing prop (they come from `select * from risk_debates`).

### Quality Gate

- [ ] **Build**: `cd apps/web && pnpm build` — no errors
- [ ] **Typecheck**: `cd apps/web && pnpm typecheck` — no new errors (pre-existing only)
- [ ] **Lint**: `cd apps/web && pnpm lint` — no errors
- [ ] **Chrome Tests** (dev server on port 7101):
  - [ ] Navigate to `/risk`, select an instrument with a completed debate
  - [ ] Debate summary shows Blue/Red/Arbiter columns with "Show Reasoning" buttons
  - [ ] Click "Show Reasoning" on Blue → reasoning content expands with provider, model, tokens, and reasoning text
  - [ ] Click "Show Reasoning" on Red → same pattern, no duplicate API call (cached)
  - [ ] Click "Hide Reasoning" → section collapses
  - [ ] For agents with no reasoning_content: "No extended reasoning captured" message
  - [ ] For debates with empty transcript: no "Show Reasoning" buttons visible
- [ ] **Phase Review**:
  - [ ] PRD §2 "Reasoning expansion" — clicking reveals reasoning_content
  - [ ] PRD §2 "Lazy loading" — not fetched until user clicks
  - [ ] PRD §2 "Transcript metadata" — model, provider, tokens displayed
  - [ ] PRD §2 "Graceful null handling" — clear message for missing reasoning
  - [ ] PRD §2 "Read-only" — no changes to debate pipeline
  - [ ] PRD §6 out-of-scope respected — no layout changes, no history, no cross-linking

---
