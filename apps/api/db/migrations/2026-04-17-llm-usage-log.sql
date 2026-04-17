-- LLM Usage Logging: structured log table for every LLM call in the markets layer.
-- Effort: llm-usage-logging
-- Applied by: MarketsSchemaService.ensureSchema() → llmUsageLogDdl()

create table if not exists prediction.llm_usage_log (
  id text primary key default gen_random_uuid()::text,
  "timestamp" timestamptz not null default now(),
  article_id text,
  instrument_id text,
  analyst_id text,
  billed_user_id text,
  analyst_author_user_id text,
  instrument_author_user_id text,
  stage text not null,
  sub_stage text,
  model text not null,
  provider text not null,
  via_byo_key boolean not null default false,
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  cost_cents integer,
  latency_ms integer not null default 0,
  prompt_hash text,
  output_hash text,
  cycle_id text,
  error text,
  metadata jsonb
);

create index if not exists idx_llm_usage_billed_user_ts
  on prediction.llm_usage_log (billed_user_id, "timestamp");
create index if not exists idx_llm_usage_analyst_author_ts
  on prediction.llm_usage_log (analyst_author_user_id, "timestamp");
create index if not exists idx_llm_usage_instrument_author_ts
  on prediction.llm_usage_log (instrument_author_user_id, "timestamp");
create index if not exists idx_llm_usage_instrument_ts
  on prediction.llm_usage_log (instrument_id, "timestamp");
create index if not exists idx_llm_usage_analyst_ts
  on prediction.llm_usage_log (analyst_id, "timestamp");
create index if not exists idx_llm_usage_stage_ts
  on prediction.llm_usage_log (stage, "timestamp");
create index if not exists idx_llm_usage_cycle
  on prediction.llm_usage_log (cycle_id);
