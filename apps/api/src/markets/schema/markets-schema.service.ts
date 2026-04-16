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

      -- Dead table cleanup: drop legacy tables superseded by market_analysts / analyst_config_versions
      drop table if exists prediction.analyst_context_versions cascade;
      drop table if exists prediction.analysts cascade;

      ${this.domainRegistryDdl()}
      ${this.instrumentsDdl()}
      ${this.orchestrationRunsDdl()}
      ${this.analystsDdl()}
      ${this.assignmentsDdl()}
      ${this.sourcesDdl()}
      ${this.articlesDdl()}
      ${this.predictorsDdl()}
      ${this.articleInstrumentRelevanceDdl()}
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
      ${this.tradeDecisionsDdl()}
      ${this.portfolioFoundationDdl()}
      ${this.auditFindingsDdl()}
      ${this.userScopingMigrationDdl()}
      ${this.affinityDdl()}
      ${this.notificationsDdl()}
      ${this.fearGreedAlertsDdl()}
      ${this.coordinationDdl()}
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
    await this.seedPortfolioManagerAnalyst();
    await this.seedPortfolioFoundation();
    await this.dropOrganizationSlugColumns();
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
        symbol text not null,
        name text not null,
        asset_type text not null default 'stock',
        universe_slug text not null default 'stocks',
        current_state jsonb not null default '{}'::jsonb,
        is_active boolean not null default true,
        created_at timestamptz not null default now()
      );
      alter table prediction.instruments add column if not exists universe_slug text not null default 'stocks';
      alter table prediction.instruments add column if not exists current_state jsonb not null default '{}'::jsonb;
      create unique index if not exists instruments_symbol_unique_idx on prediction.instruments (symbol);
    `;
  }

  private orchestrationRunsDdl(): string {
    return `
      create table if not exists prediction.orchestration_runs (
        id text primary key,
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

      -- Replace old org-scoped dedup index with user-scoped version
      drop index if exists prediction.prediction_one_queued_run_per_key_idx;
      create unique index if not exists prediction_one_queued_run_per_key_idx
      on prediction.orchestration_runs (instrument_id, run_type)
      where status = 'queued';
    `;
  }

  private analystsDdl(): string {
    return `
      create table if not exists prediction.market_analysts (
        id text primary key,
        slug text not null,
        display_name text not null,
        persona_prompt text not null,
        is_active boolean not null default true,
        created_by text not null,
        created_at timestamptz not null default now()
      );
      alter table prediction.market_analysts add column if not exists slug text;
      alter table prediction.market_analysts add column if not exists display_name text;
      alter table prediction.market_analysts add column if not exists name text;
      alter table prediction.market_analysts add column if not exists persona_prompt text;
      alter table prediction.market_analysts add column if not exists is_active boolean not null default true;
      alter table prediction.market_analysts add column if not exists created_by text;
      alter table prediction.market_analysts add column if not exists created_at timestamptz not null default now();
      -- Drop legacy org-scoped unique indexes
      drop index if exists prediction.prediction_analysts_org_slug_unique_idx;

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
        instrument_id text not null references prediction.instruments(id) on delete cascade,
        analyst_id text not null,
        assigned_by text not null,
        created_at timestamptz not null default now(),
        primary key (instrument_id, analyst_id)
      );
      alter table prediction.market_instrument_analyst_assignments add column if not exists weight_override numeric;
      alter table prediction.market_instrument_analyst_assignments add column if not exists instrument_id text;
      alter table prediction.market_instrument_analyst_assignments add column if not exists analyst_id text;
      alter table prediction.market_instrument_analyst_assignments add column if not exists assigned_by text;
      alter table prediction.market_instrument_analyst_assignments add column if not exists created_at timestamptz not null default now();

      -- Viewer-scoped analyst participation: lets a user opt their custom
      -- analyst into the debate for a (base or custom) instrument. The
      -- market_instrument_analyst_assignments table above is the global
      -- participation set; this table layers viewer-specific additions on top.
      create table if not exists prediction.viewer_instrument_analyst_assignments (
        id text primary key default gen_random_uuid()::text,
        viewer_user_id text not null,
        instrument_id text not null references prediction.instruments(id) on delete cascade,
        analyst_id text not null references prediction.market_analysts(id) on delete cascade,
        created_at timestamptz not null default now(),
        unique (viewer_user_id, instrument_id, analyst_id)
      );
      create index if not exists viewer_instrument_analyst_assignments_viewer_instrument_idx
        on prediction.viewer_instrument_analyst_assignments (viewer_user_id, instrument_id);
      create index if not exists viewer_instrument_analyst_assignments_instrument_idx
        on prediction.viewer_instrument_analyst_assignments (instrument_id);
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
        external_source_slug text not null,
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
      create index if not exists prediction_market_articles_external_org_idx on prediction.market_articles(external_source_slug);

      -- Allow null external_source_slug for Divinr-native articles
      alter table prediction.market_articles alter column external_source_slug drop not null;
    `;
  }

  private predictorsDdl(): string {
    return `
      create table if not exists prediction.market_predictors (
        id text primary key,
        instrument_id text not null references prediction.instruments(id) on delete cascade,
        article_id text not null references prediction.market_articles(id) on delete cascade,
        relevance_score numeric not null check (relevance_score >= 0 and relevance_score <= 1),
        status text not null check (status in ('active', 'dismissed')) default 'active',
        rationale text,
        created_by text not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      -- Replace old org-scoped index with instrument-only version
      drop index if exists prediction.prediction_market_predictors_instrument_status_idx;
      create index if not exists prediction_market_predictors_instrument_status_idx
      on prediction.market_predictors (instrument_id, status);

      -- Allow 'expired' status for predictor TTL expiration
      alter table prediction.market_predictors drop constraint if exists market_predictors_status_check;
      alter table prediction.market_predictors add constraint market_predictors_status_check
        check (status in ('active', 'dismissed', 'expired'));

      -- Per-analyst article scoring: add scored_by_analyst_id and update unique constraint
      alter table prediction.market_predictors add column if not exists scored_by_analyst_id text;

      -- Replace original unique constraints with per-analyst version (no org_slug)
      alter table prediction.market_predictors
        drop constraint if exists market_predictors_organization_slug_instrument_id_article_i_key;
      drop index if exists prediction.market_predictors_org_instrument_article_analyst_key;
      create unique index if not exists market_predictors_instrument_article_analyst_key
        on prediction.market_predictors (instrument_id, article_id, scored_by_analyst_id);
      alter table prediction.market_predictors add column if not exists llm_usage_id uuid;
      create index if not exists prediction_market_predictors_llm_usage_idx
        on prediction.market_predictors (llm_usage_id) where llm_usage_id is not null;

      -- Fear/greed crowd-reaction classification (sentiment-analyst only)
      alter table prediction.market_predictors add column if not exists crowd_reaction text;
      alter table prediction.market_predictors add column if not exists crowd_reaction_confidence numeric;
      alter table prediction.market_predictors add column if not exists crowd_reaction_rationale text;
      alter table prediction.market_predictors add column if not exists estimated_reaction_window_minutes integer;
    `;
  }

  private articleInstrumentRelevanceDdl(): string {
    return `
      create table if not exists prediction.article_instrument_relevance (
        id text primary key,
        article_id text not null references prediction.market_articles(id) on delete cascade,
        instrument_id text not null references prediction.instruments(id) on delete cascade,
        is_relevant boolean not null,
        relevance_method text not null check (relevance_method in ('keyword', 'llm')),
        keyword_score numeric,
        llm_rationale text,
        llm_usage_id uuid,
        created_at timestamptz not null default now(),
        unique (article_id, instrument_id)
      );
      create index if not exists article_instrument_relevance_article_idx
        on prediction.article_instrument_relevance (article_id);
      create index if not exists article_instrument_relevance_relevant_idx
        on prediction.article_instrument_relevance (instrument_id, is_relevant)
        where is_relevant = true;
    `;
  }

  private artifactsDdl(): string {
    return `
      create table if not exists prediction.market_run_artifacts (
        id text primary key,
        run_id text not null references prediction.orchestration_runs(id) on delete cascade,
        run_type text not null check (run_type in ('risk', 'prediction')),
        analyst_id text,
        model_provider text not null,
        model_name text not null,
        prompt text not null,
        output_text text not null,
        created_at timestamptz not null default now()
      );
      alter table prediction.market_run_artifacts add column if not exists role text not null default 'analyst';
      alter table prediction.market_run_artifacts add column if not exists workflow_stage text;
      create index if not exists market_run_artifacts_workflow_stage_idx
        on prediction.market_run_artifacts (workflow_stage)
        where workflow_stage is not null;
    `;
  }

  private predictionsDdl(): string {
    return `
      create table if not exists prediction.market_predictions (
        id text primary key,
        run_id text not null references prediction.orchestration_runs(id) on delete cascade,
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
      alter table prediction.market_predictions add column if not exists settled_at timestamptz;
      alter table prediction.market_predictions add column if not exists trade_metadata jsonb not null default '{}'::jsonb;
      alter table prediction.market_predictions add column if not exists llm_usage_id uuid;
      create index if not exists prediction_market_predictions_llm_usage_idx
        on prediction.market_predictions (llm_usage_id) where llm_usage_id is not null;
      create index if not exists prediction_market_predictions_unsettled_idx
        on prediction.market_predictions (instrument_id, created_at desc) where settled_at is null;

      create unique index if not exists prediction_market_predictions_active_analyst_instrument_idx
      on prediction.market_predictions (analyst_id, instrument_id)
      where settled_at is null and analyst_id is not null;

      create unique index if not exists prediction_market_predictions_run_analyst_idx
      on prediction.market_predictions (run_id, analyst_id)
      where analyst_id is not null and role = 'analyst';

      create unique index if not exists prediction_market_predictions_run_arbitrator_idx
      on prediction.market_predictions (run_id)
      where role = 'arbitrator';

      create unique index if not exists prediction_market_predictions_run_portfolio_manager_idx
      on prediction.market_predictions (run_id)
      where role = 'portfolio_manager';
    `;
  }

  private riskAssessmentsDdl(): string {
    return `
      create table if not exists prediction.market_risk_assessments (
        id text primary key,
        run_id text not null references prediction.orchestration_runs(id) on delete cascade,
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
      alter table prediction.analyst_config_versions add column if not exists llm_usage_id uuid;
      create index if not exists prediction_analyst_config_versions_llm_usage_idx
        on prediction.analyst_config_versions (llm_usage_id) where llm_usage_id is not null;
      -- Effort: analyst-contracts. Structured markdown contract document.
      alter table prediction.analyst_config_versions add column if not exists context_markdown text;
    `;
  }

  // ─── Sprint 1: Risk Dimensions + Debates ─────────────────────

  private riskDimensionsDdl(): string {
    return `
      create table if not exists prediction.risk_dimensions (
        id text primary key,
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
        updated_at timestamptz not null default now()
      );

      create table if not exists prediction.risk_dimension_assessments (
        id text primary key,
        run_id text not null references prediction.orchestration_runs(id) on delete cascade,
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
      drop index if exists prediction.prediction_risk_dim_assessments_instrument_idx;
      create index if not exists prediction_risk_dim_assessments_instrument_idx on prediction.risk_dimension_assessments (instrument_id);
      alter table prediction.risk_dimension_assessments add column if not exists llm_usage_id uuid;
      create index if not exists prediction_risk_dim_assessments_llm_usage_idx
        on prediction.risk_dimension_assessments (llm_usage_id) where llm_usage_id is not null;

      create table if not exists prediction.risk_composite_scores (
        id text primary key,
        run_id text not null references prediction.orchestration_runs(id) on delete cascade,
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
      drop index if exists prediction.prediction_risk_composite_instrument_idx;
      create index if not exists prediction_risk_composite_instrument_idx
      on prediction.risk_composite_scores (instrument_id, status)
      where status = 'active';
      create index if not exists prediction_risk_composite_run_idx on prediction.risk_composite_scores (run_id);
    `;
  }

  private riskDebatesDdl(): string {
    return `
      create table if not exists prediction.risk_debates (
        id text primary key,
        run_id text not null references prediction.orchestration_runs(id) on delete cascade,
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
      alter table prediction.risk_debates add column if not exists llm_usage_id uuid;
      create index if not exists prediction_risk_debates_llm_usage_idx
        on prediction.risk_debates (llm_usage_id) where llm_usage_id is not null;

      -- Viewer scope: NULL = shared base debate; NOT NULL = viewer-scoped fanout
      -- (either a custom-instrument author or a viewer with custom-analyst
      -- associations on a base instrument).
      alter table prediction.risk_debates add column if not exists viewer_user_id text;
      create index if not exists prediction_risk_debates_viewer_idx
        on prediction.risk_debates (instrument_id, viewer_user_id)
        where viewer_user_id is not null;

      create table if not exists prediction.risk_debate_contexts (
        id text primary key,
        domain_slug text not null default 'financial',
        role text not null check (role in ('blue', 'red', 'arbiter')),
        version integer not null default 1,
        system_prompt text not null,
        is_active boolean not null default true,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
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
      drop index if exists prediction.prediction_horizon_evals_analyst_idx;
      create index if not exists prediction_horizon_evals_analyst_idx on prediction.prediction_horizon_evaluations (analyst_id);

      create table if not exists prediction.analyst_performance_profiles (
        id text primary key,
        analyst_id text not null,
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
      drop index if exists prediction.prediction_perf_profiles_analyst_idx;
      create index if not exists prediction_perf_profiles_analyst_idx on prediction.analyst_performance_profiles (analyst_id);

      create table if not exists prediction.canonical_test_days (
        id text primary key,
        instrument_id text not null,
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
      drop index if exists prediction.prediction_canonical_days_instrument_idx;
      create index if not exists prediction_canonical_days_instrument_idx
      on prediction.canonical_test_days (instrument_id, is_active)
      where is_active = true;

      create table if not exists prediction.learning_proposals (
        id text primary key,
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
      drop index if exists prediction.prediction_learning_proposals_org_idx;
      create index if not exists prediction_learning_proposals_status_idx on prediction.learning_proposals (status);
      alter table prediction.learning_proposals add column if not exists llm_usage_id uuid;
      create index if not exists prediction_learning_proposals_llm_usage_idx
        on prediction.learning_proposals (llm_usage_id) where llm_usage_id is not null;
      alter table prediction.learning_proposals add column if not exists evidence_summary jsonb;
      alter table prediction.learning_proposals add column if not exists proposed_context_markdown text;
      alter table prediction.learning_proposals add column if not exists current_context_markdown text;

      create table if not exists prediction.learning_reports (
        id text primary key,
        report_type text not null check (report_type in ('nightly_evaluation', 'learning_cycle')),
        report_date date not null default current_date,
        summary jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
      );
      create index if not exists prediction_learning_reports_date_idx on prediction.learning_reports (report_date desc);
      do $$ begin
        alter table prediction.learning_reports
          add constraint learning_reports_type_date_unique unique (report_type, report_date);
      exception when others then null; end $$;
      alter table prediction.learning_reports add column if not exists llm_usage_id uuid;
      create index if not exists prediction_learning_reports_llm_usage_idx
        on prediction.learning_reports (llm_usage_id) where llm_usage_id is not null;
      -- Effort: automated-meta-loop. Allow audit_policy report type.
      do $$ begin
        alter table prediction.learning_reports
          drop constraint learning_reports_report_type_check;
        alter table prediction.learning_reports
          add constraint learning_reports_report_type_check
          check (report_type in ('nightly_evaluation', 'learning_cycle', 'audit_policy'));
      exception when others then null; end $$;

      -- org_learning_config renamed to learning_config in user-scoping migration DDL
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
        (id, domain_slug, slug, name, description, weight, display_order, system_prompt)
      values
        ('dim_market_template', 'financial', 'market', 'Market Risk',
         'Overall market conditions, sector rotation, volatility regime', 0.30, 1,
         'Analyze the market risk for this instrument. Consider: overall market conditions, sector performance, volatility indicators, and correlation with major indices. Score 0 (no risk) to 100 (extreme risk).'),
        ('dim_fundamental_template', 'financial', 'fundamental', 'Fundamental Risk',
         'Balance sheet, earnings quality, valuation risk', 0.30, 2,
         'Analyze the fundamental risk for this instrument. Consider: earnings quality, revenue sustainability, debt levels, valuation relative to peers, and competitive position. Score 0 (no risk) to 100 (extreme risk).'),
        ('dim_technical_template', 'financial', 'technical', 'Technical Risk',
         'Chart breakdown risk, support/resistance, momentum exhaustion', 0.20, 3,
         'Analyze the technical risk for this instrument. Consider: proximity to support/resistance, trend exhaustion signals, volume divergence, and pattern breakdown risk. Score 0 (no risk) to 100 (extreme risk).'),
        ('dim_macro_template', 'financial', 'macro', 'Macro Risk',
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
        (id, tier_name, min_confidence, max_confidence, position_percent)
      values
        ('sizing_global_low', 'low', 60, 70, 0.05),
        ('sizing_global_medium', 'medium', 70, 80, 0.10),
        ('sizing_global_high', 'high', 80, 100, 0.15)
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
      alter table prediction.analyst_portfolios add column if not exists initial_balance numeric not null default 1000000;
      alter table prediction.analyst_portfolios add column if not exists current_balance numeric not null default 1000000;
      alter table prediction.analyst_portfolios add column if not exists total_realized_pnl numeric not null default 0;
      alter table prediction.analyst_portfolios add column if not exists total_unrealized_pnl numeric not null default 0;
      alter table prediction.analyst_portfolios add column if not exists win_count integer not null default 0;
      alter table prediction.analyst_portfolios add column if not exists loss_count integer not null default 0;
      alter table prediction.analyst_portfolios add column if not exists status text not null default 'active';
      alter table prediction.analyst_portfolios add column if not exists status_changed_at timestamptz;
      drop index if exists prediction.prediction_analyst_portfolios_analyst_idx;
      create index if not exists prediction_analyst_portfolios_analyst_idx
      on prediction.analyst_portfolios (analyst_id);

      create table if not exists prediction.analyst_positions (
        id text primary key,
        portfolio_id text not null,
        analyst_id text not null,
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

      create table if not exists prediction.user_portfolios (
        id text primary key,
        user_id text not null,
        initial_balance numeric not null default 1000000,
        current_balance numeric not null default 1000000,
        total_realized_pnl numeric not null default 0,
        total_unrealized_pnl numeric not null default 0,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      alter table prediction.user_portfolios add column if not exists initial_balance numeric not null default 1000000;
      alter table prediction.user_portfolios add column if not exists current_balance numeric not null default 1000000;
      alter table prediction.user_portfolios add column if not exists total_realized_pnl numeric not null default 0;
      alter table prediction.user_portfolios add column if not exists total_unrealized_pnl numeric not null default 0;

      create table if not exists prediction.user_positions (
        id text primary key,
        portfolio_id text not null,
        user_id text not null,
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
      alter table prediction.user_positions add column if not exists direction text not null default 'long';
      alter table prediction.user_positions add column if not exists quantity integer not null default 0;
      alter table prediction.user_positions add column if not exists entry_price numeric not null default 0;
      alter table prediction.user_positions add column if not exists current_price numeric not null default 0;

      create table if not exists prediction.user_trade_queue (
        id text primary key,
        user_id text not null,
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
      drop index if exists prediction.prediction_user_trade_queue_status_idx;
      create index if not exists prediction_user_trade_queue_status_idx
      on prediction.user_trade_queue (user_id, status)
      where status = 'queued';

      create table if not exists prediction.eod_settlement_log (
        id text primary key,
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
        tier_name text not null,
        min_confidence numeric not null,
        max_confidence numeric not null,
        position_percent numeric not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
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
      drop index if exists prediction.prediction_analyst_risk_assessments_instrument_idx;
      create index if not exists prediction_analyst_risk_assessments_instrument_idx
        on prediction.analyst_risk_assessments (instrument_id);
      alter table prediction.analyst_risk_assessments add column if not exists llm_usage_id uuid;
      create index if not exists prediction_analyst_risk_assessments_llm_usage_idx
        on prediction.analyst_risk_assessments (llm_usage_id) where llm_usage_id is not null;
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

  private async seedPortfolioManagerAnalyst(): Promise<void> {
    // Phase 6: Portfolio Manager analyst record. Not a personality analyst —
    // does not make directional predictions. Synthesizes arbitrator output +
    // composite risk + analyst consensus + portfolio state into a sized trade
    // recommendation. Idempotent.
    const sql = `
      insert into prediction.market_analysts (
        id, slug, display_name, persona_prompt,
        analyst_type, default_weight, workflow_scope, is_system_default,
        is_enabled, is_active, learning_enabled, created_by, created_at, updated_at
      ) values (
        'pm-base-portfolio-manager',
        'portfolio-manager',
        'Portfolio Manager',
        'You are the Portfolio Manager. You do not make directional predictions. You take the arbitrator''s composite prediction, the composite risk score, the analyst consensus, and the current portfolio state, and convert them into a sized trade signal: BUY, SELL, or HOLD with position size, entry price, and stop-loss. You apply the Kelly criterion adjusted by calibration accuracy and respect sane bounds (max position percent, no negative sizes, no concentration above limits).',
        'portfolio_manager',
        1.0,
        'trade',
        true,
        true,
        true,
        true,
        'phase-6-migration',
        now(),
        now()
      )
      on conflict (id) do nothing;
    `;
    const result = await this.db.rawQuery(sql);
    if (result.error) {
      this.logger.warn(`Failed to seed portfolio manager analyst: ${result.error.message}`);
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
      join prediction.market_analysts ma on ma.slug = v.analyst_slug and ma.user_id is null
      join prediction.data_source_registry ds on ds.id = v.source_id
      on conflict (analyst_id, source_id) do nothing;
    `;
    const aResult = await this.db.rawQuery(assignmentsSql);
    if (aResult.error) {
      this.logger.warn(`Failed to seed analyst-source assignments: ${aResult.error.message}`);
    }
  }

  // ─── Trade Decisions & Challenges ──────────────────────────────

  private tradeDecisionsDdl(): string {
    return `
      create table if not exists prediction.user_trade_decisions (
        id text primary key default gen_random_uuid()::text,
        user_id text not null,
        prediction_id text not null,
        instrument_id text not null,
        symbol text not null,
        decision text not null check (decision in ('buy', 'sell', 'skip')),
        based_on_analyst_id text,
        trade_queue_id text,
        confidence_at_decision numeric,
        decided_at timestamptz not null default now(),
        unique(user_id, prediction_id)
      );
      drop index if exists prediction.prediction_user_decisions_user_idx;
      create index if not exists prediction_user_decisions_user_idx
        on prediction.user_trade_decisions (user_id);

      create table if not exists prediction.user_decision_outcomes (
        id text primary key default gen_random_uuid()::text,
        decision_id text not null,
        horizon_days integer not null,
        price_at_decision numeric not null,
        price_at_horizon numeric,
        actual_direction text check (actual_direction in ('up', 'down', 'flat')),
        pnl_if_taken numeric,
        pnl_actual numeric,
        evaluated_at timestamptz,
        created_at timestamptz not null default now()
      );
      create index if not exists prediction_decision_outcomes_decision_idx
        on prediction.user_decision_outcomes (decision_id);

      create table if not exists prediction.prediction_challenges (
        id text primary key default gen_random_uuid()::text,
        prediction_id text not null,
        challenged_analyst_id text not null,
        challenger_analyst_id text not null,
        instrument_id text not null,
        counter_argument text not null,
        counter_direction text check (counter_direction in ('up', 'down', 'flat')),
        counter_confidence numeric,
        evidence jsonb default '[]',
        model_provider text,
        model_name text,
        created_at timestamptz not null default now()
      );
      create index if not exists prediction_challenges_prediction_idx
        on prediction.prediction_challenges (prediction_id);
      alter table prediction.prediction_challenges add column if not exists llm_usage_id uuid;
      create index if not exists prediction_challenges_llm_usage_idx
        on prediction.prediction_challenges (llm_usage_id) where llm_usage_id is not null;

      alter table prediction.user_portfolios
        add column if not exists disclaimer_acknowledged_at timestamptz;
    `;
  }

  // ─── Portfolio Foundation (multi-actor paper-trading game) ─────

  private portfolioFoundationDdl(): string {
    return `
      -- Multi-actor support: kind column lets analyst_portfolios host
      -- arbitrator + day_trader rows alongside analysts. strategy_state
      -- is forward-prepared for the day-traders/leaderboard effort.
      alter table prediction.analyst_portfolios
        add column if not exists kind text not null default 'analyst'
          check (kind in ('analyst','arbitrator','day_trader'));
      alter table prediction.analyst_portfolios
        add column if not exists strategy_name text;
      alter table prediction.analyst_portfolios
        add column if not exists strategy_state jsonb not null default '{}'::jsonb;

      -- Trade provenance on analyst positions. Reasons cover the full set
      -- so the autotrading follow-up can populate them without a migration.
      -- high_water_mark is null until the autotrading effort writes to it.
      alter table prediction.analyst_positions
        add column if not exists trigger_reason text not null default 'manual'
          check (trigger_reason in
            ('signal_cross','eod_sweep','stop_loss','take_profit','trailing_stop','manual','strategy'));
      -- Phase 8: extend trigger_reason to include 'eod_backfill' so the EOD
      -- helper that creates positions from settled-day predictions can be
      -- distinguished from human/manual opens. Drop the inline-named CHECK
      -- (auto-named by add-column) and re-add with the wider set.
      do $$
      begin
        alter table prediction.analyst_positions
          drop constraint if exists analyst_positions_trigger_reason_check;
      exception when others then null;
      end$$;
      alter table prediction.analyst_positions
        add constraint analyst_positions_trigger_reason_check
          check (trigger_reason in
            ('signal_cross','eod_sweep','eod_backfill','stop_loss','take_profit','trailing_stop','manual','strategy'));
      alter table prediction.analyst_positions
        add column if not exists notes text;
      alter table prediction.analyst_positions
        add column if not exists trigger_prediction_id text;
      alter table prediction.analyst_positions
        add column if not exists trigger_conviction numeric;
      alter table prediction.analyst_positions
        add column if not exists trigger_strategy text;
      alter table prediction.analyst_positions
        add column if not exists high_water_mark numeric;

      -- User positions only get manual / eod_sweep — user trades are not
      -- auto-managed by stop/take rules.
      alter table prediction.user_positions
        add column if not exists trigger_reason text not null default 'manual'
          check (trigger_reason in ('manual','eod_sweep'));
      alter table prediction.user_positions
        add column if not exists trigger_prediction_id text;

      -- Bailout ledger: monthly top-ups recorded for the leaderboard
      -- "shame" column. UNIQUE constraint enforces monthly idempotency.
      create table if not exists prediction.bailout_ledger (
        id text primary key default gen_random_uuid()::text,
        portfolio_kind text not null check (portfolio_kind in ('user','analyst')),
        portfolio_id text not null,
        reset_date date not null,
        balance_before numeric not null,
        topup_amount numeric not null,
        cumulative_bailouts numeric not null,
        notes text,
        created_at timestamptz not null default now(),
        unique (portfolio_kind, portfolio_id, reset_date)
      );
      create index if not exists idx_bailout_portfolio
        on prediction.bailout_ledger (portfolio_kind, portfolio_id, reset_date desc);

      -- Benchmark series: SPY daily close used for leaderboard overlays.
      create table if not exists prediction.benchmark_series (
        symbol text not null,
        trading_date date not null,
        close_price numeric not null,
        source text not null,
        primary key (symbol, trading_date)
      );

      -- Daily P&L snapshot: source of truth for equity curves. UNIQUE
      -- constraint allows safe retry on the next day.
      create table if not exists prediction.daily_pnl_snapshot (
        id text primary key default gen_random_uuid()::text,
        portfolio_kind text not null check (portfolio_kind in ('user','analyst')),
        portfolio_id text not null,
        snapshot_date date not null,
        starting_balance numeric not null,
        ending_balance numeric not null,
        realized_pnl numeric not null,
        unrealized_pnl numeric not null,
        open_position_count int not null,
        trades_today int not null,
        unique (portfolio_kind, portfolio_id, snapshot_date)
      );
      create index if not exists idx_pnl_snapshot_portfolio
        on prediction.daily_pnl_snapshot (portfolio_kind, portfolio_id, snapshot_date desc);
    `;
  }

  /**
   * Seeds the multi-actor paper-trading game's foundational portfolios:
   * the arbitrator (one row) and three day-trader strategies. Each gets
   * a synthetic market_analysts row + an analyst_portfolios row at $1M.
   *
   * Idempotent via ON CONFLICT DO NOTHING.
   */
  private async seedPortfolioFoundation(): Promise<void> {
    // 1. Synthetic analyst rows for the arbitrator + three day traders.
    //    Arbitrator is normally a synthesis role, not a market_analysts row;
    //    we add one so analyst_portfolios.analyst_id has something to point at.
    const analystSeedSql = `
      insert into prediction.market_analysts (
        id, slug, display_name, persona_prompt,
        analyst_type, default_weight, workflow_scope, is_system_default,
        is_enabled, is_active, learning_enabled, created_by, created_at, updated_at
      ) values
        (
          'pf-base-arbitrator',
          'arbitrator',
          'Arbitrator (Mini-Me)',
          'You are the Arbitrator. You synthesize all analyst predictions into a single composite conviction and trade your own conviction when it crosses threshold. Implementation lives in the agent-autotrading effort; this row exists so the foundation effort can give you a $1M portfolio.',
          'arbitrator',
          1.0,
          'trade',
          true,
          true,
          true,
          true,
          'portfolio-foundation-seed',
          now(),
          now()
        ),
        (
          'pf-base-day-trader-momentum',
          'momentum-breakout',
          'Day Trader — Momentum Breakout',
          'Day trader strategy: buy on N-bar high breakout, sell on first lower-high. Implementation lives in the day-traders-and-leaderboard effort; this row exists so the foundation effort can give you a $1M portfolio.',
          'day_trader',
          1.0,
          'trade',
          true,
          true,
          true,
          false,
          'portfolio-foundation-seed',
          now(),
          now()
        ),
        (
          'pf-base-day-trader-mean-reversion',
          'mean-reversion',
          'Day Trader — Mean Reversion',
          'Day trader strategy: buy when price drops below SMA - k*stdev, sell on cross back to mean. Implementation lives in the day-traders-and-leaderboard effort; this row exists so the foundation effort can give you a $1M portfolio.',
          'day_trader',
          1.0,
          'trade',
          true,
          true,
          true,
          false,
          'portfolio-foundation-seed',
          now(),
          now()
        ),
        (
          'pf-base-day-trader-gap-and-go',
          'gap-and-go',
          'Day Trader — Gap and Go',
          'Day trader strategy: at first tick of session check gap vs prior close, buy on gap-up + continuation tick, sell on first reversal tick. Implementation lives in the day-traders-and-leaderboard effort; this row exists so the foundation effort can give you a $1M portfolio.',
          'day_trader',
          1.0,
          'trade',
          true,
          true,
          true,
          false,
          'portfolio-foundation-seed',
          now(),
          now()
        )
      on conflict (id) do nothing;
    `;
    const analystResult = await this.db.rawQuery(analystSeedSql);
    if (analystResult.error) {
      this.logger.warn(`Failed to seed portfolio foundation analysts: ${analystResult.error.message}`);
      return;
    }

    // 2. Portfolio rows for each — $1M each, kind set, strategy_name set
    //    where applicable. Idempotent via ON CONFLICT on the primary key.
    const portfolioSeedSql = `
      insert into prediction.analyst_portfolios (
        id, analyst_id, kind, strategy_name, strategy_state,
        initial_balance, current_balance, status, created_at, updated_at
      ) values
        (
          'pf-portfolio-arbitrator',
          'pf-base-arbitrator',
          'arbitrator',
          null,
          '{}'::jsonb,
          1000000,
          1000000,
          'active',
          now(),
          now()
        ),
        (
          'pf-portfolio-momentum-breakout',
          'pf-base-day-trader-momentum',
          'day_trader',
          'momentum_breakout',
          '{}'::jsonb,
          1000000,
          1000000,
          'active',
          now(),
          now()
        ),
        (
          'pf-portfolio-mean-reversion',
          'pf-base-day-trader-mean-reversion',
          'day_trader',
          'mean_reversion',
          '{}'::jsonb,
          1000000,
          1000000,
          'active',
          now(),
          now()
        ),
        (
          'pf-portfolio-gap-and-go',
          'pf-base-day-trader-gap-and-go',
          'day_trader',
          'gap_and_go',
          '{}'::jsonb,
          1000000,
          1000000,
          'active',
          now(),
          now()
        )
      on conflict (id) do nothing;
    `;
    const portfolioResult = await this.db.rawQuery(portfolioSeedSql);
    if (portfolioResult.error) {
      this.logger.warn(`Failed to seed portfolio foundation portfolios: ${portfolioResult.error.message}`);
    }
  }

  // ─── Tier 2 Audit Findings (effort: tier-2-audit) ─────────────

  private auditFindingsDdl(): string {
    return `
      create table if not exists prediction.audit_findings (
        id                text primary key,
        analyst_id        text not null,
        prediction_id     text not null,
        config_version_id text,
        contract_excerpt  text not null,
        output_excerpt    text not null,
        discrepancy       text not null,
        hypothesis        text not null,
        severity          text not null check (severity in ('low', 'medium', 'high')),
        status            text not null default 'pending_review'
                          check (status in ('pending_review', 'accepted', 'rejected', 'noted')),
        review_text       text,
        reviewed_by       text,
        reviewed_at       timestamptz,
        llm_usage_id      uuid,
        audit_model       text,
        created_at        timestamptz not null default now()
      );
      drop index if exists prediction.audit_findings_status_idx;
      create index if not exists audit_findings_status_idx
        on prediction.audit_findings (status);
      create index if not exists audit_findings_analyst_idx
        on prediction.audit_findings (analyst_id);
      create index if not exists audit_findings_prediction_idx
        on prediction.audit_findings (prediction_id);
    `;
  }

  // ─── User-Scoped Platform Migration ──────────────────────────

  /**
   * Additive DDL for user-scoped platform effort.
   * Adds user_id columns to ownership tables, new indexes on user_id,
   * renames org_learning_config → learning_config,
   * updates position_sizing_config to remove org PK,
   * and renames market_articles.external_organization_slug.
   */
  private userScopingMigrationDdl(): string {
    return `
      -- Step 1.1: Add user_id columns to ownership tables
      alter table prediction.instruments
        add column if not exists user_id text;
      alter table prediction.market_analysts
        add column if not exists user_id text;
      alter table prediction.risk_dimensions
        add column if not exists user_id text;
      alter table prediction.risk_debate_contexts
        add column if not exists user_id text;
      alter table prediction.learning_proposals
        add column if not exists user_id text;
      alter table prediction.canonical_test_days
        add column if not exists user_id text;
      alter table prediction.analyst_portfolios
        add column if not exists user_id text;
      alter table prediction.audit_findings
        add column if not exists user_id text;
      -- user_trade_decisions and user_trade_queue already have user_id
      -- (the acting user IS the owner) — no new column needed, just drop org later.
      alter table prediction.prediction_challenges
        add column if not exists user_id text;
      alter table prediction.analyst_risk_assessments
        add column if not exists user_id text;

      -- Step 1.2: Add indexes on user_id for ownership tables
      create index if not exists prediction_instruments_user_id_idx
        on prediction.instruments (user_id);
      create index if not exists prediction_analysts_user_id_idx
        on prediction.market_analysts (user_id);
      create index if not exists prediction_risk_dimensions_user_id_idx
        on prediction.risk_dimensions (user_id);
      create index if not exists prediction_risk_debate_contexts_user_id_idx
        on prediction.risk_debate_contexts (user_id);
      create index if not exists prediction_learning_proposals_user_id_idx
        on prediction.learning_proposals (user_id, status);
      create index if not exists prediction_canonical_test_days_user_id_idx
        on prediction.canonical_test_days (user_id, instrument_id, is_active)
        where is_active = true;
      create index if not exists prediction_analyst_portfolios_user_id_idx
        on prediction.analyst_portfolios (analyst_id, user_id);
      create index if not exists prediction_audit_findings_user_id_idx
        on prediction.audit_findings (user_id, status);
      create index if not exists prediction_prediction_challenges_user_id_idx
        on prediction.prediction_challenges (user_id);
      create index if not exists prediction_analyst_risk_assessments_user_id_idx
        on prediction.analyst_risk_assessments (user_id, instrument_id);

      -- Step 1.3: Rename org_learning_config → learning_config with user_id
      do $$ begin
        if exists (select 1 from information_schema.tables where table_schema = 'prediction' and table_name = 'org_learning_config')
           and not exists (select 1 from information_schema.tables where table_schema = 'prediction' and table_name = 'learning_config')
        then
          alter table prediction.org_learning_config rename to learning_config;
        end if;
      end $$;
      -- Create table if it doesn't exist yet (fresh install)
      create table if not exists prediction.learning_config (
        id text primary key default gen_random_uuid()::text,
        user_id text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      alter table prediction.learning_config
        add column if not exists user_id text;

      -- Step 1.4: position_sizing_config — remove org dependency
      -- Drop the old unique constraint that includes organization_slug
      alter table prediction.position_sizing_config
        drop constraint if exists position_sizing_config_organization_slug_tier_name_key;
      -- Add new unique on tier_name only (system-level config)
      create unique index if not exists prediction_position_sizing_tier_unique_idx
        on prediction.position_sizing_config (tier_name);

      -- Step 1.5: Rename market_articles column
      do $$ begin
        alter table prediction.market_articles
          rename column external_organization_slug to external_source_slug;
      exception when undefined_column then null;
      end $$;
      -- Update the index to use the new column name
      drop index if exists prediction.prediction_market_articles_external_org_idx;
      create index if not exists prediction_market_articles_external_source_idx
        on prediction.market_articles (external_source_slug);

      -- Phase 2 prep: drop PKs that include organization_slug, recreate without it
      -- Use conditional logic: only drop+recreate if org_slug is still in the PK
      do $$ begin
        if exists (
          select 1 from information_schema.key_column_usage
          where table_schema = 'prediction' and table_name = 'market_instrument_analyst_assignments'
            and column_name = 'organization_slug'
            and constraint_name in (select constraint_name from information_schema.table_constraints where constraint_type = 'PRIMARY KEY' and table_schema = 'prediction' and table_name = 'market_instrument_analyst_assignments')
        ) then
          alter table prediction.market_instrument_analyst_assignments drop constraint market_instrument_analyst_assignments_pkey;
          delete from prediction.market_instrument_analyst_assignments where ctid not in (select min(ctid) from prediction.market_instrument_analyst_assignments group by instrument_id, analyst_id);
          alter table prediction.market_instrument_analyst_assignments add primary key (instrument_id, analyst_id);
        end if;
      end $$;
      do $$ begin
        if exists (
          select 1 from information_schema.key_column_usage
          where table_schema = 'prediction' and table_name = 'instrument_analyst_assignments'
            and column_name = 'organization_slug'
            and constraint_name in (select constraint_name from information_schema.table_constraints where constraint_type = 'PRIMARY KEY' and table_schema = 'prediction' and table_name = 'instrument_analyst_assignments')
        ) then
          alter table prediction.instrument_analyst_assignments drop constraint instrument_analyst_assignments_pkey;
          delete from prediction.instrument_analyst_assignments where ctid not in (select min(ctid) from prediction.instrument_analyst_assignments group by instrument_id, analyst_id);
          alter table prediction.instrument_analyst_assignments add primary key (instrument_id, analyst_id);
        end if;
      end $$;
      do $$ begin
        if exists (
          select 1 from information_schema.key_column_usage
          where table_schema = 'prediction' and table_name = 'tenant_source_entitlements'
            and column_name = 'organization_slug'
            and constraint_name in (select constraint_name from information_schema.table_constraints where constraint_type = 'PRIMARY KEY' and table_schema = 'prediction' and table_name = 'tenant_source_entitlements')
        ) then
          alter table prediction.tenant_source_entitlements drop constraint tenant_source_entitlements_pkey;
          delete from prediction.tenant_source_entitlements where ctid not in (select min(ctid) from prediction.tenant_source_entitlements group by source_id);
          alter table prediction.tenant_source_entitlements add primary key (source_id);
        end if;
      end $$;
      -- learning_config: drop PK if it includes organization_slug
      do $$ begin
        perform 1 from pg_constraint c
          join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
          where c.conrelid = 'prediction.learning_config'::regclass
            and c.contype = 'p' and a.attname = 'organization_slug';
        if found then
          execute 'alter table prediction.learning_config drop constraint ' ||
            (select conname from pg_constraint where conrelid = 'prediction.learning_config'::regclass and contype = 'p');
        end if;
      exception when undefined_table then null;
      end $$;

      -- Phase 2 prep: make organization_slug nullable on all prediction tables
      -- (dual-column period — services now write user_id, organization_slug becomes optional)
      -- Use a dynamic loop to handle all tables at once
      do $$ declare r record; begin
        for r in
          select c.table_name from information_schema.columns c
          where c.table_schema = 'prediction' and c.column_name = 'organization_slug' and c.is_nullable = 'NO'
            -- Skip columns that are in a PK (handled above)
            and not exists (
              select 1 from information_schema.key_column_usage kcu
              join information_schema.table_constraints tc on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
              where tc.constraint_type = 'PRIMARY KEY' and kcu.table_schema = 'prediction'
                and kcu.table_name = c.table_name and kcu.column_name = 'organization_slug'
            )
        loop
          execute 'alter table prediction.' || r.table_name || ' alter column organization_slug drop not null';
        end loop;
      end $$;
      alter table prediction.market_articles alter column external_source_slug drop not null;
    `;
  }

  /**
   * Phase 5 cleanup: drop organization_slug from all prediction tables
   * and authz.users. Also drops stale unique constraints and indexes
   * that referenced organization_slug.
   */
  private async dropOrganizationSlugColumns(): Promise<void> {
    const predictionTables = [
      'instruments',
      'market_analysts',
      'orchestration_runs',
      'market_predictions',
      'market_predictors',
      'market_risk_assessments',
      'risk_dimension_assessments',
      'risk_composite_scores',
      'risk_debates',
      'market_run_evaluations',
      'market_run_replays',
      'market_run_artifacts',
      'analyst_config_versions',
      'prediction_horizon_evaluations',
      'analyst_performance_profiles',
      'canonical_test_days',
      'learning_proposals',
      'analyst_portfolios',
      'analyst_positions',
      'user_portfolios',
      'user_positions',
      'user_trade_decisions',
      'user_trade_queue',
      'audit_findings',
      'prediction_challenges',
      'analyst_risk_assessments',
      'market_instrument_analyst_assignments',
      'instrument_analyst_assignments',
      'position_sizing_config',
      'tenant_source_entitlements',
      'risk_dimensions',
      'risk_debate_contexts',
      'learning_config',
      'eod_settlement_log',
    ];

    // Drop unique constraints that reference organization_slug before dropping the column
    const constraintDrops = `
      alter table prediction.instruments drop constraint if exists instruments_organization_slug_symbol_key;
      alter table prediction.market_analysts drop constraint if exists market_analysts_organization_slug_slug_key;
      alter table prediction.risk_dimensions drop constraint if exists risk_dimensions_organization_slug_slug_key;
      alter table prediction.risk_debate_contexts drop constraint if exists risk_debate_contexts_organization_slug_role_version_key;
      alter table prediction.user_portfolios drop constraint if exists user_portfolios_user_id_organization_slug_key;
      alter table prediction.position_sizing_config drop constraint if exists position_sizing_config_organization_slug_tier_name_key;
    `;
    const cResult = await this.db.rawQuery(constraintDrops);
    if (cResult.error) {
      this.logger.warn(`Drop constraints: ${cResult.error.message}`);
    }

    for (const table of predictionTables) {
      const sql = `alter table prediction.${table} drop column if exists organization_slug`;
      const result = await this.db.rawQuery(sql);
      if (result.error) {
        this.logger.warn(`Drop organization_slug from ${table}: ${result.error.message}`);
      }
    }

    // Also drop from authz.users
    const authzResult = await this.db.rawQuery(
      `alter table authz.users drop column if exists organization_slug`,
    );
    if (authzResult.error) {
      this.logger.warn(`Drop organization_slug from authz.users: ${authzResult.error.message}`);
    }

    this.logger.log('Phase 5: organization_slug columns dropped');
  }

  // ─── User-Analyst Affinity ──────────────────────────────────

  private affinityDdl(): string {
    return `
      create table if not exists prediction.user_analyst_affinity (
        id text primary key default gen_random_uuid()::text,
        user_id text not null,
        analyst_id text not null,
        affinity_score numeric not null default 0.5,
        signal_count integer not null default 0,
        buy_agreement integer not null default 0,
        skip_disagreement integer not null default 0,
        challenge_accept integer not null default 0,
        challenge_reject integer not null default 0,
        browse_signals integer not null default 0,
        last_signal_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique(user_id, analyst_id)
      );
      create index if not exists prediction_user_analyst_affinity_user_idx
        on prediction.user_analyst_affinity (user_id);

      create table if not exists prediction.user_affinity_signals (
        id text primary key default gen_random_uuid()::text,
        user_id text not null,
        analyst_id text not null,
        signal_type text not null check (signal_type in (
          'buy_agreement', 'sell_agreement', 'skip_disagreement',
          'challenge_accept', 'challenge_reject', 'browse_interest'
        )),
        prediction_id text,
        instrument_id text,
        weight numeric not null,
        created_at timestamptz not null default now()
      );
      create index if not exists prediction_affinity_signals_user_idx
        on prediction.user_affinity_signals (user_id, created_at desc);

      create table if not exists prediction.user_contrarian_alerts (
        id text primary key default gen_random_uuid()::text,
        user_id text not null,
        analyst_id text not null,
        prediction_id text not null,
        instrument_id text not null,
        symbol text not null,
        user_weighted_direction text not null check (user_weighted_direction in ('up', 'down', 'flat')),
        contrarian_direction text not null check (contrarian_direction in ('up', 'down', 'flat')),
        contrarian_confidence numeric not null,
        affinity_score_at_alert numeric not null,
        rationale text not null,
        is_read boolean not null default false,
        created_at timestamptz not null default now()
      );
      create index if not exists prediction_contrarian_alerts_user_idx
        on prediction.user_contrarian_alerts (user_id, is_read, created_at desc);
    `;
  }

  /** Unified notification system table. */
  private fearGreedAlertsDdl(): string {
    return `
      create table if not exists prediction.fear_greed_alerts (
        id text primary key default gen_random_uuid()::text,
        user_id text not null,
        predictor_id text not null,
        instrument_id text not null,
        symbol text not null,
        crowd_reaction text not null check (crowd_reaction in ('fear_trigger', 'greed_trigger')),
        crowd_reaction_confidence numeric not null,
        estimated_reaction_window_minutes integer,
        trade_action text,
        entry_price numeric,
        stop_loss numeric,
        take_profit numeric,
        notification_id text,
        is_read boolean not null default false,
        created_at timestamptz not null default now()
      );
      create index if not exists fear_greed_alerts_user_unread_idx
        on prediction.fear_greed_alerts (user_id, is_read, created_at desc);
      create unique index if not exists fear_greed_alerts_predictor_user_key
        on prediction.fear_greed_alerts (predictor_id, user_id);
    `;
  }

  // ─── Multi-Analyst Coordination ──────────────────────────────

  private coordinationDdl(): string {
    return `
      create table if not exists prediction.analyst_pair_correlations (
        id text primary key default gen_random_uuid()::text,
        analyst_a_id text not null,
        analyst_b_id text not null,
        instrument_id text,
        horizon_window integer,
        period text not null check (period in ('30d', '90d', 'all')),
        agreement_rate numeric not null,
        sample_size integer not null,
        flag text check (flag in ('redundant', 'adversarial')),
        computed_at timestamptz not null default now(),
        unique (analyst_a_id, analyst_b_id, instrument_id, horizon_window, period)
      );
      create index if not exists analyst_pair_corr_flag_idx
        on prediction.analyst_pair_correlations (flag) where flag is not null;

      create table if not exists prediction.analyst_coverage_gaps (
        id text primary key default gen_random_uuid()::text,
        instrument_id text not null,
        horizon_window integer,
        period text not null check (period in ('30d', '90d', 'all')),
        best_analyst_id text,
        best_accuracy numeric,
        analyst_count integer not null,
        avg_accuracy numeric not null,
        is_gap boolean not null,
        computed_at timestamptz not null default now(),
        unique (instrument_id, horizon_window, period)
      );
      create index if not exists analyst_coverage_gaps_gap_idx
        on prediction.analyst_coverage_gaps (is_gap) where is_gap = true;

      create table if not exists prediction.analyst_contribution_scores (
        id text primary key default gen_random_uuid()::text,
        analyst_id text not null,
        instrument_id text,
        period text not null check (period in ('30d', '90d', 'all')),
        composite_accuracy_with numeric not null,
        composite_accuracy_without numeric not null,
        marginal_contribution numeric not null,
        prediction_count integer not null,
        computed_at timestamptz not null default now(),
        unique (analyst_id, instrument_id, period)
      );
      create index if not exists analyst_contribution_scores_analyst_idx
        on prediction.analyst_contribution_scores (analyst_id);
    `;
  }

  private notificationsDdl(): string {
    return `
      create table if not exists prediction.notifications (
        id text primary key default gen_random_uuid()::text,
        user_id text not null,
        event_type text not null,
        urgency text not null check (urgency in ('immediate', 'actionable', 'informational')),
        title text not null,
        summary text,
        link_to text not null,
        is_read boolean not null default false,
        created_at timestamptz not null default now()
      );
      create index if not exists notifications_user_unread_idx
        on prediction.notifications (user_id, is_read, created_at desc);
    `;
  }
}
