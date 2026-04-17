-- Triple Model: Add author_user_id to reasoning tables
-- (User, Analyst, Instrument) becomes the atom of reasoning continuity.
-- author_user_id IS NULL = base content (Divinr-owned).
-- author_user_id IS NOT NULL = user-authored content.

-- 1. market_predictors
ALTER TABLE prediction.market_predictors
  ADD COLUMN IF NOT EXISTS author_user_id text;

DROP INDEX IF EXISTS prediction.market_predictors_instrument_article_analyst_key;
CREATE UNIQUE INDEX IF NOT EXISTS market_predictors_triple_article_key
  ON prediction.market_predictors (
    coalesce(author_user_id, 'base'), instrument_id, article_id, scored_by_analyst_id
  );

CREATE INDEX IF NOT EXISTS market_predictors_triple_lookup_idx
  ON prediction.market_predictors (
    coalesce(author_user_id, 'base'), scored_by_analyst_id, instrument_id
  );

-- 2. market_predictions
ALTER TABLE prediction.market_predictions
  ADD COLUMN IF NOT EXISTS author_user_id text;

DROP INDEX IF EXISTS prediction.prediction_market_predictions_active_analyst_instrument_idx;
CREATE UNIQUE INDEX IF NOT EXISTS market_predictions_active_triple_idx
  ON prediction.market_predictions (
    coalesce(author_user_id, 'base'), analyst_id, instrument_id
  ) WHERE settled_at IS NULL AND analyst_id IS NOT NULL;

DROP INDEX IF EXISTS prediction.prediction_market_predictions_run_analyst_idx;
CREATE UNIQUE INDEX IF NOT EXISTS market_predictions_run_triple_idx
  ON prediction.market_predictions (
    run_id, coalesce(author_user_id, 'base'), analyst_id
  ) WHERE analyst_id IS NOT NULL AND role = 'analyst';

-- 3. market_risk_assessments
ALTER TABLE prediction.market_risk_assessments
  ADD COLUMN IF NOT EXISTS author_user_id text;

CREATE INDEX IF NOT EXISTS market_risk_assessments_triple_idx
  ON prediction.market_risk_assessments (
    coalesce(author_user_id, 'base'), analyst_id, instrument_id
  );

-- 4. analyst_performance_profiles
ALTER TABLE prediction.analyst_performance_profiles
  ADD COLUMN IF NOT EXISTS author_user_id text;

-- Deduplicate existing rows before adding unique index: keep most recent per key
DELETE FROM prediction.analyst_performance_profiles a
  USING prediction.analyst_performance_profiles b
  WHERE a.analyst_id = b.analyst_id
    AND coalesce(a.instrument_id, '') = coalesce(b.instrument_id, '')
    AND a.horizon_window = b.horizon_window
    AND a.period = b.period
    AND coalesce(a.author_user_id, '') = coalesce(b.author_user_id, '')
    AND a.computed_at < b.computed_at;

DROP INDEX IF EXISTS prediction.prediction_perf_profiles_analyst_idx;
CREATE UNIQUE INDEX IF NOT EXISTS analyst_performance_profiles_triple_key
  ON prediction.analyst_performance_profiles (
    coalesce(author_user_id, 'base'), analyst_id, instrument_id, horizon_window, period
  );

-- 5. prediction_horizon_evaluations
ALTER TABLE prediction.prediction_horizon_evaluations
  ADD COLUMN IF NOT EXISTS author_user_id text;

CREATE INDEX IF NOT EXISTS prediction_horizon_evals_triple_idx
  ON prediction.prediction_horizon_evaluations (
    coalesce(author_user_id, 'base'), analyst_id, instrument_id
  );

-- 6. orchestration_runs
ALTER TABLE prediction.orchestration_runs
  ADD COLUMN IF NOT EXISTS author_user_id text;

DROP INDEX IF EXISTS prediction.prediction_one_queued_run_per_key_idx;
CREATE UNIQUE INDEX IF NOT EXISTS orchestration_runs_queued_triple_idx
  ON prediction.orchestration_runs (
    coalesce(author_user_id, 'base'), instrument_id, run_type
  ) WHERE status = 'queued';
