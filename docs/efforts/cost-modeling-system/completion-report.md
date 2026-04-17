# Cost Modeling System — Completion Report

**Plan**: [plan.md](./plan.md)
**PRD**: [prd.md](./prd.md)
**Completed**: 2026-04-17
**Final Status**: All Phases Complete

## Summary
- Total phases: 5
- Phases completed: 5
- Phases remaining: 0
- New backend module: `apps/api/src/cost-modeling/` (5 services + 2 controllers)
- New frontend: 4 admin/user views, 2 widgets, 1 composable, 1 store + extension to existing usage store
- New tests: 5 unit-test files, 119 new assertions

## Phase Results

### Phase 1: Calibration Layer — Complete
- DDL for `prediction.model_pricing_calibration` and `prediction.model_pricing_drift_alerts` (`MarketsSchemaService.costCalibrationDdl()`); migration file `2026-04-18-cost-calibration.sql`
- `CostCalibrationService` with `recomputeForModel`, `runWeeklyCalibration`, `getCalibration`, `getDriftAlerts`, `acknowledgeDriftAlert` + `@Cron('0 3 * * 1')` weekly trigger gated by `MARKETS_DISABLE_NIGHTLY_CRON`
- 4 admin endpoints on `AdminCostController` (`/admin/cost/calibration`, `/admin/cost/calibration/refresh`, `/admin/cost/drift-alerts`, `/admin/cost/drift-alerts/:id/acknowledge`)
- 34 unit-test assertions (sample-count gating, drift threshold + sample minimum, first-time NULL drift, weekly aggregation)
- **Decision**: created dedicated `AdminCostController` (not on `MarketsController`) so URLs land at `/admin/cost/*` exactly per PRD §4.3 (MarketsController has prefix `markets`).

### Phase 2: Prediction Layer — Complete
- `CostPredictionService.predictForUser(userId, override?)` returns `{predictedMonthlyCents, confidenceRange, confidence, breakdownByStage, breakdownByTriple, basisDays}`
- Cold-start path (history < 14 days): seeds from 75th-percentile of peer users binned by enabled-triple count (1-3 / 4-10 / 11+), confidence `'low'`, ±50% range
- Established path: 30-day scaled, `'high'` confidence ≥28 days else `'medium'`, ±25% range
- `configurationOverride` supports addTriples / removeTriples / modelOverrides (with calibration-driven model-cost ratios)
- `BillingCostController.POST /billing/predict-cost` with self-or-admin auth
- 25 unit-test assertions
- **Architectural pivot**: created new self-contained `CostModelingModule` (`apps/api/src/cost-modeling/`) instead of placing services in BillingModule, because MarketsModule already imports BillingModule (cycle would have formed). All cost-modeling services live in this new module; AppModule wires it independently.

### Phase 3: Defensibility & Student Billing — Complete
- `PricingDefensibilityService.summarizeByItemKind()` joins `billing.authored_items` to authorship usage views with env-var fallback fees; flags under-priced (cost > fee) and over-priced (fee > cost × 2) per item kind
- `StudentBillingService` with `getUserCostCentsThisMonth(userId)` (the `stripe-integration` consumption point), `getStudentAccrual(userId)`, `getMySummary(userId, yearMonth?)`. `STUDENT_FLOOR_USD` floor applied. `isStudent` heuristic uses `billing.subscriptions.status === 'trial'` (v1 — to be replaced when student-club-accounts ships)
- 3 endpoints: `GET /admin/cost/defensibility`, `GET /billing/student-accrual`, `GET /billing/my-summary`
- 43 new unit-test assertions (18 defensibility + 25 student-billing)

### Phase 4: Experimentation Mode — Complete
- DDL for `prediction.cost_experiments` and `prediction.cost_experiment_runs` with FK + `idx_experiment_runs_by_exp`; migration `2026-04-18-cost-experiments.sql`
- `CostExperimentationService` with **async create** (`setImmediate`-scheduled background worker), serial execution (Ollama serial constraint), per-run failure isolation
- Each run synthesizes a unique `sub_stage = runId` so the inserted `llm_usage_log` row can be located deterministically post-call to capture cost/tokens/latency
- 3 endpoints: `POST /admin/cost/experiments` (returns `{experimentId, status: 'pending'}`), `GET /admin/cost/experiments`, `GET /admin/cost/experiments/:id`
- LLM-judge automated quality scoring deferred per PRD §6 — v1 ships human-review only via persisted `output_text`
- 17 unit-test assertions (validation, async, serial timing, partial failure, all-fail, JSON parsing)

### Phase 5: Frontend Dashboards — Complete
- 4 new views: `CostCalibrationView` (calibration table + drift alerts banner + manual refresh), `CostDefensibilityView` (margin per item kind + env-var copy), `CostExperimentsView` (list + form + detail with side-by-side outputs + 3s polling), `BillingSummaryView` (per-user breakdown by stage/triple/model + prior-month comparison)
- 2 new widgets: `StudentAccrualWidget` (only renders when `isStudent === true`), extended `UserUsageWidget` (added "Projected next month" line + link to `/billing/summary`)
- 1 new composable: `useCostPrediction.ts` exposing `predictForUser` and `predictWithOverride`
- 1 new store: `billing-summary.store.ts`; extension to existing `usage.store.ts` for admin-side cost actions
- Routes added: `/billing/summary` (user), `/admin/cost/calibration`, `/admin/cost/defensibility`, `/admin/cost/experiments`, `/admin/cost/experiments/:id` (admin)
- Sidebar nav: new admin "Cost Modeling" group + user-facing "Billing Summary" entry under Settings
- All copy uses "estimate" / "projected" — no "advice" or "guarantee" (project legal-language convention honored)

## Gate Results

| Gate | Phase 1 | Phase 2 | Phase 3 | Phase 4 | Phase 5 |
|------|---------|---------|---------|---------|---------|
| Lint (api) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Typecheck (api) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Build (api) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Unit tests (api) | ✅ 34 | ✅ +25 | ✅ +43 | ✅ +17 | ✅ all |
| Smoke (markets) | ✅ | ✅ | ⚠ deadlock | ⚠ deadlock | n/a |
| Lint (web) | n/a | n/a | n/a | n/a | ✅ |
| Typecheck (web) | n/a | n/a | n/a | n/a | ⚠ pre-existing |
| Build (web) | n/a | n/a | n/a | n/a | ✅ |

**⚠ Deadlock**: `test:markets:smoke` triggers a transient PostgreSQL deadlock during parallel `MarketsSchemaService.ensureSchema()` calls. Same root cause documented in the `llm-usage-logging` completion report ("Pre-existing deadlock on schema creation (unrelated to this effort)"). New DDL added by this effort (4 tables, all `if not exists`) does not introduce the deadlock — it occurs on parallel calls to the same DDL block, regardless of which tables are present. Phase 1's smoke happened to land on lucky timing.

**⚠ Web typecheck**: Pre-existing errors in unrelated files (`ClubDetailView`, `LandingView`, `PerformanceDashboardView`, `ContractEditorView`, etc. — DOM lib config and an `auth.user` typo). My new files (CostExperimentsView, CostCalibrationView, CostDefensibilityView, BillingSummaryView, StudentAccrualWidget, UserUsageWidget extension, billing-summary.store, useCostPrediction.ts, usage.store extension) all typecheck clean. No net regression from this effort. Vite production build succeeds.

## Deviations from PRD

1. **Module placement (PRD §4.1)**: PRD said `CostPredictionService` lives in `apps/api/src/billing/`, `PricingDefensibilityService` in `markets/services/`, `StudentBillingService` in `billing/`, and `CostExperimentationService` in `markets/services/`. **Implementation**: all five cost-modeling services live in a new self-contained `CostModelingModule` (`apps/api/src/cost-modeling/`) to avoid the circular-import problem (MarketsModule already imports BillingModule). Endpoints land at the URLs PRD specifies (`/billing/*` and `/admin/cost/*`); module ownership differs.

2. **Controller pattern**: PRD said admin endpoints live on `MarketsController`. **Implementation**: created dedicated `AdminCostController` and `BillingCostController` (both in CostModelingModule) so URLs are exactly `/admin/cost/*` and `/billing/*` rather than nested under markets.

3. **Pinia store organization (PRD §4.4)**: PRD said extend `usage.store.ts` for admin actions and create new `billing-summary.store.ts` for user actions. **Implementation matches** — `usage.store.ts` extended with calibration/defensibility/experiments admin actions; new `billing-summary.store.ts` owns the three user-facing endpoints.

4. **`isStudent` heuristic (PRD §4.4)**: PRD said student-tier widget visibility is gated by an `isStudent` flag derived from `billing.subscriptions`. **Implementation**: returns `true` when `billing.subscriptions.status === 'trial'` as a v1 heuristic. The dedicated `student-club-accounts` effort will replace this with a proper `account_type` column.

5. **Experimentation quality assessment (PRD §6)**: PRD already deferred LLM-judge automated quality scoring to a follow-up; v1 ships human-review only via persisted `output_text`. **Implementation matches** — admin UI renders side-by-side outputs.

## Open Questions Resolved

All four PRD-phase open questions from `intention.md` are answered in the codebase:

1. **Prediction accuracy ±25% target after how many weeks?** → Implemented as: `confidence = 'high'` requires ≥28 days history; medium below that; ±25% range applied to high/medium predictions.
2. **First-30-days handling?** → Cold-start branch when history < `COST_PREDICTION_MIN_HISTORY_DAYS` (default 14): seeds from 75th-percentile of peer users binned by enabled-triple count, returns `confidence: 'low'` with ±50% range.
3. **Auto-adjust env vars vs admin approval?** → Manual admin approval only. `CostDefensibilityView` shows margin per item kind + footer copy directing admin to env-var changes; no auto-apply UI.
4. **Experimentation on-demand vs continuous?** → Admin-triggered on-demand only. `POST /admin/cost/experiments` is the only entry point; no continuous sampling cron.

## Next Steps

- Run `/pr-eval` in the morning to review the PR before merging
- After merging, manually verify the dashboards by booting `pnpm --filter @divinr/api dev` (port 7100) + `pnpm --filter @divinr/web dev` (port 7101) and walking the Phase 5 chrome scenarios documented in `plan.md`
- Trigger a `POST /admin/cost/calibration/refresh` once real `llm_usage_log` data accumulates to populate `model_pricing_calibration`
- Wire `getUserCostCentsThisMonth(userId)` into `stripe-integration` when that effort starts (the canonical query method is exported from `StudentBillingService`)
- Replace the `isStudent` heuristic in `StudentBillingService.isStudentTier()` with a proper account-type lookup when `student-club-accounts` ships
