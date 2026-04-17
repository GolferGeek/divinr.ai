-- Effort: entity-level-performance-attribution
-- Phase 1+2: outcome_records table + 6 materialized aggregate views

create table if not exists prediction.outcome_records (
  id text primary key default gen_random_uuid()::text,
  evaluation_id text not null references prediction.prediction_horizon_evaluations(id) on delete cascade,
  prediction_id text not null,
  run_id text,
  author_user_id text,
  analyst_id text,
  instrument_id text not null,
  horizon_window integer not null,
  prediction_date timestamptz not null,
  evaluation_date timestamptz not null,
  predicted_direction text not null check (predicted_direction in ('up','down','flat')),
  actual_direction text not null check (actual_direction in ('up','down','flat')),
  was_correct boolean not null,
  confidence_at_prediction numeric,
  pnl_type text not null default 'paper' check (pnl_type in ('paper','real')),
  attribution_method text not null check (attribution_method in ('calibration','position')),
  attributable_pnl_cents bigint not null default 0,
  calibration_score numeric,
  contributing_predictor_ids jsonb not null default '[]'::jsonb,
  contributing_article_ids jsonb not null default '[]'::jsonb,
  contributing_source_keys jsonb not null default '[]'::jsonb,
  predictor_attribution_method text not null default 'lookback_window'
    check (predictor_attribution_method in ('lookback_window','explicit_link','none')),
  analyst_config_version_id text,
  instrument_config_version_id text,
  computed_at timestamptz not null default now(),
  unique (evaluation_id)
);

create index if not exists outcome_records_triple_idx
  on prediction.outcome_records (coalesce(author_user_id,'base'), analyst_id, instrument_id, evaluation_date desc);
create index if not exists outcome_records_author_idx
  on prediction.outcome_records (author_user_id, evaluation_date desc) where author_user_id is not null;
create index if not exists outcome_records_instrument_idx
  on prediction.outcome_records (instrument_id, evaluation_date desc);
create index if not exists outcome_records_eval_date_idx
  on prediction.outcome_records (evaluation_date desc);
create index if not exists outcome_records_sources_gin
  on prediction.outcome_records using gin (contributing_source_keys jsonb_path_ops);
create index if not exists outcome_records_articles_gin
  on prediction.outcome_records using gin (contributing_article_ids jsonb_path_ops);

create materialized view if not exists prediction.attribution_per_triple_monthly as
  select
    coalesce(author_user_id,'base') as triple_key_author,
    author_user_id,
    analyst_id,
    instrument_id,
    to_char(evaluation_date,'YYYY-MM') as year_month,
    count(*)::bigint as outcomes_count,
    sum(case when was_correct then 1 else 0 end)::bigint as hits_count,
    (sum(case when was_correct then 1 else 0 end)::numeric / nullif(count(*),0)) as hit_rate,
    coalesce(sum(attributable_pnl_cents),0)::bigint as total_pnl_cents,
    avg(calibration_score) as avg_calibration_score,
    avg(confidence_at_prediction) as avg_confidence
  from prediction.outcome_records
  group by 1,2,3,4,5
  with no data;
create unique index if not exists attribution_per_triple_monthly_key
  on prediction.attribution_per_triple_monthly (triple_key_author, analyst_id, instrument_id, year_month);

create materialized view if not exists prediction.attribution_per_analyst_monthly as
  select
    coalesce(author_user_id,'base') as triple_key_author,
    author_user_id,
    analyst_id,
    to_char(evaluation_date,'YYYY-MM') as year_month,
    count(*)::bigint as outcomes_count,
    sum(case when was_correct then 1 else 0 end)::bigint as hits_count,
    (sum(case when was_correct then 1 else 0 end)::numeric / nullif(count(*),0)) as hit_rate,
    coalesce(sum(attributable_pnl_cents),0)::bigint as total_pnl_cents,
    avg(calibration_score) as avg_calibration_score,
    avg(confidence_at_prediction) as avg_confidence
  from prediction.outcome_records
  where analyst_id is not null
  group by 1,2,3,4
  with no data;
create unique index if not exists attribution_per_analyst_monthly_key
  on prediction.attribution_per_analyst_monthly (triple_key_author, analyst_id, year_month);

create materialized view if not exists prediction.attribution_per_instrument_monthly as
  select
    instrument_id,
    to_char(evaluation_date,'YYYY-MM') as year_month,
    count(*)::bigint as outcomes_count,
    sum(case when was_correct then 1 else 0 end)::bigint as hits_count,
    (sum(case when was_correct then 1 else 0 end)::numeric / nullif(count(*),0)) as hit_rate,
    coalesce(sum(attributable_pnl_cents),0)::bigint as total_pnl_cents,
    avg(calibration_score) as avg_calibration_score,
    avg(confidence_at_prediction) as avg_confidence
  from prediction.outcome_records
  group by 1,2
  with no data;
create unique index if not exists attribution_per_instrument_monthly_key
  on prediction.attribution_per_instrument_monthly (instrument_id, year_month);

create materialized view if not exists prediction.attribution_per_source_monthly as
  select
    source_key,
    to_char(evaluation_date,'YYYY-MM') as year_month,
    count(*)::bigint as predictions_contributed,
    coalesce(sum(attributable_pnl_cents),0)::bigint as total_pnl_cents,
    (coalesce(sum(attributable_pnl_cents),0)::numeric / nullif(count(*),0))::bigint as avg_pnl_per_prediction_cents,
    avg(calibration_score) as avg_calibration_score
  from prediction.outcome_records,
  lateral jsonb_array_elements_text(contributing_source_keys) as source_key
  group by 1,2
  with no data;
create unique index if not exists attribution_per_source_monthly_key
  on prediction.attribution_per_source_monthly (source_key, year_month);

create materialized view if not exists prediction.attribution_per_article_lifetime as
  select
    article_id,
    count(*)::bigint as predictions_contributed,
    min(evaluation_date) as first_used_at,
    max(evaluation_date) as last_used_at,
    coalesce(sum(attributable_pnl_cents),0)::bigint as total_pnl_cents,
    avg(calibration_score) as avg_calibration_score
  from prediction.outcome_records,
  lateral jsonb_array_elements_text(contributing_article_ids) as article_id
  group by 1
  with no data;
create unique index if not exists attribution_per_article_lifetime_key
  on prediction.attribution_per_article_lifetime (article_id);

create materialized view if not exists prediction.attribution_per_author_monthly as
  select
    author_user_id,
    to_char(evaluation_date,'YYYY-MM') as year_month,
    count(*)::bigint as outcomes_count,
    sum(case when was_correct then 1 else 0 end)::bigint as hits_count,
    (sum(case when was_correct then 1 else 0 end)::numeric / nullif(count(*),0)) as hit_rate,
    coalesce(sum(attributable_pnl_cents),0)::bigint as total_pnl_cents,
    avg(calibration_score) as avg_calibration_score,
    count(distinct analyst_id) filter (where analyst_id is not null) + count(distinct instrument_id) as distinct_items_count
  from prediction.outcome_records
  where author_user_id is not null
  group by 1,2
  with no data;
create unique index if not exists attribution_per_author_monthly_key
  on prediction.attribution_per_author_monthly (author_user_id, year_month);
