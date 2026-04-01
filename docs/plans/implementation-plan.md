# Divinr AI — Full Implementation Plan

## Context

Divinr AI is extracting the prediction-runner and risk-runner from orchestrator-ai-enterprise into a governed multi-tenant SaaS product. Phase 0 (monorepo, planes, guardrails) is complete. The markets module has 25 endpoints with basic single-analyst prediction/risk runs. What's missing: real authentication, multi-analyst orchestration with context providers, dimension-based risk analysis with debate, LLM predictor scoring, the AI learning system, domain/universe awareness, prediction plane abstraction, and the entire web UI.

### Design documents this plan implements

| Document | Key concepts |
|----------|-------------|
| `analyst-system.md` | Default 5 personalities, tenant enable/disable/customize, context providers, analyst versioning, ensemble mechanics |
| `ai-learning-system.md` | Nightly autonomous evaluation (1d/3d/5d horizons), canonical test days, tiered learning, paper mode |
| `domain-architecture.md` | Three domains (financial/betting/elections), universe hierarchy, domain_slug/universe_slug on entities |
| `prediction-planes.md` | PredictionPlane interface (ingest/state/evaluation/presentation), StocksPredictionPlane |
| `markets-orchestration-roadmap.md` | Multi-analyst pipeline, arbitrator, LLM predictor scoring |

---

## Implementation Sequence

| Sprint | Focus | Key Deliverables |
|--------|-------|-----------------|
| **0** | Auth + analyst model + demo tenants | JWT middleware, route guards, expanded analyst model, domain/universe registry, 3 demo orgs |
| **1** | Schema + prediction plane | All new tables (risk, learning, versioning), prediction plane interface + StocksPredictionPlane |
| **2** | Risk runner | Dimension analyzer, score aggregation, debate system, risk-runner through plane interface |
| **3** | Multi-analyst predictions | Prediction-runner with context providers, arbitrator, analyst versioning tracked |
| **4** | LLM scoring + nightly evaluation | Predictor scoring, multi-horizon evaluation job (Phases 1-2), API updates |
| **5** | Canonical tests + learning engine | Canonical test execution, Tier 1 autonomous proposals, paper mode infrastructure |
| **6** | Web app foundation | Vue 3 + Vuetify, plane-driven presentation, CRUD views, tenant/domain selector |
| **7** | Web app detail views + learning UI | Run detail, risk dashboard, evaluation views (multi-horizon), learning reports |

---

## Quality gates (every sprint)

Every sprint must pass ALL gates before completion. No sprint ships without these:

| Gate | Tool | What it verifies |
|------|------|-----------------|
| **Lint** | `pnpm -w run lint` | No lint errors in changed files |
| **Build** | `pnpm -w run build` | TypeScript compilation succeeds for all packages and apps |
| **Typecheck** | `pnpm -w run typecheck` | No type errors |
| **Unit tests** | `pnpm -w run test` | All unit tests pass, including new tests for sprint deliverables |
| **Compliance tests** | `pnpm -w run test:compliance` | Cross-tenant isolation, RBAC, audit — must pass with sprint changes |
| **Markets smoke tests** | `pnpm -w run test:markets` | Smoke + HTTP integration tests for markets module |
| **Curl tests** | Manual or scripted | Key endpoints exercised via curl against running dev server |
| **Browser tests** | Chrome automation (Sprints 6-7 only) | UI renders correctly, CRUD operations work, navigation functional |
| **Verify readiness** | `pnpm -w run verify:markets` | Readiness script passes |

**Sprint-specific test additions are listed within each sprint.**

---

## Sprint 0: Auth + Analyst Model + Demo Tenants

**Goal:** Production-ready authentication, expanded analyst model with domain awareness, and 3 demo tenants.

### 0.1 Wire JWT Authentication Middleware

- Add NestJS middleware: extract `Authorization: Bearer <token>`, validate via `SupabaseIdentityProvider`, populate `request.user`
- Mark `/health` as `@Public()`
- Dev bypass: `MARKETS_DEV_AUTH_BYPASS=true` accepts header-based identity (logged as dev-only)
- **Files:** `apps/api/src/auth/auth.middleware.ts` (new), `apps/api/src/app.module.ts`

### 0.2 Protect Markets Routes

- Add `@UseGuards(JwtAuthGuard, RbacGuard)` to `MarketsController`
- Replace `resolveIdentity()` with `@CurrentUser()` decorator
- Validate org access via `RbacService.getUserOrganizations()`
- **Files:** `apps/api/src/markets/markets.controller.ts`

### 0.3 Markets-Specific Permissions

- Create permissions: `markets.instruments.read/write`, `markets.analysts.read/write`, `markets.runs.read/execute`, `markets.sources.read/write`, `markets.predictors.read/write`
- Create roles: `markets-admin` (all), `markets-analyst` (read + execute + predictors.write), `markets-viewer` (read only)
- Update `requireRead`/`requireWrite` to use new permission names
- **Files:** `apps/api/src/markets/markets.service.ts`, seed script

### 0.4 Domain and Universe Registry

- Create `prediction.domains` table and seed: `financial` (active), `betting` (inactive), `elections` (inactive)
- Create `prediction.universes` table and seed: `stocks` (active under financial), `crypto` (inactive), `polymarket` (inactive under betting), `nfl` (inactive), `us-2028-pres` (inactive under elections), `us-2026-mid` (inactive)
- Add `domain_slug` and/or `universe_slug` columns to `market_analysts`, `instruments`, `source_catalog`
- **Ref:** `docs/initial/domain-architecture.md`

### 0.5 Expand Analyst Model

Add columns to `market_analysts`:
- `analyst_type` (personality | context_provider)
- `default_weight` (0.1–2.0, default 1.0)
- `tier_instructions` (jsonb: { gold, silver, bronze })
- `is_system_default` (boolean)
- `is_enabled` (boolean, tenant toggle — distinct from soft-delete)
- `workflow_scope` (prediction | risk | both)
- `domain_slug` (FK to domains)
- `universe_slug` (optional FK to universes, for context providers)
- `updated_at`

Add `weight_override` to `market_instrument_analyst_assignments`

Seed 5 default personalities per org (is_system_default=true, domain_slug='financial'):
- Fundamental Fred (1.00), Technical Tina (1.00), Sentiment Sally (1.00), Aggressive Alex (1.10), Cautious Carl (0.90)
- Each with full tier_instructions (gold/silver/bronze)

### 0.6 Demo Tenant Seeding

Script: `scripts/seed-demo-tenants.ts` (idempotent)

| Org | Slug | Defaults | Custom Analysts |
|-----|------|----------|-----------------|
| Alpha Capital | `alpha-capital` | Alex weight→1.30, Carl disabled | Momentum Maria |
| Steadfast Advisors | `steadfast-advisors` | Fred weight→1.20, Carl weight→1.20, Alex disabled | Value Victor |
| Apex Quant | `apex-quant` | Fred disabled, Tina weight→1.30 | Quant Quinn, Macro Max |

Per org: 1 admin + 1 analyst user, 5 instruments (AAPL, MSFT, TSLA, GOOGL, AMZN), different source entitlements.

### 0.7 Sprint 0 Tests

- **Unit:** Auth middleware rejects invalid/missing tokens; dev bypass works with env flag
- **Compliance:** Update existing tests to use `markets.*` permissions; add cross-org denial test; add viewer-cannot-enqueue test
- **Curl:** Authenticate as demo user, hit `/markets/instruments`, verify response; hit without token, verify 401
- **E2E:** Seed script runs idempotently; 3 orgs visible with different analyst counts

---

## Sprint 1: Schema + Prediction Plane

**Goal:** All tables for risk, learning, and versioning. Prediction plane interface with StocksPredictionPlane.

### 1.1 Extract schema service

- Move `ensureSchema()` + `seedDefaultSources()` + `seedDefaultDimensions()` + `seedDefaultAnalysts()` into `apps/api/src/markets/schema/markets-schema.service.ts`
- Inject into all markets services

### 1.2 Multi-analyst prediction schema

- Add to `market_predictions`: `role` (analyst|arbitrator), `lineage_json` (jsonb), `key_factors` (jsonb), `risks` (jsonb), `config_version_id` (text, nullable)
- Add `role` to `market_run_artifacts`
- Unique indexes: `(run_id, analyst_id) WHERE role='analyst'`, `(run_id) WHERE role='arbitrator'`

### 1.3 Analyst versioning schema

- Create `prediction.analyst_config_versions` (id, analyst_id, organization_slug, version_number, persona_prompt, tier_instructions, default_weight, config_overrides jsonb, source, change_reason, parent_version_id, canonical_test_score, is_active, created_by, created_at)
- Add `current_config_version_id` to `market_analysts`
- Create initial version record for each existing analyst

### 1.4 Risk schema

- `prediction.risk_dimensions` (id, organization_slug, domain_slug, slug, name, description, weight, display_order, is_active, system_prompt, output_schema jsonb, created_at, updated_at) — UNIQUE (organization_slug, slug)
- `prediction.risk_dimension_assessments` (id, run_id, organization_slug, instrument_id, dimension_id, score 0-100, confidence 0-1, reasoning, evidence jsonb, signals jsonb, model_provider, model_name, created_at)
- `prediction.risk_composite_scores` (id, run_id, organization_slug, instrument_id, overall_score, dimension_scores jsonb, debate_id, debate_adjustment, pre_debate_score, confidence, status, created_at)
- `prediction.risk_debates` (id, run_id, organization_slug, instrument_id, composite_score_id, blue_assessment jsonb, red_challenges jsonb, arbiter_synthesis jsonb, original_score, final_score, score_adjustment, transcript jsonb, status, created_at, completed_at)
- `prediction.risk_debate_contexts` (id, organization_slug, domain_slug, role, version, system_prompt, is_active, created_at, updated_at) — UNIQUE (organization_slug, role, version)
- Seed default dimensions per domain (stocks: market/fundamental/technical/macro)

### 1.5 Learning system schema

- `prediction.prediction_horizon_evaluations` (id, prediction_id, run_id, organization_slug, instrument_id, analyst_id, horizon_window, prediction_date, evaluation_date, predicted_direction, actual_direction, actual_outcome_data jsonb, was_correct, confidence_at_prediction, created_at)
- `prediction.analyst_performance_profiles` (id, analyst_id, organization_slug, instrument_id, horizon_window, period, accuracy_rate, avg_confidence, calibration_score, systematic_biases jsonb, sample_size, computed_at)
- `prediction.canonical_test_days` (id, instrument_id, organization_slug, universe_slug, canonical_date, failure_classification, articles_snapshot jsonb, predictor_state_snapshot jsonb, risk_analysis_snapshot jsonb, risk_config_snapshot jsonb, analyst_config_snapshot jsonb, original_prediction jsonb, original_risk_assessment jsonb, actual_outcome jsonb, test_scope, is_active, added_at, retired_at, added_by)
- `prediction.learning_proposals` (id, organization_slug, tier, analyst_id, instrument_id, proposal_type, description, rationale, proposed_change jsonb, canonical_test_results jsonb, net_score, has_severity_regression, status, proposed_at, tested_at, reviewed_by, reviewed_at, applied_at)

### 1.6 Prediction plane interface + StocksPredictionPlane

- Define `PredictionPlane` interface in `packages/prediction-planes/src/prediction-plane.interface.ts` with 4 sub-contracts: `ingest`, `state`, `evaluation`, `presentation`
- Define supporting types: `InstrumentState`, `PrimaryMetric`, `ActualOutcome`, `EvaluationScore`, `EvaluationHorizon`, `DashboardLayout`, `CardFieldDefinition`
- Implement `StocksPredictionPlane` in `packages/prediction-planes/src/stocks/`:
  - `stocks-prediction-plane.ts` — plane entry point
  - `stocks-state.service.ts` — price/market data, `getPromptContext()` formats stock context
  - `stocks-evaluation.service.ts` — direction comparison, confidence calibration scoring
  - `stocks-presentation.ts` — dashboard layout definitions, card fields, visualization types
- Add `current_state jsonb` column to `instruments` table
- Register plane in NestJS module

### 1.7 Sprint 1 Tests

- **Unit:** Schema creates all new tables without error; plane interface methods return correct types; StocksPredictionPlane.state.getPromptContext() formats correctly
- **Compliance:** Cross-tenant isolation on all new risk/learning tables
- **Curl:** `GET /health` returns table counts confirming new schema
- **E2E:** Seed script still runs with expanded schema; existing smoke tests pass

---

## Sprint 2: Service Decomposition + Risk Runner

**Goal:** Decompose monolith, implement dimension-based risk analysis with debate, wired through prediction plane.

### 2.1 Service structure

```
apps/api/src/markets/
  schema/markets-schema.service.ts
  services/
    risk-dimension-analyzer.service.ts
    risk-score-aggregation.service.ts
    risk-debate.service.ts
    risk-runner.service.ts
    prediction-runner.service.ts       (Sprint 3)
    context-provider.service.ts        (loads + executes context providers)
```

### 2.2 Context provider service

- `loadContextProviders(organizationSlug, instrumentId)` — load context_provider analysts relevant to this instrument's universe
- `executeContextProvider(provider, instrument, sharedContext)` — LLM call that produces domain/universe/instrument knowledge
- `injectContextIntoPrompt(personalityPrompt, contextOutputs)` — merge context provider outputs into personality analyst prompts
- Filter by `analyst_type = 'context_provider'` and matching `universe_slug`

### 2.3 Risk runner (through prediction plane)

`risk-runner.service.ts` — called from `processNextQueuedRun` for risk runs:
1. Resolve instrument → universe → domain → prediction plane
2. Call `plane.state.getPromptContext(instrument)` for domain-formatted instrument context
3. Load active dimensions for org (filtered by `domain_slug`)
4. Validate weights sum to ~1.0
5. Load context providers for this instrument (via context-provider.service)
6. Fetch active predictors
7. For each dimension → call dimension analyzer (sequential, with progress events)
   - Dimension prompt includes: dimension system_prompt + plane context + context provider outputs + predictor context
   - Filter personality analysts by `workflow_scope = 'risk' or 'both'` — include their perspectives in dimension prompts
8. Persist dimension assessments
9. Call score aggregation → weighted composite
10. Persist composite score
11. Trigger debate
12. Apply debate adjustment, update composite
13. Persist legacy `market_risk_assessments` row

### 2.4 Score aggregation (pure computation)

- `aggregateAssessments()`: weighted average, geometric mean confidence
- `applyDebateAdjustment()`: clamp to 0-100

### 2.5 Debate service

- Blue/Red/Arbiter three-agent flow
- Load debate contexts from DB (filtered by `domain_slug`) or use built-in defaults
- Adjustment clamped to [-30, +30]
- Persist full transcript

### 2.6 Sprint 2 Tests

- **Unit:** Score aggregation with known inputs → expected outputs; dimension analyzer returns valid structure; debate adjustment clamping
- **Compliance:** Risk tables isolated per tenant; cross-tenant dimension query returns empty
- **Curl:** Enqueue risk run → process → verify dimension assessments + composite + debate in response
- **E2E:** Full risk pipeline end-to-end with demo tenant data; legacy `market_risk_assessments` row also created

---

## Sprint 3: Multi-Analyst Prediction Pipeline

**Goal:** N analyst outcomes + 1 arbitrator outcome per prediction run, with context providers and analyst versioning.

### 3.1 Prediction runner (through prediction plane)

`prediction-runner.service.ts`:
1. Resolve instrument → domain → prediction plane
2. Call `plane.state.getPromptContext(instrument)` for domain-formatted context
3. Load shared context (latest risk composite + active predictors)
4. Get ALL enabled analysts for instrument (filter by `workflow_scope = 'prediction' or 'both'`)
5. Load context providers for this instrument
6. Execute context providers → collect outputs
7. For each personality analyst (sequential):
   - Load current active config version (`analyst_config_versions WHERE is_active = true`)
   - Build prompt: persona_prompt + tier_instructions + plane context + context provider outputs + risk context + predictor context
   - Include analyst weight in structured output request
   - LLM call → parse JSON `{ direction, confidence, rationale, key_factors, risks }`
   - Persist per-analyst prediction with `role='analyst'`, `analyst_id`, `config_version_id`
   - Persist artifact with `analyst_id`, `role='analyst'`
   - On failure: record in partialFailures, continue
8. Arbitrator step:
   - Build prompt from all analyst outputs (including each analyst's name, perspective, weight, direction, confidence, rationale)
   - Include shared context
   - LLM call → parse JSON with `consensus_notes`
   - Persist prediction with `role='arbitrator'` + `lineage_json` (all analyst outcomes)
9. If zero analysts succeeded → mark run failed
10. Emit observability events at each step boundary

### 3.2 Output parsing

- Request JSON output in system prompt with explicit schema
- Try `JSON.parse` first
- Fall back to keyword heuristic with warning log

### 3.3 Analyst version creation on modification

- When a tenant modifies an analyst's persona/weight/tier_instructions via API:
  - Create new `analyst_config_versions` row (source='manual', version_number incremented)
  - Set `is_active=true` on new version, `is_active=false` on old
  - Update `market_analysts.current_config_version_id`
- Add `PUT /markets/analysts/:analystId` endpoint for modifications
- Add `POST /markets/analysts/:analystId/rollback` endpoint to revert to previous version

### 3.4 Sprint 3 Tests

- **Unit:** Prompt building includes context provider output; output parsing handles valid JSON and fallback; version creation increments correctly
- **Compliance:** Multi-analyst run produces N+1 rows; arbitrator lineage references only same-run analysts; cross-tenant analyst isolation
- **Curl:** Assign 3 analysts to instrument → enqueue prediction → process → GET run detail shows 3 analyst outcomes + 1 arbitrator
- **E2E:** Run prediction for all 3 demo tenants on same instrument → different results due to different analyst packs

---

## Sprint 4: LLM Scoring + Nightly Evaluation

**Goal:** Automate article relevance scoring and build the multi-horizon evaluation engine.

### 4.1 Predictor scoring

- `scoreArticleForInstrument(input)` — validate source entitlement, LLM score (relevance 0-1, rationale, dismiss flag), upsert `market_predictors`
- `POST /markets/predictors/score` — single article
- `POST /markets/predictors/score-batch` — batch with per-article results
- Manual `POST /markets/predictors` unchanged

### 4.2 API updates

- `GET /markets/runs/:runId` — enhanced with `analyst_outcomes[]` + `arbitrator_outcome`
- `GET /markets/predictions` — add `?role=analyst|arbitrator|all` filter
- `GET /markets/risk-assessments` — same role filter
- `GET /markets/risk-dimensions` — list dimensions for org
- `POST /markets/risk-dimensions` — create/update dimension
- `GET /markets/runs/:runId/risk-details` — composite + dimension assessments + debate
- `GET /markets/instruments/:instrumentId/composite-score` — latest composite + trend

### 4.3 Nightly evaluation job (Phases 1-2)

Build the autonomous evaluation engine:

**Phase 1 — Evaluate:**
1. Query predictions by horizon window (1d ago not yet eval'd at 1d, 3d ago not yet eval'd at 3d, 5d ago not yet eval'd at 5d)
2. For each: resolve instrument → prediction plane → call `plane.evaluation.evaluateOutcome(instrument, predictionDate, evaluationDate)`
3. Call `plane.evaluation.scorePrediction(predicted, actual)`
4. Persist `prediction_horizon_evaluations` records

**Phase 2 — Profile:**
5. Compute rolling performance per analyst per instrument per horizon (7d, 30d, all-time)
6. Calculate confidence calibration and systematic biases
7. Persist/update `analyst_performance_profiles`
8. Flag "wrong at all horizons + high confidence" as canonical day candidates (insert into `canonical_test_days`)

**Implementation:**
- NestJS scheduled task (cron) or CLI script callable by cron
- Configurable evaluation horizons per org (read from universe `default_evaluation_horizons` or org override)
- Uses `StocksPredictionPlane.evaluation` for outcome fetching

### 4.4 Sprint 4 Tests

- **Unit:** Predictor scoring validates entitlement deny path; evaluation job correctly identifies predictions by horizon window; performance profile computation with known data
- **Compliance:** Predictor scoring respects entitlements; evaluations scoped to org; canonical day candidates scoped to org
- **Curl:** Score an article → verify predictor upsert; GET enhanced run detail → verify grouped response; trigger evaluation job manually → verify horizon evaluations created
- **E2E:** Full flow: create prediction → wait (or simulate) → run evaluation → verify multi-horizon records

---

## Sprint 5: Canonical Tests + Learning Engine

**Goal:** Canonical test execution and Tier 1 autonomous learning with paper mode.

### 5.1 Canonical test execution engine

- `canonical-test-runner.service.ts`:
  1. Load canonical test set for instrument (filtered by `test_scope` and `is_active`)
  2. For each canonical day:
     - Restore frozen snapshot (articles, predictors, risk context or risk config depending on test_scope)
     - Run modified analyst config against snapshot
     - Compare output vs actual outcome and vs original prediction
  3. Score the change: improvement count, regression count, net score, severity check
  4. Decision rules: severity regression → block, net ≤ 0 → reject, net > 0 → pass

### 5.2 Paper mode infrastructure

- Add `paper_config_version_id` to `market_analysts` (nullable — the version being tested in paper mode)
- When a paper mode version is active, prediction runs produce TWO outputs per analyst: one from production config, one from paper config (paper results flagged with `is_paper = true`)
- Nightly evaluation compares paper vs production accuracy
- Auto-promote: if paper outperforms production over N days (configurable, default 3), swap active version
- Auto-demote: if paper underperforms, discard and log

### 5.3 Tier 1 autonomous learning

- `learning-engine.service.ts`:
  1. Read nightly evaluation results and performance profiles
  2. Identify systematic patterns (not one-off misses) — e.g., analyst consistently overconfident by 15%
  3. Propose micro-adjustments: confidence calibration, evidence weighting, prompt refinements
  4. Bounded: max ±15% confidence shift per cycle, no fundamental persona changes
  5. Run proposal against canonical test set via canonical-test-runner
  6. If passed: create new `analyst_config_versions` row (source='tier1_auto'), set as `paper_config_version_id`
  7. Persist `learning_proposals` record with full audit trail
  8. Generate nightly report (stored for dashboard consumption)

### 5.4 Tenant learning controls

- Per-analyst `learning_enabled` boolean (default true for system defaults)
- Per-org `learning_boundaries` jsonb on universe or org config (max_confidence_shift, locked_persona_aspects, paper_mode_duration_days)
- Tenant can review and revert any auto-applied change via API

### 5.5 Sprint 5 Tests

- **Unit:** Canonical test runner scores known scenarios correctly; paper mode produces dual outputs; learning engine proposes bounded adjustments; tenant controls respected
- **Compliance:** Learning proposals scoped to org; paper mode predictions scoped to org; canonical test days tenant-isolated
- **Curl:** Manually add a canonical day → trigger canonical test → verify scoring; trigger learning cycle → verify proposal created
- **E2E:** Full cycle: bad prediction → flagged as canonical candidate → nightly eval → learning proposes adjustment → canonical test validates → paper mode activated

---

## Sprint 6: Web App Foundation

**Goal:** Full Vue 3 + Vuetify dashboard with plane-driven presentation and domain awareness.

### 6.1 Setup

- Add dependencies: vuetify, vue-router, pinia, @mdi/font
- Configure Vite proxy: `/api` → `http://localhost:3100`
- `useApi.ts` composable: reads auth token + org context from tenant store, sets `Authorization` header
- Register prediction plane presentation config on the client side

### 6.2 Layout and navigation

- `DefaultLayout.vue` — nav drawer + toolbar + router-view
- `TenantSelector.vue` — org selector + login, persisted to localStorage
- `DomainSelector.vue` — domain/universe selector (shows only active domains for tenant)
- Navigation adapts based on active domain

### 6.3 Views and routes (plane-driven)

| Route | View | Source |
|-------|------|--------|
| `/` | DashboardView | Overview cards — instrument count, active runs, recent predictions |
| `/:domain` | DomainDashboardView | Uses `plane.presentation.getDashboardLayout()` for domain-specific layout |
| `/instruments` | InstrumentsView | List + create — card fields from `plane.presentation.getInstrumentCardFields()` |
| `/instruments/:id` | InstrumentDetailView | Tabs: analysts, runs, risk, predictions, predictors |
| `/analysts` | AnalystsView | List + create + persona editing + enable/disable toggle |
| `/runs` | RunsView | Run queue, filter by status, enqueue dialog |
| `/sources` | SourcesView | Source catalog + entitlement toggles + article browser |

### 6.4 Shared components (domain-agnostic)

- `AnalystOutcomeCard.vue`, `ArbitratorSection.vue`, `RunStatusChip.vue`, `RunEnqueueDialog.vue`, `DebateSummary.vue`

### 6.5 Domain-specific components (stocks initially)

- `StockInstrumentCard.vue` — uses plane card field definitions
- `StockPredictionDisplay.vue` — direction arrow + confidence bar + horizon
- `StockPriceChart.vue` — placeholder for market data visualization

### 6.6 Pinia stores

One per resource: tenant, domain, instruments, analysts, runs, predictions, risk, sources, predictors

### 6.7 Sprint 6 Tests

- **Unit:** Pinia stores fetch and cache correctly; useApi composable attaches auth headers
- **Curl:** All API endpoints exercised to verify data availability for UI
- **E2E:** App boots, tenant selector works, instruments list renders
- **Browser (Chrome):** Navigate all routes — verify renders, no console errors; CRUD: create instrument, create analyst, enqueue run; tenant switching shows different data per org

---

## Sprint 7: Detail Views + Learning UI

**Goal:** Rich visualizations, multi-horizon evaluation views, and learning system dashboard.

### 7.1 Run detail view

- `RunDetailView.vue` — per-analyst cards + arbitrator section + artifacts
- Uses `AnalystOutcomeCard.vue` with direction badge, confidence bar, rationale, key factors, analyst weight
- `ArbitratorSection.vue` — highlighted final verdict with consensus notes + expandable lineage

### 7.2 Risk dashboard

- `RiskDashboardView.vue` — cross-instrument risk overview
- `RiskDimensionChart.vue` — bar/radar for dimension scores (domain-specific dimensions)
- `CompositeScoreGauge.vue` — gauge widget for composite score
- `DebateSummary.vue` — blue/red/arbiter visualization

### 7.3 Predictions view

- `PredictionsView.vue` — cross-instrument predictions with analyst drill-down
- `PredictionDisplay.vue` — uses `plane.presentation.getPredictionDisplayFormat()`

### 7.4 Evaluation + learning views

- `EvaluationsView.vue` — multi-horizon evaluation table (1d/3d/5d columns per prediction)
- `AnalystPerformanceView.vue` — accuracy trends by horizon, confidence calibration charts, bias indicators
- `LearningDashboardView.vue` — nightly report summary, active proposals, paper mode status, canonical test day list
- `CanonicalDayDetail.vue` — frozen snapshot viewer, test results against this day

### 7.5 Predictor scoring panel

- `PredictorScoringPanel.vue` — inside InstrumentDetailView, AI scoring trigger for articles, batch scoring

### 7.6 Sprint 7 Tests

- **Unit:** Component rendering with mock data; chart components handle edge cases (no data, single point)
- **Curl:** All new API endpoints exercised
- **E2E:** Full user journey: login → select tenant → view instruments → enqueue run → view results → view evaluations → view learning dashboard
- **Browser (Chrome):** All detail views render correctly; risk radar chart displays; evaluation horizon columns show data; learning dashboard shows nightly report; analyst performance charts render; cross-tenant navigation shows different data

---

## Key Design Decisions

1. **Single `prediction` schema** — no separate `risk` schema
2. **No repository layer** — direct `db.rawQuery()` in services, matching existing pattern
3. **Arbitrator as a row, not a table** — `role` column on predictions/assessments
4. **Sequential LLM calls** — respects rate limits, runs are async queue-processed
5. **Debate always runs** for explicit risk runs
6. **Legacy `market_risk_assessments` preserved** — backward compat
7. **Vuetify for UI** — Material Design components
8. **Dev auth bypass** — `MARKETS_DEV_AUTH_BYPASS=true` for local dev
9. **Prediction plane consumed everywhere** — pipeline, evaluation, and UI all call through the plane interface
10. **Domain/universe awareness from day one** — columns and registry in place even though only stocks is active
11. **Learning system integrated into sprints** — not deferred, built incrementally (schema → evaluation → canonical tests → Tier 1 autonomous)
12. **Tests per sprint, not a terminal sprint** — every sprint has its own quality gates

---

## Critical Files

| File | Sprint | Action |
|------|--------|--------|
| `apps/api/src/auth/auth.middleware.ts` | 0 | New — JWT extraction + validation |
| `scripts/seed-demo-tenants.ts` | 0 | New — idempotent demo data seeding |
| `apps/api/src/markets/schema/markets-schema.service.ts` | 1 | New — all DDL + seeding |
| `packages/prediction-planes/src/prediction-plane.interface.ts` | 1 | New — plane contract |
| `packages/prediction-planes/src/stocks/` | 1 | New — StocksPredictionPlane |
| `apps/api/src/markets/services/context-provider.service.ts` | 2 | New — context provider execution |
| `apps/api/src/markets/services/risk-runner.service.ts` | 2 | New — risk orchestration through plane |
| `apps/api/src/markets/services/risk-dimension-analyzer.service.ts` | 2 | New — per-dimension LLM |
| `apps/api/src/markets/services/risk-score-aggregation.service.ts` | 2 | New — weighted math |
| `apps/api/src/markets/services/risk-debate.service.ts` | 2 | New — Blue/Red/Arbiter |
| `apps/api/src/markets/services/prediction-runner.service.ts` | 3 | New — multi-analyst pipeline through plane |
| `apps/api/src/markets/services/nightly-evaluation.service.ts` | 4 | New — multi-horizon evaluation job |
| `apps/api/src/markets/services/canonical-test-runner.service.ts` | 5 | New — canonical test execution |
| `apps/api/src/markets/services/learning-engine.service.ts` | 5 | New — Tier 1 autonomous proposals |
| `apps/api/src/markets/markets.service.ts` | 2-3 | Slim down, delegate to new services |
| `apps/api/src/markets/markets.types.ts` | 1 | Extend with ~25 new interfaces |
| `apps/api/src/markets/markets.controller.ts` | 0,3,4 | Guards + ~12 new endpoints |
| `apps/api/src/markets/markets.module.ts` | 1-5 | Register providers incrementally |
| `apps/web/src/` | 6-7 | Major — full UI build |
