-- Cost Modeling: per-model rolling cost calibration + drift alerts.
-- Effort: cost-modeling-system
-- Applied by: MarketsSchemaService.ensureSchema() → costCalibrationDdl()

create table if not exists prediction.model_pricing_calibration (
  model text not null,
  provider text not null,
  last_calibrated_at timestamptz not null,
  samples_count integer not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  rolling_avg_cost_cents_per_call numeric(10,4),
  rolling_avg_tokens_in numeric(12,2) not null,
  rolling_avg_tokens_out numeric(12,2) not null,
  rolling_avg_latency_ms numeric(10,2) not null,
  per_million_tokens_in_usd numeric(10,6),
  per_million_tokens_out_usd numeric(10,6),
  previous_avg_cost_cents_per_call numeric(10,4),
  drift_pct numeric(6,2),
  primary key (model, provider)
);

create table if not exists prediction.model_pricing_drift_alerts (
  id text primary key default gen_random_uuid()::text,
  model text not null,
  provider text not null,
  detected_at timestamptz not null default now(),
  previous_avg_cost_cents_per_call numeric(10,4) not null,
  new_avg_cost_cents_per_call numeric(10,4) not null,
  drift_pct numeric(6,2) not null,
  threshold_pct numeric(6,2) not null,
  samples_count integer not null,
  acknowledged_at timestamptz,
  acknowledged_by_user_id text
);

create index if not exists idx_pricing_drift_unack
  on prediction.model_pricing_drift_alerts (detected_at)
  where acknowledged_at is null;
