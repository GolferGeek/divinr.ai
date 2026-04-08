# LLM Reasoning Capture — Product Requirements Document

## 1. Overview

Capture LLM reasoning content on the existing `public.llm_usage` table and link every markets analysis row back to the LLM call that produced it.

Today, every markets LLM call already writes a row to `public.llm_usage` via `packages/planes/llm/simplified/simplified-llm.service.ts:577`. Two things are missing:
1. The **reasoning content** (thinking tokens) the model produced is discarded at the Ollama adapter before it reaches the insert.
2. The **markets analysis rows** that result from each call have no link back to the `llm_usage` row that produced them.

This effort fixes both. After it lands: reasoning is persisted as a nullable column on `llm_usage`, and every markets analysis row carries an `llm_usage_id` pointing back at its originating call. The existing pattern on `prediction.analyst_assessments` and `prediction.predictors` (which already have `llm_usage_id` columns with the comment "Reference to public.llm_usage for cost tracking") is extended to the newer markets-stack tables.

## 2. Goals & Success Criteria

### Goals
- Stop discarding LLM reasoning at the Ollama adapter.
- Make every LLM call traceable from its consuming domain row.
- Establish the convention so future LLM-calling services can't merge without a trace.

### Success Criteria
1. **Reasoning capture (Ollama):** Calls routed to a reasoning-capable Ollama model produce an `llm_usage` row with non-empty `reasoning_content`.
2. **No-op for non-reasoning models:** Calls routed to non-reasoning models produce a row with `reasoning_content IS NULL` and zero new errors.
3. **Trace coverage:** 100% of markets analysis rows produced by an LLM call (the 9 tables enumerated in §4.2) have a non-null `llm_usage_id` pointing to the originating row.
4. **No regressions:** `pnpm -w run lint`, `pnpm -w run build`, `pnpm -w run typecheck`, `pnpm --filter @divinr/api run test:unit`, `pnpm -w run ci:markets` all pass.
5. **Round-trip integration test:** A new test in the markets integration harness drives a single analyst run and asserts that the resulting `market_predictions` row's `llm_usage_id` resolves to an `llm_usage` row whose `reasoning_content` matches the canned reasoning the stub adapter returned.

## 3. Out of Scope

- Read endpoints / provenance extension / challenge stream prompt enrichment / front-end work / admin pages. All of these are downstream of this effort and become trivial follow-ons once the data is captured and joinable.
- Non-Ollama provider adapters. OpenAI, Anthropic, OpenRouter, vertex-ai, azure-foundry stay as they are. The new optional `reasoning` field on `LLMClientChatResult` is available for them to populate later.
- Day-trader strategies (deterministic, no LLM involvement).
- Cost calculation, retention sweeps, sanitization pipelines for reasoning content.
- Backfill of historical rows. Capture is forward-only.

## 4. Technical Requirements

### 4.1 Architecture

```
markets analyst service
  │  calls MarketsLlmService.generateText
  ▼
MarketsLlmService.generateText
  │  forwards ExecutionContext through to simplified-llm.service
  │  ← returns LlmTextResult { text, provider, model, reasoning?, llmUsageId }
  ▼
simplified-llm.service.ts
  │  inserts llm_usage row at line ~577 (already happens today)
  │  ← payload now also includes reasoning_content / reasoning_tokens / reasoning_truncated
  │  ← returns llm_usage row's primary key as part of generateResponse result
  ▼
LLMClient.chatCompletion (Ollama adapter)
  │  stops collapsing message.reasoning into content; returns it as a separate field
  ▼
Ollama /v1/chat/completions  ← already returns message.reasoning natively (verified Phase 0)
```

After the call returns, the markets service captures `result.llmUsageId` and includes it in the subsequent insert into its analysis table. The natural call order (LLM first, analysis row second) means there's no upfront uuid generation or placeholder rows.

### 4.2 Data Model Changes

**Additive changes to `public.llm_usage`** (3 columns, all nullable, idempotent):

```sql
alter table public.llm_usage add column if not exists reasoning_content text;
alter table public.llm_usage add column if not exists reasoning_tokens integer;
alter table public.llm_usage add column if not exists reasoning_truncated boolean default false;
```

**Additive `llm_usage_id` columns on 9 markets analysis tables** (added to `apps/api/src/markets/schema/markets-schema.service.ts` following the existing `alter table … add column if not exists` pattern, plus a partial index on each):

| # | Table | Written by |
|---|---|---|
| 1 | `prediction.market_predictions` | `prediction-runner.service.ts`, `trade-recommendation.service.ts` |
| 2 | `prediction.analyst_risk_assessments` | `risk-runner.service.ts` |
| 3 | `prediction.risk_dimension_assessments` | `risk-runner.service.ts` |
| 4 | `prediction.risk_debates` | `risk-debate.service.ts` |
| 5 | `prediction.market_predictors` | `predictor-generator.service.ts` |
| 6 | `prediction.prediction_challenges` | `markets.service.ts` (challenge handler) |
| 7 | `prediction.learning_proposals` | `learning-engine.service.ts` |
| 8 | `prediction.learning_reports` | `learning-engine.service.ts` (LLM-summarized rows only) |
| 9 | `prediction.analyst_config_versions` | `learning-engine.service.ts` (LLM-tuned promptSuffix rows only) |

For each: `add column if not exists llm_usage_id uuid` plus `create index if not exists <table>_llm_usage_idx on <table> (llm_usage_id) where llm_usage_id is not null`. No FK enforcement (matches the existing convention on `prediction.analyst_assessments.llm_usage_id`, which is a uuid column with no FK constraint, only an index).

**Composite/derived rows are intentionally excluded.** `prediction.market_risk_assessments` (composite verdict) and `prediction.risk_composite_scores` (aggregation) don't get `llm_usage_id` because they don't come from a single LLM call; they roll up from per-analyst rows that *do* carry the link. Drilldown is two hops, no information loss.

### 4.3 Code Changes

**`packages/planes/llm/simplified/llm-client.interface.ts`** — additive optional field on `LLMClientChatResult`:
```ts
reasoning?: string;
usage: { ...; reasoningTokens?: number; }
```

**`packages/planes/llm/simplified/adapters/ollama-local.adapter.ts:113-127`** — stop collapsing `msg.reasoning` into `content`. Populate the new `reasoning` field separately. Implement an inline `<think>...</think>` fallback (when `msg.reasoning` is absent and content matches `/^\s*<think>([\s\S]*?)<\/think>([\s\S]*)$/`, treat group 1 as reasoning, group 2 as content).

**`packages/planes/llm/simplified/simplified-llm.service.ts`** — at the existing `llm_usage` insert site (around line 577):
- Capture `reasoning` and `usage.reasoningTokens` from the adapter result.
- Apply 64 KB truncation to reasoning if needed (slice to 65536 chars, set `reasoning_truncated=true`, log warning).
- Add `reasoning_content`, `reasoning_tokens`, `reasoning_truncated` to the insert payload.
- After the insert succeeds, surface the new row's primary key (today's `run_id`) on the `generateResponse` return value as `llmUsageId`.

**`apps/api/src/markets/services/markets-llm.service.ts`** — extend `LlmTextResult`:
```ts
export interface LlmTextResult {
  text: string;
  provider: string;
  model: string;
  reasoning?: string;
  llmUsageId?: string;   // primary key of the llm_usage row written by this call
}
```
`generateText` reads these from the underlying response and surfaces them.

**The 9 markets services in §4.2** — capture `result.llmUsageId` from `generateText` and include it in the subsequent `insert into prediction.<table>` statement. Each service touched once.

### 4.4 Tests

- New unit test: `apps/api/tests/unit/ollama-adapter-reasoning.test.ts` — three fixtures (content-only, native `reasoning` field, inline `<think>` tag).
- New unit test: `apps/api/tests/unit/simplified-llm-reasoning-insert.test.ts` — asserts the insert payload includes the new columns and that `llmUsageId` is returned. Three branches: with reasoning, without reasoning, oversized reasoning (truncation).
- New integration test: `apps/api/tests/markets/integration/llm-reasoning-roundtrip.test.ts` — drives a single prediction-runner integration run with a stub LLM service that returns canned reasoning. Asserts `market_predictions.llm_usage_id` resolves to an `llm_usage` row with the expected `reasoning_content`.
- Integration test stub harness: `apps/api/tests/markets/integration/stubs/stub-llm-service.ts` gains a `withReasoning(content, tokens?)` builder.
- All new unit tests added to the `tsx tests/unit/...` chain in `apps/api/package.json`.

### 4.5 Migration Application

`public.llm_usage` is not managed by a tracked migration in this repo (the table exists in the dev Postgres but no `create table` for it lives in `divinr.ai`). Phase 1 applies the three new columns by hand via `psql` and commits a record-keeping SQL file under `apps/api/db/migrations/2026-04-08-llm-usage-reasoning.sql`. The markets-table `llm_usage_id` columns are added the normal way — into `markets-schema.service.ts`, which already manages those tables via runtime `alter table … add column if not exists`.

## 5. Risks & Mitigations

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | The Ollama adapter's `content || msg.reasoning` fallback was masking malformed responses where the model returned only reasoning. Removing it could cause analyst-service JSON parsers to start failing on inputs they previously tolerated. | High | Phase 1 covers the adapter change with three unit-test fixtures. Phase 3 runs `pnpm -w run ci:markets` after each service is wired; any failure surfaces immediately. Fix the parser, not the adapter. |
| 2 | The `simplified-llm.service.ts:577` insert is on the hot path of every Orchestrator-wide LLM call (not just markets). Schema changes are cross-cutting. | Medium | Strictly additive. Nullable columns. Idempotent migration. Existing inserts that don't supply the new fields keep working. |
| 3 | Markets services modify their `insert into` statements in 9 places. A typo or mis-wiring could leave `llm_usage_id` null on rows that should have it. | Medium | Round-trip integration test (§4.4) asserts non-null linkage end-to-end for the prediction-runner path. Extend the test to one risk-runner path before declaring Phase 3 done. |
| 4 | `public.llm_usage` is not managed by a migration tool in this repo. Manual SQL is brittle across environments. | Low | Commit the SQL file under `apps/api/db/migrations/` for record-keeping. Production application is a follow-up concern; this effort lands the dev path. |
| 5 | Ollama's current build does not report `usage.completion_tokens_details.reasoning_tokens` for qwen3:8b. | Low | `reasoning_tokens` column is nullable. Stays NULL on qwen3:8b until Ollama exposes the breakdown. Future paid-provider adapters can populate it. |
| 6 | A 64 KB truncation cap on `reasoning_content` may be too low for complex multi-step reasoning. | Low | `reasoning_truncated=true` flags affected rows. Logged warning. Revisit if >5% of calls truncate in real usage. |

## 6. Phasing

### Phase 0 — Discovery
- Verify Ollama on the dev machine returns `message.reasoning` for qwen3:8b. (Already confirmed in this session: 3411 chars on a test call.)
- Locate the field name `simplified-llm.service.ts` uses for the inserted row's primary key (`run_id` per current grep).
- Locate the `ExecutionContext` type definition file (`@orchestrator-ai/transport-types`) so additive field changes know where to land if needed.
- Output: `notes-phase-0.md` recording findings.

### Phase 1 — Schema + Ollama adapter
- Apply additive `llm_usage` columns to dev Postgres via psql; commit SQL file.
- Add `llm_usage_id` column + partial index for each of the 9 markets tables in `markets-schema.service.ts`.
- Extend `LLMClientChatResult` with optional `reasoning` field.
- Modify `ollama-local.adapter.ts` to stop discarding reasoning; implement `<think>` fallback.
- New unit test: `ollama-adapter-reasoning.test.ts` (3 fixtures).
- Gate: lint, build, typecheck, test:unit, ci:markets.

### Phase 2 — `simplified-llm.service.ts` payload + `MarketsLlmService` surface
- Extend `simplified-llm.service.ts:577` insert payload with the three new columns + truncation.
- Surface the inserted row's primary key on the `generateResponse` return value.
- Extend `LlmTextResult` and `MarketsLlmService.generateText` to surface `reasoning` and `llmUsageId`.
- New unit test: `simplified-llm-reasoning-insert.test.ts` (3 branches).
- Gate: lint, build, typecheck, test:unit, ci:markets. No markets caller wired yet, so existing markets tests must still pass unchanged.

### Phase 3 — Wire 9 markets services
- For each service in §4.2, capture `result.llmUsageId` from `generateText` and include it in the existing `insert into prediction.<table>` statement.
- Extend the integration test stub (`stub-llm-service.ts`) with `withReasoning(...)`.
- New integration test: `llm-reasoning-roundtrip.test.ts`.
- Gate: lint, build, typecheck, test:unit, ci:markets, integration test green.

### Phase 4 — Completion report
- Write `completion-report.md` with §2 success criteria results.
- Run final gate suite.
- Commit + push branch.
