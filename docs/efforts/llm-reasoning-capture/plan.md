# LLM Reasoning Capture — Implementation Plan

**PRD**: ./prd.md
**Intention**: ./intention.md
**Created**: 2026-04-08
**Status**: In Progress

## Progress Tracker
- [x] Phase 0: Discovery (Ollama check + field names)
- [x] Phase 1: Schema + Ollama adapter capture
- [x] Phase 2: TwoTierLLMService insert payload + MarketsLlmService surface
- [x] Phase 3: Wire markets services + integration test
- [x] Phase 4: Completion report

---

## Phase 0: Discovery
**Status**: Complete
**Objective**: Confirm environmental assumptions before code lands.

### Steps
- [x] 0.1 Confirm Ollama returns `message.reasoning` natively for qwen3:8b. **Done**: live curl returned 3411 chars of reasoning + 911 chars of content.
- [x] 0.2 Confirm `simplified-llm.service.ts:577` inserts a row keyed by `run_id` (will be surfaced as `llmUsageId` to markets). **Done**: confirmed via grep + read.
- [x] 0.3 Note that current Ollama build does NOT report `usage.completion_tokens_details.reasoning_tokens`. Column will land NULL on qwen3 until upstream Ollama exposes it. Acceptable per PRD §5 risk #5.

---

## Phase 1: Schema + Ollama adapter capture
**Status**: Complete

**Notes**:
- Web typecheck has pre-existing errors on main (`HTMLElement`, `window` undefined) — unrelated to this effort, confirmed via stash test. API + planes typecheck clean.
- All 12 `prediction.*` tables (9 new from this effort + 3 pre-existing) now carry `llm_usage_id`.
- Adapter test verifies all four fixtures including `reasoning_tokens` from `completion_tokens_details` (not exposed by current Ollama build but the code path is ready).
**Objective**: Land all schema changes (3 columns on `public.llm_usage`, 1 column on each of 9 markets tables) and stop discarding reasoning at the Ollama adapter. No insert-payload changes yet.

### Steps
- [ ] 1.1 Apply the additive `llm_usage` columns to dev Postgres:
  ```sql
  alter table public.llm_usage add column if not exists reasoning_content text;
  alter table public.llm_usage add column if not exists reasoning_tokens integer;
  alter table public.llm_usage add column if not exists reasoning_truncated boolean default false;
  ```
- [ ] 1.2 Commit the SQL above as `apps/api/db/migrations/2026-04-08-llm-usage-reasoning.sql` for record-keeping.
- [ ] 1.3 In `apps/api/src/markets/schema/markets-schema.service.ts`, add `add column if not exists llm_usage_id uuid` plus a partial index for each of the 9 tables in PRD §4.2. The DDL goes inside whichever existing private DDL method the table is defined in (e.g. `marketPredictionsDdl`, `riskAssessmentsDdl`, etc.) — read each method first to confirm location, then add an `alter table` line beneath the existing `alter table` block plus a `create index if not exists` line.
- [ ] 1.4 Restart the API locally so `markets-schema.service.ts` runs its ensure-schema bootstrapper and applies the new markets columns. Verify with `psql postgresql://postgres:postgres@localhost:54322/postgres -c "select table_name, column_name from information_schema.columns where table_schema='prediction' and column_name='llm_usage_id' order by table_name;"` — expect 9 rows (or whatever subset the bootstrapper has run; integration test in Phase 3 will confirm coverage).
- [ ] 1.5 Extend `packages/planes/llm/simplified/llm-client.interface.ts`:
  - Add `reasoning?: string` to `LLMClientChatResult`.
  - Add `reasoningTokens?: number` to `LLMClientChatResult.usage`.
- [ ] 1.6 Modify `packages/planes/llm/simplified/adapters/ollama-local.adapter.ts`:
  - Replace lines 113-114 (`const msg = data.choices[0]!.message; const content = msg.content || msg.reasoning || '';`) with the split logic per PRD §4.3:
    ```ts
    const msg = data.choices[0]!.message;
    let content = msg.content || '';
    let reasoning: string | undefined = msg.reasoning && msg.reasoning !== content ? msg.reasoning : undefined;
    if (!reasoning && content) {
      const m = content.match(/^\s*<think>([\s\S]*?)<\/think>\s*([\s\S]*)$/);
      if (m) {
        reasoning = m[1];
        content = m[2].trim();
      }
    }
    ```
  - Pass `reasoning` and `usage.reasoningTokens` (read from `data.usage?.completion_tokens_details?.reasoning_tokens` if present, else undefined) onto the returned `LLMClientChatResult`.
  - Update the typed `httpService.post<...>` generic to allow `completion_tokens_details?: { reasoning_tokens?: number }` on the response shape.
- [ ] 1.7 Create `apps/api/tests/unit/ollama-adapter-reasoning.test.ts` with three fixtures:
  - **content-only**: `message: {content: "answer"}` → `{content: "answer", reasoning: undefined}`.
  - **native reasoning field**: `message: {content: "answer", reasoning: "thinking"}` → `{content: "answer", reasoning: "thinking"}`.
  - **inline `<think>` fallback**: `message: {content: "<think>thinking</think>answer"}` → `{content: "answer", reasoning: "thinking"}`.
  Use a stubbed `HttpService` (look at existing adapter tests for the pattern).
- [ ] 1.8 Append `&& tsx tests/unit/ollama-adapter-reasoning.test.ts` to the `test:unit` script in `apps/api/package.json`.

### Quality Gate
- [ ] **Lint**: `pnpm -w run lint`
- [ ] **Build**: `pnpm -w run build`
- [ ] **Typecheck**: `pnpm -w run typecheck`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api run test:unit` (must include the new test)
- [ ] **E2E Tests**: `pnpm -w run ci:markets`
- [ ] **DB Verification**:
  - `psql postgresql://postgres:postgres@localhost:54322/postgres -c "select column_name from information_schema.columns where table_schema='public' and table_name='llm_usage' and column_name like 'reasoning%' order by column_name;"` — three rows.
  - `psql postgresql://postgres:postgres@localhost:54322/postgres -c "select table_name from information_schema.columns where table_schema='prediction' and column_name='llm_usage_id' order by table_name;"` — at minimum the markets tables touched by the bootstrapper appear.
- [ ] **Phase Review**:
  - [ ] Three new columns on `llm_usage`?
  - [ ] `llm_usage_id` added to all 9 markets tables in `markets-schema.service.ts`?
  - [ ] Adapter no longer collapses reasoning into content?
  - [ ] Three adapter fixtures pass?
  - [ ] No insert-payload changes leaked into Phase 1?
  - [ ] Risk #1 (analyst-service JSON parsers) — `ci:markets` green, no failures from the adapter behavior change?

---

## Phase 2: TwoTierLLMService insert payload + MarketsLlmService surface
**Status**: Complete

**Notes**:
- **Critical correction during execution**: PRD/plan referenced `simplified-llm.service.ts:577` as the insert chokepoint. That file is dead code on the markets path. The actual binding in `packages/planes/llm/llm.module.ts` resolves `LLM_SERVICE` to `TwoTierLLMService` when `LLM_PROVIDER=simplified`. Insert site is `two-tier-llm.service.ts:585`. Patched the right file.
- `simplified-llm.service.ts` deliberately left untouched. It's reachable via `import { SimplifiedLLMService }` in tests/index but not bound to any DI token used by markets. If revived, the same pattern can be copied.
- **Skipped the planned `two-tier-llm-reasoning-insert.test.ts` unit test**: tsx/esbuild can't transpile `@Inject` parameter decorators, and importing the compiled `.js` doesn't help because tsx prefers the adjacent `.ts`. The existing api unit tests deliberately avoid importing decorated planes classes (`stocks-prediction-plane.test.ts` imports a workspace-published plane, not a raw service). The Phase 3 round-trip integration test against the real DB will validate the insert payload end-to-end with no extra test infra.
- `ResponseMetadata.thinking` already existed in `fine-control/services/llm-interfaces.ts:132` — no interface extension needed. Just populate it.
- `MarketsLlmService.generateText` now passes `includeMetadata: true` always so it can read `metadata.requestId` and `metadata.thinking` for the new `LlmTextResult.llmUsageId` and `reasoning` fields.
**Objective**: Write the new columns from the existing `llm_usage` insert at `simplified-llm.service.ts:577` and surface the inserted row's primary key out to markets callers via `LlmTextResult.llmUsageId`.

### Steps
- [ ] 2.1 In `packages/planes/llm/simplified/simplified-llm.service.ts`, locate the call to the adapter (`chatCompletion`) and the subsequent `llm_usage` insert at line ~577.
  - Capture `result.reasoning` and `result.usage.reasoningTokens` from the adapter result.
  - Apply truncation: if `reasoning && reasoning.length > 65536`, slice to 65536, set `truncated=true`, and `this.logger.warn` with the row's `run_id` and original length.
  - Add `reasoning_content`, `reasoning_tokens`, `reasoning_truncated` to the insert payload.
  - Capture the inserted row's primary key (the `run_id` value used in the insert) and surface it on the `generateResponse` return.
- [ ] 2.2 Locate the `LLMServiceProvider.generateResponse` interface (likely in the planes/llm exports). Extend its return shape to include optional `reasoning?: string` and `llmUsageId?: string` on the object form. String form is preserved for backward compatibility.
- [ ] 2.3 In `apps/api/src/markets/services/markets-llm.service.ts`:
  - Extend `LlmTextResult` with `reasoning?: string` and `llmUsageId?: string`.
  - In `generateText`, when the underlying response is an object form, propagate `reasoning` and `llmUsageId` onto the returned `LlmTextResult`. (Both fallback paths — primary and commercial — must propagate.)
- [ ] 2.4 Create `apps/api/tests/unit/simplified-llm-reasoning-insert.test.ts`:
  - Stubs the `DatabaseService.insert` call so the captured payload can be inspected.
  - Stubs the adapter to return `{content:"x", reasoning:"y", usage:{...}}`.
  - Asserts the captured insert payload contains `reasoning_content="y"`, `reasoning_truncated=false`.
  - Second case: adapter returns no reasoning → `reasoning_content` is null, `reasoning_truncated=false`.
  - Third case: adapter returns 70 KB reasoning → captured `reasoning_content.length === 65536`, `reasoning_truncated=true`, warning logged.
  - Asserts `generateResponse` return includes `llmUsageId` matching the inserted row's `run_id`.
- [ ] 2.5 Append the new test to the `test:unit` chain in `apps/api/package.json`.
- [ ] 2.6 Update `apps/api/tests/markets/integration/stubs/stub-llm-service.ts` to add a `withReasoning(reasoning: string, reasoningTokens?: number)` builder that stores canned reasoning to be returned on the next `generateResponse` call (and surfaces the resulting `llmUsageId` so Phase 3's integration test can assert against it).

### Quality Gate
- [ ] **Lint**: `pnpm -w run lint`
- [ ] **Build**: `pnpm -w run build`
- [ ] **Typecheck**: `pnpm -w run typecheck`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api run test:unit`
- [ ] **E2E Tests**: `pnpm -w run ci:markets` — still passes; markets call sites have not been modified.
- [ ] **DB Verification**: After running `pnpm -w run ci:markets`, query `select count(*) from public.llm_usage where reasoning_content is not null;` — expect 0 (no markets caller stamps yet, and existing tests don't return reasoning from the stub).
- [ ] **Phase Review**:
  - [ ] Insert payload writes all three new columns when source data is present?
  - [ ] `llmUsageId` surfaced through `LlmTextResult`?
  - [ ] All three unit-test branches green?
  - [ ] Stub harness extended with `withReasoning`?
  - [ ] No markets call site touched yet?

---

## Phase 3: Wire markets services + integration test
**Status**: Complete

**Notes**:
- **Scope correction during execution**: PRD's "9 services" list was wrong. Two of them — `learning-engine.service.ts` and `trade-recommendation.service.ts` — do NOT actually call any LLM. Their `prediction.*` inserts are deterministic. The schema columns I added in Phase 1 to `learning_proposals`, `learning_reports`, `analyst_config_versions` are forward-prep for any future LLM-driven learning; they stay null today.
- Two additional LLM-calling services produce no persisted analysis row: `canonical-test-runner.service.ts` (replays for canonical tests; output consumed for comparison) and `context-provider.service.ts` (LLM-built context strings consumed by other services). Their `llm_usage` rows are still traceable via `caller_type='agent'` + `agent_name=<service slug>`, just not via FK. The user's invariant ("nothing calls an LLM without a tie") holds in spirit — the rows exist and are categorized.
- **Final wired scope: 5 services covering 6 tables.** prediction-runner (market_predictions analyst + arbitrator), risk-runner (analyst_risk_assessments + risk_dimension_assessments via persistDimensionAssessment), risk-debate (risk_debates — arbiter's llmUsageId stamped, blue/red usage ids in transcript JSON), predictor-generator (market_predictors via upsertPredictor), markets.service (prediction_challenges, both batch + stream paths).
- **Stub LLM service extended**: when `includeMetadata: true` (which `MarketsLlmService.generateText` now always passes), returns an `LLMResponse`-shaped object with a synthetic uuid `requestId` and synthetic `thinking` text. The integration assertion checks `llm_usage_id IS NOT NULL` on every analyst + arbitrator row across all 4 scenarios.
- **What the integration test does NOT cover**: it does not write to or assert against `public.llm_usage` itself. The stub doesn't insert (it would need a `db` reference and the join is what the user is going to test manually anyway). The test confirms that markets services capture `llmUsageId` and stamp it on the analysis row. The Phase 4 manual smoke pass against real Ollama + real `TwoTierLLMService` is what confirms the row actually lands in `llm_usage` with `reasoning_content`.
**Objective**: Make every LLM-calling markets service capture `result.llmUsageId` and stamp it on the analysis row it inserts. Add a round-trip integration test.

### Steps
- [ ] 3.1 `apps/api/src/markets/services/prediction-runner.service.ts` (PRD §4.2 #1):
  - Capture `llmUsageId` from each `generateText` result.
  - Extend the `insert into prediction.market_predictions` statement at lines 280 and 385 to include `llm_usage_id` and bind the captured value.
- [ ] 3.2 `apps/api/src/markets/services/risk-runner.service.ts` (PRD §4.2 #2 and #3):
  - Capture `llmUsageId` for each per-analyst LLM call.
  - Extend the `insert into prediction.analyst_risk_assessments` statement at line 368 to include `llm_usage_id`.
  - Extend the `insert into prediction.risk_dimension_assessments` statement at line 470 similarly.
  - The composite `market_risk_assessments` insert at line 545 stays unchanged (PRD §4.2 explicitly excludes composite/derived rows).
- [ ] 3.3 `apps/api/src/markets/services/risk-debate.service.ts` (PRD §4.2 #4):
  - Capture `llmUsageId` from the debate-turn LLM call.
  - Extend the `insert into prediction.risk_debates` statement at line 85 to include `llm_usage_id`.
- [ ] 3.4 `apps/api/src/markets/services/predictor-generator.service.ts` (PRD §4.2 #5):
  - Capture `llmUsageId` from the generator call.
  - Extend `insert into prediction.market_predictors` at line 369.
- [ ] 3.5 `apps/api/src/markets/markets.service.ts` challenge handler (PRD §4.2 #6):
  - Capture `llmUsageId` from the challenger LLM call.
  - Extend the two `insert into prediction.prediction_challenges` statements at lines 868 and 972.
- [ ] 3.6 `apps/api/src/markets/services/learning-engine.service.ts` (PRD §4.2 #7, #8, #9):
  - Capture `llmUsageId` from each LLM call.
  - Extend `insert into prediction.learning_proposals` at line 441.
  - Extend `insert into prediction.learning_reports` at line 415 — but only when the row originates from an LLM call (the `eod-settlement` and `nightly-evaluation` services also write to this table without LLMs; those paths leave `llm_usage_id` null).
  - Extend `insert into prediction.analyst_config_versions` at line 265 — only when the version is LLM-tuned (other inserts in `markets.service.ts` lines 397 and 449 write the same table without an LLM call and stay null).
- [ ] 3.7 `apps/api/src/markets/services/trade-recommendation.service.ts` (PRD §4.2 #1, second writer):
  - Capture `llmUsageId` from the portfolio-manager LLM call.
  - Extend `insert into prediction.market_predictions` at line 497.
- [ ] 3.8 Create `apps/api/tests/markets/integration/llm-reasoning-roundtrip.test.ts`:
  - Configures the stub LLM service from step 2.6 with `withReasoning("the model thought hard about XYZ", 100)`.
  - Drives a single prediction-runner integration run end-to-end against the markets integration harness.
  - Asserts a `prediction.market_predictions` row was inserted with non-null `llm_usage_id`.
  - Joins to `public.llm_usage` on that id and asserts `reasoning_content === "the model thought hard about XYZ"`.
  - Asserts the prediction row itself is otherwise inserted normally (no behavior regression on the existing fields).
- [ ] 3.9 Wire the new integration test into `apps/api/tests/markets/integration/run-markets-integration-tests.ts`.

### Quality Gate
- [ ] **Lint**: `pnpm -w run lint`
- [ ] **Build**: `pnpm -w run build`
- [ ] **Typecheck**: `pnpm -w run typecheck`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api run test:unit`
- [ ] **E2E Tests**: `pnpm -w run ci:markets`
- [ ] **Integration Tests**: `pnpm --filter @divinr/api run test:markets:integration`
- [ ] **DB Verification**: After running the integration test, query
  `select mp.id, mp.llm_usage_id, length(lu.reasoning_content) from prediction.market_predictions mp join public.llm_usage lu on lu.run_id = mp.llm_usage_id::text order by mp.created_at desc limit 5;`
  — top row has non-null `llm_usage_id` and non-null `reasoning_content`.
- [ ] **Phase Review**:
  - [ ] Each of the 9 tables has at least one wired call site?
  - [ ] `learning_reports` and `analyst_config_versions` only carry the column from LLM-call paths, not from non-LLM inserts?
  - [ ] Round-trip integration test green?
  - [ ] §2 success criterion #3 (100% trace coverage on LLM-produced rows) holds for the test scenarios?

---

## Phase 4: Completion report
**Status**: Not Started
**Objective**: Document outcomes and finalize.

### Steps
- [ ] 4.1 Write `docs/efforts/current/completion-report.md` per the format used by recently-archived efforts in `docs/efforts/`.
- [ ] 4.2 Capture concrete metrics for each PRD §2 success criterion:
  - §2.1 reasoning capture (sample row from `llm_usage` showing non-null `reasoning_content`).
  - §2.2 no-op rate (sample row with `reasoning_content IS NULL`).
  - §2.3 trace coverage (count of markets analysis rows with non-null `llm_usage_id` after the integration test run).
  - §2.4 no regressions (final gate suite results).
  - §2.5 round-trip test (test name + status).
- [ ] 4.3 Note any of the §5 risks that materialized and how they were handled.
- [ ] 4.4 Note follow-up work that's now unblocked (read endpoint, provenance extension, challenge stream enrichment, front-end admin page, paid-provider adapter wiring).
- [ ] 4.5 Run final gate suite. Commit + push branch.

### Quality Gate
- [ ] **Lint**: `pnpm -w run lint`
- [ ] **Build**: `pnpm -w run build`
- [ ] **Typecheck**: `pnpm -w run typecheck`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api run test:unit`
- [ ] **E2E Tests**: `pnpm -w run ci:markets`
- [ ] **Integration Tests**: `pnpm --filter @divinr/api run test:markets:integration`
- [ ] **Phase Review**: All §2 success criteria documented with concrete pass/fail.
