# Multi-Analyst Coordination — Product Requirements Document

## 1. Overview

Divinr runs 7+ base analysts plus day-trader analysts, each making independent predictions that the arbitrator synthesizes. Today there is no system-level visibility into how analysts relate to each other — whether pairs are redundant, adversarial, or whether gaps exist that no analyst covers well. This effort builds a **read-only coordination layer** that computes cross-analyst behavior metrics and surfaces them in an admin dashboard, enabling the admin to make informed decisions about panel composition.

All analysis derives from existing data (`market_predictions`, `prediction_horizon_evaluations`, `analyst_performance_profiles`) — no new LLM calls are required for the coordination computations themselves.

## 2. Goals & Success Criteria

| Goal | Success Criterion | Measurement |
|------|-------------------|-------------|
| Identify redundant analyst pairs | Admin can view correlation matrix showing agreement rates for all analyst pairs | Agreement rate computed per pair; pairs >90% flagged as redundant |
| Identify adversarial analyst pairs | Same matrix flags pairs that disagree >80% of the time | Disagreement rate computed per pair |
| Surface coverage gaps | Admin can see instruments/conditions where no analyst performs well | Coverage report showing instruments with <50% accuracy across all analysts |
| Measure marginal contribution | Admin can see each analyst's contribution score to the arbitrator composite | Leave-one-out analysis comparing composite accuracy with vs. without each analyst |
| Periodic computation | Coordination metrics refresh on a schedule using existing evaluation data | Weekly cron job computes all metrics, stores results for dashboard |

## 3. User Stories / Use Cases

**Admin reviewing panel composition:**
- As an admin, I want to see which analyst pairs consistently agree so I can identify redundancy and consider removing one to save compute.
- As an admin, I want to see which pairs consistently disagree so I can investigate whether one is systematically wrong or if they cover different market regimes.
- As an admin, I want to see which instruments lack strong analyst coverage so I can prioritize creating new analysts or adjusting existing ones.
- As an admin, I want to see each analyst's marginal contribution to the composite so I can identify dead-weight analysts that never change the arbitrator's outcome.

**Admin after adding/removing an analyst:**
- As an admin, after modifying the panel, I want to trigger a re-computation of coordination metrics to see the updated landscape without waiting for the weekly schedule.

## 4. Technical Requirements

### 4.1 Architecture

The coordination layer is a new NestJS service (`CoordinationService`) in `apps/api/src/markets/services/`. It reads from existing tables and writes to new coordination-specific tables. It runs as a scheduled job (weekly) and can be triggered on-demand via an admin endpoint.

```
Existing Data                    Coordination Layer              Admin UI
─────────────                    ──────────────────              ────────
market_predictions ──┐
                     ├──→ CoordinationService ──→ coordination_* tables ──→ CoordinationView.vue
prediction_horizon_  │     - correlation analysis
  evaluations ───────┤     - coverage analysis
                     │     - contribution scoring
analyst_performance_ │
  profiles ──────────┘
```

### 4.2 Data Model Changes

Three new tables in the `prediction` schema:

**prediction.analyst_pair_correlations**
```sql
create table if not exists prediction.analyst_pair_correlations (
  id text primary key default gen_random_uuid()::text,
  analyst_a_id text not null,
  analyst_b_id text not null,
  instrument_id text,              -- NULL = aggregate across all instruments
  horizon_window integer,          -- NULL = aggregate across all horizons
  period text not null,            -- '30d' | '90d' | 'all'
  agreement_rate numeric not null, -- 0.0 to 1.0
  sample_size integer not null,
  flag text,                       -- 'redundant' | 'adversarial' | null
  computed_at timestamptz not null default now(),
  unique (analyst_a_id, analyst_b_id, instrument_id, horizon_window, period)
);
```

- `analyst_a_id < analyst_b_id` enforced to avoid duplicate pairs.
- `flag` is set when agreement_rate > 0.90 (redundant) or < 0.20 (adversarial, meaning disagreement > 80%).

**prediction.analyst_coverage_gaps**
```sql
create table if not exists prediction.analyst_coverage_gaps (
  id text primary key default gen_random_uuid()::text,
  instrument_id text not null,
  horizon_window integer,          -- NULL = aggregate
  period text not null,            -- '30d' | '90d' | 'all'
  best_analyst_id text,            -- analyst with highest accuracy, if any
  best_accuracy numeric,           -- best analyst's accuracy for this instrument
  analyst_count integer not null,  -- how many analysts cover this instrument
  avg_accuracy numeric not null,   -- average accuracy across all analysts
  is_gap boolean not null,         -- true if avg_accuracy < 0.50 or analyst_count < 2
  computed_at timestamptz not null default now(),
  unique (instrument_id, horizon_window, period)
);
```

**prediction.analyst_contribution_scores**
```sql
create table if not exists prediction.analyst_contribution_scores (
  id text primary key default gen_random_uuid()::text,
  analyst_id text not null,
  instrument_id text,              -- NULL = aggregate across all instruments
  period text not null,            -- '30d' | '90d' | 'all'
  composite_accuracy_with numeric not null,    -- arbitrator accuracy with this analyst
  composite_accuracy_without numeric not null, -- simulated accuracy without this analyst
  marginal_contribution numeric not null,      -- with - without (can be negative)
  prediction_count integer not null,
  computed_at timestamptz not null default now(),
  unique (analyst_id, instrument_id, period)
);
```

Schema creation goes in `markets-schema.service.ts` alongside existing table definitions.

### 4.3 API Changes

New endpoints in `markets.controller.ts`:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/markets/coordination/correlations` | Returns analyst pair correlations. Query params: `period` (default '30d'), `instrument_id` (optional), `flagOnly` (boolean, default false) |
| `GET` | `/markets/coordination/coverage` | Returns coverage gaps. Query params: `period` (default '30d'), `gapsOnly` (boolean, default false) |
| `GET` | `/markets/coordination/contributions` | Returns contribution scores. Query params: `period` (default '30d'), `instrument_id` (optional) |
| `POST` | `/markets/coordination/compute` | Triggers on-demand recomputation. Admin-only. Returns job status. |

All endpoints require admin authentication (existing auth middleware).

### 4.4 Frontend Changes

**New view: `CoordinationView.vue`** at route `/coordination`

Three sections:

1. **Correlation Matrix** — Heatmap-style grid of analyst pairs. Color-coded: green (moderate agreement 40-60%), yellow (high agreement 60-90%), red (>90% redundant or <20% adversarial). Click a cell to see per-instrument breakdown.

2. **Coverage Gaps** — Table of instruments sorted by avg_accuracy ascending. Columns: instrument symbol, analyst count, avg accuracy, best analyst, gap flag. Rows flagged as gaps highlighted.

3. **Contribution Scores** — Bar chart or sorted table of analysts by marginal contribution. Columns: analyst name, composite with, composite without, marginal contribution, prediction count. Negative contributions highlighted as warnings.

**Navigation:** Add "Coordination" link to the admin sidebar/nav, between "Analysts" and "Evaluations".

**Store:** New `coordination.store.ts` Pinia store with `fetchCorrelations()`, `fetchCoverage()`, `fetchContributions()`, `triggerCompute()` actions.

### 4.5 Infrastructure Requirements

- No new infrastructure. Uses existing Postgres (Supabase), NestJS cron (`@nestjs/schedule`), and Vue frontend.
- Coordination computation is CPU-bound SQL aggregation, not LLM-bound. Expected runtime: seconds for current data volumes.

## 5. Non-Functional Requirements

- **Performance**: Coordination computation must complete within 60 seconds for up to 20 analysts x 50 instruments x 3 horizons. Dashboard API responses under 500ms (pre-computed data).
- **Data freshness**: Weekly scheduled computation is sufficient. On-demand trigger available for immediate refresh.
- **Accuracy**: Correlation and contribution calculations must use only evaluated predictions (those with `was_correct` outcomes), not pending predictions.
- **Backwards compatibility**: No changes to existing prediction pipeline, arbitrator logic, or evaluation flow. Coordination layer is purely additive.

## 6. Out of Scope

- Auto-removing or auto-adding analysts based on coordination insights (intention: read-only system).
- Modifying analyst contracts or tier instructions based on coordination data (Tier 3's responsibility).
- Real-time coordination during prediction runs (coordination is periodic batch analysis).
- Per-user coordination views (admin-only).
- Weighting changes to the arbitrator based on coordination findings (the admin acts on insights manually).

## 7. Dependencies & Risks

| Dependency / Risk | Impact | Mitigation |
|-------------------|--------|------------|
| Sufficient evaluation data | Correlation and contribution metrics are meaningless with small sample sizes | Display sample_size prominently; flag metrics with <20 samples as "low confidence"; skip computation for pairs with <5 shared predictions |
| Leave-one-out contribution accuracy | Simulating "composite without analyst X" requires re-running arbitrator logic without LLM | Use deterministic majority-vote fallback (already exists in prediction-runner.service.ts lines 370-383) for leave-one-out simulation — no LLM calls needed |
| Analyst assignment changes over time | An analyst added last week has few predictions; comparing it to a 90-day veteran is misleading | Period parameter ('30d', '90d', 'all') lets admin choose appropriate window; contribution scores include prediction_count for context |
| Schema migration on Supabase | New tables must be created without disrupting existing data | Tables are purely additive (no ALTER on existing tables); use IF NOT EXISTS; deploy via existing schema service pattern |

## 8. Phasing

### Phase 1: Data Model & Correlation Analysis
- Add three new tables to `markets-schema.service.ts`
- Implement `CoordinationService` with `computeCorrelations()` method
- Query `prediction_horizon_evaluations` for all analyst pairs sharing the same run_id/instrument_id
- Compute agreement rates, flag redundant/adversarial pairs
- Store results in `analyst_pair_correlations`
- Add `GET /markets/coordination/correlations` endpoint
- **Gate**: Endpoint returns correct correlation data for existing evaluation records; pairs with >90% agreement flagged as redundant.

### Phase 2: Coverage Analysis & Contribution Scoring
- Implement `computeCoverage()` in CoordinationService
- Query `prediction_horizon_evaluations` grouped by instrument, compute per-analyst accuracy, identify gaps
- Store results in `analyst_coverage_gaps`
- Implement `computeContributions()` in CoordinationService
- For each analyst, simulate arbitrator composite without that analyst using deterministic majority-vote on historical predictions
- Compare simulated accuracy to actual arbitrator accuracy
- Store results in `analyst_contribution_scores`
- Add `GET /markets/coordination/coverage` and `GET /markets/coordination/contributions` endpoints
- **Gate**: Coverage endpoint correctly identifies instruments with low accuracy; contribution endpoint shows meaningful differentiation between analysts.

### Phase 3: Scheduling & On-Demand Trigger
- Add weekly cron job to CoordinationService (`@Cron('0 2 * * 0')` — Sunday 2 AM)
- Cron runs all three computations sequentially: correlations, coverage, contributions
- Add `POST /markets/coordination/compute` endpoint for on-demand trigger
- Guard with existing admin auth
- **Gate**: Cron fires on schedule and populates all three tables; on-demand endpoint triggers same computation and returns within 60 seconds.

### Phase 4: Admin Dashboard
- Create `CoordinationView.vue` with three sections (correlation matrix, coverage gaps, contribution scores)
- Create `coordination.store.ts` Pinia store
- Add route `/coordination` and navigation link
- Correlation matrix: heatmap grid with color coding and click-to-drill
- Coverage gaps: sortable table with gap highlighting
- Contribution scores: sorted table with negative-contribution warnings
- Add period selector (30d / 90d / all) and refresh button (triggers on-demand compute)
- **Gate**: All three sections render with real data; period switching works; refresh button triggers computation and updates display.
