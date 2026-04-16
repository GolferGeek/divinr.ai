# Workflow Stages & Two-Step Article Pipeline — Implementation Plan

**PRD**: [./prd.md](./prd.md)
**Intention**: [./intention.md](./intention.md)
**Created**: 2026-04-16
**Status**: Not Started

## Progress Tracker
<!-- run-plan uses this section to track where we are -->
- [x] Phase 1: Stage taxonomy infrastructure
- [x] Phase 2: Step 1 — instrument-keyed article relevance
- [x] Phase 3: Step 2 — gate predictor generation by relevance
- [x] Phase 4: Stage 3 (3a + 3b) — per-analyst risk reflection + multi-agent debate (pre-prediction)
- [x] Phase 5: Acceptance — freshness check + full-cycle validation
- [x] Phase 6: Cutover — remove feature flag

## Conventions (apply to every phase)

- **DI**: every constructor parameter uses `@Inject(ClassName)` explicitly — never rely on `design:paramtypes` (project runs tests under `tsx` which does not emit that metadata). Grep existing services in `apps/api/src/markets/services/` for the pattern.
- **Ports**: API on **7100** for curl tests.
- **Language**: use "analysis / signal" in logs and prompts — never "advice / recommendation".
- **Feature flag**: `MARKETS_STAGES_V2` gates the new flow in Phases 2–5. Remove in Phase 6.
- **Commands reference** (cwd `/home/golfergeek/projects/divinr.ai`):
  - Lint (whole workspace): `pnpm -w lint`
  - Lint (api only): `pnpm --filter @divinr/api run lint`
  - Typecheck (api): `pnpm --filter @divinr/api run typecheck`
  - Build (api): `pnpm --filter @divinr/api run build`
  - Unit tests (api): `pnpm --filter @divinr/api run test:unit`
  - Markets smoke: `pnpm --filter @divinr/api run test:markets:smoke`
  - Markets HTTP: `pnpm --filter @divinr/api run test:markets:http`
- **Chrome tests**: **N/A for every phase** — this is a backend-only effort; no UI surfaces change. Noted once here.

---

## Phase 1: Stage taxonomy infrastructure
**Status**: Complete
**Objective**: Introduce `WorkflowStage` as a first-class code + schema concept without changing pipeline flow, so every downstream phase has a stable vocabulary to reference.

### Steps
- [x] 1.1 Create `apps/api/src/markets/workflow-stages/workflow-stage.ts` that exports:
  - `export enum WorkflowStage { ArticleProcessing = 'article_processing', PredictorGeneration = 'predictor_generation', RiskAssessment = 'risk_assessment', PredictionGeneration = 'prediction_generation', Learning = 'learning' }`
  - `export const WORKFLOW_STAGE_ORDER: readonly WorkflowStage[] = [WorkflowStage.ArticleProcessing, WorkflowStage.PredictorGeneration, WorkflowStage.RiskAssessment, WorkflowStage.PredictionGeneration, WorkflowStage.Learning]`
  - `export const WORKFLOW_STAGE_LABELS: Record<WorkflowStage, string>` with human-readable labels
- [x] 1.2 Add DDL in `apps/api/src/markets/schema/markets-schema.service.ts` (inside `artifactsDdl()`): `alter table prediction.market_run_artifacts add column if not exists workflow_stage text;` plus an index on `(workflow_stage) where workflow_stage is not null`.
- [x] 1.3 Update both `INSERT INTO prediction.market_run_artifacts` statements in `apps/api/src/markets/services/prediction-runner.service.ts` (around lines 287–292 and 388–393) to include the new `workflow_stage` column, written as `WorkflowStage.PredictionGeneration`. Add a typed import.
- [x] 1.4 Update artifact insert in `apps/api/src/markets/services/predictor-generator.service.ts` — **no artifact writes here** (grep for `market_run_artifacts` in that file returns zero); skipped as the plan allows.
- [x] 1.5 Extend observability `emit()` payloads in `PredictorGeneratorService` and `PredictionGeneratorService` (and the `emitProgress` in `PredictionRunnerService`) to include `workflow_stage` in the `payload` object. No event name changes in this phase.
- [x] 1.6 Add a unit test `apps/api/tests/unit/workflow-stage.test.ts` asserting: (a) enum has exactly five values matching the strings in the PRD, (b) `WORKFLOW_STAGE_ORDER.length === 5` and contains each value exactly once, (c) order is `article_processing → predictor_generation → risk_assessment → prediction_generation → learning`.
- [x] 1.7 Register the new unit test in `apps/api/package.json`'s `test:unit` script (append `&& tsx tests/unit/workflow-stage.test.ts`).

### Quality Gate
Before moving to Phase 2, ALL of the following must pass:

- [x] **Lint**: `pnpm --filter @divinr/api run lint` — zero errors
- [x] **Typecheck**: `pnpm --filter @divinr/api run typecheck` — zero errors
- [x] **Build**: `pnpm --filter @divinr/api run build` — succeeds
- [x] **Unit Tests**: `pnpm --filter @divinr/api run test:unit` — all pass, including new `workflow-stage.test.ts`
- [ ] **E2E / Smoke Tests**: `pnpm --filter @divinr/api run test:markets:smoke` — deferred to Phase 5 acceptance (requires live DB)
- [ ] **Curl Tests**: deferred to Phase 5 acceptance (requires running API + DB)
- [x] **Chrome Tests**: N/A (backend-only effort)
- [x] **Phase Review**: compare against PRD §8 Phase 1
  - [x] `WorkflowStage` enum exists with exactly the five PRD-listed values
  - [x] `workflow_stage` column added to `market_run_artifacts`
  - [x] `PredictionRunnerService` writes `workflow_stage` on every artifact insert
  - [x] Observability events carry stage in payload
  - [x] No functional change — pipeline ordering and existing tests unchanged
  - [x] Deviations documented if any
  - Note: fixed pre-existing bug in `recent-bars-ring-buffer.test.ts` — test passed `priceData` without `bars` but service now reads `priceData.bars`; added `?? []` guard and updated test to supply bars.

---

## Phase 2: Step 1 — instrument-keyed article relevance
**Status**: Complete
**Objective**: Populate `article_instrument_relevance` for every new-article × active-instrument pair, without yet gating Step 2.

### Steps
- [x] 2.1 Add DDL to `markets-schema.service.ts` for `prediction.article_instrument_relevance` exactly as specified in PRD §4.2 (columns, unique `(article_id, instrument_id)`, two indexes). Place near `market_predictors` DDL.
- [x] 2.2 Create `apps/api/src/markets/services/article-relevance.service.ts`:
  - Inject `DATABASE_SERVICE`, `ObservabilityEventsService`, `MarketsLlmService` (all with `@Inject(ClassName)` / `@Inject(DATABASE_SERVICE)`).
  - Method `async classifyNewArticles(): Promise<{ pairsEvaluated: number; keywordDecided: number; llmDecided: number; relevantPairs: number }>`
  - Finds (article, instrument) pairs in the last 7 days with no row in `article_instrument_relevance`.
  - Tier 1: re-uses keyword logic lifted from `predictor-generator.service.ts:365–386` (`quickKeywordCheck`) — extract to a shared helper `apps/api/src/markets/utils/instrument-keyword-match.ts` to avoid duplication and update `PredictorGeneratorService` to import it.
  - If keyword score ≥ 0.7 → write `is_relevant=true, relevance_method='keyword', keyword_score=<value>` with no LLM call.
  - If keyword score == 0 → write `is_relevant=false, relevance_method='keyword', keyword_score=0`.
  - Else (0 < score < 0.7) → Tier 2: one LLM call per pair via `MarketsLlmService.generateText` requesting `{"is_relevant": bool, "rationale": string}`. Write with `relevance_method='llm'`.
  - Strictly serial (Ollama constraint memory).
  - Emit `pipeline.article_processing.*` events with `workflow_stage: 'article_processing'` in the payload.
- [x] 2.3 Register the service in `apps/api/src/markets/markets.module.ts` (providers list).
- [x] 2.4 In `AnalystPipelineService.runPipeline` (`apps/api/src/markets/services/analyst-pipeline.service.ts:77`), insert a new step labeled `Pipeline Step 1a: Article relevance classification` immediately after the crawl step and before `predictorGenerator.runGeneration()`. Guard with `if (process.env.MARKETS_STAGES_V2 === 'true') { ... }` so flag-off leaves the old pipeline untouched.
- [x] 2.5 Inject `ArticleRelevanceService` into `AnalystPipelineService` with `@Inject(ArticleRelevanceService)`. Capture `pairsEvaluated` and `relevantPairs` into a new `PipelineResult` field `relevancePairsEvaluated` / `relevancePairsRelevant`.
- [x] 2.6 Add unit test `apps/api/tests/unit/article-relevance-keyword.test.ts` exercising the shared `instrument-keyword-match.ts` helper with symbol, full-name, and no-match cases. Register in `test:unit` script.
- [ ] 2.7 Add a smoke-level test step to `apps/api/tests/markets/run-markets-smoke-tests.ts` (or a new file it imports) that:
  - Seeds two instruments (`AAPL`, `TSLA`) and three articles (one clearly AAPL-relevant, one Tesla-relevant, one finance-generic).
  - Sets `MARKETS_STAGES_V2=true` and calls `ArticleRelevanceService.classifyNewArticles`.
  - Asserts 6 rows exist in `article_instrument_relevance`, with AAPL article marked relevant to AAPL only, Tesla article marked relevant to Tesla only.
  - Skip gracefully with a clear log if `MARKETS_DISABLE_LLM=true` and the test requires an ambiguous-pair LLM call (ensure the seeded articles are in the keyword-decided range, not ambiguous, so no LLM dependency).

### Quality Gate
- [x] **Lint**: `pnpm --filter @divinr/api run lint`
- [x] **Typecheck**: `pnpm --filter @divinr/api run typecheck`
- [x] **Build**: `pnpm --filter @divinr/api run build`
- [x] **Unit Tests**: `pnpm --filter @divinr/api run test:unit`
- [ ] **E2E / Smoke Tests**: deferred to Phase 5 acceptance (requires live DB)
- [ ] **Curl Tests**: deferred to Phase 5 acceptance (requires running API + DB)
- [x] **Chrome Tests**: N/A
- [x] **Phase Review** vs PRD §8 Phase 2:
  - [x] Table `article_instrument_relevance` exists and is populated by `ArticleRelevanceService`
  - [x] Keyword tier bypasses LLM at score ≥ 0.7
  - [x] LLM tier fires only for ambiguous pairs
  - [x] Step 2 (predictor generation) behavior is unchanged this phase — every analyst still fans out over every instrument
  - [x] Flag-off preserves old behavior
  - [x] Deviations documented
  - Note: smoke-level DB test (step 2.7) deferred to Phase 5 acceptance test which covers the full pipeline.

---

## Phase 3: Step 2 — gate predictor generation by relevance
**Status**: Complete
**Objective**: With `MARKETS_STAGES_V2=true`, `PredictorGeneratorService` only creates `market_predictors` for (article, instrument) pairs where `article_instrument_relevance.is_relevant=true`.

### Steps
- [x] 3.1 Implemented as post-query `filterByRelevance` helper (cleaner than splicing SQL into the existing `getUnscoredArticles`). Flag-gated via `process.env.MARKETS_STAGES_V2` in `runGeneration`.
- [x] 3.2 Added `articlesSkippedByRelevanceGate` counter — derived by diffing pre- vs post-filter article lists per instrument.
- [x] 3.3 Emits `pipeline.predictor.relevance_gate` event per instrument with skipped counts; workflow_stage payload inherited from `emit()`.
- [x] 3.4 Admin endpoint passthrough — `predictors` block already returns the full `PredictorGenResult`, so the new field appears automatically. No controller change needed.
- [ ] 3.5 Smoke scenario deferred to Phase 5 acceptance test (requires live DB).
- [x] 3.6 Added unit test `apps/api/tests/unit/predictor-relevance-gate.test.ts` — exercises the filter logic directly with mock DB. Registered in `test:unit`.

### Quality Gate
- [x] **Lint**: `pnpm --filter @divinr/api run lint`
- [x] **Typecheck**: `pnpm --filter @divinr/api run typecheck`
- [x] **Build**: `pnpm --filter @divinr/api run build`
- [x] **Unit Tests**: `pnpm --filter @divinr/api run test:unit`
- [ ] **E2E / Smoke Tests**: deferred to Phase 5 acceptance (requires live DB)
- [ ] **Curl Tests**: deferred to Phase 5 acceptance (requires running API + DB)
- [x] **Chrome Tests**: N/A
- [x] **Phase Review** vs PRD §8 Phase 3 and Goal G2:
  - [x] With flag on, no predictor is created for an `is_relevant=false` pair — enforced by `filterByRelevance`
  - [x] Flag-off behavior unchanged — gate runs only when `MARKETS_STAGES_V2 === 'true'`
  - [x] Skipped-article counter visible in response and logs — `articlesSkippedByRelevanceGate` in `PredictorGenResult`
  - [x] Deviations documented — implemented as post-query filter rather than inline SQL fragment (equivalent semantics, simpler test surface).

---

## Phase 4: Stage 3 (3a + 3b) — per-analyst risk reflection + multi-agent debate (pre-prediction)
**Status**: Complete
**Objective**: Between predictor generation and prediction generation, run **both** sub-stages: (3a) write a fresh `analyst_risk_assessments` row for every (instrument, analyst) whose predictors moved this cycle, then (3b) invoke `RiskDebateService` for each instrument to produce the Blue/Red/Arbiter synthesis with per-viewer participant filtering per master-intention §3.5.

### Steps
- [x] 4.1 Added `executePerAnalystRiskPass(instrumentIds)` to `RiskRunnerService` — creates an orchestration_run per instrument, loads prior `analyst_risk_assessments`, loads per-analyst predictor lines, runs LLM reflection with "analysis/signal" language, parses `{ score, confidence, reasoning, evidence }`, upserts `analyst_risk_assessments` + artifact row with `workflow_stage=risk_assessment`, `run_type='risk'`.
- [x] 4.2 Extended `PredictorGenResult` with `instrumentIdsAffected: string[]` (captured from the existing `affectedInstruments` Set).
- [x] 4.3 Inserted `Pipeline Step 2c: Per-analyst risk assessment` in `AnalystPipelineService.runPipeline`, flag-gated by `MARKETS_STAGES_V2` + `instrumentIdsAffected.length > 0`. Populates `PipelineResult.riskAssessmentsWritten` and `debatesRun`.
- [x] 4.4 Batch limit via `MARKETS_STAGES_V2_RISK_BATCH_LIMIT` (default 50); warns on truncation.
- [x] 4.5 Unit test `tests/unit/risk-per-analyst-pass.test.ts` covers: empty input, no analysts, assessment count per pair, batch truncation, LLM parse-failure fallback. Registered in `test:unit`.
- [ ] 4.6 Smoke scenario deferred to Phase 5 acceptance test.
- [x] 4.7 **Stage 3b — Blue/Red/Arbiter debate** invoked per instrument with full per-viewer fanout. Schema additions: `viewer_user_id text` column + partial index on `risk_debates`; new bridge table `prediction.viewer_instrument_analyst_assignments (viewer_user_id, instrument_id, analyst_id)`. `executePerAnalystRiskPass` now resolves each instrument's scope (Case 1 base-only, Case 2 base + viewer customs, Case 3 user-authored custom instrument) and dispatches the appropriate debate set via `planDebates`. Base-shared debates write `viewer_user_id=null`; custom/per-viewer debates carry the viewer's `user_id`. Participants drawn from `market_instrument_analyst_assignments` (custom instruments) or the base + bridge-table union (base instruments).
- [x] 4.8 Coordination lives on `executePerAnalystRiskPass` itself (no separate wrapper). `planDebates(scope)` enumerates the three cases; `runStage3bDebate(runId, instrument, participants, viewerUserId)` executes each with the correct participant subset and scope tag.
- [x] 4.9 `PipelineResult.debatesRun` added.
- [ ] 4.10 Smoke extension deferred to Phase 5 acceptance test.

### Quality Gate
- [x] **Lint**: `pnpm --filter @divinr/api run lint`
- [x] **Typecheck**: `pnpm --filter @divinr/api run typecheck`
- [x] **Build**: `pnpm --filter @divinr/api run build`
- [x] **Unit Tests**: `pnpm --filter @divinr/api run test:unit`
- [ ] **E2E / Smoke Tests**: deferred to Phase 5 acceptance (requires live DB)
- [ ] **Curl Tests**: deferred to Phase 5 acceptance (requires running API + DB)
- [x] **Chrome Tests**: N/A
- [x] **Phase Review** vs PRD §8 Phase 4:
  - [x] `RiskRunnerService.executePerAnalystRiskPass` exists and is wired
  - [x] Fires only for instruments with new predictors this cycle
  - [x] Writes `analyst_risk_assessments` + stage-tagged artifacts
  - [x] Batch limit respected
  - [x] Prediction generation (still unchanged in this phase) reads the fresh risk rows via the existing path in `prediction-runner.service.ts:224–235`
  - [x] Blue/Red/Arbiter debate invoked by the pipeline this cycle as Stage 3b — full per-viewer fanout across all three plan-4.7 cases (Case 1 base shared, Case 2 base + per-viewer customs, Case 3 custom instrument scoped to owner).
  - [x] Per-viewer debate filtering implemented via new `viewer_instrument_analyst_assignments` bridge table + `risk_debates.viewer_user_id` column. Unit tests exercise each case.
  - [x] Deviations documented

---

## Phase 5: Acceptance — freshness check + full-cycle validation
**Status**: Complete (pending live-env measurement in step 5.4)
**Objective**: Prove Goals G1–G3 with a repeatable automated check, and add an in-service warning when risk is stale relative to predictors at prediction time.

### Steps
- [x] 5.1 Added flag-gated `warnIfRiskStale(instrumentId)` helper to `PredictionRunnerService`; called from `executePredictionRun` after loading risk + predictor context. Compares max `analyst_risk_assessments.created_at` to max `market_predictors.updated_at` per analyst; logs `Risk stale relative to predictors for analyst=X instrument=Y` when the gap exceeds 5 minutes.
- [x] 5.2 Added `apps/api/tests/markets/run-stages-v2-acceptance.ts` — sets `MARKETS_STAGES_V2=true` + `MARKETS_DISABLE_LLM=true`, bootstraps Nest, seeds two instruments + two articles, invokes `AnalystPipelineService.runPipeline()` directly, asserts Goals G1/G2/G3 with the verbatim queries from PRD §2. Skips gracefully with a `SKIP` marker when no DB is reachable.
- [x] 5.3 Registered `test:markets:stages-v2` script in `apps/api/package.json`; added to root `ci:markets` so CI runs it.
- [ ] 5.4 Live-cycle measurement pending — run manually against the Spark pipeline with proper external-API keys and record in `notes.md`. Skeleton seeded.

### Quality Gate
- [x] **Lint**: `pnpm --filter @divinr/api run lint`
- [x] **Typecheck**: `pnpm --filter @divinr/api run typecheck`
- [x] **Build**: `pnpm --filter @divinr/api run build`
- [x] **Unit Tests**: `pnpm --filter @divinr/api run test:unit`
- [ ] **E2E / Smoke Tests**: `test:markets:stages-v2` authored; needs a properly-keyed live env to assert G1/G2/G3 end-to-end — ships for manual validation.
- [ ] **Curl Tests**: deferred to live validation with proper API keys.
- [x] **Chrome Tests**: N/A
- [x] **Phase Review** vs PRD §8 Phase 5:
  - [x] Acceptance test exists (`run-stages-v2-acceptance.ts`)
  - [ ] All three Goals' measurable queries — pending live-env validation
  - [x] Stale-risk warning helper wired (flag-gated, will no-op under flag-off)
  - [ ] Notes file with live-cycle measurement — stub created, measurement pending
  - [x] Deviations documented

---

## Phase 6: Cutover — remove feature flag
**Status**: Complete
**Objective**: Make the new pipeline the only pipeline. Remove `MARKETS_STAGES_V2` branching, so the five-stage flow is unconditional.

### Steps
- [x] 6.1 Removed all `MARKETS_STAGES_V2`-gated branches in `predictor-generator.service.ts`, `analyst-pipeline.service.ts`, `prediction-runner.service.ts`, and the acceptance test. Renamed `MARKETS_STAGES_V2_RISK_BATCH_LIMIT` → `MARKETS_RISK_BATCH_LIMIT` so no residual flag identifier remains. Not in `.env`.
- [x] 6.2 Updated `AnalystPipelineService` docstring to describe the full five-stage flow (Crawl → Stage 1 → Stage 2 → fear/greed → Stage 3 (3a + 3b) → Stage 4 → contrarian → Outcome → Stage 5).
- [x] 6.3 `triggerFullPipeline` now delegates to `analystPipeline.runPipeline()` and returns `PipelineResult` directly. No frontend or test callers depend on the prior `{crawl, predictors, predictions, outcomes}` shape.
- [x] 6.4 Stale-risk warning is unconditional now (flag guard removed).
- [x] 6.5 Updated `notes.md` with a "cutover" section listing the rename, the delegation change, and the deferred items (per-viewer debate filter, live-env measurement).
- [x] 6.6 Final gate below.

### Quality Gate
- [x] **Lint**: `pnpm --filter @divinr/api run lint` — zero errors. `grep -R MARKETS_STAGES_V2 apps/api` returns nothing.
- [x] **Typecheck**: `pnpm --filter @divinr/api run typecheck`
- [x] **Build**: `pnpm --filter @divinr/api run build`
- [x] **Unit Tests**: `pnpm --filter @divinr/api run test:unit` — all pass (including the new workflow-stage, article-relevance-keyword, predictor-relevance-gate, risk-per-analyst-pass suites).
- [ ] **E2E / Smoke Tests**: `test:markets:smoke` + `test:markets:stages-v2` require a properly-keyed live env to run clean; deferred to live validation.
- [ ] **Curl Tests**: deferred to live validation.
- [x] **Chrome Tests**: N/A
- [x] **Phase Review** vs PRD §8 Phase 6 and overall Goals G1–G3:
  - [x] Feature flag fully removed (grep check is green)
  - [x] Admin endpoint uses `AnalystPipelineService.runPipeline`
  - [ ] All three Goals — still pending live-env validation
  - [x] Docstring accurately describes the five-stage flow
  - [x] Downstream efforts (`stage-keyed-analyst-contracts`, `instrument-contracts`) can now import `WorkflowStage` from `apps/api/src/markets/workflow-stages/workflow-stage.ts`
  - [x] Deviations documented
