# (User, Analyst, Instrument) Triple as Reasoning Atom — Product Requirements Document

## 1. Overview

Refactor predictors, risk assessments, predictions, and learning records so they are keyed by the **(author_user_id, analyst_id, instrument_id)** triple instead of the current **(analyst_id, instrument_id)** pair. This makes each analyst's reasoning stream per-instrument independent across user-authored content variants. A single analyst running through three different instrument-contract lenses on AAPL holds three distinct, independently-evolving views.

The codebase already scopes `market_analysts` and `instruments` by `user_id` (NULL = base, non-NULL = user-authored). This effort extends that pattern to the four downstream reasoning tables — `market_predictors`, `market_predictions`, `market_risk_assessments`, and `analyst_performance_profiles` — and updates every runtime service that reads or writes those tables.

## 2. Goals & Success Criteria

| Goal | Measurable Criterion |
|------|---------------------|
| All reasoning records keyed by triple | Every row in predictors, predictions, risk_assessments, and performance_profiles has an `author_user_id` column participating in its unique/lookup indexes |
| Independent reasoning per lens | A single analyst scoring the same article for two different instrument variants (base AAPL vs. user-X's AAPL) produces two separate predictor records with distinct relevance scores |
| Per-triple calibration queryable | `analyst_performance_profiles` can be filtered by `(author_user_id, analyst_id, instrument_id)` and returns independent accuracy/calibration metrics per triple |
| No base-content regression | All existing base-content records (predictors, predictions, risk assessments, performance profiles) behave identically after migration — just with explicit `author_user_id = NULL` |
| Content-keyed cost model preserved | Each triple runs once per article/prediction cycle; no duplication of LLM calls for the same triple regardless of how many users have it enabled |

## 3. User Stories / Use Cases

**US-1: User-authored instrument variant gets independent analysis.** A user creates a "China-aware AAPL" instrument contract. When the predictor generator scores new articles, it produces separate predictor records for (NULL, analyst, base-AAPL) and (user-X, analyst, China-AAPL). Each set of predictors feeds its own prediction and risk assessment pipeline.

**US-2: Analyst holds independent risk views per lens.** An Aggressive Growth analyst assesses risk for base-AAPL and for user-X's ESG-tilt-AAPL. The risk summaries, debate transcripts, and composite scores are stored and evolve independently. Updating one does not affect the other.

**US-3: Per-triple calibration surfaces.** A user can see that Aggressive Growth's calibration on their custom instrument contract diverges from its calibration on the base instrument — the learning engine proposes adjustments scoped to each triple independently.

**US-4: Base content continues working unchanged.** Existing base instruments with base analysts produce predictors, predictions, and risk assessments exactly as before. The `author_user_id = NULL` triple is the default path, with no additional overhead or behavioral change.

**US-5: Debate participants scoped by triple.** When viewing a risk debate for a base instrument, a user sees only base-analyst participants. When viewing their custom instrument, they see analysts they explicitly associated. The existing `viewer_user_id` fanout on `risk_debates` extends to use triple-scoped risk assessment inputs.

## 4. Technical Requirements

### 4.1 Architecture

The triple model extends the existing user-scoping pattern already established on `market_analysts.user_id` and `instruments.user_id`. The new column is named `author_user_id` (matching the convention on `analyst_config_versions` and `instrument_config_versions`) and follows the same semantics:

- `author_user_id IS NULL` → base content (global, Divinr-owned)
- `author_user_id IS NOT NULL` → user-authored content, owned by that user

**Design decision: NULL sentinel for base content** (not a system user account). Rationale: the codebase already uses this pattern on 10+ tables with `user_id IS NULL` for base content, including the immutability trigger `guard_base_content_immutability()`. Introducing a system user would require rewriting every existing NULL check, the immutability guard, and the COALESCE-based unique indexes. NULL is the established convention.

### 4.2 Data Model Changes

#### 4.2.1 `prediction.market_predictors`

Add column:
```sql
ALTER TABLE prediction.market_predictors
  ADD COLUMN author_user_id text;
```

Replace unique index:
```sql
-- Drop: market_predictors_instrument_article_analyst_key (instrument_id, article_id, scored_by_analyst_id)
-- Create:
CREATE UNIQUE INDEX market_predictors_triple_article_key
  ON prediction.market_predictors (
    coalesce(author_user_id, 'base'), instrument_id, article_id, scored_by_analyst_id
  );
```

Add lookup index:
```sql
CREATE INDEX market_predictors_triple_idx
  ON prediction.market_predictors (
    coalesce(author_user_id, 'base'), analyst_id_or_scored_by, instrument_id
  );
```

Note: `scored_by_analyst_id` is the analyst reference column on this table. The triple lookup index uses `(author_user_id, scored_by_analyst_id, instrument_id)`.

#### 4.2.2 `prediction.market_predictions`

Add column:
```sql
ALTER TABLE prediction.market_predictions
  ADD COLUMN author_user_id text;
```

Replace unique indexes:
```sql
-- Drop: prediction_market_predictions_active_analyst_instrument_idx
-- Create:
CREATE UNIQUE INDEX market_predictions_active_triple_idx
  ON prediction.market_predictions (
    coalesce(author_user_id, 'base'), analyst_id, instrument_id
  ) WHERE settled_at IS NULL;

-- Drop: prediction_market_predictions_run_analyst_idx
-- Create:
CREATE UNIQUE INDEX market_predictions_run_triple_idx
  ON prediction.market_predictions (
    run_id, coalesce(author_user_id, 'base'), analyst_id
  ) WHERE role = 'analyst';
```

#### 4.2.3 `prediction.market_risk_assessments`

Add column:
```sql
ALTER TABLE prediction.market_risk_assessments
  ADD COLUMN author_user_id text;
```

Add lookup index:
```sql
CREATE INDEX market_risk_assessments_triple_idx
  ON prediction.market_risk_assessments (
    coalesce(author_user_id, 'base'), analyst_id, instrument_id
  );
```

#### 4.2.4 `prediction.analyst_performance_profiles`

Add column:
```sql
ALTER TABLE prediction.analyst_performance_profiles
  ADD COLUMN author_user_id text;
```

Update unique constraint (current key is `(analyst_id, instrument_id, horizon_window, period)`):
```sql
-- Replace with:
CREATE UNIQUE INDEX analyst_performance_profiles_triple_key
  ON prediction.analyst_performance_profiles (
    coalesce(author_user_id, 'base'), analyst_id, instrument_id, horizon_window, period
  );
```

#### 4.2.5 `prediction.prediction_horizon_evaluations`

Add column:
```sql
ALTER TABLE prediction.prediction_horizon_evaluations
  ADD COLUMN author_user_id text;
```

This table tracks per-prediction outcomes. The `author_user_id` propagates from the prediction it evaluates, enabling per-triple calibration queries.

#### 4.2.6 `prediction.learning_proposals`

This table already has a `user_id` column. Verify it is used consistently as the triple's `author_user_id` context when proposals are generated from triple-scoped performance data.

#### 4.2.7 `prediction.orchestration_runs`

Add column:
```sql
ALTER TABLE prediction.orchestration_runs
  ADD COLUMN author_user_id text;
```

Update unique queued-run constraint:
```sql
-- Drop: prediction_one_queued_run_per_key_idx (instrument_id, run_type) WHERE status='queued'
-- Create:
CREATE UNIQUE INDEX orchestration_runs_queued_triple_idx
  ON prediction.orchestration_runs (
    coalesce(author_user_id, 'base'), instrument_id, run_type
  ) WHERE status = 'queued';
```

This ensures one queued run per triple per run_type, not one per instrument globally.

#### 4.2.8 Migration Strategy

All existing records are base content. Backfill in a single migration:

```sql
-- All columns default to NULL which already means "base content"
-- No data update needed — NULL IS the base sentinel
-- Only indexes need rebuilding
```

The `ALTER TABLE ... ADD COLUMN` with no DEFAULT is a metadata-only operation in PostgreSQL — no table rewrite. Index rebuilds are the only potentially slow operation, run with `CONCURRENTLY` where possible.

### 4.3 API / Service Changes

Every service that reads or writes the affected tables must pass and filter by `author_user_id`. The changes follow a consistent pattern: resolve the triple context at the top of the pipeline and thread it through.

#### 4.3.1 Triple Context Resolution

Add a utility that resolves the `author_user_id` for a given (analyst, instrument) pair:

```typescript
interface TripleContext {
  authorUserId: string | null;  // NULL = base
  analystId: string;
  instrumentId: string;
}

function resolveTripleContext(
  analyst: { id: string; user_id: string | null },
  instrument: { id: string; user_id: string | null },
): TripleContext;
```

Resolution rule: `author_user_id` = the user_id from whichever entity is user-authored. If the analyst is base and the instrument is base, `author_user_id = NULL`. If either is user-authored, `author_user_id` = that user's ID. If both are user-authored by the same user, `author_user_id` = that user's ID. (Mixed authorship — analyst owned by user A, instrument owned by user B — is not supported in the current design; the assignment tables prevent it.)

#### 4.3.2 Predictor Generator (`predictor-generator.service.ts`)

- When scoring articles per (instrument, analyst), resolve the triple context
- Insert `author_user_id` into `market_predictors` rows
- Update the upsert conflict target to include `author_user_id` (via COALESCE)

#### 4.3.3 Risk Runner (`risk-runner.service.ts`)

- Thread `author_user_id` through `executePerAnalystRiskPass()`
- Insert `author_user_id` into `market_risk_assessments`
- When loading prior risk assessments for reflection, filter by triple
- Orchestration run creation includes `author_user_id`
- Queued-run dedup uses triple-scoped unique index

#### 4.3.4 Risk Debate (`risk-debate.service.ts`)

- Debate inputs (risk dimension assessments, composite scores) are already scoped by `viewer_user_id` on `risk_debates`
- Ensure the per-analyst risk assessments fed into the debate are filtered by the correct triple's `author_user_id`
- No schema change to `risk_debates` itself — `viewer_user_id` already provides the fanout scope

#### 4.3.5 Prediction Runner (`prediction-runner.service.ts`)

- Thread `author_user_id` through `runSingleAnalyst()`
- Insert `author_user_id` into `market_predictions`
- Active-prediction uniqueness now uses the triple-scoped index
- Arbitrator predictions: `author_user_id` = same as the analyst predictions they synthesize (one arbitrator output per triple)

#### 4.3.6 Outcome Tracking (`outcome-tracking.service.ts`)

- When resolving predictions, propagate `author_user_id` to `prediction_horizon_evaluations`
- Price snapshots are instrument-level (not triple-scoped) — no change needed

#### 4.3.7 Performance & Calibration (`performance.service.ts`, `leaderboard.service.ts`)

- `analyst_performance_profiles` queries and upserts include `author_user_id`
- Leaderboard calibration queries:
  - Default aggregation: by analyst (across all triples) — existing behavior preserved
  - New drill-down: by triple `(author_user_id, analyst_id, instrument_id)`
- Calibration bucket analysis unchanged in logic, just adds grouping dimension

#### 4.3.8 Learning Engine (`learning-engine.service.ts`)

- Pattern detection queries filter `analyst_performance_profiles` by triple
- Proposals target a specific triple (analyst + instrument + author context)
- Canonical test validation runs per-triple
- Paper mode activation scoped to triple

### 4.4 Frontend Changes

No frontend changes in this effort. The frontend currently displays predictions, risk assessments, and leaderboards keyed by analyst and instrument. The `author_user_id = NULL` base path produces identical API responses. Surfacing per-triple drill-downs is deferred to the `slot-based-enablement-ui` and `entity-level-performance-attribution` efforts.

### 4.5 Infrastructure Requirements

- **Migration**: Single SQL migration adding columns and rebuilding indexes. The `ADD COLUMN` (nullable, no default) is metadata-only in PostgreSQL. Index rebuilds with `CREATE INDEX CONCURRENTLY` avoid table locks.
- **No new services or infrastructure**: All changes are within existing services.
- **Ollama serial constraint respected**: Triple model does not change the number of concurrent LLM calls — it changes the keying of their outputs. Each triple still runs one inference at a time per the existing serial constraint.

## 5. Non-Functional Requirements

**Performance**: Adding `author_user_id` to indexes does not degrade query performance — the COALESCE-based indexes maintain the same selectivity. The triple-scoped unique indexes replace (not augment) existing indexes.

**Backward compatibility**: All existing queries that filter by `(analyst_id, instrument_id)` continue to work because base content has `author_user_id = NULL`. The COALESCE in unique indexes means NULL values participate correctly in uniqueness checks.

**Data integrity**: The `author_user_id` column is nullable (NULL = base). No FK constraint to a users table — consistent with existing `user_id` columns on `market_analysts` and `instruments` which also lack FK constraints (user identity is managed by Supabase Auth, not a local users table).

**Immutability**: Base-content immutability guard (`guard_base_content_immutability`) does not need modification — it checks `user_id IS NULL` on the parent entities (analysts, instruments), not on downstream records.

## 6. Out of Scope

- **User-side UI for picking which triples to enable** — separate effort: `slot-based-enablement-ui`
- **The authorship layer that creates non-base variants** — prerequisite effort: `user-authored-custom-content`
- **Multi-dimensional performance attribution** — separate effort: `entity-level-performance-attribution`
- **Frontend drill-down into per-triple calibration** — deferred until performance attribution effort
- **Sharing/club visibility of triple outputs** — sharing affects discoverability, not the triple key itself; deferred
- **New API endpoints for triple-level queries** — existing endpoints continue to serve base content; triple-filtered endpoints will be added by downstream efforts as needed

## 7. Dependencies & Risks

### Dependencies

| Dependency | Status | Impact |
|-----------|--------|--------|
| `user-authored-custom-content` | Must land first | Without user-authored variants, all records have `author_user_id = NULL` — the migration is safe but the triple model is exercised only on the base path |
| `stage-keyed-analyst-contracts` | Landed | Analyst contracts with `context_markdown` and `author_user_id` already exist on `analyst_config_versions` |
| `instrument-contracts` | Landed | Instrument contracts with `context_markdown` and `author_user_id` already exist on `instrument_config_versions` |

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Mixed-authorship triple (analyst owned by user A, instrument owned by user B) | Low — assignment tables prevent it | Undefined `author_user_id` | `resolveTripleContext()` throws on mixed authorship; add a check constraint or validation |
| Index rebuild on large tables blocks writes | Low — tables are small in early stage | Temporary write unavailability | Use `CREATE INDEX CONCURRENTLY`; schedule migration during low-traffic window |
| Existing queries miss `author_user_id` filter | Medium | Base-content queries return correct results (only NULL rows exist) but user-content queries could leak across triples | Systematic audit of all queries against affected tables; add integration tests per service that verify triple isolation |
| Learning engine proposals cross triple boundaries | Low | Adjustment learned from one triple applied to another | Thread `author_user_id` through proposal creation and application; test with multi-triple fixture |

## 8. Phasing

### Phase 1: Schema Migration & Triple Context Utility

**Deliverables:**
- SQL migration adding `author_user_id` to: `market_predictors`, `market_predictions`, `market_risk_assessments`, `analyst_performance_profiles`, `prediction_horizon_evaluations`, `orchestration_runs`
- Rebuild unique/lookup indexes with COALESCE-based triple keys
- `resolveTripleContext()` utility function with mixed-authorship guard
- TypeScript type updates for affected entities

**Quality gate:** Migration runs cleanly on dev Supabase. All existing tests pass (no behavioral change — all records have `author_user_id = NULL`). Schema service reflects new columns and indexes.

### Phase 2: Predictor Generator & Risk Pipeline

**Deliverables:**
- `predictor-generator.service.ts` threads `author_user_id` through article scoring and predictor upserts
- `risk-runner.service.ts` threads `author_user_id` through per-analyst risk passes, orchestration run creation, and risk assessment persistence
- `risk-debate.service.ts` filters debate inputs by triple-scoped risk assessments

**Quality gate:** Predictor generation for base content produces identical results. Risk pipeline for base content produces identical results. Integration tests verify triple isolation: two triples with same (analyst, instrument) but different `author_user_id` produce independent predictor and risk records.

### Phase 3: Prediction Pipeline & Outcome Tracking

**Deliverables:**
- `prediction-runner.service.ts` threads `author_user_id` through analyst predictions, arbitrator synthesis, and paper-mode runs
- `outcome-tracking.service.ts` propagates `author_user_id` to `prediction_horizon_evaluations`
- Active-prediction uniqueness uses triple-scoped index

**Quality gate:** Prediction generation for base content unchanged. Outcome resolution correctly tags evaluations with `author_user_id`. Two triples produce independent prediction streams and independent horizon evaluations.

### Phase 4: Performance, Calibration & Learning

**Deliverables:**
- `performance.service.ts` computes per-triple accuracy and calibration
- `leaderboard.service.ts` aggregates across triples by default, supports triple-level drill-down queries
- `learning-engine.service.ts` scopes pattern detection, proposals, and canonical tests to the triple
- `analyst_performance_profiles` upserts and queries use triple key

**Quality gate:** Leaderboard for base content unchanged. Per-triple calibration query returns independent scores for two triples sharing the same analyst. Learning proposals are scoped to and applied within a single triple.
