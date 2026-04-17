# Cost Modeling System — Product Requirements Document

## 1. Overview

`llm-usage-logging` (shipped 2026-04-17) captures every LLM call to `prediction.llm_usage_log` with full dimensional context (stage, sub_stage, analyst_id, instrument_id, billed_user_id, author user IDs, tokens, cost_cents) and exposes 8 aggregation materialized views via `LlmUsageQueryService`. That data is the raw substrate; nothing today turns it into pricing decisions.

This effort builds the **analytical layer** on top: weekly per-model cost calibration from real samples, per-user configuration-to-cost prediction, an admin pricing defensibility view, the `user_cost_cents_this_month()` query that `stripe-integration` will call for student cost-pass-through billing, an admin experimentation mode for comparing models on identical inputs, and the cost dashboards that expose all of it. No new instrumentation — pure consumer of `llm_usage_log`.

## 2. Goals & Success Criteria

| Goal | Measurable Criterion |
|------|---------------------|
| Per-model cost calibrated weekly from real samples, with sample-count gating to bound variance | `prediction.model_pricing_calibration` rows refreshed on the weekly calibration cron; each `(model, provider)` row shows `samples_count` (>= `COST_CALIBRATION_MIN_SAMPLES`, default 50), `rolling_avg_cost_cents_per_call`, `last_calibrated_at`. Models with insufficient samples are skipped (previous calibration retained) and surfaced in the admin view as "Insufficient samples" |
| Pricing-drift detection flags providers when their billing changes | When a model's rolling average shifts by more than `COST_CALIBRATION_DRIFT_THRESHOLD` (default 20%) week-over-week AND `samples_count` >= 200, a row is written to `prediction.model_pricing_drift_alerts` and surfaced in the admin calibration view |
| User monthly cost is predictable in one API call | `POST /billing/predict-cost { userId, configurationOverride? }` returns `{ predictedMonthlyCents, confidenceRange, breakdownByStage }` in <2s |
| Prediction accuracy reaches ±25% after sufficient history | For users with ≥28 days of usage history, the running absolute error between prediction and actual end-of-month cost stays within ±25% on at least 70% of users |
| Cold-start users get a defensible default | Users with <14 days of history receive a prediction seeded from the 75th-percentile cost of users with similar enabled-triple counts, returned with `confidence: "low"` and a wider range |
| Student cost-pass-through query works in one call | `GET /billing/student-accrual?userId=X&yearMonth=Y` returns `{ rawCostCents, withFloorCents, breakdown }` from `llm_usage_per_user_monthly` with `STUDENT_FLOOR_USD` applied |
| Pricing defensibility answers "are we profitable" at a glance | Admin view shows per-authored-item-kind: avg monthly cost, current monthly fee, margin %, count under-priced / over-priced |
| Per-user billing breakdown answers "why does my bill look like this" | User-facing `/billing/summary` view shows the authenticated user's current and prior month broken down by stage, by triple (analyst × instrument), and by model — sourced from existing aggregation views in `llm-usage-logging` |
| Experimentation mode lets admin compare cost-vs-quality across the active model roster | Admin can trigger an experiment selecting ≥2 models from the active roster against a single input; results land in `prediction.cost_experiments` + `prediction.cost_experiment_runs` with per-model `cost_cents`, `latency_ms`, `output_text` (full output kept for human review), and `output_hash` |
| Admin and user dashboards render aggregated economics | New admin views (`/admin/cost/calibration`, `/admin/cost/defensibility`, `/admin/cost/experiments`) and user-facing `/billing/summary` + dashboard widgets render real data |

## 3. User Stories / Use Cases

**UC-1: Weekly calibration tells admin what models actually cost.** Admin opens `/admin/cost/calibration` and sees: `gemma4:e4b` averages $0 (local), `claude-sonnet-4-6` averages $0.84/call across 3,200 samples last week, `gpt-4o-mini` averaged $0.012/call. A drift alert flags that `claude-sonnet-4-6`'s average shifted +28% week-over-week — Anthropic may have changed pricing.

**UC-2: User wants to know what they'll pay before adding an analyst.** A user about to enable a 4th custom analyst hits `POST /billing/predict-cost` with a `configurationOverride` adding the new analyst. Response: `{ predictedMonthlyCents: 1240, confidenceRange: [930, 1550], breakdownByStage: {...} }`. UI surfaces "~$12.40/month, range $9.30–$15.50".

**UC-3: Admin checks if authored-instrument pricing is defensible.** Admin opens `/admin/cost/defensibility` and sees `custom_instrument` items: avg $14.10 monthly compute, current $20 fee, margin 30%. Flagged: `analyst_contract_override` averages $76 cost vs $0 fee — losing money. Admin updates `CONTRACT_OVERRIDE_USD` env var (manual change, not auto-applied).

**UC-4: Student sees real-time accrual.** Student logs in, dashboard widget shows: "This month so far: $7.42 across 3 instruments and 2 analysts (3 days into billing period)". Updates on every page load from `/billing/student-accrual`.

**UC-5: Stripe integration pulls a billable amount.** When `stripe-integration` ships, it calls `getUserCostCentsThisMonth(userId)` once per billing-cycle close — which queries `llm_usage_per_user_monthly` and applies `STUDENT_FLOOR_USD`.

**UC-6: Admin compares models on the same input.** Admin selects an article + instrument, picks `[gemma4:e4b, gemma4:26b, claude-haiku, gpt-4o-mini]`, triggers an experiment. System runs each in serial (Ollama serial constraint), records `cost_cents` and `output_hash` for each. Admin reads the comparison table and decides whether to upgrade Stage 3b Arbiter calls.

## 4. Technical Requirements

### 4.1 Architecture

```
prediction.llm_usage_log  (written by llm-usage-logging)
   │
   ├── LlmUsageQueryService (read materialized views)
   │
   ├── CostCalibrationService    ──► prediction.model_pricing_calibration
   │     (weekly cron)            ──► prediction.model_pricing_drift_alerts
   │
   ├── CostPredictionService     ◄── reads enabled triples + calibration
   │                              ──► returns predicted cents + breakdown
   │
   ├── PricingDefensibilityService ◄── joins authored_items × usage
   │                                ──► returns margin per item kind
   │
   ├── StudentBillingService     ◄── reads llm_usage_per_user_monthly
   │                              ──► applies STUDENT_FLOOR_USD
   │
   └── CostExperimentationService ──► prediction.cost_experiments (header)
         (admin-triggered, async) ──► prediction.cost_experiment_runs (per-model results)
                                  ──► prediction.llm_usage_log (each call also lands here for canonical accounting)
```

All five services are new `@Injectable()` classes in `apps/api/src/markets/services/`, registered in `MarketsModule`. Following the project DI convention (CLAUDE.md), every constructor parameter uses explicit `@Inject(ClassName)`.

Cron-driven work uses NestJS `@Cron` like `NightlyEvaluationService` does; weekly calibration runs at a Monday 03:00 maintenance window. Manual on-demand recalibration is exposed via an admin endpoint.

**Pricing data access**: Per the `llm-usage-logging` completion report, `LLMPricingService` lives under `packages/planes/llm/fine-control/` which is excluded from the planes build, so it cannot be imported. Cost-modeling services follow the established pattern from `LlmUsageLogger` and query `public.llm_models` directly via the database connection (with the same in-process cache).

**Async experiment execution**: Comparing N commercial models can take minutes. Experiment creation returns immediately with a `pending` status; execution runs in a background worker (in-process; no new queue infrastructure). The frontend polls `GET /admin/cost/experiments/:id` until status reaches `complete` or `failed`.

### 4.2 Data Model Changes

**New table: `prediction.model_pricing_calibration`**

| Column | Type | Notes |
|--------|------|-------|
| `model` | `text` | NOT NULL, part of PK |
| `provider` | `text` | NOT NULL, part of PK |
| `last_calibrated_at` | `timestamptz` | NOT NULL |
| `samples_count` | `integer` | NOT NULL — number of `llm_usage_log` rows used |
| `window_start` | `timestamptz` | NOT NULL — start of calibration window |
| `window_end` | `timestamptz` | NOT NULL — end of calibration window |
| `rolling_avg_cost_cents_per_call` | `numeric(10,4)` | NULL for local/BYO models (cost_cents NULL upstream) |
| `rolling_avg_tokens_in` | `numeric(12,2)` | NOT NULL |
| `rolling_avg_tokens_out` | `numeric(12,2)` | NOT NULL |
| `rolling_avg_latency_ms` | `numeric(10,2)` | NOT NULL |
| `per_million_tokens_in_usd` | `numeric(10,6)` | NULL for local — derived from cost_cents/tokens when available |
| `per_million_tokens_out_usd` | `numeric(10,6)` | NULL for local |
| `previous_avg_cost_cents_per_call` | `numeric(10,4)` | NULL on first calibration — used for drift detection |
| `drift_pct` | `numeric(6,2)` | Computed: `(current − previous) / previous × 100`, NULL on first calibration |

**Primary key**: `(model, provider)`.

**New table: `prediction.model_pricing_drift_alerts`**

| Column | Type | Notes |
|--------|------|-------|
| `id` | `text` | PK, default `gen_random_uuid()::text` |
| `model` | `text` | NOT NULL |
| `provider` | `text` | NOT NULL |
| `detected_at` | `timestamptz` | NOT NULL, default `now()` |
| `previous_avg_cost_cents_per_call` | `numeric(10,4)` | NOT NULL |
| `new_avg_cost_cents_per_call` | `numeric(10,4)` | NOT NULL |
| `drift_pct` | `numeric(6,2)` | NOT NULL |
| `threshold_pct` | `numeric(6,2)` | NOT NULL — what threshold tripped |
| `samples_count` | `integer` | NOT NULL |
| `acknowledged_at` | `timestamptz` | Nullable — admin marks reviewed |
| `acknowledged_by_user_id` | `text` | Nullable |

**New table: `prediction.cost_experiments`**

| Column | Type | Notes |
|--------|------|-------|
| `id` | `text` | PK, default `gen_random_uuid()::text` |
| `created_at` | `timestamptz` | NOT NULL, default `now()` |
| `created_by_user_id` | `text` | NOT NULL — admin who triggered |
| `name` | `text` | NOT NULL — admin label |
| `stage` | `text` | NOT NULL — which stage's prompt is being tested |
| `input_payload` | `jsonb` | NOT NULL — serialized prompt + variables |
| `models` | `jsonb` | NOT NULL — array of `{provider, model}` to compare |
| `status` | `text` | NOT NULL — `pending`, `running`, `complete`, `failed` |
| `notes` | `text` | Nullable |

**New table: `prediction.cost_experiment_runs`**

| Column | Type | Notes |
|--------|------|-------|
| `id` | `text` | PK, default `gen_random_uuid()::text` |
| `experiment_id` | `text` | NOT NULL, FK → `cost_experiments.id` |
| `provider` | `text` | NOT NULL |
| `model` | `text` | NOT NULL |
| `started_at` | `timestamptz` | NOT NULL, default `now()` |
| `completed_at` | `timestamptz` | Nullable |
| `cost_cents` | `numeric(10,4)` | Nullable — NULL for local/BYO |
| `tokens_in` | `integer` | NOT NULL, default `0` |
| `tokens_out` | `integer` | NOT NULL, default `0` |
| `latency_ms` | `integer` | NOT NULL, default `0` |
| `output_text` | `text` | Nullable — full output kept for human review |
| `output_hash` | `text` | Nullable — SHA-256 of output |
| `error` | `text` | Nullable |
| `usage_log_id` | `text` | Nullable, FK → `llm_usage_log.id` — links experiment row to canonical log row |

**Indexes:**

| Index | Columns | Purpose |
|-------|---------|---------|
| `idx_pricing_drift_unack` | `(detected_at)` partial `WHERE acknowledged_at IS NULL` | Admin alert list |
| `idx_experiment_runs_by_exp` | `(experiment_id)` | Experiment detail page |

**No new materialized views.** All aggregation needs are met by the 8 views from `llm-usage-logging`. `model_pricing_calibration` is small (one row per model) and queried directly.

**Schema service**: All DDL added to `MarketsSchemaService.ensureSchema()` as re-entrant `CREATE TABLE IF NOT EXISTS` blocks (`costCalibrationDdl()`, `costExperimentsDdl()`).

### 4.3 API Changes

User-facing `/billing/*` endpoints live on `BillingController` in `apps/api/src/billing/` (the `BillingService` already exists in that module). Admin `/admin/cost/*` endpoints live on `MarketsController` alongside the existing `/markets/usage/*` endpoints, since cost-modeling is a markets-layer analytical concern. Admin endpoints gated by `requireAdmin(user)`.

| Method | Path | Controller | Auth | Returns |
|--------|------|------------|------|---------|
| `POST` | `/billing/predict-cost` | Billing | User (self) or admin (any user) | `{ predictedMonthlyCents, confidenceRange: [low, high], confidence: 'low'\|'medium'\|'high', breakdownByStage, breakdownByTriple, basisDays }` |
| `GET` | `/billing/student-accrual` | Billing | User (self) | `{ rawCostCents, withFloorCents, breakdownByTriple, daysIntoPeriod, projectedMonthlyCents }` |
| `GET` | `/billing/my-summary` | Billing | User (self) | `{ yearMonth, totalCallsThisMonth, totalCostCentsThisMonth, byStage: [...], byTriple: [...], byModel: [...], priorMonth: {...} }` — drives the user-facing `/billing/summary` view |
| `GET` | `/admin/cost/calibration` | Markets | Admin | `[{ model, provider, samplesCount, rollingAvgCostCentsPerCall, lastCalibratedAt, driftPct }]` |
| `POST` | `/admin/cost/calibration/refresh` | Markets | Admin | `{ refreshedModels: number, alertsRaised: number }` (synchronous; calibration job is fast) |
| `GET` | `/admin/cost/drift-alerts` | Markets | Admin | `[{ id, model, provider, driftPct, detectedAt, acknowledgedAt }]` |
| `POST` | `/admin/cost/drift-alerts/:id/acknowledge` | Markets | Admin | `{ acknowledgedAt }` |
| `GET` | `/admin/cost/defensibility` | Markets | Admin | `[{ itemKind, avgMonthlyCostCents, currentMonthlyFeeCents, marginPct, underPricedCount, overPricedCount }]` |
| `POST` | `/admin/cost/experiments` | Markets | Admin | `{ experimentId, status: 'pending' }` — returns immediately; execution runs in background |
| `GET` | `/admin/cost/experiments` | Markets | Admin | `[{ id, name, stage, status, createdAt, runsCount }]` |
| `GET` | `/admin/cost/experiments/:id` | Markets | Admin | `{ experiment, runs: [...] }` — UI polls this until `status === 'complete' \|\| 'failed'` |

`POST /billing/predict-cost` body:

```typescript
{
  userId: string;            // required; non-admin must match auth user
  configurationOverride?: {  // optional what-if scenario
    addTriples?: Array<{ analystId: string; instrumentId: string }>;
    removeTriples?: Array<{ analystId: string; instrumentId: string }>;
    modelOverrides?: Array<{ analystId: string; provider: string; model: string }>;
  };
}
```

`POST /admin/cost/experiments` body:

```typescript
{
  name: string;
  stage: string;             // matches LlmUsageContext.stage values
  inputPayload: unknown;     // JSON-serializable prompt + variables
  models: Array<{ provider: string; model: string }>;
}
```

### 4.4 Frontend Changes

**New admin views** (added to router under existing admin section):

| Route | View | Purpose |
|-------|------|---------|
| `/admin/cost/calibration` | `CostCalibrationView.vue` | Per-model rolling averages table, drift alerts banner, manual refresh button |
| `/admin/cost/defensibility` | `CostDefensibilityView.vue` | Per-item-kind margin table, flagged under/over-priced items, links to env-var-driven pricing config doc |
| `/admin/cost/experiments` | `CostExperimentsView.vue` | List + detail of experiments, "New Experiment" form |

Sidebar nav entry "Cost Modeling" added under the existing System (admin-only) section, with sub-links Calibration / Defensibility / Experiments.

**User-facing changes:**

| Component | Change |
|-----------|--------|
| New `BillingSummaryView.vue` at route `/billing/summary` | The per-user billing dashboard called for in the intention. Shows current month + prior month broken down by stage, by triple (analyst × instrument), and by model. Sourced from `GET /billing/my-summary`. Includes a "this is an estimate of compute cost" disclaimer (legal-language convention). |
| `DashboardView.vue` (existing) | Existing `UserUsageWidget` extended to show predicted next-month cost from `/billing/predict-cost` and a link to `/billing/summary` for the full breakdown |
| New `StudentAccrualWidget.vue` | Shown on `DashboardView` only when the user's billing tier is `student` (the widget's API response includes a `isStudent` flag derived from `billing.subscriptions`) — shows accrual + projected monthly |
| New `cost-prediction.composable.ts` | Wraps `/billing/predict-cost` and exposes a `predictWithOverride()` helper for "what-if" UI flows |
| New `billing-summary.store.ts` (Pinia) | Actions for `/billing/my-summary`, `/billing/predict-cost`, `/billing/student-accrual` |
| Existing `usage.store.ts` (Pinia) | Extended with calibration / defensibility / experiments admin actions |

A "what-if" prediction surface (e.g., a button on the analyst-enable flow) is **not** in scope for this effort — only the API and the composable are built. UI consumers can be added in a follow-up.

### 4.5 Infrastructure Requirements

- **Migration**: New tables (`model_pricing_calibration`, `model_pricing_drift_alerts`, `cost_experiments`, `cost_experiment_runs`) added via `MarketsSchemaService.ensureSchema()` re-entrant DDL. No materialized views.
- **Services**: `CostCalibrationService`, `CostPredictionService`, `PricingDefensibilityService`, `StudentBillingService`, `CostExperimentationService` — all `@Injectable()` registered in `MarketsModule`.
- **Cron**:
  - **Weekly calibration**: new `@Cron('0 3 * * 1')` (Monday 03:00 local) on a `CostCalibrationService.runWeeklyCalibration()` method, gated by `MARKETS_DISABLE_NIGHTLY_CRON` (reuse existing flag).
- **Env vars** (new):
  - `STUDENT_FLOOR_USD` (default `10`) — minimum monthly billable amount for student-tier users
  - `COST_CALIBRATION_WINDOW_DAYS` (default `28`) — rolling window for calibration averages
  - `COST_CALIBRATION_DRIFT_THRESHOLD` (default `20`) — % drift that triggers an alert
  - `COST_PREDICTION_HEADROOM_PCT` (default `25`) — multiplier added to predicted cost (predicted × (1 + headroom))
  - `COST_PREDICTION_MIN_HISTORY_DAYS` (default `14`) — below this, prediction returns `confidence: 'low'`
- **Existing env vars consumed** (no change): `INSTRUMENT_AUTHORSHIP_USD`, `ANALYST_AUTHORSHIP_USD`, `BYO_PLATFORM_FEE_USD`, `CONTRACT_OVERRIDE_USD`, `BASIC_MONTHLY_USD` (from `BillingService`).
- **No new external dependencies.**

## 5. Non-Functional Requirements

- **Performance**: `POST /billing/predict-cost` returns in <2s for any user. `GET /admin/cost/calibration` returns in <500ms (small table, single SELECT). Weekly calibration job completes in <60s on the current dataset (reads from already-aggregated `llm_usage_per_model_daily`).
- **Ollama serial constraint** (project memory): `CostExperimentationService` runs experiment models **sequentially**, not in parallel — even when comparing 4 models, calls go one at a time. The service must not introduce parallel LLM execution.
- **Async tolerance** (project memory): predictions and calibration are background analytics, not user-blocking inference. Endpoints can be slow-ish; nothing is on a hot path.
- **Security**: Admin endpoints gated by `requireAdmin(user)` (existing pattern from markets controller). User-scoped endpoints (`/billing/predict-cost`, `/billing/student-accrual`) require `userId` to match the authenticated user unless the caller is admin.
- **Legal language** (project memory): all user-facing text in the new dashboards uses "estimated cost" / "projected cost" / "analysis", never "advice" or "guarantee". Prediction surfaces an explicit confidence range and a "this is an estimate" disclaimer.
- **Compatibility**: Adds no breaking changes to `LlmUsageLogger` or `LlmUsageQueryService`. All new tables are additive.
- **Observability**: Drift alerts surface in admin UI. Calibration job logs samples-count and any models skipped (insufficient samples). Failed experiment runs leave a row with `error` populated.

## 6. Out of Scope

- **LLM call instrumentation and raw logging** — done by `llm-usage-logging` (prerequisite, shipped).
- **P&L / prediction performance attribution** — separate effort `entity-level-performance-attribution`.
- **Stripe billing flow mechanics, invoicing, payment retries** — separate effort `stripe-integration`. This effort only provides the queries that `stripe-integration` will call; it does not run any billing transactions.
- **Regression-test cost comparisons across historical replays** — separate effort `regression-testing-harness`.
- **Auto-adjusting authorship pricing env vars** — open question resolved as **manual admin approval only** (defensibility view recommends, admin edits env var). No auto-application.
- **Continuous background experimentation sampling** — open question resolved as **admin-triggered on-demand only** for v1. Continuous sampling deferred because the Ollama serial constraint means background experiments would degrade production cycle throughput.
- **LLM-judge automated quality scoring of experiment outputs** — intention mentions "quality-delta (via LLM-judge or human review)". v1 ships **human-review only**: the full `output_text` from each experiment run is persisted and rendered side-by-side in the admin UI. Adding an automated LLM-judge that scores semantic similarity / quality is deferred to a follow-up effort.
- **What-if UI flows on analyst-enable / instrument-create pages** — only the prediction API and composable are built. Adding the prediction surface to those pages is a follow-up.
- **Per-stage model routing** — analyst → model is one-to-one today (`prediction.market_analysts.llm_model`); per-stage routing is a separate future effort.
- **BYO API key cost imputation** — for BYO calls, `cost_cents` is NULL upstream (`LlmUsageLogger`). Calibration averages skip BYO rows. The "what would Divinr have paid for this BYO call" comparison is a future enhancement.
- **Real-time streaming dashboards** — daily/weekly refresh cadence on `llm-usage-logging`'s materialized views is sufficient. The student accrual widget computes from those daily-refreshed views, so accrual is current-as-of-last-refresh, not literal real-time.

## 7. Dependencies & Risks

| Dependency | Status | Risk |
|-----------|--------|------|
| `llm-usage-logging` table + views | Shipped 2026-04-17 | None — table and 8 views in place |
| `LlmUsageQueryService` | Shipped | None — reused as data source for calibration and prediction |
| `BillingService` env vars (`*_AUTHORSHIP_USD`, etc.) | Live | None — read from `process.env` like `BillingService` does |
| `prediction.user_enabled_triples` | Live | None — used to drive prediction inputs |
| `public.llm_models` | Live | Used only as fallback during cold-start when no `model_pricing_calibration` row exists yet |
| `requireAdmin()` helper | Live (markets.controller.ts) | None — reuse |
| `@nestjs/schedule` `@Cron` | Live (NightlyEvaluationService) | None — same pattern for weekly job |

**Technical Risks:**

1. **Cold-start: insufficient samples for calibration.** A model that's been called <50 times in the calibration window will produce noisy averages. **Mitigation**: `CostCalibrationService` skips models with `samples_count < COST_CALIBRATION_MIN_SAMPLES` (default 50, configurable env var). Calibration row is left in place from the previous run; only updated when sample size is sufficient. UI shows "Insufficient samples" badge.

2. **Cold-start: new users have no history for prediction.** **Mitigation**: When a user has <`COST_PREDICTION_MIN_HISTORY_DAYS` of usage, `CostPredictionService` falls back to seeding from the **75th-percentile cost of users with similar enabled-triple counts** (binned by count: 1–3, 4–10, 11+). Returned with `confidence: 'low'` and a wider range (±50% instead of ±25%). After the user accumulates the minimum history, predictions switch to the user's own data and confidence rises.

3. **Drift alert false positives.** Sample variance can produce 20%+ swings even without provider pricing changes. **Mitigation**: Alert only fires when `drift_pct ≥ threshold` AND `samples_count ≥ 200`. Admin can acknowledge alerts to dismiss without action.

4. **Pricing data divergence between `public.llm_models` and `model_pricing_calibration`.** `LlmUsageLogger` writes `cost_cents` at log-write time using `llm_models` lookup; `CostCalibrationService` then averages those `cost_cents` values to derive a different per-call average. This is intentional — `llm_models` is the listed price, `model_pricing_calibration` is the **observed** per-call cost based on real token-usage distributions. Both are kept; the calibration table is the source of truth for prediction. Admin UI shows both side-by-side so divergence is visible.

5. **Experimentation with paid models can be expensive.** An admin running an experiment with 4 commercial models on a 100-input batch could spend non-trivial money. **Mitigation**: Single-input-only for v1 (one prompt → N models, N parallel-equivalent serial calls). Batch experiments deferred. Admin UI shows the estimated cost (sum of per-model averages from calibration) before submit.

6. **NestJS DI requires explicit `@Inject(ClassName)`** (CLAUDE.md). The new services must follow this convention in every constructor parameter, including consumed services like `LlmUsageQueryService`. **Mitigation**: enforce in code review; the existing `LlmUsageLogger` and `LlmUsageQueryService` are reference patterns.

## 8. Phasing

### Phase 1: Calibration Layer

**Deliverables:**
- DDL for `prediction.model_pricing_calibration` and `prediction.model_pricing_drift_alerts` added to `MarketsSchemaService.ensureSchema()`
- `CostCalibrationService` with `runWeeklyCalibration()`, `recomputeForModel(model, provider)` methods
- Drift detection logic (compare current vs previous, write alert if threshold exceeded)
- Weekly `@Cron` registered on Mondays 03:00 local
- Admin endpoints: `GET /admin/cost/calibration`, `POST /admin/cost/calibration/refresh`, `GET /admin/cost/drift-alerts`, `POST /admin/cost/drift-alerts/:id/acknowledge`
- Unit tests for calibration math (rolling avg, drift %, sample-count gating)

**Validation gate:** Manual `POST /admin/cost/calibration/refresh` populates `model_pricing_calibration` rows with non-zero `samples_count` for every model that has ≥50 entries in `llm_usage_log` over the window. Drift alerts fire when seeded test data shows >20% variance.

### Phase 2: Prediction Layer

**Deliverables:**
- `CostPredictionService` with `predictForUser(userId, configurationOverride?)` method
- Cold-start handling: query for users with similar enabled-triple counts, compute 75th-percentile, return with `confidence: 'low'`
- Headroom application via `COST_PREDICTION_HEADROOM_PCT`
- Confidence-range computation (±25% normal, ±50% cold-start)
- Breakdown by stage and by triple
- API endpoint `POST /billing/predict-cost` (gated: self or admin)
- Unit tests with seeded `llm_usage_log` data covering: established user, cold-start user, configurationOverride scenarios

**Validation gate:** Predictions for an established test user (with ≥28 days of seeded usage) return within ±25% of actual; cold-start users return seed-based prediction with `confidence: 'low'`. `configurationOverride` adding a triple raises the predicted cost proportionally.

### Phase 3: Defensibility & Student Billing

**Deliverables:**
- `PricingDefensibilityService` with `summarizeByItemKind()` joining `billing.authored_items` × `llm_usage_per_analyst_authorship_monthly` / `llm_usage_per_instrument_authorship_monthly`
- `StudentBillingService` with `getUserCostCentsThisMonth(userId)` (canonical for `stripe-integration` consumption) and `getStudentAccrual(userId)` (for the dashboard widget)
- `STUDENT_FLOOR_USD` env var read & applied
- Endpoints: `GET /admin/cost/defensibility`, `GET /billing/student-accrual`
- Unit tests covering: under-priced item flag, over-priced flag, student floor application

**Validation gate:** Defensibility view shows per-item-kind margin computed from real `billing.authored_items` rows + their authored-author-user usage. Student accrual returns `withFloorCents = max(rawCostCents, STUDENT_FLOOR_USD * 100)`.

### Phase 4: Experimentation Mode

**Deliverables:**
- DDL for `prediction.cost_experiments` and `prediction.cost_experiment_runs`
- `CostExperimentationService` with `createExperiment(payload)` (returns immediately with `pending` status) and `runExperimentInBackground(id)` (in-process async worker — no new queue infrastructure)
- Sequential-only execution loop (Ollama serial constraint): even with 4 models selected, calls happen one after another
- Each experiment-run call goes through `MarketsLlmService.generateText()` with a synthesized `LlmUsageContext` (`stage: 'experiment'`, `subStage` carrying the experiment_id) so it lands in `llm_usage_log` AND links to `cost_experiment_runs.usage_log_id` for canonical accounting
- Status transitions: `pending → running → complete` (or `failed` on unrecoverable error). Per-run errors do not fail the whole experiment — they record the error on the run row and continue
- Endpoints: `POST /admin/cost/experiments` (returns `{experimentId, status: 'pending'}`), `GET /admin/cost/experiments`, `GET /admin/cost/experiments/:id` (UI polls)
- Output assessment is **human-review-only** for v1: the admin UI renders full `output_text` from each run side-by-side
- Unit tests with mocked LLM calls verifying serial execution, status transitions, partial-failure handling, and result persistence

**Validation gate:** Admin can submit an experiment with 2+ models. The POST returns immediately. Polling `GET /admin/cost/experiments/:id` eventually shows `status: 'complete'` with per-model `cost_cents`, `latency_ms`, and `output_text` populated. Inspect timestamps in `cost_experiment_runs` to verify execution was serial (no overlap).

### Phase 5: Frontend Dashboards

**Deliverables:**
- `CostCalibrationView.vue` — table of calibrated models with drift-pct column; alerts banner with acknowledge button; manual refresh button; "Insufficient samples" badge for skipped models
- `CostDefensibilityView.vue` — table per item kind with margin %, under-/over-priced flags; admin-facing copy directs to env var changes (no auto-apply button)
- `CostExperimentsView.vue` — list of experiments + "New Experiment" form (stage selector, model multi-select, JSON input payload field, estimated-cost preview before submit). Detail view polls `GET /admin/cost/experiments/:id` while status is `pending|running` and renders side-by-side per-run `cost_cents`, `latency_ms`, full `output_text` for human review
- `BillingSummaryView.vue` at route `/billing/summary` — user-facing per-user breakdown by stage, triple, model with current vs prior month
- `StudentAccrualWidget.vue` — used on `DashboardView` for student-tier users; shows `withFloorCents`, breakdown, projected monthly
- `cost-prediction.composable.ts` — exposes `predictForUser()` and `predictWithOverride()`
- `billing-summary.store.ts` — Pinia store for the user-facing endpoints
- Existing `UserUsageWidget` extended with a "Projected next month: $X.XX" line from `/billing/predict-cost` and a link to `/billing/summary`
- Routes added (admin): `/admin/cost/calibration`, `/admin/cost/defensibility`, `/admin/cost/experiments`
- Routes added (user): `/billing/summary`
- Sidebar nav: admin "Cost Modeling" group with sub-items; user-facing "Billing Summary" link visible to all authenticated users
- All user-facing copy uses "estimate" / "projected" — no "advice" / "guarantee" language

**Validation gate:** Admin sees real calibration data, defensibility margins, and can submit/view experiments end-to-end. A non-admin user opens `/billing/summary` and sees their own monthly breakdown by stage, triple, and model. A student-tier account sees real-time accrual on dashboard. Existing `/usage` dashboard is unchanged. All new copy matches legal-language conventions.
