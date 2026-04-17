# LLM Usage Logging — Product Requirements Document

## 1. Overview

Every LLM call in Divinr has a cost and a provenance, but today there's no unified structured log that captures both. Token counts and costs are tracked in-memory by the planes-level `RunMetadataService` and written to `public.llm_usage`, but that table lacks the dimensional context the markets layer needs: which triple, which stage, which article, who gets billed, base vs authored. This effort adds a markets-layer usage log (`prediction.llm_usage_log`) with rich dimensional columns, instruments every LLM call site to populate it, and builds aggregation views for fast downstream queries.

This is purely **capture and query** infrastructure. No pricing logic, no estimation, no billing. Downstream systems (`cost-modeling-system`, `stripe-integration`, `entity-level-performance-attribution`, `regression-testing-harness`) consume this log.

## 2. Goals & Success Criteria

| Goal | Measurable Criterion |
|------|---------------------|
| Every LLM call produces exactly one log row | After a full pipeline cycle, `COUNT(*)` in `llm_usage_log` matches the count of LLM calls observed in application logs |
| Rich dimensional context on every row | Every row has non-null `stage`, `model`, `provider`, `tokens_in`, `tokens_out`; contextual FKs (`analyst_id`, `instrument_id`, `article_id`) populated where applicable |
| Aggregation queries return in <1 second | `llm_usage_per_user_monthly` for any user over any month completes in <1s on the current dataset |
| A user's monthly compute cost is one query | `SELECT * FROM prediction.llm_usage_per_user_monthly WHERE billed_user_id = X AND year_month = Y` |
| A triple's lifetime cost is one query | `SELECT SUM(total_cost_cents) FROM prediction.llm_usage_per_triple_daily WHERE billed_user_id = X AND analyst_id = Y AND instrument_id = Z` |
| Base vs authored compute is one query | `SELECT * FROM prediction.llm_usage_base_vs_extension_daily WHERE date BETWEEN X AND Y` |
| Downstream systems don't re-instrument | API endpoints expose aggregated data; no raw table scans required by consumers |

## 3. User Stories / Use Cases

**UC-1: Admin cost visibility.** An admin opens the usage dashboard and sees last week's LLM spend sliced by stage × model, identifying that Stage 3b (risk debate) accounts for 60% of compute because it makes 3 calls per instrument.

**UC-2: Per-user billing prep.** `stripe-integration` queries a user's monthly usage via one aggregation endpoint to calculate cost-pass-through billing for a student account.

**UC-3: Authored content cost tracking.** An admin asks "How much compute did @golfergeek's authored analysts generate this month?" — answered by `llm_usage_per_analyst_authorship_monthly`.

**UC-4: Performance attribution.** `entity-level-performance-attribution` traces an outcome back to the specific LLM calls that produced the prediction, linking through `cycle_id` and `analyst_id`.

**UC-5: Model comparison.** An admin compares `gemma4:e4b` vs `gemma4:26b` cost and latency across stages to inform model selection decisions, using `llm_usage_per_model_daily`.

**UC-6: User cost awareness.** A user sees their monthly usage summary showing total calls, tokens, and estimated cost — giving transparency into their compute footprint.

## 4. Technical Requirements

### 4.1 Architecture

```
LLM Call Sites (Stage 1–5, Audit)
  ↓ pass dimensional context
MarketsLlmService.generateText()
  ↓ returns LlmTextResult + records usage
LlmUsageLogger.record()
  ↓ writes to
prediction.llm_usage_log
  ↓ refreshed nightly
Aggregation views (8 materialized views)
  ↓ queried by
API endpoints → Admin dashboard / Downstream systems
```

**`LlmUsageLogger`** is a new `@Injectable()` service in `apps/api/src/markets/services/`. It accepts a structured payload and writes one row to `prediction.llm_usage_log`. It is injected into `MarketsLlmService`, which calls it after every successful or failed LLM call.

**`MarketsLlmService.generateText()`** gains additional required parameters so callers must supply dimensional context (stage, sub_stage, analyst_id, instrument_id, article_id, author user IDs, billed_user_id). The existing `context` parameter (ExecutionContext) continues to provide provider/model/userId.

### 4.2 Data Model Changes

**New table: `prediction.llm_usage_log`**

| Column | Type | Notes |
|--------|------|-------|
| `id` | `text` | PK, default `gen_random_uuid()::text` |
| `timestamp` | `timestamptz` | NOT NULL, default `now()` |
| `article_id` | `text` | Nullable, FK to `prediction.market_articles` |
| `instrument_id` | `text` | Nullable, FK to `prediction.instruments` |
| `analyst_id` | `text` | Nullable, FK to `prediction.market_analysts` |
| `billed_user_id` | `text` | Nullable — who gets billed; NULL = Divinr pays (base content) |
| `analyst_author_user_id` | `text` | Nullable — NULL = base analyst |
| `instrument_author_user_id` | `text` | Nullable — NULL = base instrument |
| `stage` | `text` | NOT NULL — `article_processing`, `predictor_generation`, `risk_assessment`, `risk_debate`, `prediction_generation`, `learning`, `audit`, `context_provider`, `other` |
| `sub_stage` | `text` | Nullable — `red`, `blue`, `arbiter`, `reflection`, `arbitrator_synthesis`, `none` |
| `model` | `text` | NOT NULL — e.g. `gemma4:e4b`, `claude-sonnet-4-6` |
| `provider` | `text` | NOT NULL — `local-ollama`, `anthropic`, `openai`, `openrouter` |
| `via_byo_key` | `boolean` | NOT NULL, default `false` |
| `tokens_in` | `integer` | NOT NULL, default `0` |
| `tokens_out` | `integer` | NOT NULL, default `0` |
| `cost_cents` | `integer` | Nullable — computed from provider price × tokens at write time using `LlmPricingService`; NULL for local-ollama or BYO calls |
| `latency_ms` | `integer` | NOT NULL, default `0` |
| `prompt_hash` | `text` | Nullable — SHA-256 of the full merged prompt |
| `output_hash` | `text` | Nullable — SHA-256 of the output text |
| `cycle_id` | `text` | Nullable — `run_id` from `prediction.market_runs` when call is part of a pipeline run |
| `error` | `text` | Nullable — error message if the call failed |
| `metadata` | `jsonb` | Nullable — escape hatch for call-site-specific context |

**Indexes:**

| Index | Columns | Purpose |
|-------|---------|---------|
| `idx_llm_usage_billed_user_ts` | `(billed_user_id, timestamp)` | Per-user cost queries |
| `idx_llm_usage_analyst_author_ts` | `(analyst_author_user_id, timestamp)` | Authored analyst cost |
| `idx_llm_usage_instrument_author_ts` | `(instrument_author_user_id, timestamp)` | Authored instrument cost |
| `idx_llm_usage_instrument_ts` | `(instrument_id, timestamp)` | Per-instrument cost |
| `idx_llm_usage_analyst_ts` | `(analyst_id, timestamp)` | Per-analyst cost |
| `idx_llm_usage_stage_ts` | `(stage, timestamp)` | Per-stage cost |
| `idx_llm_usage_cycle` | `(cycle_id)` | Per-pipeline-run cost |

**8 Materialized Views** (refreshed nightly via a scheduled job):

1. `prediction.llm_usage_per_user_monthly` — `(billed_user_id, year_month)` → `total_calls, total_tokens_in, total_tokens_out, total_cost_cents`
2. `prediction.llm_usage_per_triple_daily` — `(billed_user_id, analyst_id, instrument_id, date)` → same
3. `prediction.llm_usage_per_stage_daily` — `(stage, sub_stage, date)` → same
4. `prediction.llm_usage_per_model_daily` — `(model, provider, date)` → same
5. `prediction.llm_usage_per_source_monthly` — `(source_id, year_month)` → same (joined through article_id → market_articles.source_id)
6. `prediction.llm_usage_per_analyst_authorship_monthly` — `(analyst_author_user_id, year_month)` → same
7. `prediction.llm_usage_per_instrument_authorship_monthly` — `(instrument_author_user_id, year_month)` → same
8. `prediction.llm_usage_base_vs_extension_daily` — `(date, is_base)` → same, where `is_base = (analyst_author_user_id IS NULL AND instrument_author_user_id IS NULL)`

**cost_cents computation:** At write time, `LlmUsageLogger` calls the existing `LlmPricingService.calculateCostSync(provider, model, tokens_in, tokens_out)` to compute cost. For `local-ollama` or `via_byo_key = true`, cost_cents is NULL (Divinr didn't pay). This is compute-on-write for fast reads; if pricing data changes, a backfill job can recompute.

**Retention:** Raw rows retained for 90 days (configurable via `LLM_USAGE_RETENTION_DAYS` env var, default 90). A nightly job deletes rows older than the retention window. Aggregation views are retained indefinitely.

### 4.3 API Changes

New endpoints on `MarketsController`, all admin-only:

| Method | Path | Query Params | Returns |
|--------|------|-------------|---------|
| `GET` | `/markets/usage/summary` | `?userId=&startDate=&endDate=&stage=&model=` | Aggregated usage summary |
| `GET` | `/markets/usage/by-user` | `?startDate=&endDate=` | Per-user monthly aggregates |
| `GET` | `/markets/usage/by-stage` | `?startDate=&endDate=` | Per-stage daily aggregates |
| `GET` | `/markets/usage/by-model` | `?startDate=&endDate=` | Per-model daily aggregates |
| `GET` | `/markets/usage/by-triple` | `?userId=&startDate=&endDate=` | Per-triple daily aggregates |
| `GET` | `/markets/usage/base-vs-extension` | `?startDate=&endDate=` | Base vs extension daily |
| `GET` | `/markets/usage/my-usage` | — | Current user's monthly summary (non-admin) |

**`/markets/usage/my-usage`** is the only non-admin endpoint — it returns the authenticated user's usage from `llm_usage_per_user_monthly` for the current month.

### 4.4 Frontend Changes

**New admin view: `UsageDashboardView.vue`**

- Route: `/usage` (admin-only, added to router)
- Sidebar nav: "LLM Usage" under the admin section
- Content:
  - Date range picker (default: current month)
  - Summary cards: total calls, total tokens, total cost
  - Tab segments: "By Stage", "By Model", "By User", "Base vs Extension"
  - Each tab shows a table of aggregated data from the corresponding API endpoint
  - Clickable rows drill into detail (e.g., clicking a stage shows daily breakdown)

**Per-user usage widget:**

- Added to the existing user settings or portfolio view
- Shows: "This month: N calls, X tokens, ~$Y.ZZ estimated cost"
- Calls `/markets/usage/my-usage`

### 4.5 Infrastructure Requirements

- **Migration:** SQL migration for `llm_usage_log` table, indexes, and 8 materialized views
- **Schema service:** `MarketsSchemaService.ensureSchema()` extended with re-entrant DDL
- **New services:** `LlmUsageLogger` (writer), `LlmUsageQueryService` (reader/aggregation)
- **Nightly job:** Materialized view refresh + retention cleanup, added to existing nightly cron
- **No new external dependencies**

### 4.6 Instrumentation Changes

Each LLM call site must pass dimensional context to `MarketsLlmService.generateText()`. The new signature adds a `usageContext` parameter:

```typescript
interface LlmUsageContext {
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

**Call sites to instrument:**

| Call Site | Service | Stage | Sub-stage | Key Context |
|-----------|---------|-------|-----------|-------------|
| Article relevance | `ArticleRelevanceService.llmClassify()` | `article_processing` | — | article_id, instrument_id |
| Predictor scoring | `PredictorGeneratorService.scoreArticleForInstrument()` | `predictor_generation` | — | article_id, instrument_id, analyst_id, author IDs |
| Risk dimension | `RiskDimensionAnalyzerService.analyzeDimension()` | `risk_assessment` | `reflection` | instrument_id, analyst_id, cycle_id |
| Risk debate blue | `RiskDebateService.runDebate()` | `risk_debate` | `blue` | instrument_id, cycle_id |
| Risk debate red | `RiskDebateService.runDebate()` | `risk_debate` | `red` | instrument_id, cycle_id |
| Risk debate arbiter | `RiskDebateService.runDebate()` | `risk_debate` | `arbiter` | instrument_id, cycle_id |
| Prediction per-analyst | `PredictionRunnerService.runSingleAnalyst()` | `prediction_generation` | — | instrument_id, analyst_id, author IDs, cycle_id |
| Prediction arbitrator | `PredictionRunnerService` (arbitrator synthesis) | `prediction_generation` | `arbitrator_synthesis` | instrument_id, cycle_id |
| Canonical test replay | `CanonicalTestRunnerService.replayCanonicalDay()` | `learning` | — | analyst_id |
| Strategic overhaul | `StrategicOverhaulService.generateProposal()` | `audit` | — | analyst_id |
| Context providers | `ContextProviderService.executeContextProviders()` | `context_provider` | — | instrument_id |

**Mandatory logging:** Every `MarketsLlmService.generateText()` call MUST produce a log row. The logger writes on both success and failure (failed calls record the error field). No silent calls.

**Dedup policy:** Every call logs a separate row, even if prompt and output are identical. This ensures accurate usage counting.

## 5. Non-Functional Requirements

- **Performance:** Logging adds <5ms overhead per LLM call (single INSERT, no blocking). Materialized views ensure aggregation queries stay <1s.
- **Scalability:** At current scale (~50 LLM calls per 5-minute cycle), the table grows ~14,400 rows/day. With 90-day retention, max ~1.3M rows — well within Postgres performance on the Spark's hardware.
- **Security:** Admin-only endpoints gated by `requireAdmin()`. Per-user endpoint (`/my-usage`) scoped to authenticated user. No raw prompt/output text stored in the usage log (only hashes).
- **Compatibility:** Existing `public.llm_usage` table (planes-level) remains untouched. The new `prediction.llm_usage_log` is a markets-layer complement with richer dimensional context.
- **Observability:** Failed LLM calls are logged with the `error` field populated, enabling monitoring of failure rates by stage/model.

## 6. Out of Scope

- **Pricing logic / calibration** — lives in `cost-modeling-system`; this effort uses existing `LlmPricingService` for write-time cost computation
- **Billing-facing user presentation** — lives in `stripe-integration`
- **P&L attribution across outcomes** — lives in `entity-level-performance-attribution`
- **Regression test replays** — lives in `regression-testing-harness`
- **BYO credential routing implementation** — the `via_byo_key` column captures intent but actual routing is a separate effort; for now it defaults to `false` on all calls
- **Real-time streaming usage** — nightly materialized view refresh is sufficient for v1

## 7. Dependencies & Risks

| Dependency | Status | Risk |
|-----------|--------|------|
| `triple-model-reasoning-continuity` | Shipped | None — `author_user_id` columns exist on all reasoning tables |
| `workflow-stages-article-pipeline` | Shipped | None — stage names are stable |
| `LlmPricingService` (planes package) | Live | Pricing data must be populated in `public.llm_models` for cost computation; local-ollama pricing is NULL by design |
| `MarketsLlmService` | Live | All LLM calls route through this; signature change affects all callers |

**Technical Risks:**

1. **Signature change breaks all callers.** Adding `usageContext` to `generateText()` requires updating 11+ call sites. **Mitigation:** Make `usageContext` a required parameter with a typed interface; the compiler catches every missed call site. Phase 1 changes the signature; Phase 2 instruments all callers.

2. **Token counts may not be available from all providers.** Local Ollama may not always return token usage. **Mitigation:** Default `tokens_in` and `tokens_out` to 0; estimate from prompt length when provider doesn't report tokens.

3. **Cost computation depends on pricing data.** If `public.llm_models` has no pricing for a model, `cost_cents` will be NULL. **Mitigation:** Acceptable — NULL means "cost unknown" which is the correct semantics. `cost-modeling-system` will populate pricing data.

4. **Materialized view refresh takes time on large tables.** At 1.3M rows, a full refresh could take seconds. **Mitigation:** `REFRESH MATERIALIZED VIEW CONCURRENTLY` avoids locking; refresh runs during nightly maintenance window.

## 8. Phasing

### Phase 1: Data Layer & Logger Service

**Deliverables:**
- SQL migration for `prediction.llm_usage_log` table with all indexes
- Schema service DDL (re-entrant)
- `LlmUsageLogger` service with `record()` method
- `LlmUsageContext` interface
- Update `MarketsLlmService.generateText()` signature to accept `usageContext`
- Wire logger into `MarketsLlmService` to record after every call (success and failure)
- Unit tests for logger service

**Validation gate:** `MarketsLlmService.generateText()` produces one `llm_usage_log` row per call. Existing tests still pass (callers updated with minimal placeholder context).

### Phase 2: Instrument All Call Sites

**Deliverables:**
- Update all 11 call sites to pass correct `LlmUsageContext`:
  - ArticleRelevanceService, PredictorGeneratorService, RiskDimensionAnalyzerService, RiskDebateService (3 calls), PredictionRunnerService (analyst + arbitrator), CanonicalTestRunnerService, StrategicOverhaulService, ContextProviderService
- Each call site passes the correct stage, sub_stage, and contextual IDs (analyst_id, instrument_id, article_id, author user IDs, cycle_id)
- Verify: after a full pipeline run, every LLM call has a corresponding row with correct dimensional context

**Validation gate:** Run a prediction pipeline cycle. Count LLM calls in logs vs rows in `llm_usage_log` — they match. Spot-check dimensional context on rows from each stage.

### Phase 3: Aggregation Views & Query Service

**Deliverables:**
- 8 materialized views created in migration/schema DDL
- `LlmUsageQueryService` with methods to query each aggregation view
- Nightly refresh job (added to existing nightly cron in `NightlyEvaluationService`)
- Retention cleanup job (delete rows older than `LLM_USAGE_RETENTION_DAYS`)
- API endpoints (7 total: 6 admin + 1 user-facing)
- Unit tests for query service

**Validation gate:** After nightly job runs, all 8 views are populated. API endpoints return correct aggregated data. Retention cleanup removes old rows.

### Phase 4: Frontend Dashboard

**Deliverables:**
- `UsageDashboardView.vue` with date range picker, summary cards, and tabbed aggregation tables
- Route `/usage` added to router (admin-only)
- Sidebar nav entry "LLM Usage" in admin section
- Per-user usage widget on portfolio or settings view
- Store/composable for usage API calls

**Validation gate:** Admin sees usage dashboard with real data from pipeline runs. Non-admin user sees their monthly usage summary.
