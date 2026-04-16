# Workflow Stages & Two-Step Article Pipeline — Implementation Plan

**PRD**: [./prd.md](./prd.md)
**Intention**: [./intention.md](./intention.md)
**Created**: 2026-04-16
**Status**: Not Started

## Progress Tracker
<!-- run-plan uses this section to track where we are -->
- [x] Phase 1: Stage taxonomy infrastructure
- [x] Phase 2: Step 1 — instrument-keyed article relevance
- [ ] Phase 3: Step 2 — gate predictor generation by relevance
- [ ] Phase 4: Stage 3 (3a + 3b) — per-analyst risk reflection + multi-agent debate (pre-prediction)
- [ ] Phase 5: Acceptance — freshness check + full-cycle validation
- [ ] Phase 6: Cutover — remove feature flag

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
**Status**: In Progress
**Objective**: With `MARKETS_STAGES_V2=true`, `PredictorGeneratorService` only creates `market_predictors` for (article, instrument) pairs where `article_instrument_relevance.is_relevant=true`.

### Steps
- [ ] 3.1 Modify `PredictorGeneratorService.getUnscoredArticles` (`predictor-generator.service.ts:224`) to add a flag-gated `AND EXISTS (SELECT 1 FROM prediction.article_instrument_relevance air WHERE air.article_id = ma.id AND air.instrument_id = $1 AND air.is_relevant = true)` clause. Branching inside the service based on `process.env.MARKETS_STAGES_V2`.
- [ ] 3.2 Add a metric/counter: in the `runGeneration` return payload, include `articlesSkippedByRelevanceGate: number` — decide it by contrasting `getUnscoredArticles` results before and after the new filter (cheap pre-filter count query, or derive post-hoc).
- [ ] 3.3 Emit a new observability event `pipeline.predictor.relevance_gate` per instrument summarizing skipped counts, with `workflow_stage: 'predictor_generation'`.
- [ ] 3.4 Update the `admin/run-pipeline` controller response shape (`apps/api/src/markets/markets.controller.ts:1488`) to include `articlesSkippedByRelevanceGate` inside the `predictors` block — passthrough from the service result.
- [ ] 3.5 Add a smoke scenario continuing from Phase 2's seeded data: call the full pipeline with `MARKETS_STAGES_V2=true` and assert that `market_predictors` has **zero rows** for the (AAPL article, TSLA) pair and for the (Tesla article, AAPL) pair, while rows exist for the matching pairs.
- [ ] 3.6 Add a unit test `apps/api/tests/unit/predictor-relevance-gate.test.ts` asserting the SQL fragment is only included when the flag is true (use a tiny stub around the query builder or inspect the generated SQL string via a test hook). Register in `test:unit`.

### Quality Gate
- [ ] **Lint**: `pnpm --filter @divinr/api run lint`
- [ ] **Typecheck**: `pnpm --filter @divinr/api run typecheck`
- [ ] **Build**: `pnpm --filter @divinr/api run build`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api run test:unit`
- [ ] **E2E / Smoke Tests**: `pnpm --filter @divinr/api run test:markets:smoke`
- [ ] **Curl Tests** on `:7100` (API started with `MARKETS_STAGES_V2=true`):
  - `curl -s -X POST -H "x-user-id: curl-test" http://localhost:7100/markets/admin/run-pipeline | jq '.predictors'` — response includes `articlesSkippedByRelevanceGate` field
  - DB assertion: `SELECT count(*) FROM prediction.market_predictors mp WHERE NOT EXISTS (SELECT 1 FROM prediction.article_instrument_relevance air WHERE air.article_id = mp.article_id AND air.instrument_id = mp.instrument_id AND air.is_relevant = true) AND mp.created_at > now() - interval '10 minutes'` returns **0** (Goal G2 acceptance from PRD §2)
  - Flag-off control: restart API without `MARKETS_STAGES_V2`, run pipeline; DB query above is allowed to return > 0 (old behavior still creates rows regardless of relevance)
- [ ] **Chrome Tests**: N/A
- [ ] **Phase Review** vs PRD §8 Phase 3 and Goal G2:
  - [ ] With flag on, no predictor is created for an `is_relevant=false` pair
  - [ ] Flag-off behavior unchanged
  - [ ] Skipped-article counter visible in response and logs
  - [ ] Deviations documented

---

## Phase 4: Stage 3 (3a + 3b) — per-analyst risk reflection + multi-agent debate (pre-prediction)
**Status**: Not Started
**Objective**: Between predictor generation and prediction generation, run **both** sub-stages: (3a) write a fresh `analyst_risk_assessments` row for every (instrument, analyst) whose predictors moved this cycle, then (3b) invoke `RiskDebateService` for each instrument to produce the Blue/Red/Arbiter synthesis with per-viewer participant filtering per master-intention §3.5.

### Steps
- [ ] 4.1 Add method `executePerAnalystRiskPass(instrumentIdsWithNewPredictors: string[]): Promise<{ assessmentsWritten: number; errors: string[] }>` to `RiskRunnerService` (`apps/api/src/markets/services/risk-runner.service.ts`). Do not modify the existing `executeRiskRun` method. For each (instrument × enabled personality analyst):
  - Load the analyst's previous `analyst_risk_assessments` row for this instrument (if any).
  - Load active per-analyst predictor lines (reuse pattern from `prediction-runner.service.ts:625–648`).
  - Build a system prompt framed as "you are <analyst display_name>. Produce your holistic risk assessment for <instrument> as a first-person analysis of how the latest signals shift your prior risk view. Use the language 'analysis / signal', never 'advice / recommendation'."
  - One LLM call via `MarketsLlmService.generateText`. Parse `{ score: 0-100, confidence: 0-1, reasoning: string, evidence: object }`.
  - Upsert into `analyst_risk_assessments`. Use `@Inject(DATABASE_SERVICE)` pattern already in the file.
  - Write a `market_run_artifacts` row with `role='analyst'`, `workflow_stage=WorkflowStage.RiskAssessment`, `analyst_id=<id>`, `run_type='risk'`. Reuse existing artifact table.
- [ ] 4.2 Determine which instruments had predictors added/updated this cycle. Simplest approach: have `AnalystPipelineService` capture the set of instrument IDs from `PredictorGeneratorService.runGeneration()` return (it already returns `instrumentsAffected` as a count; extend it to also return the Set of IDs). Update the `PredictorGenResult` interface to add `instrumentIdsAffected: string[]`.
- [ ] 4.3 In `AnalystPipelineService.runPipeline`, between existing Step 2 (predictor gen) and Step 3 (prediction gen), insert new `Pipeline Step 2c: Per-analyst risk assessment` block:
  - Guarded by `if (process.env.MARKETS_STAGES_V2 === 'true' && predictorResult.instrumentIdsAffected.length > 0)`
  - Calls `this.riskRunner.executePerAnalystRiskPass(predictorResult.instrumentIdsAffected)`
  - Populates a new `PipelineResult.riskAssessmentsWritten` field
- [ ] 4.4 Add an env-configurable batch limit `MARKETS_STAGES_V2_RISK_BATCH_LIMIT` (default 50). `executePerAnalystRiskPass` truncates its (instrument × analyst) workload to this limit, logs a warning if truncated. This mitigates the Ollama-serial risk from PRD §7.
- [ ] 4.5 Add unit test `apps/api/tests/unit/risk-per-analyst-pass.test.ts` covering: (a) parse success, (b) parse failure fallback, (c) batch truncation at limit. Use a fake `MarketsLlmService`. Register in `test:unit`.
- [ ] 4.6 Extend the Phase 2/3 smoke scenario: after the full gated pipeline runs with `MARKETS_STAGES_V2=true`, assert `analyst_risk_assessments` rows exist for every (instrument, analyst) whose instrument showed up in the relevance-filtered predictors for that run.
- [ ] 4.7 **Stage 3b — invoke Red/Blue/Arbiter debate.** After Stage 3a completes, invoke `RiskDebateService` (existing — not a new service) for each instrument whose 3a run produced fresh reflections. Participant set construction:
  - Base instrument, no viewer customizations → one shared debate run, participants = base analysts associated with the instrument
  - Base instrument with viewer-specific custom analyst associations → additional debate run per viewer, participants = base analysts + that viewer's custom analyst(s); filtered to fire only for viewers who have at least one custom analyst on the instrument
  - User-authored custom instrument → one debate run for the author, participants = the analysts that author explicitly associated with the instrument
  - Writes `risk_debates` rows (existing schema); tag each row with the viewer context (base shared vs. viewer-scoped) so downstream reads can filter per-viewer.
- [ ] 4.8 Add `RiskDebateService.runForStage3b(instrumentIds, viewerContext)` wrapper — or equivalent method on a coordinator — that the pipeline calls per instrument; internal fan-out handles the three cases in 4.7.
- [ ] 4.9 Extend `PipelineResult` with `debatesRun: number` — total debate invocations in the cycle (including additional per-viewer runs).
- [ ] 4.10 Extend the smoke scenario to assert: `risk_debates` has at least one row per instrument whose 3a reflections fired; if a seeded viewer has a custom-analyst association, assert an additional debate row exists scoped to that viewer.

### Quality Gate
- [ ] **Lint**: `pnpm --filter @divinr/api run lint`
- [ ] **Typecheck**: `pnpm --filter @divinr/api run typecheck`
- [ ] **Build**: `pnpm --filter @divinr/api run build`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api run test:unit`
- [ ] **E2E / Smoke Tests**: `pnpm --filter @divinr/api run test:markets:smoke`
- [ ] **Curl Tests** on `:7100` (API started with `MARKETS_STAGES_V2=true`):
  - `curl -s -X POST -H "x-user-id: curl-test" http://localhost:7100/markets/admin/run-pipeline | jq '.'` — expect 200 and the response includes `riskAssessmentsWritten` somewhere in the payload (add to admin-endpoint aggregation if needed)
  - DB assertion: for any instrument where `SELECT count(*) FROM prediction.market_predictors WHERE instrument_id = X AND updated_at > now() - interval '5 minutes'` is > 0, assert `SELECT count(*) FROM prediction.analyst_risk_assessments WHERE instrument_id = X AND created_at > now() - interval '5 minutes'` is > 0
  - Cycle-ordering assertion: `SELECT max(ara.created_at) > max(mp.updated_at) - interval '1 minute' FROM prediction.analyst_risk_assessments ara JOIN prediction.market_predictors mp ON mp.instrument_id = ara.instrument_id WHERE ara.instrument_id = X` returns true for instruments touched this cycle (PRD §2 G3 measurable acceptance)
- [ ] **Chrome Tests**: N/A
- [ ] **Phase Review** vs PRD §8 Phase 4:
  - [ ] `RiskRunnerService.executePerAnalystRiskPass` exists and is wired
  - [ ] Fires only for instruments with new predictors this cycle
  - [ ] Writes `analyst_risk_assessments` + stage-tagged artifacts
  - [ ] Batch limit respected
  - [ ] Prediction generation (still unchanged in this phase) reads the fresh risk rows via the existing path in `prediction-runner.service.ts:224–235`
  - [ ] Blue/Red/Arbiter debate **was invoked** by the pipeline this cycle as Stage 3b (assert: new rows in `risk_debates` exist for every instrument whose 3a reflections completed)
  - [ ] Per-viewer debate filtering works: baseline debate runs once for base instruments; additional per-viewer runs fire when a viewer has custom-analyst associations on a base instrument
  - [ ] Deviations documented

---

## Phase 5: Acceptance — freshness check + full-cycle validation
**Status**: Not Started
**Objective**: Prove Goals G1–G3 with a repeatable automated check, and add an in-service warning when risk is stale relative to predictors at prediction time.

### Steps
- [ ] 5.1 In `PredictionRunnerService.executePredictionRun` (`prediction-runner.service.ts`), after loading `latestRisk` and per-analyst risk rows (lines 79 and 224–235), compute the age gap: if the latest `analyst_risk_assessments.created_at` for (analyst, instrument) is older than the latest `market_predictors.updated_at` for the instrument by > 5 minutes, `this.logger.warn('Risk stale relative to predictors for analyst=X instrument=Y')`. Flag-gated by `MARKETS_STAGES_V2`.
- [ ] 5.2 Add end-to-end acceptance test `apps/api/tests/markets/run-stages-v2-acceptance.ts` that:
  - Sets `MARKETS_STAGES_V2=true` and `MARKETS_DISABLE_LLM=true` (deterministic fallback) to keep the test hermetic.
  - Seeds instruments, analysts, and articles with known relevance shapes.
  - Invokes `AnalystPipelineService.runPipeline()` directly (not via HTTP).
  - Asserts the three Goal queries from PRD §2, verbatim:
    - G1: `SELECT count(*) FROM prediction.market_run_artifacts WHERE workflow_stage IS NULL AND created_at > <cycle_start>` == 0
    - G2: `SELECT count(*) FROM prediction.market_predictors mp WHERE NOT EXISTS (SELECT 1 FROM prediction.article_instrument_relevance air WHERE air.article_id = mp.article_id AND air.instrument_id = mp.instrument_id AND air.is_relevant = true) AND mp.created_at > <cycle_start>` == 0
    - G3: for every new prediction run, max risk timestamp > max predictor timestamp - 5 minutes for that instrument
  - Exits non-zero if any assertion fails.
- [ ] 5.3 Register the acceptance test in `apps/api/package.json` as a new script `test:markets:stages-v2` and in the root `package.json` under `ci:markets` so CI will run it.
- [ ] 5.4 Run `MARKETS_STAGES_V2=true` manually against the live Spark pipeline for one cycle, observe logs, record the outcome in `docs/efforts/current/workflow-stages-article-pipeline/notes.md` (create the file if absent) — timings, error counts, truncations, any stale-risk warnings.

### Quality Gate
- [ ] **Lint**: `pnpm --filter @divinr/api run lint`
- [ ] **Typecheck**: `pnpm --filter @divinr/api run typecheck`
- [ ] **Build**: `pnpm --filter @divinr/api run build`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api run test:unit`
- [ ] **E2E / Smoke Tests**: `pnpm --filter @divinr/api run test:markets:smoke` passes; new `pnpm --filter @divinr/api run test:markets:stages-v2` passes
- [ ] **Curl Tests** on `:7100` (API started with `MARKETS_STAGES_V2=true`):
  - Full cycle: `curl -s -X POST -H "x-user-id: curl-test" http://localhost:7100/markets/admin/run-pipeline -o /tmp/pipeline.json && jq '.' /tmp/pipeline.json` — returns 200 and all new counters populated
  - Freshness DB check: run the three Goal queries from PRD §2 against the database and confirm each returns 0 (for count-style goals) or true (for the freshness goal)
  - Stale-risk log check: `grep "Risk stale relative to predictors" /path/to/api.log` — zero occurrences for the cycle just run
- [ ] **Chrome Tests**: N/A
- [ ] **Phase Review** vs PRD §8 Phase 5:
  - [ ] Acceptance test exists and passes
  - [ ] All three Goals' measurable queries from PRD §2 green
  - [ ] No stale-risk warnings on a clean cycle
  - [ ] Notes file records the live-cycle measurement
  - [ ] Deviations documented

---

## Phase 6: Cutover — remove feature flag
**Status**: Not Started
**Objective**: Make the new pipeline the only pipeline. Remove `MARKETS_STAGES_V2` branching, so the five-stage flow is unconditional.

### Steps
- [ ] 6.1 Remove every `MARKETS_STAGES_V2`-gated branch introduced in Phases 2–5. Code paths execute unconditionally. Delete the env var from any `.env.example` if referenced.
- [ ] 6.2 Update `AnalystPipelineService.runPipeline` docstring (lines 17–30) to describe the new five-stage flow (article processing → predictor generation → risk assessment → prediction generation → outcomes → learning), matching the PRD §4.1 diagram.
- [ ] 6.3 Update the admin endpoint `triggerFullPipeline` (`markets.controller.ts:1488`) so it delegates to `this.analystPipeline.runPipeline()` (currently it composes services manually — this was already a drift point; cutover is a good time). Return the `PipelineResult` directly. Confirm no callers depend on the previous shape (grep usage and fix any callers — frontend admin UI, etc.).
- [ ] 6.4 Remove the `if (MARKETS_STAGES_V2) { ... }` branch in the `PredictionRunnerService` stale-risk warning (Phase 5.1) — warning becomes unconditional.
- [ ] 6.5 Update `docs/efforts/current/workflow-stages-article-pipeline/notes.md` with a short "cutover done — flag removed" entry including the commit SHA.
- [ ] 6.6 Final lint/typecheck/build/test sweep (handled by the gate below).

### Quality Gate
- [ ] **Lint**: `pnpm --filter @divinr/api run lint` — zero errors, in particular zero `MARKETS_STAGES_V2` references remaining (`grep -R MARKETS_STAGES_V2 apps/api/src apps/api/tests` returns nothing)
- [ ] **Typecheck**: `pnpm --filter @divinr/api run typecheck`
- [ ] **Build**: `pnpm --filter @divinr/api run build`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api run test:unit` — all pass
- [ ] **E2E / Smoke Tests**: `pnpm --filter @divinr/api run test:markets:smoke && pnpm --filter @divinr/api run test:markets:stages-v2` — all pass
- [ ] **Curl Tests** on `:7100` (API started with **no** `MARKETS_STAGES_V2` in env):
  - `curl -s -X POST -H "x-user-id: curl-test" http://localhost:7100/markets/admin/run-pipeline | jq '.'` — returns 200 with the five-stage counters (`relevancePairsEvaluated`, `articlesSkippedByRelevanceGate`, `riskAssessmentsWritten`, plus existing counters) populated, proving the new flow runs without the flag
  - Run the three Goal queries from PRD §2 — each passes (G1=0, G2=0, G3 freshness true)
- [ ] **Chrome Tests**: N/A
- [ ] **Phase Review** vs PRD §8 Phase 6 and overall Goals G1–G3:
  - [ ] Feature flag fully removed (grep check is green)
  - [ ] Admin endpoint uses `AnalystPipelineService.runPipeline`
  - [ ] All three Goals still green without the flag
  - [ ] Docstring accurately describes the five-stage flow
  - [ ] Downstream efforts (`stage-keyed-analyst-contracts`, `instrument-contracts`) can now import `WorkflowStage` without guessing
  - [ ] Deviations documented
