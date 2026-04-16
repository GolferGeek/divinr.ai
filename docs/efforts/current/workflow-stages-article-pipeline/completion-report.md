# Workflow Stages & Two-Step Article Pipeline — Completion Report

**Plan**: [./plan.md](./plan.md)
**PRD**: [./prd.md](./prd.md)
**Intention**: [./intention.md](./intention.md)
**Completed**: 2026-04-16
**Final Status**: All Phases Complete (live-env acceptance pending)

## Summary

- Total phases: 6
- Phases completed: 6
- Phases remaining: 0 (two deferred items — live acceptance measurement and per-viewer debate filtering — tracked in `notes.md`)

## Phase Results

### Phase 1 — Stage taxonomy infrastructure — Complete
- Added `WorkflowStage` enum + `WORKFLOW_STAGE_ORDER` + `WORKFLOW_STAGE_LABELS` in `apps/api/src/markets/workflow-stages/workflow-stage.ts`.
- Added `workflow_stage text` column + filtered index on `prediction.market_run_artifacts`.
- Threaded `WorkflowStage.PredictionGeneration` into both artifact inserts in `PredictionRunnerService`.
- Extended observability `emit()` payloads in `PredictorGeneratorService`, `PredictionGeneratorService`, and `PredictionRunnerService.emitProgress` with `workflow_stage`.
- New unit test: `workflow-stage.test.ts`.
- **Drive-by fix**: pre-existing bug in `recent-bars-ring-buffer.test.ts` (test passed `priceData` without `bars`); added `?? []` guard in `OutcomeTrackingService.updateInstrumentPrice` and updated test to supply bars.

### Phase 2 — Article relevance service (Stage 1) — Complete
- Added `prediction.article_instrument_relevance` table (DDL in `markets-schema.service.ts`).
- New `ArticleRelevanceService` with keyword-first / LLM-fallback classification, serial per Ollama constraint.
- Shared `instrumentKeywordScore` helper extracted; `PredictorGeneratorService.quickKeywordCheck` refactored to use it.
- Registered service; wired into `AnalystPipelineService.runPipeline` (`Pipeline Step 1a`).
- New unit test: `article-relevance-keyword.test.ts`.

### Phase 3 — Gate predictor generation by relevance — Complete
- `PredictorGeneratorService.runGeneration` consults `article_instrument_relevance` and filters unscored articles to relevant pairs only.
- Added `articlesSkippedByRelevanceGate` counter + `pipeline.predictor.relevance_gate` observability event.
- New unit test: `predictor-relevance-gate.test.ts`.

### Phase 4 — Stage 3 (3a + 3b): per-analyst risk reflection + Blue/Red/Arbiter debate with per-viewer fanout — Complete
- Added `RiskRunnerService.executePerAnalystRiskPass(instrumentIds)`:
  - Creates a `run_type='risk'` orchestration run per instrument.
  - Resolves each instrument's scope (base vs. custom; participating analysts; per-viewer customs).
  - Runs one reflection per (instrument × analyst) in the resolved union; upserts `analyst_risk_assessments`, writes `market_run_artifacts` row with `workflow_stage=risk_assessment`.
  - Fans out Stage 3b debates per plan 4.7:
    - Case 1: base instrument, base-only analysts → one shared debate, `viewer_user_id = null`.
    - Case 2: base instrument with viewer customs → shared debate + one additional debate per viewer (participants = base + that viewer's customs).
    - Case 3: user-authored custom instrument → one debate scoped to the owner, participants = explicitly-assigned analysts.
  - Each debate persists a Stage 3b artifact row tagged with viewer scope.
- Schema additions: `viewer_user_id text` column + partial index on `risk_debates`; new bridge table `prediction.viewer_instrument_analyst_assignments`.
- Workload capped by `MARKETS_RISK_BATCH_LIMIT` (default 50).
- Extended `PredictorGenResult` with `instrumentIdsAffected: string[]`; pipeline captures and forwards to risk pass.
- Extended `PipelineResult` with `riskAssessmentsWritten` and `debatesRun`.
- Unit tests in `risk-per-analyst-pass.test.ts` exercise empty input, Case 1, Case 2, Case 3, batch truncation, and LLM parse-failure fallback.

### Phase 5 — Acceptance: freshness check + full-cycle validation — Complete (live-env measurement pending)
- Added `warnIfRiskStale(instrumentId)` in `PredictionRunnerService` — logs warning when the latest `analyst_risk_assessments.created_at` for any (analyst, instrument) lags max `market_predictors.updated_at` by > 5 minutes.
- New acceptance script `apps/api/tests/markets/run-stages-v2-acceptance.ts` — bootstraps Nest, seeds instruments + articles, invokes `AnalystPipelineService.runPipeline()` directly, asserts verbatim G1/G2/G3 queries from PRD §2. Skips gracefully without DB.
- New `test:markets:stages-v2` script; added to root `ci:markets`.
- `notes.md` template seeded with a live-cycle measurement placeholder.

### Phase 6 — Cutover — Complete
- Removed every `MARKETS_STAGES_V2` flag check from production code + acceptance test.
- Renamed env var `MARKETS_STAGES_V2_RISK_BATCH_LIMIT` → `MARKETS_RISK_BATCH_LIMIT` so no residual flag identifier remains.
- `AnalystPipelineService` docstring describes the five-stage flow end-to-end.
- `POST /markets/admin/run-pipeline` now delegates to `analystPipeline.runPipeline()` and returns `PipelineResult`. No callers depend on the prior shape.

## Gate Results

| Gate | Phase 1 | Phase 2 | Phase 3 | Phase 4 | Phase 5 | Phase 6 |
|------|---------|---------|---------|---------|---------|---------|
| Lint | PASS | PASS | PASS | PASS | PASS | PASS |
| Typecheck | PASS | PASS | PASS | PASS | PASS | PASS |
| Build | PASS | PASS | PASS | PASS | PASS | PASS |
| Unit tests | PASS | PASS | PASS | PASS | PASS | PASS |
| Smoke / E2E | deferred | deferred | deferred | deferred | script authored, live-env pending | live-env pending |
| Curl | deferred | deferred | deferred | deferred | pending | pending |
| Chrome | N/A | N/A | N/A | N/A | N/A | N/A |

All gate items marked `deferred` require a DB + keyed external APIs on the live Spark environment. The acceptance script exists and is wired to `ci:markets`; once run against a properly configured environment it asserts the three PRD Goals verbatim.

## Deviations from PRD

1. **Phase 3 SQL fragment implementation** — implemented as a post-query `filterByRelevance` helper in `PredictorGeneratorService` (vs. the plan's suggestion of splicing an `AND EXISTS (...)` clause into `getUnscoredArticles`). Equivalent semantics; simpler test surface.
2. **Phase 1 drive-by bug fix** — fixed pre-existing `recent-bars-ring-buffer.test.ts` failure to unblock the full unit-test gate. Detailed in `notes.md`.

## Next Steps

1. Run `pnpm --filter @divinr/api run test:markets:stages-v2` against the Spark-hosted Postgres with LLM keys to capture G1/G2/G3 results and populate `notes.md` Phase 5.4.
2. After live validation passes, run the commit-push flow and open a PR.
3. Downstream efforts may now import `WorkflowStage` from `apps/api/src/markets/workflow-stages/workflow-stage.ts` — the stable vocabulary is in place.
