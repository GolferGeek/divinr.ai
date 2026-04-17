# (User, Analyst, Instrument) Triple as Reasoning Atom — Completion Report

**Plan**: ./plan.md
**PRD**: ./prd.md
**Completed**: 2026-04-17
**Final Status**: All Phases Complete

## Summary
- Total phases: 4
- Phases completed: 4
- Phases remaining: 0

## Phase Results

### Phase 1: Schema Migration & Triple Context Utility — Complete
- Added `author_user_id` column to 6 tables: `market_predictors`, `market_predictions`, `market_risk_assessments`, `analyst_performance_profiles`, `prediction_horizon_evaluations`, `orchestration_runs`
- Rebuilt all unique/lookup indexes with COALESCE-based triple keys
- Created `resolveTripleContext()` utility with mixed-authorship guard
- **Notable**: Existing `analyst_performance_profiles` had duplicate rows requiring a dedup step before the unique index could be created. Fixed in migration with a DELETE-before-CREATE pattern.

### Phase 2: Predictor Generator & Risk Pipeline — Complete
- Threaded `author_user_id` through predictor-generator, risk-runner, and risk-debate services
- Updated all INSERT/UPSERT SQL to include `author_user_id`
- Updated ON CONFLICT clauses for COALESCE-based unique indexes
- **Notable**: Schema DDL had deadlock issues with the predictor-generator cron. Fixed by replacing `DROP INDEX IF EXISTS` + `CREATE INDEX IF NOT EXISTS` pairs with the new triple-scoped indexes inline (avoiding conditional DO blocks that conflicted with concurrent DDL).

### Phase 3: Prediction Pipeline & Outcome Tracking — Complete
- Threaded `author_user_id` through prediction-runner (per-analyst + arbitrator + paper mode)
- Updated outcome-tracking to propagate `author_user_id`, `analyst_id`, and `run_id` from predictions to horizon evaluations
- **Notable**: `outcome-tracking.service.ts` was also missing `analyst_id` and `run_id` propagation — fixed alongside `author_user_id`.

### Phase 4: Performance, Calibration & Learning — Complete
- Updated nightly-evaluation profile INSERT to GROUP BY `author_user_id`
- Added `computeTripleCalibration()` to leaderboard service for triple-level drill-down
- Updated learning engine proposal persistence to include `user_id` from triple context
- Completed full SQL query audit across all market services

## Gate Results

| Gate | Phase 1 | Phase 2 | Phase 3 | Phase 4 |
|------|---------|---------|---------|---------|
| Lint | Pass | Pass | Pass | Pass |
| Build | Pass | Pass | Pass | Pass |
| Unit Tests | 8/8 | 16/16 | 9/9 | 8/8 |
| Existing Tests | Pass | Pass | Pass | Pass |
| Markets Smoke | Pass | Pass* | Pass* | Pass* |
| Phase Review | Pass | Pass | Pass | Pass |

*Markets smoke tests require `MARKETS_DISABLE_PREDICTOR_GENERATION=true` due to a pre-existing DDL deadlock caused by the predictor-generator cron running concurrently with schema DDL. This is not caused by this effort's changes — confirmed by testing on main branch.

## Deviations from PRD

1. **`analyst_risk_assessments` table**: The PRD focused on `market_risk_assessments`, but the codebase also has a separate `analyst_risk_assessments` table used by the per-analyst risk reflection pipeline. Both tables were updated with `author_user_id`/`user_id` threading.

2. **outcome-tracking.service.ts bonus fix**: The evaluation INSERT was hardcoding `run_id = null` and `analyst_id = null`. Fixed to propagate from the source prediction alongside `author_user_id`.

3. **Schema DDL approach**: The PRD suggested `CREATE INDEX CONCURRENTLY`. The implementation uses inline `CREATE INDEX IF NOT EXISTS` within the DDL transaction instead, because the DDL runs as a single large SQL block in `ensureSchema()`. The standalone migration file (`2026-04-17-triple-model-author-user-id.sql`) handles the initial index creation and can be re-run idempotently.

## Next Steps

- **`user-authored-custom-content` effort**: Must land to exercise the triple model with non-NULL `author_user_id` values
- **`slot-based-enablement-ui`**: Frontend for users to pick which triples to enable
- **`entity-level-performance-attribution`**: Multi-dimensional performance views using triple-scoped data
- **DDL deadlock fix**: The pre-existing deadlock between `ensureSchema` DDL and predictor-generator cron should be investigated separately (not part of this effort)
