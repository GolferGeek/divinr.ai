# LLM Usage Logging — Completion Report

**Plan**: [plan.md](./plan.md)
**PRD**: [prd.md](./prd.md)
**Completed**: 2026-04-17
**Final Status**: All Phases Complete

## Summary
- Total phases: 4
- Phases completed: 4
- Phases remaining: 0

## Phase Results

### Phase 1: Data Layer & Logger Service — Complete
- Created `prediction.llm_usage_log` table (18 columns, 7 indexes) via `MarketsSchemaService.llmUsageLogDdl()`
- Created `LlmUsageLogger` service with cost computation from `public.llm_models`
- Defined `LlmUsageContext` interface
- Updated `MarketsLlmService.generateText()` with optional `usageContext` parameter (6th param)
- Wired logger to record after every successful or failed LLM call
- 17 unit tests for logger service
- **Decision**: Implemented cost computation directly in logger (querying `public.llm_models`) rather than importing `LLMPricingService` from planes package, because `fine-control/` is excluded from the planes build.

### Phase 2: Instrument All Call Sites — Complete
- Instrumented all 18 `generateText()` callers with correct dimensional context
- 11 PRD-specified call sites + 2 in RiskRunnerService + 5 in MarketsService
- Each call passes stage, sub_stage, and relevant IDs (analyst, instrument, article, cycle, author user IDs)
- No callers remain without `usageContext`

### Phase 3: Aggregation Views & Query Service — Complete
- 8 materialized views created in `MarketsSchemaService.llmUsageViewsDdl()`
- `LlmUsageQueryService` with 7 query methods + refreshViews + cleanupRetention
- Nightly refresh + 90-day retention cleanup wired into `NightlyEvaluationService`
- 7 API endpoints on `MarketsController` (6 admin + 1 user-facing)
- 20 unit tests for query service

### Phase 4: Frontend Dashboard — Complete
- `UsageDashboardView.vue` with date range picker, summary cards, and 4-tab data tables
- Route `/usage` added to router
- Sidebar nav "LLM Usage" under System (admin-only) section
- `UserUsageWidget.vue` showing per-user monthly usage on DashboardView
- `usage.store.ts` Pinia store with actions for all 7 API endpoints

## Gate Results
- **Lint**: All passes (API + web)
- **Build**: All passes (API tsc + web vite)
- **TypeCheck**: No new errors from this effort
- **Unit Tests**: 37 new tests (17 logger + 20 query), all existing tests pass
- **Smoke Tests**: Pre-existing deadlock on schema creation (unrelated to this effort)
- **Chrome Tests**: Deferred to user verification in running environment

## Deviations from PRD
1. **LlmPricingService import**: PRD assumed `LlmPricingService` could be imported from planes package. The `fine-control/` directory is excluded from the planes build. Instead, cost computation queries `public.llm_models` directly in `LlmUsageLogger`.
2. **usageContext optional**: Made the `usageContext` parameter optional (6th param) rather than required (as PRD suggested), to avoid breaking all callers in a single step. All callers now supply it.
3. **REFRESH MATERIALIZED VIEW**: Using non-concurrent refresh since materialized views are created with `WITH NO DATA` and concurrent refresh requires a unique index. First refresh populates the data.

## Next Steps
- Run `/pr-eval` to review the PR before merging
- After merging, trigger a pipeline run and verify `prediction.llm_usage_log` rows appear with correct dimensional context
- Verify the admin dashboard at `/usage` renders correctly with real data
- Chrome tests should be run manually in the browser
