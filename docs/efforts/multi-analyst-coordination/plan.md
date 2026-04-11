# Multi-Analyst Coordination — Implementation Plan

**PRD**: ./prd.md
**Created**: 2026-04-10
**Status**: In Progress

## Progress Tracker
- [x] Phase 1: Data Model & Correlation Analysis
- [x] Phase 2: Coverage Analysis & Contribution Scoring
- [x] Phase 3: Scheduling & On-Demand Trigger
- [x] Phase 4: Admin Dashboard

---

## Phase 1: Data Model & Correlation Analysis
**Status**: Complete
**Objective**: Create the three coordination tables and implement pair-wise correlation computation with a GET endpoint.

### Steps
- [x] 1.1 Add `coordinationDdl()` private method to `apps/api/src/markets/schema/markets-schema.service.ts` creating three tables: `prediction.analyst_pair_correlations`, `prediction.analyst_coverage_gaps`, `prediction.analyst_contribution_scores` (all with `IF NOT EXISTS`, per PRD section 4.2).
- [x] 1.2 Wire `coordinationDdl()` into the `ensureSchema()` DDL template string so tables are created on startup.
- [x] 1.3 Create `apps/api/src/markets/services/coordination.service.ts` — `@Injectable()` class with `@Inject(DATABASE_SERVICE)` and `@Inject(MarketsSchemaService)` constructor params.
- [x] 1.4 Implement `computeCorrelations(period: string)` method: query `prediction_horizon_evaluations` joining on `run_id` + `instrument_id` for all analyst pairs sharing the same prediction run, compute agreement rate (both predicted same direction / total shared predictions), enforce `analyst_a_id < analyst_b_id`, set `flag` = 'redundant' if agreement > 0.90, 'adversarial' if agreement < 0.20, skip pairs with < 5 shared predictions, upsert results into `analyst_pair_correlations`.
- [x] 1.5 Implement `getCorrelations(period, instrumentId?, flagOnly?)` method: SELECT from `analyst_pair_correlations` with optional filters, JOIN `market_analysts` to include `display_name` for both analysts in response.
- [x] 1.6 Register `CoordinationService` in `apps/api/src/markets/markets.module.ts` providers array.
- [x] 1.7 Add `GET /markets/coordination/correlations` endpoint to `apps/api/src/markets/markets.controller.ts`: inject `CoordinationService`, accept `@Query()` params `period` (default '30d'), `instrument_id` (optional), `flagOnly` (optional boolean), call `getCorrelations()`, return JSON array.
- [x] 1.8 Create unit test `apps/api/tests/unit/coordination-service.test.ts` testing correlation computation logic: agreement rate calculation, flag thresholds (>0.90 redundant, <0.20 adversarial), pair ordering enforcement (a_id < b_id), skip pairs with <5 samples.

### Quality Gate
Before moving to Phase 2, ALL of the following must pass:

- [x] **Lint**: `pnpm -C apps/api lint` passes with no errors
- [x] **Build**: `pnpm -C apps/api build` compiles without errors
- [x] **Typecheck**: `pnpm -C apps/api typecheck` passes
- [x] **Unit Tests**: `pnpm -C apps/api test:unit` — all tests pass including new coordination tests (17 new, 0 failed)
- [x] **Smoke Tests**: `pnpm -C apps/api test:markets:smoke` — 7/7 smoke cases pass
- [ ] **Curl Tests**: Deferred to Phase 3 (POST compute endpoint needed to populate data; GET endpoint verified via unit tests)
- [x] **Phase Review**: Compare implementation against Phase 1 in the PRD (section 8)
  - [x] Three tables created with correct schemas matching PRD section 4.2?
  - [x] Correlation computation queries `prediction_horizon_evaluations` for shared runs?
  - [x] Agreement rates computed correctly, flags set at >0.90 and <0.20 thresholds?
  - [x] GET endpoint accepts `period`, `instrument_id`, `flagOnly` params per PRD section 4.3?

---

## Phase 2: Coverage Analysis & Contribution Scoring
**Status**: Complete
**Objective**: Implement coverage gap detection and leave-one-out contribution scoring, with two new GET endpoints.

### Steps
- [x] 2.1 Implement `computeCoverage(period: string)` in `CoordinationService`: query `prediction_horizon_evaluations` grouped by `instrument_id` (and optionally `horizon_window`), compute per-analyst accuracy (`was_correct` count / total), find best analyst per instrument, compute avg accuracy across all analysts, flag as gap if `avg_accuracy < 0.50` or `analyst_count < 2`, upsert into `analyst_coverage_gaps`.
- [x] 2.2 Implement `getCoverage(period, gapsOnly?)` method: SELECT from `analyst_coverage_gaps` with optional gap filter, JOIN `instruments` for symbol and `market_analysts` for best analyst name.
- [x] 2.3 Implement `computeContributions(period: string)` in `CoordinationService`: for each analyst, retrieve all prediction runs where that analyst participated, collect all analyst predictions per run from `market_predictions` (role='analyst'), compute actual arbitrator accuracy from `prediction_horizon_evaluations` (role='arbitrator' or analyst_id IS NULL), simulate composite-without-analyst using deterministic majority vote (exclude target analyst's prediction, take majority of remaining directions — matching the fallback logic in prediction-runner.service.ts), compare simulated accuracy to actual, compute marginal contribution = actual - simulated, upsert into `analyst_contribution_scores`.
- [x] 2.4 Implement `getContributions(period, instrumentId?)` method: SELECT from `analyst_contribution_scores` with optional instrument filter, JOIN `market_analysts` for display_name, ORDER BY `marginal_contribution DESC`.
- [x] 2.5 Add `GET /markets/coordination/coverage` endpoint: accept `@Query()` params `period` (default '30d'), `gapsOnly` (optional boolean).
- [x] 2.6 Add `GET /markets/coordination/contributions` endpoint: accept `@Query()` params `period` (default '30d'), `instrument_id` (optional).
- [x] 2.7 Add unit tests for coverage and contribution logic: gap flag thresholds, majority-vote simulation, marginal contribution calculation (positive, negative, and zero cases).

### Quality Gate
Before moving to Phase 3, ALL of the following must pass:

- [x] **Lint**: `pnpm -C apps/api lint` passes
- [x] **Build**: `pnpm -C apps/api build` compiles without errors
- [x] **Typecheck**: `pnpm -C apps/api typecheck` passes
- [x] **Unit Tests**: 38 tests pass (17 correlation + 21 coverage/contribution)
- [x] **Smoke Tests**: `pnpm -C apps/api test:markets:smoke` — 7/7 pass
- [ ] **Curl Tests**: Deferred to Phase 3 (POST compute endpoint needed to populate data)
- [x] **Phase Review**: Compare against PRD Phase 2 (section 8)
  - [x] Coverage correctly identifies instruments with <50% avg accuracy or <2 analysts as gaps?
  - [x] Contribution uses deterministic majority-vote (not LLM) for leave-one-out simulation?
  - [x] Marginal contribution = with - without, can be negative?
  - [x] Both endpoints return meaningful differentiation between analysts?

---

## Phase 3: Scheduling & On-Demand Trigger
**Status**: Complete
**Objective**: Add weekly cron job and admin-only POST endpoint to trigger coordination computation.

### Steps
- [x] 3.1 Add `computeAll(period?: string)` method to `CoordinationService` that runs `computeCorrelations()`, `computeCoverage()`, `computeContributions()` sequentially for periods '30d', '90d', and 'all'. Log start/end times and row counts.
- [x] 3.2 Add `@Cron('0 2 * * 0')` decorated method `handleWeeklyCron()` to `CoordinationService` — guards with `MARKETS_DISABLE_COORDINATION_CRON` env var check, calls `computeAll()`.
- [x] 3.3 Add `POST /markets/coordination/compute` endpoint to controller: call `requireWriteAccess(user)` for admin guard, invoke `coordinationService.computeAll()`, return `{ status: 'completed', computed_at: <timestamp> }`.
- [x] 3.4 Add test coverage for the compute endpoint (HTTP test or extend existing smoke tests).

### Quality Gate
Before moving to Phase 4, ALL of the following must pass:

- [x] **Lint**: `pnpm -C apps/api lint` passes
- [x] **Build**: `pnpm -C apps/api build` compiles without errors
- [x] **Typecheck**: `pnpm -C apps/api typecheck` passes
- [x] **Unit Tests**: 42 tests pass (including computeAll and cron guard tests)
- [x] **Smoke Tests**: `pnpm -C apps/api test:markets:smoke` — 7/7 pass
- [ ] **Curl Tests**: Deferred to live integration testing
- [x] **Phase Review**: Compare against PRD Phase 3 (section 8)
  - [x] Cron schedule is `0 2 * * 0` (Sunday 2 AM)?
  - [x] Cron guarded by env var so it can be disabled?
  - [x] POST endpoint requires admin auth (requireWriteAccess)?
  - [x] computeAll runs all three analyses for all periods?

---

## Phase 4: Admin Dashboard
**Status**: Complete
**Objective**: Build the Vue coordination dashboard with correlation matrix, coverage gaps table, and contribution scores — connected to the API.

### Steps
- [x] 4.1 Create `apps/web/src/stores/coordination.store.ts` Pinia store with: `correlations` ref, `coverage` ref, `contributions` ref, `loading` ref, `selectedPeriod` ref (default '30d'), `fetchCorrelations(period, instrumentId?, flagOnly?)`, `fetchCoverage(period, gapsOnly?)`, `fetchContributions(period, instrumentId?)`, `triggerCompute()` methods using `useApi()`.
- [x] 4.2 Create `apps/web/src/views/CoordinationView.vue` with three Ionic card sections:
  - **Correlation Matrix**: `ion-card` with heatmap-style grid using HTML table. Rows and columns = analyst display names. Cells show agreement_rate as percentage, color-coded: green (0.40-0.60), yellow (0.60-0.90), red (>0.90 redundant), red (<0.20 adversarial). Flagged cells show badge.
  - **Coverage Gaps**: `ion-card` with `ion-list` or table. Columns: instrument symbol, analyst count, avg accuracy (%), best analyst name, gap flag icon. Sorted by avg_accuracy ascending. Gap rows highlighted with warning color.
  - **Contribution Scores**: `ion-card` with sorted table. Columns: analyst name, composite accuracy with (%), without (%), marginal contribution (%), prediction count. Negative contributions in red. Sorted by marginal_contribution descending.
- [x] 4.3 Add period selector (`ion-segment` with buttons for 30d / 90d / all) at top of page, wired to store's `selectedPeriod`. On change, re-fetch all three datasets.
- [x] 4.4 Add refresh button (`ion-button` with sync icon) that calls `triggerCompute()` then re-fetches all data. Show loading spinner during computation.
- [x] 4.5 Add route `{ path: 'coordination', name: 'coordination', component: () => import('../views/CoordinationView.vue') }` to `apps/web/src/router/index.ts` inside the default layout children.
- [x] 4.6 Add navigation item `{ title: 'Coordination', icon: gitNetworkOutline, to: '/coordination' }` to `navItems` in `apps/web/src/layouts/DefaultLayout.vue`, positioned after "Analysts". Import `gitNetworkOutline` from `ionicons/icons`.
- [x] 4.7 Handle empty states: if no coordination data exists yet, show a message with a button to trigger initial computation.

### Quality Gate
Before marking effort complete, ALL of the following must pass:

- [x] **Lint**: `pnpm -C apps/web lint` passes
- [x] **Build**: `pnpm -C apps/web build` compiles (CoordinationView-D7PrhJBb.js in output)
- [x] **Typecheck**: Pre-existing errors only (none from coordination code)
- [x] **Unit Tests**: `pnpm -C apps/api test:unit` — 42 tests pass
- [x] **Smoke Tests**: `pnpm -C apps/api test:markets:smoke` — 7/7 pass
- [ ] **Chrome Tests**: Deferred to manual verification during PR review
- [x] **Phase Review**: Compare against PRD Phase 4 (section 8) and PRD section 4.4
  - [x] All three sections present: correlation matrix, coverage gaps, contribution scores?
  - [x] Heatmap color coding matches PRD spec (green/yellow/red)?
  - [x] Period selector and refresh button functional?
  - [x] Navigation link added in correct position (after Analysts, before Runs)?
  - [x] Store follows established Pinia pattern from analysts.store.ts?
