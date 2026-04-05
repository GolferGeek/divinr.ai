import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';

/**
 * Manages all DDL for the prediction schema and default data seeding.
 * Extracted from MarketsService to keep schema concerns separate from business logic.
 *
 * All tables use CREATE TABLE IF NOT EXISTS + ALTER TABLE ADD COLUMN IF NOT EXISTS
 * so the schema is forward-compatible and re-entrant.
 */
@Injectable()
export class MarketsSchemaService {
  private schemaReady = false;
  private readonly logger = new Logger(MarketsSchemaService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
  ) {}

  async ensureSchema(): Promise<void> {
    if (this.schemaReady) return;

    const ddl = `
      create schema if not exists prediction;

      ${this.domainRegistryDdl()}
      ${this.instrumentsDdl()}
      ${this.orchestrationRunsDdl()}
      ${this.analystsDdl()}
      ${this.assignmentsDdl()}
      ${this.sourcesDdl()}
      ${this.articlesDdl()}
      ${this.predictorsDdl()}
      ${this.artifactsDdl()}
      ${this.predictionsDdl()}
      ${this.riskAssessmentsDdl()}
      ${this.evaluationsDdl()}
      ${this.replaysDdl()}
      ${this.analystVersioningDdl()}
      ${this.riskDimensionsDdl()}
      ${this.riskDebatesDdl()}
      ${this.learningSystemDdl()}
      ${this.portfolioSystemDdl()}
      ${this.dataSourceDdl()}
    `;

    const result = await this.db.rawQuery(ddl);
    if (result.error) {
      throw new Error(`Schema creation failed: ${result.error.message}`);
    }

    await this.seedDefaultDomains();
    await this.seedDefaultSources();
    await this.seedDefaultRiskDimensions();
    await this.seedDefaultPositionSizing();
    await this.migrateAnalystNames();
    await this.seedDataSources();
    this.schemaReady = true;
    this.logger.log('Prediction schema ready');
  }

  // ─── DDL Sections ────────────────────────────────────────────

  private domainRegistryDdl(): string {
    return `
      create table if not exists prediction.domains (
        slug text primary key,
        display_name text not null,
        description text,
        prediction_plane text not null default 'stocks',
        is_active boolean not null default true,
        created_at timestamptz not null default now()
      );

      create table if not exists prediction.universes (
        slug text primary key,
        domain_slug text not null references prediction.domains(slug),
        display_name text not null,
        description text,
        default_evaluation_horizons jsonb not null default '[1, 3, 5]'::jsonb,
        horizon_unit text not null default 'days' check (horizon_unit in ('hours', 'days', 'weeks')),
        is_active boolean not null default true,
        metadata jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
      );
    `;
  }

  private instrumentsDdl(): string {
    return `
      create table if not exists prediction.instruments (
        id text primary key,
        organization_slug text not null,
        symbol text not null,
        name text not null,
        asset_type text not null default 'stock',
        universe_slug text not null default 'stocks',
        current_state jsonb not null default '{}'::jsonb,
        is_active boolean not null default true,
        created_at timestamptz not null default now(),
        unique (organization_slug, symbol)
      );
      alter table prediction.instruments add column if not exists universe_slug text not null default 'stocks';
      alter table prediction.instruments add column if not exists current_state jsonb not null default '{}'::jsonb;
    `;
  }

  private orchestrationRunsDdl(): string {
    return `
      create table if not exists prediction.orchestration_runs (
        id text primary key,
        organization_slug text not null,
        instrument_id text not null references prediction.instruments(id) on delete cascade,
        run_type text not null check (run_type in ('risk', 'prediction')),
        status text not null check (status in ('queued', 'running', 'completed', 'failed')) default 'queued',
        requested_by text not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        started_at timestamptz,
        completed_at timestamptz,
        last_error text
      );
      alter table prediction.orchestration_runs add column if not exists started_at timestamptz;
      alter table prediction.orchestration_runs add column if not exists completed_at timestamptz;
      alter table prediction.orchestration_runs add column if not exists last_error text;

      create unique index if not exists prediction_one_queued_run_per_key_idx
      on prediction.orchestration_runs (organization_slug, instrument_id, run_type)
      where status = 'queued';
    `;
  }

  private analystsDdl(): string {
    return `
      create table if not exists prediction.market_analysts (
        id text primary key,
        organization_slug text not null,
        slug text not null,
        display_name text not null,
        persona_prompt text not null,
        is_active boolean not null default true,
        created_by text not null,
        created_at timestamptz not null default now(),
        unique (organization_slug, slug)
      );
      alter table prediction.market_analysts add column if not exists organization_slug text;
      alter table prediction.market_analysts add column if not exists slug text;
      alter table prediction.market_analysts add column if not exists display_name text;
      alter table prediction.market_analysts add column if not exists name text;
      alter table prediction.market_analysts add column if not exists persona_prompt text;
      alter table prediction.market_analysts add column if not exists is_active boolean not null default true;
      alter table prediction.market_analysts add column if not exists created_by text;
      alter table prediction.market_analysts add column if not exists created_at timestamptz not null default now();
      create unique index if not exists prediction_analysts_org_slug_unique_idx
      on prediction.market_analysts (organization_slug, slug);

      -- Expanded analyst model (Sprint 0)
      alter table prediction.market_analysts add column if not exists analyst_type text not null default 'personality';
      alter table prediction.market_analysts add column if not exists default_weight numeric not null default 1.0;
      alter table prediction.market_analysts add column if not exists tier_instructions jsonb not null default '{}'::jsonb;
      alter table prediction.market_analysts add column if not exists is_system_default boolean not null default false;
      alter table prediction.market_analysts add column if not exists is_enabled boolean not null default true;
      alter table prediction.market_analysts add column if not exists workflow_scope text not null default 'both';
      alter table prediction.market_analysts add column if not exists domain_slug text not null default 'financial';
      alter table prediction.market_analysts add column if not exists universe_slug text;
      alter table prediction.market_analysts add column if not exists updated_at timestamptz not null default now();
      alter table prediction.market_analysts add column if not exists current_config_version_id text;
      alter table prediction.market_analysts add column if not exists paper_config_version_id text;
      alter table prediction.market_analysts add column if not exists learning_enabled boolean not null default true;
      alter table prediction.market_analysts add column if not exists memory_patterns jsonb not null default '[]';
      alter table prediction.market_analysts add column if not exists memory_corrections jsonb not null default '[]';
      alter table prediction.market_analysts add column if not exists memory_instrument_notes jsonb not null default '{}';
      alter table prediction.market_analysts add column if not exists memory_calibration jsonb not null default '{}';
    `;
  }

  private assignmentsDdl(): string {
    return `
      create table if not exists prediction.market_instrument_analyst_assignments (
        organization_slug text not null,
        instrument_id text not null references prediction.instruments(id) on delete cascade,
        analyst_id text not null,
        assigned_by text not null,
        created_at timestamptz not null default now(),
        primary key (organization_slug, instrument_id, analyst_id)
      );
      alter table prediction.market_instrument_analyst_assignments add column if not exists weight_override numeric;
      alter table prediction.market_instrument_analyst_assignments add column if not exists organization_slug text;
      alter table prediction.market_instrument_analyst_assignments add column if not exists instrument_id text;
      alter table prediction.market_instrument_analyst_assignments add column if not exists analyst_id text;
      alter table prediction.market_instrument_analyst_assignments add column if not exists assigned_by text;
      alter table prediction.market_instrument_analyst_assignments add column if not exists created_at timestamptz not null default now();
    `;
  }

  private sourcesDdl(): string {
    return `
      create table if not exists prediction.source_catalog (
        id text primary key,
        source_key text not null unique,
        display_name text not null,
        base_url text,
        tier text not null default 'standard',
        is_global_default boolean not null default false,
        created_at timestamptz not null default now()
      );
      alter table prediction.source_catalog add column if not exists source_key text;
      alter table prediction.source_catalog add column if not exists display_name text;
      alter table prediction.source_catalog add column if not exists base_url text;
      alter table prediction.source_catalog add column if not exists tier text not null default 'standard';
      alter table prediction.source_catalog add column if not exists is_global_default boolean not null default false;
      alter table prediction.source_catalog add column if not exists created_at timestamptz not null default now();
      alter table prediction.source_catalog add column if not exists source_origin text not null default 'divinr';
      alter table prediction.source_catalog add column if not exists external_source_id text;
      alter table prediction.source_catalog add column if not exists domain_slug text not null default 'financial';
      alter table prediction.source_catalog add column if not exists universe_slug text;
      alter table prediction.source_catalog add column if not exists source_type text not null default 'rss';
      alter table prediction.source_catalog add column if not exists crawl_frequency_minutes int not null default 15;
      alter table prediction.source_catalog add column if not exists last_crawled_at timestamptz;
      alter table prediction.source_catalog add column if not exists last_crawl_error text;
      create unique index if not exists prediction_source_origin_external_id_unique_idx
      on prediction.source_catalog (source_origin, external_source_id)
      where external_source_id is not null;
    `;
  }

  private articlesDdl(): string {
    return `
      create table if not exists prediction.market_articles (
        id text primary key,
        external_article_id text not null unique,
        external_source_id text not null,
        source_id text not null references prediction.source_catalog(id) on delete cascade,
        source_origin text not null default 'orchestrator_crawler',
        external_organization_slug text not null,
        title text,
        url text not null,
        summary text,
        author text,
        content text,
        content_hash text,
        published_at timestamptz,
        first_seen_at timestamptz not null default now(),
        metadata jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create index if not exists prediction_market_articles_source_id_idx on prediction.market_articles(source_id);
      create index if not exists prediction_market_articles_published_idx on prediction.market_articles(published_at desc);
      create index if not exists prediction_market_articles_external_org_idx on prediction.market_articles(external_organization_slug);

      -- Allow null external_organization_slug for Divinr-native articles
      alter table prediction.market_articles alter column external_organization_slug drop not null;
    `;
  }

  private predictorsDdl(): string {
    return `
      create table if not exists prediction.market_predictors (
        id text primary key,
        organization_slug text not null,
        instrument_id text not null references prediction.instruments(id) on delete cascade,
        article_id text not null references prediction.market_articles(id) on delete cascade,
        relevance_score numeric not null check (relevance_score >= 0 and relevance_score <= 1),
        status text not null check (status in ('active', 'dismissed')) default 'active',
        rationale text,
        created_by text not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (organization_slug, instrument_id, article_id)
      );
      create index if not exists prediction_market_predictors_instrument_status_idx
      on prediction.market_predictors (organization_slug, instrument_id, status);

      -- Allow 'expired' status for predictor TTL expiration
      alter table prediction.market_predictors drop constraint if exists market_predictors_status_check;
      alter table prediction.market_predictors add constraint market_predictors_status_check
        check (status in ('active', 'dismissed', 'expired'));

      -- Per-analyst article scoring: add scored_by_analyst_id and update unique constraint
      alter table prediction.market_predictors add column if not exists scored_by_analyst_id text;

      -- Replace original unique constraint with per-analyst version
      -- (original: organization_slug, instrument_id, article_id)
      -- (new: organization_slug, instrument_id, article_id, scored_by_analyst_id)
      drop index if exists prediction.market_predictors_organization_slug_instrument_id_article_key;
      create unique index if not exists market_predictors_org_instrument_article_analyst_key
        on prediction.market_predictors (organization_slug, instrument_id, article_id, scored_by_analyst_id);
    `;
  }

  private artifactsDdl(): string {
    return `
      create table if not exists prediction.market_run_artifacts (
        id text primary key,
        run_id text not null references prediction.orchestration_runs(id) on delete cascade,
        organization_slug text not null,
        run_type text not null check (run_type in ('risk', 'prediction')),
        analyst_id text,
        model_provider text not null,
        model_name text not null,
        prompt text not null,
        output_text text not null,
        created_at timestamptz not null default now()
      );
      alter table prediction.market_run_artifacts add column if not exists role text not null default 'analyst';
    `;
  }

  private predictionsDdl(): string {
    return `
      create table if not exists prediction.market_predictions (
        id text primary key,
        run_id text not null references prediction.orchestration_runs(id) on delete cascade,
        organization_slug text not null,
        instrument_id text not null references prediction.instruments(id) on delete cascade,
        predicted_direction text not null check (predicted_direction in ('up', 'down', 'flat')),
        confidence numeric not null,
        horizon_minutes integer not null,
        rationale text not null,
        created_at timestamptz not null default now()
      );
      alter table prediction.market_predictions add column if not exists analyst_id text;
      alter table prediction.market_predictions add column if not exists role text not null default 'analyst';
      alter table prediction.market_predictions add column if not exists lineage_json jsonb;
      alter table prediction.market_predictions add column if not exists key_factors jsonb not null default '[]'::jsonb;
      alter table prediction.market_predictions add column if not exists risks jsonb not null default '[]'::jsonb;
      alter table prediction.market_predictions add column if not exists config_version_id text;
      alter table prediction.market_predictions add column if not exists is_paper boolean not null default false;

      create unique index if not exists prediction_market_predictions_run_analyst_idx
      on prediction.market_predictions (run_id, analyst_id)
      where analyst_id is not null and role = 'analyst';

      create unique index if not exists prediction_market_predictions_run_arbitrator_idx
      on prediction.market_predictions (run_id)
      where role = 'arbitrator';
    `;
  }

  private riskAssessmentsDdl(): string {
    return `
      create table if not exists prediction.market_risk_assessments (
        id text primary key,
        run_id text not null references prediction.orchestration_runs(id) on delete cascade,
        organization_slug text not null,
        instrument_id text not null references prediction.instruments(id) on delete cascade,
        risk_score numeric not null,
        verdict text not null check (verdict in ('low', 'medium', 'high')),
        rationale text not null,
        created_at timestamptz not null default now()
      );
      alter table prediction.market_risk_assessments add column if not exists analyst_id text;
      alter table prediction.market_risk_assessments add column if not exists role text not null default 'composite';
    `;
  }

  private evaluationsDdl(): string {
    return `
      create table if not exists prediction.market_run_evaluations (
        id text primary key,
        run_id text not null references prediction.orchestration_runs(id) on delete cascade,
        organization_slug text not null,
        actual_direction text not null check (actual_direction in ('up', 'down', 'flat')),
        predicted_direction text check (predicted_direction in ('up', 'down', 'flat')),
        was_correct boolean,
        notes text,
        created_at timestamptz not null default now()
      );
    `;
  }

  private replaysDdl(): string {
    return `
      create table if not exists prediction.market_run_replays (
        id text primary key,
        run_id text not null references prediction.orchestration_runs(id) on delete cascade,
        organization_slug text not null,
        scenario text not null,
        replay_output text not null,
        created_at timestamptz not null default now()
      );
    `;
  }

  // ─── Sprint 1: Analyst Versioning ────────────────────────────

  private analystVersioningDdl(): string {
    return `
      create table if not exists prediction.analyst_config_versions (
        id text primary key,
        analyst_id text not null,
        organization_slug text not null,
        version_number integer not null default 1,
        persona_prompt text not null,
        tier_instructions jsonb not null default '{}'::jsonb,
        default_weight numeric not null default 1.0,
        config_overrides jsonb not null default '{}'::jsonb,
        source text not null default 'manual' check (source in ('manual', 'tier1_auto', 'tier2_approved', 'tier3_strategic')),
        change_reason text,
        parent_version_id text,
        canonical_test_score integer,
        is_active boolean not null default true,
        created_by text not null,
        created_at timestamptz not null default now()
      );
      create index if not exists prediction_analyst_config_versions_analyst_idx
      on prediction.analyst_config_versions (analyst_id, is_active);
    `;
  }

  // ─── Sprint 1: Risk Dimensions + Debates ─────────────────────

  private riskDimensionsDdl(): string {
    return `
      create table if not exists prediction.risk_dimensions (
        id text primary key,
        organization_slug text not null,
        domain_slug text not null default 'financial',
        slug text not null,
        name text not null,
        description text,
        weight numeric(3,2) not null default 0.25 check (weight >= 0 and weight <= 2),
        display_order integer not null default 0,
        is_active boolean not null default true,
        system_prompt text,
        output_schema jsonb not null default '{"type":"object","properties":{"score":{"type":"integer","minimum":0,"maximum":100},"confidence":{"type":"number","minimum":0,"maximum":1},"reasoning":{"type":"string"},"evidence":{"type":"array","items":{"type":"string"}}},"required":["score","confidence","reasoning"]}'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (organization_slug, slug)
      );

      create table if not exists prediction.risk_dimension_assessments (
        id text primary key,
        run_id text not null references prediction.orchestration_runs(id) on delete cascade,
        organization_slug text not null,
        instrument_id text not null references prediction.instruments(id) on delete cascade,
        dimension_id text not null,
        score integer not null check (score >= 0 and score <= 100),
        confidence numeric(3,2) not null check (confidence >= 0 and confidence <= 1),
        reasoning text not null,
        evidence jsonb not null default '[]'::jsonb,
        signals jsonb not null default '[]'::jsonb,
        model_provider text,
        model_name text,
        created_at timestamptz not null default now()
      );
      create index if not exists prediction_risk_dim_assessments_run_idx on prediction.risk_dimension_assessments (run_id);
      create index if not exists prediction_risk_dim_assessments_instrument_idx on prediction.risk_dimension_assessments (organization_slug, instrument_id);

      create table if not exists prediction.risk_composite_scores (
        id text primary key,
        run_id text not null references prediction.orchestration_runs(id) on delete cascade,
        organization_slug text not null,
        instrument_id text not null references prediction.instruments(id) on delete cascade,
        overall_score integer not null check (overall_score >= 0 and overall_score <= 100),
        dimension_scores jsonb not null default '{}'::jsonb,
        debate_id text,
        debate_adjustment integer not null default 0,
        pre_debate_score integer check (pre_debate_score >= 0 and pre_debate_score <= 100),
        confidence numeric(3,2) not null check (confidence >= 0 and confidence <= 1),
        status text not null default 'active' check (status in ('active', 'superseded')),
        created_at timestamptz not null default now()
      );
      create index if not exists prediction_risk_composite_instrument_idx
      on prediction.risk_composite_scores (organization_slug, instrument_id, status)
      where status = 'active';
      create index if not exists prediction_risk_composite_run_idx on prediction.risk_composite_scores (run_id);
    `;
  }

  private riskDebatesDdl(): string {
    return `
      create table if not exists prediction.risk_debates (
        id text primary key,
        run_id text not null references prediction.orchestration_runs(id) on delete cascade,
        organization_slug text not null,
        instrument_id text not null references prediction.instruments(id) on delete cascade,
        composite_score_id text,
        blue_assessment jsonb not null default '{}'::jsonb,
        red_challenges jsonb not null default '{}'::jsonb,
        arbiter_synthesis jsonb not null default '{}'::jsonb,
        original_score integer check (original_score >= 0 and original_score <= 100),
        final_score integer check (final_score >= 0 and final_score <= 100),
        score_adjustment integer not null default 0 check (score_adjustment >= -30 and score_adjustment <= 30),
        transcript jsonb not null default '[]'::jsonb,
        status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed', 'failed')),
        created_at timestamptz not null default now(),
        completed_at timestamptz
      );
      create index if not exists prediction_risk_debates_run_idx on prediction.risk_debates (run_id);

      create table if not exists prediction.risk_debate_contexts (
        id text primary key,
        organization_slug text not null,
        domain_slug text not null default 'financial',
        role text not null check (role in ('blue', 'red', 'arbiter')),
        version integer not null default 1,
        system_prompt text not null,
        is_active boolean not null default true,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (organization_slug, role, version)
      );
    `;
  }

  // ─── Sprint 1: Learning System ───────────────────────────────

  private learningSystemDdl(): string {
    return `
      create table if not exists prediction.prediction_horizon_evaluations (
        id text primary key,
        prediction_id text not null,
        run_id text not null,
        organization_slug text not null,
        instrument_id text not null,
        analyst_id text,
        horizon_window integer not null,
        prediction_date timestamptz not null,
        evaluation_date timestamptz not null,
        predicted_direction text not null check (predicted_direction in ('up', 'down', 'flat')),
        actual_direction text not null check (actual_direction in ('up', 'down', 'flat')),
        actual_outcome_data jsonb not null default '{}'::jsonb,
        was_correct boolean not null,
        confidence_at_prediction numeric,
        created_at timestamptz not null default now()
      );
      create index if not exists prediction_horizon_evals_prediction_idx on prediction.prediction_horizon_evaluations (prediction_id);
      create index if not exists prediction_horizon_evals_analyst_idx on prediction.prediction_horizon_evaluations (analyst_id, organization_slug);

      create table if not exists prediction.analyst_performance_profiles (
        id text primary key,
        analyst_id text not null,
        organization_slug text not null,
        instrument_id text,
        horizon_window integer not null,
        period text not null check (period in ('7d', '30d', 'all')),
        accuracy_rate numeric,
        avg_confidence numeric,
        calibration_score numeric,
        systematic_biases jsonb not null default '{}'::jsonb,
        sample_size integer not null default 0,
        computed_at timestamptz not null default now()
      );
      create index if not exists prediction_perf_profiles_analyst_idx on prediction.analyst_performance_profiles (analyst_id, organization_slug);

      create table if not exists prediction.canonical_test_days (
        id text primary key,
        instrument_id text not null,
        organization_slug text not null,
        universe_slug text not null default 'stocks',
        canonical_date date not null,
        failure_classification text not null,
        articles_snapshot jsonb not null default '[]'::jsonb,
        predictor_state_snapshot jsonb not null default '[]'::jsonb,
        risk_analysis_snapshot jsonb not null default '{}'::jsonb,
        risk_config_snapshot jsonb not null default '{}'::jsonb,
        analyst_config_snapshot jsonb not null default '{}'::jsonb,
        original_prediction jsonb not null default '{}'::jsonb,
        original_risk_assessment jsonb not null default '{}'::jsonb,
        actual_outcome jsonb not null default '{}'::jsonb,
        test_scope text not null default 'both' check (test_scope in ('prediction', 'risk', 'both')),
        is_active boolean not null default true,
        added_at timestamptz not null default now(),
        retired_at timestamptz,
        added_by text not null
      );
      create index if not exists prediction_canonical_days_instrument_idx
      on prediction.canonical_test_days (organization_slug, instrument_id, is_active)
      where is_active = true;

      create table if not exists prediction.learning_proposals (
        id text primary key,
        organization_slug text not null,
        tier integer not null check (tier in (1, 2, 3)),
        analyst_id text,
        instrument_id text,
        proposal_type text not null,
        description text not null,
        rationale text not null,
        proposed_change jsonb not null default '{}'::jsonb,
        canonical_test_results jsonb,
        net_score integer,
        has_severity_regression boolean,
        status text not null default 'proposed' check (status in ('proposed', 'testing', 'passed', 'failed', 'approved', 'rejected', 'applied', 'reverted')),
        proposed_at timestamptz not null default now(),
        tested_at timestamptz,
        reviewed_by text,
        reviewed_at timestamptz,
        applied_at timestamptz
      );
      create index if not exists prediction_learning_proposals_org_idx on prediction.learning_proposals (organization_slug, status);

      create table if not exists prediction.learning_reports (
        id text primary key,
        report_type text not null check (report_type in ('nightly_evaluation', 'learning_cycle')),
        report_date date not null default current_date,
        summary jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
      );
      create index if not exists prediction_learning_reports_date_idx on prediction.learning_reports (report_date desc);

      create table if not exists prediction.org_learning_config (
        organization_slug text primary key,
        max_confidence_shift numeric not null default 15,
        max_weight_shift numeric not null default 0.2,
        paper_mode_duration_days integer not null default 3,
        locked_persona_aspects jsonb not null default '[]'::jsonb,
        updated_at timestamptz not null default now()
      );
    `;
  }

  // ─── Seeding ─────────────────────────────────────────────────

  private async seedDefaultDomains(): Promise<void> {
    const seedSql = `
      insert into prediction.domains (slug, display_name, description, prediction_plane, is_active)
      values
        ('financial', 'Financial Markets', 'Stocks, crypto, commodities', 'stocks', true),
        ('betting', 'Betting Markets', 'Sports, prediction markets, props', 'sports', false),
        ('elections', 'Election Coverage', 'US and international elections', 'elections', false)
      on conflict (slug) do nothing;

      insert into prediction.universes (slug, domain_slug, display_name, description, default_evaluation_horizons, horizon_unit, is_active)
      values
        ('stocks', 'financial', 'Stocks', 'Equities and stock market instruments', '[1, 3, 5]'::jsonb, 'days', true),
        ('crypto', 'financial', 'Crypto', 'Cryptocurrency instruments', '[1, 3, 5]'::jsonb, 'days', false),
        ('commodities', 'financial', 'Commodities', 'Gold, oil, natural gas', '[1, 3, 5]'::jsonb, 'days', false),
        ('polymarket', 'betting', 'Prediction Markets', 'Polymarket, Kalshi contracts', '[1, 3, 5]'::jsonb, 'days', false),
        ('nfl', 'betting', 'NFL', 'NFL games and props', '[1]'::jsonb, 'days', false),
        ('mlb', 'betting', 'MLB', 'MLB games and props', '[1]'::jsonb, 'days', false),
        ('us-2028-pres', 'elections', 'US 2028 Presidential', 'State and national races', '[7, 3, 1]'::jsonb, 'days', false),
        ('us-2026-mid', 'elections', 'US 2026 Midterms', 'Senate, House, Governor races', '[7, 3, 1]'::jsonb, 'days', false),
        ('eu-elections', 'elections', 'European Elections', 'UK, France, Germany, EU Parliament', '[7, 3, 1]'::jsonb, 'days', false)
      on conflict (slug) do nothing;
    `;
    const result = await this.db.rawQuery(seedSql);
    if (result.error) throw new Error(result.error.message);
  }

  private async seedDefaultSources(): Promise<void> {
    const seedSql = `
      insert into prediction.source_catalog
        (id, source_key, display_name, base_url, tier, is_global_default, domain_slug)
      values
        ('source_marketwatch', 'marketwatch', 'MarketWatch', 'https://www.marketwatch.com', 'standard', true, 'financial'),
        ('source_reuters', 'reuters', 'Reuters', 'https://www.reuters.com', 'premium', true, 'financial')
      on conflict (id) do update
      set source_key = excluded.source_key,
          display_name = excluded.display_name,
          base_url = excluded.base_url,
          tier = excluded.tier,
          is_global_default = excluded.is_global_default;
    `;
    const result = await this.db.rawQuery(seedSql);
    if (result.error) throw new Error(result.error.message);
  }

  private async seedDefaultRiskDimensions(): Promise<void> {
    // Default risk dimensions are seeded globally with a placeholder org.
    // Per-org dimensions are created by the seed script or tenant setup.
    // These serve as templates.
    const seedSql = `
      insert into prediction.risk_dimensions
        (id, organization_slug, domain_slug, slug, name, description, weight, display_order, system_prompt)
      values
        ('dim_market_template', '__template__', 'financial', 'market', 'Market Risk',
         'Overall market conditions, sector rotation, volatility regime', 0.30, 1,
         'Analyze the market risk for this instrument. Consider: overall market conditions, sector performance, volatility indicators, and correlation with major indices. Score 0 (no risk) to 100 (extreme risk).'),
        ('dim_fundamental_template', '__template__', 'financial', 'fundamental', 'Fundamental Risk',
         'Balance sheet, earnings quality, valuation risk', 0.30, 2,
         'Analyze the fundamental risk for this instrument. Consider: earnings quality, revenue sustainability, debt levels, valuation relative to peers, and competitive position. Score 0 (no risk) to 100 (extreme risk).'),
        ('dim_technical_template', '__template__', 'financial', 'technical', 'Technical Risk',
         'Chart breakdown risk, support/resistance, momentum exhaustion', 0.20, 3,
         'Analyze the technical risk for this instrument. Consider: proximity to support/resistance, trend exhaustion signals, volume divergence, and pattern breakdown risk. Score 0 (no risk) to 100 (extreme risk).'),
        ('dim_macro_template', '__template__', 'financial', 'macro', 'Macro Risk',
         'Interest rates, inflation, geopolitical, central bank policy', 0.20, 4,
         'Analyze the macro risk for this instrument. Consider: interest rate trajectory, inflation trends, geopolitical risks, central bank policy signals, and currency impacts. Score 0 (no risk) to 100 (extreme risk).')
      on conflict (id) do nothing;
    `;
    const result = await this.db.rawQuery(seedSql);
    if (result.error) throw new Error(result.error.message);
  }

  private async seedDefaultPositionSizing(): Promise<void> {
    const seedSql = `
      insert into prediction.position_sizing_config
        (id, organization_slug, tier_name, min_confidence, max_confidence, position_percent)
      values
        ('sizing_global_low', '*', 'low', 60, 70, 0.05),
        ('sizing_global_medium', '*', 'medium', 70, 80, 0.10),
        ('sizing_global_high', '*', 'high', 80, 100, 0.15)
      on conflict (id) do nothing;
    `;
    const result = await this.db.rawQuery(seedSql);
    if (result.error) throw new Error(result.error.message);
  }

  // ─── Sprint 8: Portfolio System ──────────────────────────────

  private portfolioSystemDdl(): string {
    return `
      create table if not exists prediction.analyst_portfolios (
        id text primary key,
        analyst_id text not null,
        organization_slug text not null,
        initial_balance numeric not null default 1000000,
        current_balance numeric not null default 1000000,
        total_realized_pnl numeric not null default 0,
        total_unrealized_pnl numeric not null default 0,
        win_count integer not null default 0,
        loss_count integer not null default 0,
        status text not null default 'active' check (status in ('active', 'warning', 'probation', 'suspended')),
        status_changed_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      alter table prediction.analyst_portfolios add column if not exists organization_slug text not null default '*';
      alter table prediction.analyst_portfolios add column if not exists initial_balance numeric not null default 1000000;
      alter table prediction.analyst_portfolios add column if not exists current_balance numeric not null default 1000000;
      alter table prediction.analyst_portfolios add column if not exists total_realized_pnl numeric not null default 0;
      alter table prediction.analyst_portfolios add column if not exists total_unrealized_pnl numeric not null default 0;
      alter table prediction.analyst_portfolios add column if not exists win_count integer not null default 0;
      alter table prediction.analyst_portfolios add column if not exists loss_count integer not null default 0;
      alter table prediction.analyst_portfolios add column if not exists status text not null default 'active';
      alter table prediction.analyst_portfolios add column if not exists status_changed_at timestamptz;
      create index if not exists prediction_analyst_portfolios_analyst_idx
      on prediction.analyst_portfolios (analyst_id, organization_slug);

      create table if not exists prediction.analyst_positions (
        id text primary key,
        portfolio_id text not null,
        analyst_id text not null,
        organization_slug text not null,
        prediction_id text,
        instrument_id text not null,
        symbol text not null,
        direction text not null check (direction in ('long', 'short')),
        quantity integer not null,
        entry_price numeric not null,
        current_price numeric not null,
        exit_price numeric,
        unrealized_pnl numeric not null default 0,
        realized_pnl numeric,
        is_paper_only boolean not null default false,
        status text not null default 'open' check (status in ('open', 'closed')),
        opened_at timestamptz not null default now(),
        closed_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      alter table prediction.analyst_positions add column if not exists organization_slug text not null default '*';
      alter table prediction.analyst_positions add column if not exists direction text not null default 'long';
      alter table prediction.analyst_positions add column if not exists quantity integer not null default 0;
      alter table prediction.analyst_positions add column if not exists entry_price numeric not null default 0;
      alter table prediction.analyst_positions add column if not exists current_price numeric not null default 0;
      alter table prediction.analyst_positions add column if not exists exit_price numeric;
      alter table prediction.analyst_positions add column if not exists unrealized_pnl numeric not null default 0;
      alter table prediction.analyst_positions add column if not exists realized_pnl numeric;
      alter table prediction.analyst_positions add column if not exists is_paper_only boolean not null default false;
      create index if not exists prediction_analyst_positions_portfolio_idx
      on prediction.analyst_positions (portfolio_id, status);
      create index if not exists prediction_analyst_positions_prediction_idx
      on prediction.analyst_positions (prediction_id);

      alter table prediction.user_portfolios add column if not exists organization_slug text not null default '*';
      alter table prediction.user_portfolios add column if not exists initial_balance numeric not null default 1000000;
      alter table prediction.user_portfolios add column if not exists current_balance numeric not null default 1000000;
      alter table prediction.user_portfolios add column if not exists total_realized_pnl numeric not null default 0;
      alter table prediction.user_portfolios add column if not exists total_unrealized_pnl numeric not null default 0;

      create table if not exists prediction.user_portfolios (
        id text primary key,
        user_id text not null,
        organization_slug text not null,
        initial_balance numeric not null default 1000000,
        current_balance numeric not null default 1000000,
        total_realized_pnl numeric not null default 0,
        total_unrealized_pnl numeric not null default 0,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (user_id, organization_slug)
      );

      alter table prediction.user_positions add column if not exists organization_slug text not null default '*';
      alter table prediction.user_positions add column if not exists direction text not null default 'long';
      alter table prediction.user_positions add column if not exists quantity integer not null default 0;
      alter table prediction.user_positions add column if not exists entry_price numeric not null default 0;
      alter table prediction.user_positions add column if not exists current_price numeric not null default 0;

      create table if not exists prediction.user_positions (
        id text primary key,
        portfolio_id text not null,
        user_id text not null,
        organization_slug text not null,
        prediction_id text,
        instrument_id text not null,
        symbol text not null,
        direction text not null check (direction in ('long', 'short')),
        quantity integer not null,
        entry_price numeric not null,
        current_price numeric not null,
        exit_price numeric,
        unrealized_pnl numeric not null default 0,
        realized_pnl numeric,
        status text not null default 'open' check (status in ('open', 'closed')),
        opened_at timestamptz not null default now(),
        closed_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create index if not exists prediction_user_positions_portfolio_idx
      on prediction.user_positions (portfolio_id, status);

      alter table prediction.user_trade_queue add column if not exists organization_slug text not null default '*';

      create table if not exists prediction.user_trade_queue (
        id text primary key,
        user_id text not null,
        organization_slug text not null,
        portfolio_id text not null,
        prediction_id text not null,
        instrument_id text not null,
        symbol text not null,
        direction text not null check (direction in ('long', 'short')),
        quantity integer not null,
        status text not null default 'queued' check (status in ('queued', 'executed', 'cancelled')),
        executed_position_id text,
        execution_price numeric,
        executed_at timestamptz,
        queued_at timestamptz not null default now(),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create index if not exists prediction_user_trade_queue_status_idx
      on prediction.user_trade_queue (user_id, organization_slug, status)
      where status = 'queued';

      create table if not exists prediction.eod_settlement_log (
        id text primary key,
        organization_slug text,
        settlement_date date not null default current_date,
        queued_trades_executed integer not null default 0,
        analyst_positions_created integer not null default 0,
        predictions_resolved integer not null default 0,
        positions_closed integer not null default 0,
        unrealized_pnl_updated integer not null default 0,
        total_realized_pnl numeric not null default 0,
        errors jsonb not null default '[]'::jsonb,
        started_at timestamptz not null default now(),
        completed_at timestamptz,
        duration_ms integer
      );

      create table if not exists prediction.position_sizing_config (
        id text primary key,
        organization_slug text not null default '*',
        tier_name text not null,
        min_confidence numeric not null,
        max_confidence numeric not null,
        position_percent numeric not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (organization_slug, tier_name)
      );
    `;
  }

  // ─── Analyst Intelligence Platform ─────────────────────────────

  private dataSourceDdl(): string {
    return `
      create table if not exists prediction.data_source_registry (
        id text primary key,
        name text not null,
        provider_type text not null check (provider_type in ('api', 'crawler', 'computed')) default 'api',
        base_url text,
        api_key_env_var text,
        tier text not null default 'free' check (tier in ('free', 'paid')),
        rate_limit_per_minute int not null default 60,
        cache_ttl_seconds int not null default 900,
        is_active boolean not null default true,
        created_at timestamptz not null default now()
      );

      create table if not exists prediction.analyst_source_assignments (
        id text primary key default gen_random_uuid()::text,
        analyst_id text not null,
        source_id text not null references prediction.data_source_registry(id),
        data_types text[] not null default '{}',
        priority int not null default 0,
        is_active boolean not null default true,
        unique(analyst_id, source_id)
      );

      alter table prediction.market_predictions
        add column if not exists source_context jsonb not null default '{}';

      create table if not exists prediction.analyst_risk_assessments (
        id text primary key default gen_random_uuid()::text,
        run_id text not null,
        organization_slug text not null,
        instrument_id text not null,
        analyst_id text not null,
        score int not null check (score >= 0 and score <= 100),
        confidence numeric not null check (confidence >= 0 and confidence <= 1),
        reasoning text,
        evidence jsonb default '[]',
        source_data jsonb default '{}',
        model_provider text,
        model_name text,
        created_at timestamptz not null default now()
      );
      create index if not exists prediction_analyst_risk_assessments_run_idx
        on prediction.analyst_risk_assessments (run_id);
      create index if not exists prediction_analyst_risk_assessments_instrument_idx
        on prediction.analyst_risk_assessments (organization_slug, instrument_id);
    `;
  }

  private async migrateAnalystNames(): Promise<void> {
    const migrations = [
      { oldSlug: 'technical-tina', newSlug: 'technical-analyst', newName: 'Technical Analyst', newPrompt: null },
      { oldSlug: 'fundamental-fred', newSlug: 'fundamentals-analyst', newName: 'Fundamentals Analyst', newPrompt: null },
      { oldSlug: 'sentiment-sally', newSlug: 'sentiment-analyst', newName: 'Sentiment Analyst', newPrompt: null },
      { oldSlug: 'aggressive-alex', newSlug: 'momentum-analyst', newName: 'Momentum Analyst', newPrompt: null },
      {
        oldSlug: 'cautious-carl',
        newSlug: 'macro-strategist',
        newName: 'Macro Strategist',
        newPrompt: 'You are a Macro Strategist, focused on macroeconomic indicators, central bank policy, and cross-asset analysis. Focus on: interest rates, inflation data, employment figures, Fed policy signals, yield curves, sector rotation, and geopolitical risks. You assess how macro forces create tailwinds or headwinds for individual instruments.',
      },
    ];

    for (const m of migrations) {
      const sql = m.newPrompt
        ? `update prediction.market_analysts set slug = $1, display_name = $2, persona_prompt = $3 where slug = $4`
        : `update prediction.market_analysts set slug = $1, display_name = $2 where slug = $3`;
      const params = m.newPrompt
        ? [m.newSlug, m.newName, m.newPrompt, m.oldSlug]
        : [m.newSlug, m.newName, m.oldSlug];
      await this.db.rawQuery(sql, params);
    }
  }

  private async seedDataSources(): Promise<void> {
    const seedSql = `
      insert into prediction.data_source_registry
        (id, name, provider_type, base_url, api_key_env_var, tier, rate_limit_per_minute, cache_ttl_seconds, is_active)
      values
        ('ds-twelve-data', 'Twelve Data', 'api', 'https://api.twelvedata.com', 'TWELVE_DATA_API_KEY', 'free', 8, 900, true),
        ('ds-fmp', 'Financial Modeling Prep', 'api', 'https://financialmodelingprep.com/api/v3', 'FMP_API_KEY', 'free', 4, 86400, true),
        ('ds-sec-edgar', 'SEC EDGAR', 'api', 'https://data.sec.gov', null, 'free', 600, 86400, true),
        ('ds-finnhub', 'Finnhub', 'api', 'https://finnhub.io/api/v1', 'FINNHUB_API_KEY', 'free', 60, 1800, true),
        ('ds-fred', 'FRED', 'api', 'https://api.stlouisfed.org/fred', 'FRED_API_KEY', 'free', 120, 3600, true),
        ('ds-polygon', 'Polygon.io', 'api', 'https://api.polygon.io', 'POLYGON_API_KEY', 'free', 5, 900, true),
        ('ds-reddit', 'Reddit', 'crawler', 'https://www.reddit.com', null, 'free', 100, 1800, true)
      on conflict (id) do nothing;
    `;
    const result = await this.db.rawQuery(seedSql);
    if (result.error) {
      this.logger.warn(`Failed to seed data sources: ${result.error.message}`);
      return;
    }

    // Seed analyst-source assignments
    // We need analyst IDs — look them up by slug for __base__
    const assignmentsSql = `
      insert into prediction.analyst_source_assignments (id, analyst_id, source_id, data_types, priority)
      select
        gen_random_uuid()::text,
        ma.id,
        ds.id,
        v.data_types,
        v.priority
      from (values
        ('technical-analyst', 'ds-twelve-data', ARRAY['rsi','macd','sma','ema','bbands'], 1),
        ('technical-analyst', 'ds-polygon', ARRAY['ohlcv','volume'], 2),
        ('fundamentals-analyst', 'ds-fmp', ARRAY['ratios','earnings','income-statement'], 1),
        ('fundamentals-analyst', 'ds-sec-edgar', ARRAY['filings','financials'], 2),
        ('sentiment-analyst', 'ds-finnhub', ARRAY['recommendations','insider-transactions','price-targets'], 1),
        ('sentiment-analyst', 'ds-reddit', ARRAY['posts'], 2),
        ('macro-strategist', 'ds-fred', ARRAY['yield-curve','cpi','unemployment','vix','gdp','fed-funds'], 1),
        ('momentum-analyst', 'ds-twelve-data', ARRAY['roc'], 1),
        ('momentum-analyst', 'ds-fmp', ARRAY['earnings-surprise','sector-performance'], 2),
        ('momentum-analyst', 'ds-polygon', ARRAY['volume','ohlcv'], 3)
      ) as v(analyst_slug, source_id, data_types, priority)
      join prediction.market_analysts ma on ma.slug = v.analyst_slug and ma.organization_slug = '__base__'
      join prediction.data_source_registry ds on ds.id = v.source_id
      on conflict (analyst_id, source_id) do nothing;
    `;
    const aResult = await this.db.rawQuery(assignmentsSql);
    if (aResult.error) {
      this.logger.warn(`Failed to seed analyst-source assignments: ${aResult.error.message}`);
    }
  }
}
