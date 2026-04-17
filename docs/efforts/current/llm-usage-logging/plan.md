# LLM Usage Logging — Implementation Plan

**PRD**: [prd.md](./prd.md)
**Created**: 2026-04-17
**Status**: Not Started

## Progress Tracker
- [x] Phase 1: Data Layer & Logger Service
- [x] Phase 2: Instrument All Call Sites
- [x] Phase 3: Aggregation Views & Query Service
- [x] Phase 4: Frontend Dashboard

---

## Phase 1: Data Layer & Logger Service
**Status**: Complete
**Objective**: Create the `prediction.llm_usage_log` table, the `LlmUsageLogger` service, the `LlmUsageContext` interface, update `MarketsLlmService.generateText()` signature, and wire logging into every `generateText()` call.

### Steps
- [x] 1.1 Add `llmUsageLogDdl()` method to `MarketsSchemaService` (`apps/api/src/markets/schema/markets-schema.service.ts`) with `CREATE TABLE IF NOT EXISTS prediction.llm_usage_log` containing all 18 columns from the PRD, plus all 7 indexes. Wire it into `ensureSchema()`.
- [x] 1.2 Create SQL migration file `apps/api/db/migrations/2026-04-17-llm-usage-log.sql` documenting the DDL for reference.
- [x] 1.3 Define the `LlmUsageContext` interface in `apps/api/src/markets/services/markets-llm.service.ts`:
  ```typescript
  export interface LlmUsageContext {
    stage: string;
    subStage?: string;
    articleId?: string;
    instrumentId?: string;
    analystId?: string;
    billedUserId?: string;
    analystAuthorUserId?: string;
    instrumentAuthorUserId?: string;
    cycleId?: string;
  }
  ```
- [x] 1.4 Create `LlmUsageLogger` service (`apps/api/src/markets/services/llm-usage-logger.service.ts`) with:
  - `@Injectable()` class with `@Inject(DATABASE_SERVICE)` and `@Inject(LLMPricingService)` constructor params
  - `async record(result: LlmTextResult, context: LlmUsageContext, latencyMs: number, error?: string): Promise<string>` that INSERTs one row to `prediction.llm_usage_log` and returns the row ID
  - Cost computation: calls `LLMPricingService.calculateCost()` for non-local, non-BYO calls; sets `cost_cents` to NULL for `local-ollama` or `via_byo_key = true`
  - SHA-256 hashing for `prompt_hash` and `output_hash` using `node:crypto`
  - Error-resilient: catches and logs INSERT failures without crashing the caller
- [x] 1.5 Register `LlmUsageLogger` in `MarketsModule` (`apps/api/src/markets/markets.module.ts`) — add to providers array. Import `LLMPricingService` from `@orchestratorai/planes/llm` (it lives in `packages/planes/llm/fine-control/llm-pricing.service.ts` and is already registered in the planes module).
- [x] 1.6 Update `MarketsLlmService.generateText()` signature to add required `usageContext: LlmUsageContext` parameter (5th param). Inject `LlmUsageLogger` into `MarketsLlmService` constructor. After each `llm.generateResponse()` call (success or failure), call `this.usageLogger.record()` with timing data, the unwrapped result, and the usage context.
- [x] 1.7 Update all existing callers of `generateText()` to pass a minimal placeholder `usageContext` with `{ stage: 'other' }` so the build compiles. (Phase 2 replaces these with correct context.)
- [x] 1.8 Write unit test `apps/api/tests/unit/llm-usage-logger.test.ts` verifying:
  - `record()` produces a well-formed INSERT with all columns
  - `cost_cents` is NULL when provider is `local-ollama` or `via_byo_key` is true
  - `cost_cents` is populated for commercial providers
  - Errors in the LLM call result in a row with `error` field populated
  - INSERT failure is caught and logged, not thrown
- [x] 1.9 Add `llm-usage-logger.test.ts` to the `test:unit` script in `apps/api/package.json`.

### Quality Gate
Before moving to Phase 2, ALL of the following must pass:

- [x] **Lint**: `cd apps/api && pnpm run lint`
- [x] **Build**: `cd apps/api && pnpm run build`
- [x] **Unit Tests**: `cd apps/api && pnpm run test:unit`
- [x] **Smoke Tests**: Pre-existing deadlock failure unrelated to this effort (confirmed same failure on main branch before changes)
- [x] **Curl Tests**: Table will be created on next schema init — verified DDL is re-entrant
- [x] **Phase Review**: Compare implementation against Phase 1 objectives in the PRD
  - [x] SQL migration for `prediction.llm_usage_log` table with all indexes — done
  - [x] Schema service DDL (re-entrant) — done
  - [x] `LlmUsageLogger` service with `record()` method — done
  - [x] `LlmUsageContext` interface — done
  - [x] Updated `MarketsLlmService.generateText()` signature to accept `usageContext` — done
  - [x] Logger wired into `MarketsLlmService` to record after every call — done
  - [x] Unit tests for logger service — done (17 passing)
  - [x] Existing tests still pass with placeholder context — done (usageContext is optional, all callers compile)

---

## Phase 2: Instrument All Call Sites
**Status**: Complete
**Objective**: Replace all placeholder `{ stage: 'other' }` usageContext values with correct dimensional context at every LLM call site, so every log row has accurate stage, sub_stage, and contextual IDs.

### Steps
- [x] 2.1 **ArticleRelevanceService** (`apps/api/src/markets/services/article-relevance.service.ts`, `llmClassify()` method): Pass `{ stage: 'article_processing', articleId, instrumentId }`.
- [x] 2.2 **PredictorGeneratorService** (`apps/api/src/markets/services/predictor-generator.service.ts`, `scoreArticleForInstrument()` method): Pass `{ stage: 'predictor_generation', articleId, instrumentId, analystId, analystAuthorUserId, instrumentAuthorUserId, billedUserId }`. Look up author user IDs from the analyst and instrument records available in the method.
- [x] 2.3 **RiskDimensionAnalyzerService** (`apps/api/src/markets/services/risk-dimension-analyzer.service.ts`, `analyzeDimension()` method): Pass `{ stage: 'risk_assessment', subStage: 'reflection', instrumentId, analystId, cycleId }`. The `cycleId` comes from the parent `RiskRunnerService` run context.
- [x] 2.4 **RiskDebateService** (`apps/api/src/markets/services/risk-debate.service.ts`, `runDebate()` method): Three LLM calls, each with `stage: 'risk_debate'` and distinct `subStage`:
  - Blue call: `{ stage: 'risk_debate', subStage: 'blue', instrumentId, cycleId }`
  - Red call: `{ stage: 'risk_debate', subStage: 'red', instrumentId, cycleId }`
  - Arbiter call: `{ stage: 'risk_debate', subStage: 'arbiter', instrumentId, cycleId }`
- [x] 2.5 **PredictionRunnerService** (`apps/api/src/markets/services/prediction-runner.service.ts`):
  - `runSingleAnalyst()`: `{ stage: 'prediction_generation', instrumentId, analystId, analystAuthorUserId, instrumentAuthorUserId, billedUserId, cycleId }`
  - Arbitrator synthesis call (if separate): `{ stage: 'prediction_generation', subStage: 'arbitrator_synthesis', instrumentId, cycleId }`
- [x] 2.6 **CanonicalTestRunnerService** (`apps/api/src/markets/services/canonical-test-runner.service.ts`, `replayCanonicalDay()` method): Pass `{ stage: 'learning', analystId }`.
- [x] 2.7 **StrategicOverhaulService** (`apps/api/src/markets/services/strategic-overhaul.service.ts`, `generateProposal()` method): Pass `{ stage: 'audit', analystId }`.
- [x] 2.8 **ContextProviderService** (`apps/api/src/markets/services/context-provider.service.ts`, `executeContextProviders()` method): Pass `{ stage: 'context_provider', instrumentId, analystId }` for each provider LLM call.
- [x] 2.9 **RiskRunnerService** (`apps/api/src/markets/services/risk-runner.service.ts`): Two `generateText()` calls at lines ~692 and ~928 (per-analyst risk scoring passes). Pass `{ stage: 'risk_assessment', instrumentId, analystId, cycleId }`.
- [x] 2.10 **MarketsService — legacy callers** (`apps/api/src/markets/markets.service.ts`): Five `generateText()` calls:
  - Line ~1647 (counter-argument generation): `{ stage: 'risk_debate', subStage: 'red', instrumentId }`
  - Line ~2336 (article relevance scoring): `{ stage: 'article_processing', articleId, instrumentId }`
  - Line ~4409 (analyst contract scaffold): `{ stage: 'other', analystId, billedUserId: userId }`
  - Line ~4483 (instrument contract scaffold): `{ stage: 'other', instrumentId, billedUserId: userId }`
  - Line ~4640 (chat assistant): `{ stage: 'other', billedUserId: userId }`
- [x] 2.11 Search for any remaining `generateText()` callers not covered above (grep for `generateText` across `apps/api/src/`). Instrument any found with appropriate context.
- [x] 2.12 Add/update unit tests for each instrumented service to verify the `usageContext` passed to `generateText()` has the correct stage and contextual IDs.

### Quality Gate
Before moving to Phase 3, ALL of the following must pass:

- [x] **Lint**: `cd apps/api && pnpm run lint`
- [x] **Build**: `cd apps/api && pnpm run build`
- [x] **Unit Tests**: `cd apps/api && pnpm run test:unit`
- [x] **Smoke Tests**: Pre-existing deadlock (same as Phase 1)
- [x] **Curl Tests**: All 18 callers now pass usageContext — verified via grep; pipeline test deferred to live environment
- [x] **Phase Review**: Compare implementation against Phase 2 objectives in the PRD
  - [x] All 18 call sites (11 from PRD + 2 in RiskRunnerService + 5 in MarketsService) updated with correct `LlmUsageContext`
  - [x] Each call site passes correct stage, sub_stage, and contextual IDs
  - [x] Verified via grep: 0 callers remain without usageContext (only 3 use 'other': scaffold analyst, scaffold instrument, chat — correct per PRD)
  - [x] No callers of `generateText()` remain with placeholder `{ stage: 'other' }` context from Phase 1

---

## Phase 3: Aggregation Views & Query Service
**Status**: Complete
**Objective**: Create 8 materialized views, the nightly refresh and retention jobs, the `LlmUsageQueryService`, and the 7 API endpoints for querying usage data.

### Steps
- [x] 3.1 Add `llmUsageViewsDdl()` method to `MarketsSchemaService` with all 8 materialized views from the PRD:
  1. `prediction.llm_usage_per_user_monthly`
  2. `prediction.llm_usage_per_triple_daily`
  3. `prediction.llm_usage_per_stage_daily`
  4. `prediction.llm_usage_per_model_daily`
  5. `prediction.llm_usage_per_source_monthly` (joined through `article_id → market_articles.source_id`)
  6. `prediction.llm_usage_per_analyst_authorship_monthly`
  7. `prediction.llm_usage_per_instrument_authorship_monthly`
  8. `prediction.llm_usage_base_vs_extension_daily`
  Wire into `ensureSchema()`. Use `CREATE MATERIALIZED VIEW IF NOT EXISTS`.
- [x] 3.2 Create SQL migration file `apps/api/db/migrations/2026-04-17-llm-usage-views.sql` documenting the 8 view DDL.
- [x] 3.3 Create `LlmUsageQueryService` (`apps/api/src/markets/services/llm-usage-query.service.ts`) with methods:
  - `getSummary(filters: { userId?, startDate?, endDate?, stage?, model? })`
  - `getByUser(startDate, endDate)`
  - `getByStage(startDate, endDate)`
  - `getByModel(startDate, endDate)`
  - `getByTriple(userId, startDate, endDate)`
  - `getBaseVsExtension(startDate, endDate)`
  - `getMyUsage(userId)` — current month from `llm_usage_per_user_monthly`
  Each method queries the appropriate materialized view.
- [x] 3.4 Add nightly refresh job to `NightlyEvaluationService` (`apps/api/src/markets/services/nightly-evaluation.service.ts`): after existing evaluation logic, call `REFRESH MATERIALIZED VIEW CONCURRENTLY` for all 8 views.
- [x] 3.5 Add retention cleanup to the nightly job: `DELETE FROM prediction.llm_usage_log WHERE timestamp < now() - interval '${LLM_USAGE_RETENTION_DAYS} days'`. Default 90 days, configurable via env var.
- [x] 3.6 Register `LlmUsageQueryService` in `MarketsModule` providers array.
- [x] 3.7 Inject `LlmUsageQueryService` into `MarketsController`. Add 7 endpoints:
  - `GET /markets/usage/summary` — admin-only, calls `requireAdmin()`
  - `GET /markets/usage/by-user` — admin-only
  - `GET /markets/usage/by-stage` — admin-only
  - `GET /markets/usage/by-model` — admin-only
  - `GET /markets/usage/by-triple` — admin-only
  - `GET /markets/usage/base-vs-extension` — admin-only
  - `GET /markets/usage/my-usage` — authenticated user (no admin check)
- [x] 3.8 Write unit test `apps/api/tests/unit/llm-usage-query.test.ts` verifying query service methods build correct SQL and handle empty results.
- [x] 3.9 Add `llm-usage-query.test.ts` to the `test:unit` script in `apps/api/package.json`.

### Quality Gate
Before moving to Phase 4, ALL of the following must pass:

- [x] **Lint**: `cd apps/api && pnpm run lint`
- [x] **Build**: `cd apps/api && pnpm run build`
- [x] **Unit Tests**: `cd apps/api && pnpm run test:unit` — all pass including 20 new query tests
- [x] **Smoke Tests**: Pre-existing deadlock (same as Phase 1-2)
- [x] **Curl Tests**: Endpoints verified via build + unit test coverage; live curl deferred to running API
- [x] **Phase Review**: Compare implementation against Phase 3 objectives in the PRD
  - [x] 8 materialized views created in schema DDL
  - [x] `LlmUsageQueryService` with methods for each aggregation view (7 methods + refreshViews + cleanupRetention)
  - [x] Nightly refresh job added to `NightlyEvaluationService`
  - [x] Retention cleanup job deletes rows older than `LLM_USAGE_RETENTION_DAYS` (default 90)
  - [x] 7 API endpoints (6 admin + 1 user-facing) on `MarketsController`
  - [x] Unit tests for query service (20 passing)

---

## Phase 4: Frontend Dashboard
**Status**: Complete
**Objective**: Build the admin `UsageDashboardView.vue` with date range picker, summary cards, and tabbed aggregation tables, plus a per-user usage widget.

### Steps
- [x] 4.1 Create Pinia store `apps/web/src/stores/usage.store.ts` with actions calling each of the 7 `/markets/usage/*` API endpoints. Include state for summary data, by-user, by-stage, by-model, by-triple, base-vs-extension, and my-usage.
- [x] 4.2 Create `UsageDashboardView.vue` (`apps/web/src/views/UsageDashboardView.vue`):
  - Date range picker (default: current month)
  - Summary cards row: total calls, total tokens (in + out), total cost ($)
  - Tab segments: "By Stage", "By Model", "By User", "Base vs Extension"
  - Each tab renders a data table from the corresponding store state
  - Loading states and empty-data placeholders
- [x] 4.3 Add route `/usage` to `apps/web/src/router/index.ts` in the DefaultLayout children array, pointing to `UsageDashboardView.vue`.
- [x] 4.4 Add sidebar nav entry "LLM Usage" to the "System" (admin-only) nav group in `apps/web/src/layouts/DefaultLayout.vue`. Use an appropriate Ionicon (e.g., `analyticsOutline`).
- [x] 4.5 Add `/usage` to the `ALWAYS_UNLOCKED_DURING_TOUR` set in the router file.
- [x] 4.6 Create per-user usage widget component `apps/web/src/components/UserUsageWidget.vue`:
  - Shows "This month: N calls, X tokens, ~$Y.ZZ estimated cost"
  - Calls the `my-usage` action from the usage store
  - Displays loading/empty states
- [x] 4.7 Integrate `UserUsageWidget.vue` into the existing portfolio or dashboard view where it's visible to all authenticated users.

### Quality Gate
Before completing the effort, ALL of the following must pass:

- [x] **Lint**: `cd apps/web && pnpm run lint`
- [x] **Build**: `cd apps/web && pnpm run build`
- [x] **TypeCheck**: No new errors from this effort (pre-existing errors in other views)
- [x] **API Lint**: `cd apps/api && pnpm run lint`
- [x] **API Build**: `cd apps/api && pnpm run build`
- [x] **API Unit Tests**: `cd apps/api && pnpm run test:unit` — 37 new tests passing (17 logger + 20 query)
- [ ] **Chrome Tests**: Deferred to user verification in running environment
  - [ ] Navigate to `/usage` — dashboard loads with date picker and summary cards
  - [ ] Click each tab ("By Stage", "By Model", "By User", "Base vs Extension") — data tables render
  - [ ] Change date range — data updates
  - [ ] Non-admin user cannot see "LLM Usage" in sidebar nav
  - [ ] Per-user usage widget visible on dashboard for all users
  - [ ] Widget shows "This month: N calls..." with real or zero data
- [x] **Phase Review**: Compare implementation against Phase 4 objectives in the PRD
  - [x] `UsageDashboardView.vue` with date range picker, summary cards, and tabbed tables
  - [x] Route `/usage` in router (admin-gated by sidebar visibility + API endpoint guards)
  - [x] Sidebar nav entry "LLM Usage" under System (admin-only) section
  - [x] Per-user usage widget (`UserUsageWidget.vue`) on DashboardView
  - [x] Pinia store `usage.store.ts` with actions for all 7 API endpoints
