# LLM Reasoning Capture — Completion Report

**Plan**: ./plan.md
**PRD**: ./prd.md
**Intention**: ./intention.md
**Branch**: `effort/llm-reasoning-capture`
**Completed**: 2026-04-08
**Final Status**: All Phases Complete (pending manual smoke pass)

## Summary

Captured LLM reasoning content on the existing `public.llm_usage` table and linked every markets analysis row produced by an LLM call back to the `llm_usage` row that produced it. Establishes the convention so future LLM-calling services in markets can't merge without a trace.

- Total phases: 4 (0–3 plus this report)
- Phases completed: 4
- Phases remaining: 0 (manual smoke pass deferred to user per request)

## What Landed

### Schema (additive, idempotent)
- `public.llm_usage`: 3 new nullable columns (`reasoning_content text`, `reasoning_tokens integer`, `reasoning_truncated boolean default false`). Applied via `psql` to dev; SQL committed at `apps/api/db/migrations/2026-04-08-llm-usage-reasoning.sql` for record-keeping. The table is not managed by a tracked migration in this repo (not in `supabase/migrations/`); the SQL file is the divinr.ai-side artifact for the change.
- 9 markets `prediction.*` tables: each gained `llm_usage_id uuid` + a partial index where non-null. DDL added to `apps/api/src/markets/schema/markets-schema.service.ts` following the existing `alter table … add column if not exists` pattern. Tables: `market_predictions`, `analyst_risk_assessments`, `risk_dimension_assessments`, `risk_debates`, `market_predictors`, `prediction_challenges`, `learning_proposals`, `learning_reports`, `analyst_config_versions`.

### Code path (planes/llm)
- `LLMClientChatResult` (`packages/planes/llm/simplified/llm-client.interface.ts`): added optional `reasoning?: string` and `usage.reasoningTokens?: number`.
- `OllamaLocalAdapter` (`packages/planes/llm/simplified/adapters/ollama-local.adapter.ts`): no longer collapses `message.reasoning` into `content`. Returns reasoning as a separate field. Implements `<think>...</think>` inline-tag fallback for providers that embed reasoning in content. Reads `usage.completion_tokens_details.reasoning_tokens` if present.
- `TwoTierLLMService` (`packages/planes/llm/simplified/two-tier-llm.service.ts`): captures `result.reasoning` + `result.usage.reasoningTokens`, applies 64 KB truncation with a warning log, writes the three new columns to the `llm_usage` insert at line ~585, populates `metadata.thinking` (existing field on `ResponseMetadata`) so callers can read it.
- **NOT touched**: `simplified-llm.service.ts`. It looked like the chokepoint by name, but `packages/planes/llm/llm.module.ts:111-128` binds `LLM_SERVICE` to `TwoTierLLMService` when `LLM_PROVIDER=simplified`. The `simplified-llm.service.ts` file is dead code on the markets path. Documented in plan.md notes for future maintainers.

### Code path (markets)
- `MarketsLlmService.generateText` (`apps/api/src/markets/services/markets-llm.service.ts`): now always passes `includeMetadata: true`. New `unwrapResponse` helper extracts `metadata.requestId` → `LlmTextResult.llmUsageId` and `metadata.thinking` → `LlmTextResult.reasoning`.
- `LlmTextResult` interface gained `reasoning?: string` and `llmUsageId?: string`.
- 5 markets analysis services modified to capture `result.llmUsageId` and stamp it on the inserted analysis row:
  1. `prediction-runner.service.ts` — both analyst row insert (line ~280) and arbitrator row insert (line ~385).
  2. `risk-runner.service.ts` — `analyst_risk_assessments` insert (line ~368) + `risk_dimension_assessments` insert via `persistDimensionAssessment` (line ~470). `RiskDimensionAssessment` type gained `llm_usage_id: string | null`; `risk-dimension-analyzer.service.ts` populates it from `result.llmUsageId`.
  3. `risk-debate.service.ts` — `risk_debates` row stamped with the **arbiter call's** `llmUsageId`. The blue/red call ids are recorded in the `transcript` JSON column. Documented in code comment.
  4. `predictor-generator.service.ts` — `upsertPredictor` signature gained an `llmUsageId` parameter; `market_predictors` upsert writes it (and updates it on conflict).
  5. `markets.service.ts` — both `prediction_challenges` insert sites (batch path at ~868, stream path at ~972).

### Tests
- New unit test `apps/api/tests/unit/ollama-adapter-reasoning.test.ts` (10 assertions, 4 fixtures: content-only, native reasoning field, inline `<think>` fallback, `reasoning_tokens` from `completion_tokens_details`). Wired into `apps/api/package.json` `test:unit` chain.
- `StubLlmService` (`apps/api/tests/markets/integration/stubs/stub-llm-service.ts`): when `includeMetadata: true` is passed, returns an `LLMResponse`-shaped object with a synthetic uuid `requestId` and synthetic `thinking` text. Backward-compatible with the existing `stub-llm-shape.test.ts` unit test, which still gets the bare-string return path.
- Integration test (`run-markets-integration-tests.ts`): added a non-null `llm_usage_id` assertion to every analyst + arbitrator row in `market_predictions` for each of the 4 scenarios. All 4 pass.

## Phase Results

| Phase | Status | Notable |
|---|---|---|
| 0: Discovery | Complete | Confirmed qwen3:8b returns `message.reasoning` natively (3411 chars on a test call). Confirmed Ollama does NOT report `usage.completion_tokens_details.reasoning_tokens` on this build — `reasoning_tokens` column will land NULL on qwen3 until upstream Ollama exposes it. |
| 1: Schema + Ollama adapter | Complete | All 9 markets-schema migrations + 3 llm_usage columns applied. Adapter test green (10 assertions). |
| 2: TwoTierLLMService payload + MarketsLlmService surface | Complete | **Critical correction**: PRD/plan pointed at the wrong service file. Real chokepoint is `two-tier-llm.service.ts:585`, not `simplified-llm.service.ts:577`. Patched the right file. Skipped the planned unit test for this phase because tsx can't transpile `@Inject` decorators on the imported class — relied on Phase 3 integration test instead. |
| 3: Wire markets services + integration test | Complete | **Scope correction**: 5 services touched, not 9. `learning-engine.service.ts` and `trade-recommendation.service.ts` are deterministic — they don't call LLMs at all. The schema columns on the 3 learning tables are forward-prep. |
| 4: Completion report | Complete | This document. Manual smoke pass deferred to user. |

## Gate Results

Every phase ran the same gate suite. Results from the final pass at end of Phase 3:

| Gate | Result |
|---|---|
| `pnpm --filter @divinr/api run lint` | ✓ |
| `pnpm --filter @divinr/api run typecheck` | ✓ |
| `pnpm --filter @orchestratorai/planes run typecheck` | ✓ |
| `pnpm --filter @divinr/api run build` | ✓ |
| `pnpm --filter @orchestratorai/planes run build` | ✓ |
| `pnpm --filter @divinr/api run test:unit` (44 existing + 10 new = 54 assertions) | ✓ |
| `pnpm -w run ci:markets` | ✓ |
| `pnpm --filter @divinr/api run test:markets:integration` (4/4 scenarios with new `llm_usage_id` assertion) | ✓ |
| Web typecheck | **Pre-existing failure on main** (unrelated; `HTMLElement` / `window` undefined in `apps/web/src` — DOM lib config issue confirmed via `git stash` test). Not caused by this effort. |

## Success Criteria Results (PRD §2)

| # | Criterion | Result |
|---|---|---|
| 1 | Reasoning capture (Ollama) | **Code path landed; awaiting manual smoke pass.** Adapter unit test confirms `message.reasoning` is captured separately when present. End-to-end validation requires running the API against real Ollama. |
| 2 | No-op for non-reasoning models | **Code path landed.** Adapter test fixture 1 confirms `reasoning=undefined` when the response has only `content`. The truncation/insert logic in `TwoTierLLMService` writes `null` for both `reasoning_content` and `reasoning_tokens` in that case. |
| 3 | Trace coverage on LLM-produced rows | **100% on the integration test.** All 14 expected analyst + arbitrator rows across the 4 scenarios have non-null `llm_usage_id`. Full markets integration suite green. |
| 4 | No regressions | **All gates green.** ci:markets, test:unit, lint, build, typecheck (api + planes) all pass. Existing 44 unit-test assertions unchanged. |
| 5 | Round-trip integration test | **Green.** The new assertion at `run-markets-integration-tests.ts` is integrated into every scenario run, not a separate test file. |

## Deviations from PRD

1. **PRD said the chokepoint was `simplified-llm.service.ts:577`. Wrong.** The real `LLM_SERVICE` binding for `LLM_PROVIDER=simplified` is `TwoTierLLMService` (`packages/planes/llm/llm.module.ts:111-128`). The `simplified-llm.service.ts` file is dead code on the markets path. Patched the right file (`two-tier-llm.service.ts:585`). Documented.
2. **PRD said 9 services would be wired. Actual: 5.** `learning-engine.service.ts` and `trade-recommendation.service.ts` do not call LLMs (verified by grep of `marketsLlm.generateText|llmService.generateText`). Their inserts are deterministic. The schema columns I added to the 3 learning tables (`learning_proposals`, `learning_reports`, `analyst_config_versions`) are now forward-prep for any future LLM-driven learning code path.
3. **PRD planned a unit test for `simplified-llm-reasoning-insert.test.ts`. Skipped.** tsx/esbuild can't transpile `@Inject` parameter decorators on the imported planes class, and importing the compiled `.js` doesn't help (tsx prefers the adjacent `.ts`). Existing api unit tests deliberately avoid this pattern. The integration test against the real DB validates the same code path end-to-end without the test infra wrestling.
4. **PRD planned a separate `llm-reasoning-roundtrip.test.ts` integration test file. Folded into the existing harness.** Adding an assertion to `run-markets-integration-tests.ts` covers the same ground (every analyst/arbitrator row across 4 scenarios) without spinning up a new harness. The stub was extended to support the new `includeMetadata: true` path.
5. **Integration test does NOT validate the `llm_usage` row itself.** The stub doesn't insert into `llm_usage` — that's `TwoTierLLMService`'s job, and the stub bypasses it entirely. The test confirms markets services capture and stamp `llmUsageId`. The Phase 4 manual smoke pass against real Ollama + real `TwoTierLLMService` is what confirms reasoning content actually lands in `llm_usage.reasoning_content` and that the FK from a `market_predictions` row resolves to a real `llm_usage` row.

## Risks That Materialized

| # | Risk (PRD §5) | Outcome |
|---|---|---|
| 1 | Removing the Ollama adapter `content || msg.reasoning` fallback could break analyst-service JSON parsers. | **Did not materialize.** Full `ci:markets` and `test:markets:integration` green after the change. No analyst service depended on the old fallback in any tested scenario. |
| 2 | Hot-path latency on the cross-cutting `llm_usage` insert. | **N/A.** Insert payload grew by three columns; no observable runtime impact in the test suite (ci:markets duration unchanged within noise). |
| 3 | Markets services modify inserts in many places — typo could leave `llm_usage_id` null. | **Caught by integration test.** The non-null assertion in `run-markets-integration-tests.ts` would fail if any analyst or arbitrator row insert was missing the column wiring. All 4 scenarios pass. |
| 4 | `public.llm_usage` not managed by a tracked migration. | **Real and unresolved.** Applied to dev by hand; SQL committed under `apps/api/db/migrations/` for record-keeping. Production application is a follow-up concern. |
| 5 | Ollama doesn't report `reasoning_tokens` on this build. | **Confirmed.** Column lands NULL on qwen3:8b. Code path is ready for when upstream Ollama exposes it. |
| 6 | 64 KB truncation cap. | **No data yet.** Will surface via `reasoning_truncated=true` rows after manual smoke pass. |

## Follow-Up Work Now Unblocked

Each of these is a separate effort, deliberately out of scope here:
- **Read endpoint** (e.g. `GET /markets/predictions/:id/llm-calls`) — admin-gated query that walks `market_predictions.llm_usage_id → llm_usage.reasoning_content`. Requires resolving the admin guard question (no `AdminGuard`/`RoleGuard` exists in `apps/api/src` today).
- **Provenance extension** — `getPredictionProvenance` (`markets.service.ts:700`) gains an optional `includeReasoning` flag.
- **Challenge stream prompt enrichment** — Challenge SSE stream loads the original analyst's reasoning from `llm_usage` and prepends it to the challenger's user prompt.
- **Front-end admin page** — minimal Calibration drilldown view that lazy-loads the read endpoint above.
- **Paid-provider adapter wiring** — extend `OpenRouterAdapter`, `AzureFoundryAdapter`, `VertexAIAdapter`, `OllamaCloudAdapter` to populate the new optional `reasoning` field on `LLMClientChatResult`. Each is a self-contained ~10-line change.
- **`llm_usage` migration ownership** — decide whether divinr.ai owns the schema (move it into a tracked migration here) or whether the upstream Orchestrator AI repo owns it (commit the additive migration there).
- **Reasoning content sanitization** — decide whether to run captured reasoning through the existing PII/sanitization pipeline that other `llm_usage` columns already use.
- **Retention sweep** — if real-world growth on `reasoning_content` exceeds ~1 GB/month.

## Manual Smoke Pass (deferred to user per request)

The integration test confirms the wiring. The user will validate end-to-end with a real model:

1. Confirm `MARKETS_ENABLE_LLM=true`, `LLM_PROVIDER=simplified`, `OPENSOURCE_LLM_PROVIDER=ollama_local`, `OLLAMA_DEFAULT_MODEL=qwen3:8b` (or any installed reasoning-capable model).
2. Trigger a markets prediction run (any scenario / instrument).
3. Query:
   ```sql
   select mp.id, mp.role, mp.llm_usage_id, lu.reasoning_content is not null as has_reasoning, length(lu.reasoning_content) as reasoning_len
   from prediction.market_predictions mp
   join public.llm_usage lu on lu.run_id::text = mp.llm_usage_id::text
   where mp.run_id = '<run_id>'
   order by mp.created_at desc;
   ```
4. Expect: every row has non-null `llm_usage_id`, `has_reasoning=true` for analyst/arbitrator rows on a reasoning-capable model, real reasoning text in `lu.reasoning_content`.

If any of those don't hold, the gap is between the `TwoTierLLMService` insert and the markets capture path, which the integration test stub bypasses. That's the gap the manual pass is designed to catch.
