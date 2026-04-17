-- LLM Usage Logging: 8 materialized views for aggregation queries.
-- Effort: llm-usage-logging
-- Applied by: MarketsSchemaService.ensureSchema() → llmUsageViewsDdl()
-- Refreshed nightly by NightlyEvaluationService.

-- 1. Per-user monthly
create materialized view if not exists prediction.llm_usage_per_user_monthly as
  select billed_user_id, to_char("timestamp", 'YYYY-MM') as year_month,
    count(*)::integer as total_calls, sum(tokens_in)::integer as total_tokens_in,
    sum(tokens_out)::integer as total_tokens_out, sum(cost_cents)::integer as total_cost_cents
  from prediction.llm_usage_log
  group by billed_user_id, to_char("timestamp", 'YYYY-MM')
with no data;

-- 2. Per-triple daily
create materialized view if not exists prediction.llm_usage_per_triple_daily as
  select billed_user_id, analyst_id, instrument_id, "timestamp"::date as date,
    count(*)::integer as total_calls, sum(tokens_in)::integer as total_tokens_in,
    sum(tokens_out)::integer as total_tokens_out, sum(cost_cents)::integer as total_cost_cents
  from prediction.llm_usage_log
  group by billed_user_id, analyst_id, instrument_id, "timestamp"::date
with no data;

-- 3. Per-stage daily
create materialized view if not exists prediction.llm_usage_per_stage_daily as
  select stage, sub_stage, "timestamp"::date as date,
    count(*)::integer as total_calls, sum(tokens_in)::integer as total_tokens_in,
    sum(tokens_out)::integer as total_tokens_out, sum(cost_cents)::integer as total_cost_cents
  from prediction.llm_usage_log
  group by stage, sub_stage, "timestamp"::date
with no data;

-- 4. Per-model daily
create materialized view if not exists prediction.llm_usage_per_model_daily as
  select model, provider, "timestamp"::date as date,
    count(*)::integer as total_calls, sum(tokens_in)::integer as total_tokens_in,
    sum(tokens_out)::integer as total_tokens_out, sum(cost_cents)::integer as total_cost_cents
  from prediction.llm_usage_log
  group by model, provider, "timestamp"::date
with no data;

-- 5. Per-source monthly
create materialized view if not exists prediction.llm_usage_per_source_monthly as
  select a.source_id, to_char(l."timestamp", 'YYYY-MM') as year_month,
    count(*)::integer as total_calls, sum(l.tokens_in)::integer as total_tokens_in,
    sum(l.tokens_out)::integer as total_tokens_out, sum(l.cost_cents)::integer as total_cost_cents
  from prediction.llm_usage_log l
  join prediction.market_articles a on a.id = l.article_id
  group by a.source_id, to_char(l."timestamp", 'YYYY-MM')
with no data;

-- 6. Per analyst authorship monthly
create materialized view if not exists prediction.llm_usage_per_analyst_authorship_monthly as
  select analyst_author_user_id, to_char("timestamp", 'YYYY-MM') as year_month,
    count(*)::integer as total_calls, sum(tokens_in)::integer as total_tokens_in,
    sum(tokens_out)::integer as total_tokens_out, sum(cost_cents)::integer as total_cost_cents
  from prediction.llm_usage_log where analyst_author_user_id is not null
  group by analyst_author_user_id, to_char("timestamp", 'YYYY-MM')
with no data;

-- 7. Per instrument authorship monthly
create materialized view if not exists prediction.llm_usage_per_instrument_authorship_monthly as
  select instrument_author_user_id, to_char("timestamp", 'YYYY-MM') as year_month,
    count(*)::integer as total_calls, sum(tokens_in)::integer as total_tokens_in,
    sum(tokens_out)::integer as total_tokens_out, sum(cost_cents)::integer as total_cost_cents
  from prediction.llm_usage_log where instrument_author_user_id is not null
  group by instrument_author_user_id, to_char("timestamp", 'YYYY-MM')
with no data;

-- 8. Base vs extension daily
create materialized view if not exists prediction.llm_usage_base_vs_extension_daily as
  select "timestamp"::date as date,
    (analyst_author_user_id is null and instrument_author_user_id is null) as is_base,
    count(*)::integer as total_calls, sum(tokens_in)::integer as total_tokens_in,
    sum(tokens_out)::integer as total_tokens_out, sum(cost_cents)::integer as total_cost_cents
  from prediction.llm_usage_log
  group by "timestamp"::date, (analyst_author_user_id is null and instrument_author_user_id is null)
with no data;
