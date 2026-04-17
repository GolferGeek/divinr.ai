-- Cost Modeling: experimentation tables for admin model-comparison runs.
-- Effort: cost-modeling-system
-- Applied by: MarketsSchemaService.ensureSchema() → costExperimentsDdl()

create table if not exists prediction.cost_experiments (
  id text primary key default gen_random_uuid()::text,
  created_at timestamptz not null default now(),
  created_by_user_id text not null,
  name text not null,
  stage text not null,
  input_payload jsonb not null,
  models jsonb not null,
  status text not null,
  notes text
);

create table if not exists prediction.cost_experiment_runs (
  id text primary key default gen_random_uuid()::text,
  experiment_id text not null references prediction.cost_experiments (id) on delete cascade,
  provider text not null,
  model text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  cost_cents numeric(10,4),
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  latency_ms integer not null default 0,
  output_text text,
  output_hash text,
  error text,
  usage_log_id text
);

create index if not exists idx_experiment_runs_by_exp
  on prediction.cost_experiment_runs (experiment_id);
