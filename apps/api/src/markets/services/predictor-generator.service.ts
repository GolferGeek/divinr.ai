import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  DATABASE_SERVICE,
  type DatabaseService,
} from '@orchestratorai/planes/database';
import { ObservabilityEventsService } from '@orchestratorai/planes/observability';
import { MarketsLlmService } from './markets-llm.service';
import { WorkflowStage } from '../workflow-stages/workflow-stage';
import { instrumentKeywordScore } from '../utils/instrument-keyword-match';
import { loadContractFragment } from '../utils/contract-loader';
import { loadInstrumentContractFragment } from '../utils/instrument-contract-loader';
import { buildMergedSystemPrompt, emitPromptTokenEstimate } from '../utils/merge-prompts';
import { resolveTripleContext } from '../utils/resolve-triple-context';
import {
  demoDefaultInt,
  getDisabledAnalystSlugs,
  getDisabledInstrumentSymbols,
  getPipelineInstrumentLimit,
  getPipelineInstrumentSymbols,
  isMarketsDemoMode,
  getEnabledAnalystSlugs,
} from '../utils/demo-mode';

interface UnscoredArticle {
  id: string;
  title: string | null;
  summary: string | null;
  content: string | null;
  source_id: string;
  published_at: string | null;
}

interface ActiveInstrument {
  id: string;
  symbol: string;
  name: string;
  asset_type: string;
  user_id: string | null;
}

interface ScoringAnalyst {
  id: string;
  slug: string;
  display_name: string;
  scoring_focus: string;
  current_config_version_id: string | null;
  user_id: string | null;
}

interface PredictorGenResult {
  articlesProcessed: number;
  predictorsCreated: number;
  predictorsDismissed: number;
  instrumentsAffected: number;
  instrumentIdsAffected: string[];
  articlesSkippedByRelevanceGate: number;
  errors: string[];
}

/**
 * Generic fallback prompt body for analysts that don't have a v4 stage-keyed
 * contract's Predictor Generation section. In production, every base
 * personality analyst has one after the stage-keyed-analyst-contracts effort,
 * so this path is dead for the 7 base analysts. It remains for rollback
 * safety and for future analysts seeded without a v4 contract.
 */
const GENERIC_FALLBACK_SCORING_FOCUS =
  'Score the relevance of this article to the instrument from your analytical perspective. Focus on signals aligned with your specialty.';

/**
 * PredictorGeneratorService — Scores new articles against active instruments
 * to create market_predictors (relevance signals).
 *
 * Schedule: Every 5 minutes
 * Disable: MARKETS_DISABLE_PREDICTOR_GENERATION=true
 *
 * Flow:
 * 1. Find articles not yet scored against active instruments
 * 2. For each article × instrument pair, use LLM to score relevance
 * 3. Create/upsert market_predictors with relevance_score and rationale
 * 4. Dismiss irrelevant articles (score < threshold)
 */
@Injectable()
export class PredictorGeneratorService {
  private readonly logger = new Logger(PredictorGeneratorService.name);
  private isRunning = false;

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(ObservabilityEventsService) private readonly observability: ObservabilityEventsService,
    @Inject(MarketsLlmService) private readonly marketsLlm: MarketsLlmService,
  ) {}

  private emit(type: string, message: string, data?: Record<string, unknown>): void {
    this.observability.push({
      context: { conversationId: 'pipeline', userId: 'system', agentSlug: 'predictor-generator' } as never,
      source_app: 'divinr-api',
      hook_event_type: `pipeline.predictor.${type}`,
      status: type === 'error' ? 'error' : 'running',
      message,
      progress: null,
      step: null,
      payload: { workflow_stage: WorkflowStage.PredictorGeneration, ...(data ?? {}) },
      timestamp: Date.now(),
    }).catch(() => {});
  }

  private isDisabled(): boolean {
    return process.env.MARKETS_DISABLE_PREDICTOR_GENERATION === 'true';
  }

  /**
   * Scheduled predictor generation — every 5 minutes
   */
  @Cron('*/5 * * * *')
  async scheduledGeneration(): Promise<void> {
    if (this.isDisabled()) return;
    await this.runGeneration();
  }

  /**
   * Run a full predictor generation cycle.
   */
  async runGeneration(): Promise<PredictorGenResult> {
    if (this.isDisabled()) {
      this.logger.debug('Predictor generation disabled by MARKETS_DISABLE_PREDICTOR_GENERATION');
      return { articlesProcessed: 0, predictorsCreated: 0, predictorsDismissed: 0, instrumentsAffected: 0, instrumentIdsAffected: [], articlesSkippedByRelevanceGate: 0, errors: [] };
    }

    if (this.isRunning) {
      this.logger.warn('Skipping predictor generation — previous run still in progress');
      return { articlesProcessed: 0, predictorsCreated: 0, predictorsDismissed: 0, instrumentsAffected: 0, instrumentIdsAffected: [], articlesSkippedByRelevanceGate: 0, errors: [] };
    }

    this.isRunning = true;
    const startTime = Date.now();
    const errors: string[] = [];
    let articlesProcessed = 0;
    let predictorsCreated = 0;
    let predictorsDismissed = 0;
    let articlesSkippedByRelevanceGate = 0;
    const affectedInstruments = new Set<string>();

    try {
      // Get all active instruments across all organizations
      const instruments = await this.getActiveInstruments();
      if (instruments.length === 0) {
        this.logger.debug('No active instruments');
        return { articlesProcessed: 0, predictorsCreated: 0, predictorsDismissed: 0, instrumentsAffected: 0, instrumentIdsAffected: [], articlesSkippedByRelevanceGate: 0, errors: [] };
      }

      // Load personality analysts for per-analyst scoring
      const analysts = await this.getPersonalityAnalysts();

      // For each instrument, find unscored articles and score them per analyst
      for (const instrument of instruments) {
        try {
          const unscoredArticles = await this.getUnscoredArticles(instrument, analysts);

          const gatedArticles = await this.filterByRelevance(instrument, unscoredArticles);
          const skipped = unscoredArticles.length - gatedArticles.length;
          if (skipped > 0) {
            articlesSkippedByRelevanceGate += skipped;
            this.emit('relevance_gate', `Relevance gate skipped ${skipped} articles for ${instrument.symbol}`, { symbol: instrument.symbol, skipped, remaining: gatedArticles.length });
          }

          if (gatedArticles.length === 0) continue;

          this.emit('instrument.scoring', `Scoring ${gatedArticles.length} articles for ${instrument.symbol} (${analysts.length} analysts)`, { symbol: instrument.symbol, articleCount: gatedArticles.length });
          for (const article of gatedArticles) {
            try {
              // Score through each analyst's lens
              for (const analyst of analysts) {
                const result = await this.scoreArticleForInstrument(article, instrument, analyst);
                articlesProcessed++;

                if (result.dismissed) {
                  predictorsDismissed++;
                } else {
                  predictorsCreated++;
                  affectedInstruments.add(instrument.id);
                  this.emit('predictor.created', `Predictor: ${analyst.display_name} → "${(article.title || 'untitled').slice(0, 50)}" → ${instrument.symbol} (${result.relevanceScore.toFixed(2)})`, { symbol: instrument.symbol, analyst: analyst.slug, relevance: result.relevanceScore });
                }
              }
            } catch (err) {
              const msg = `Error scoring article ${article.id} for ${instrument.symbol}: ${err instanceof Error ? err.message : String(err)}`;
              errors.push(msg);
              this.logger.error(msg);
            }
          }

          // Also process authored analysts wired to this instrument
          const authoredAnalysts = await this.getAuthoredAnalystsForInstrument(instrument.id);
          if (authoredAnalysts.length > 0) {
            this.emit('instrument.scoring', `Scoring ${gatedArticles.length} articles for ${instrument.symbol} (${authoredAnalysts.length} authored analysts)`, { symbol: instrument.symbol, articleCount: gatedArticles.length, authoredAnalystCount: authoredAnalysts.length });
            for (const article of gatedArticles) {
              try {
                for (const analyst of authoredAnalysts) {
                  const result = await this.scoreArticleForInstrument(article, instrument, analyst);
                  articlesProcessed++;

                  if (result.dismissed) {
                    predictorsDismissed++;
                  } else {
                    predictorsCreated++;
                    affectedInstruments.add(instrument.id);
                    this.emit('predictor.created', `Predictor: ${analyst.display_name} (authored) → "${(article.title || 'untitled').slice(0, 50)}" → ${instrument.symbol} (${result.relevanceScore.toFixed(2)})`, { symbol: instrument.symbol, analyst: analyst.slug, relevance: result.relevanceScore, authored: true });
                  }
                }
              } catch (err) {
                const msg = `Error scoring article ${article.id} for ${instrument.symbol} (authored analyst): ${err instanceof Error ? err.message : String(err)}`;
                errors.push(msg);
                this.logger.error(msg);
              }
            }
          }
        } catch (err) {
          const msg = `Error processing instrument ${instrument.symbol}: ${err instanceof Error ? err.message : String(err)}`;
          errors.push(msg);
          this.logger.error(msg);
        }
      }

      const duration = Date.now() - startTime;
      this.logger.log(
        `Predictor generation complete: ${articlesProcessed} articles, ` +
          `${predictorsCreated} predictors created, ${predictorsDismissed} dismissed, ` +
          `${affectedInstruments.size} instruments affected (${duration}ms)`,
      );
      this.emit('complete', `Predictor generation: ${predictorsCreated} created, ${predictorsDismissed} dismissed from ${articlesProcessed} articles`, { articlesProcessed, predictorsCreated, predictorsDismissed, instrumentsAffected: affectedInstruments.size, articlesSkippedByRelevanceGate, duration });

      return {
        articlesProcessed,
        predictorsCreated,
        predictorsDismissed,
        instrumentsAffected: affectedInstruments.size,
        instrumentIdsAffected: Array.from(affectedInstruments),
        articlesSkippedByRelevanceGate,
        errors,
      };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Get base personality analysts (user_id IS NULL) for shared pipeline scoring.
   */
  private async getPersonalityAnalysts(): Promise<ScoringAnalyst[]> {
    const analystLimit = demoDefaultInt('MARKETS_PIPELINE_ANALYST_LIMIT', 2, 100);
    const enabledSlugs = getEnabledAnalystSlugs();
    const disabledSlugs = getDisabledAnalystSlugs();
    const result = await this.db.rawQuery(
      `select id, slug, display_name, current_config_version_id, user_id from prediction.market_analysts
       where analyst_type = 'personality'
         and is_enabled = true and is_active = true
         and user_id is null
         and (cardinality($2::text[]) = 0 or lower(slug) = any($2::text[]))
         and not (lower(slug) = any($3::text[]))
       order by slug
       limit $1`,
      [analystLimit, enabledSlugs, disabledSlugs],
    );
    const rows = (result.data as Array<{ id: string; slug: string; display_name: string; current_config_version_id: string | null; user_id: string | null }> | null) ?? [];
    return rows.map(r => ({
      ...r,
      scoring_focus: GENERIC_FALLBACK_SCORING_FOCUS,
    }));
  }

  /**
   * Get authored analysts wired to a specific instrument via
   * viewer_instrument_analyst_assignments. These are user-created analysts
   * (user_id IS NOT NULL) that participate alongside base analysts.
   */
  private async getAuthoredAnalystsForInstrument(instrumentId: string): Promise<ScoringAnalyst[]> {
    const analystLimit = demoDefaultInt('MARKETS_AUTHORED_PIPELINE_ANALYST_LIMIT', 0, 100);
    if (analystLimit <= 0) return [];
    const enabledSlugs = getEnabledAnalystSlugs();
    const disabledSlugs = getDisabledAnalystSlugs();
    const result = await this.db.rawQuery(
      `SELECT DISTINCT ma.id, ma.slug, ma.display_name, ma.current_config_version_id,
              ma.user_id, viaa.viewer_user_id
       FROM prediction.viewer_instrument_analyst_assignments viaa
       JOIN prediction.market_analysts ma ON ma.id = viaa.analyst_id
       WHERE viaa.instrument_id = $1
         AND ma.is_active = true
         AND ma.user_id IS NOT NULL
         AND (cardinality($3::text[]) = 0 OR lower(ma.slug) = any($3::text[]))
         AND NOT (lower(ma.slug) = any($4::text[]))
       ORDER BY ma.slug
       LIMIT $2`,
      [instrumentId, analystLimit, enabledSlugs, disabledSlugs],
    );
    const rows = (result.data as Array<{ id: string; slug: string; display_name: string; current_config_version_id: string | null; user_id: string | null }> | null) ?? [];
    return rows.map(r => ({
      ...r,
      scoring_focus: GENERIC_FALLBACK_SCORING_FOCUS,
    }));
  }

  /**
   * Get all active __base__ instruments. Pipeline runs once for base instruments;
   * all orgs see the base results.
   */
  private async getActiveInstruments(): Promise<ActiveInstrument[]> {
    const demoMode = isMarketsDemoMode();
    const symbols = getPipelineInstrumentSymbols();
    const disabledSymbols = getDisabledInstrumentSymbols();
    const limit = getPipelineInstrumentLimit(1000);
    const result = await this.db.rawQuery(
      `select id, symbol, name, asset_type, user_id
       from prediction.instruments
       where is_active = true
         and ($1::boolean = false or cardinality($2::text[]) = 0 or upper(symbol) = any($2::text[]))
         and not (upper(symbol) = any($4::text[]))
       order by symbol
       limit $3`,
      [demoMode, symbols, limit, disabledSymbols],
    );
    if (result.error) {
      this.logger.error(`Failed to query instruments: ${result.error.message}`);
      return [];
    }
    return (result.data as ActiveInstrument[] | null) ?? [];
  }

  /**
   * Find articles that have NOT yet been scored by ALL analysts against a specific instrument.
   * Only considers articles from the last 7 days to avoid scoring stale content.
   * Limited to 20 per instrument per cycle to avoid overwhelming the LLM.
   */
  private async getUnscoredArticles(instrument: ActiveInstrument, analysts: ScoringAnalyst[]): Promise<UnscoredArticle[]> {
    // Find articles that are missing scoring by at least one analyst
    const analystCount = analysts.length;
    const result = await this.db.rawQuery(
      `
      select ma.id, ma.title, ma.summary, ma.content, ma.source_id, ma.published_at
      from prediction.market_articles ma
      join prediction.source_catalog sc on sc.id = ma.source_id
      left join prediction.tenant_source_entitlements tse on tse.source_id = sc.id
      where (
        select count(distinct mp.scored_by_analyst_id)
        from prediction.market_predictors mp
        where mp.instrument_id = $1
          and mp.article_id = ma.id
          and mp.scored_by_analyst_id is not null
      ) < $2
      and coalesce(tse.is_enabled, sc.is_global_default) = true
      and coalesce(ma.published_at, ma.first_seen_at, ma.created_at) >= now() - interval '7 days'
      order by coalesce(ma.published_at, ma.first_seen_at, ma.created_at) desc
      limit $3
      `,
      [instrument.id, analystCount, demoDefaultInt('MARKETS_ARTICLES_PER_INSTRUMENT_LIMIT', 3, 20)],
    );
    if (result.error) {
      this.logger.error(`Failed to query unscored articles for ${instrument.symbol}: ${result.error.message}`);
      return [];
    }
    return (result.data as UnscoredArticle[] | null) ?? [];
  }

  /**
   * Score a single article's relevance to an instrument through an analyst's lens.
   * Creates a market_predictor row with the score and scored_by_analyst_id.
   */
  private async scoreArticleForInstrument(
    article: UnscoredArticle,
    instrument: ActiveInstrument,
    analyst: ScoringAnalyst,
  ): Promise<{ relevanceScore: number; rationale: string; dismissed: boolean }> {
    // Quick keyword check for a preliminary score
    const quickScore = this.quickKeywordCheck(article, instrument);

    // Use LLM for nuanced per-analyst scoring when available
    let relevanceScore = quickScore;
    let rationale = quickScore > 0 ? 'Keyword match' : 'No keyword match';
    let dismissed = false;
    let llmUsageId: string | null = null;

    // Crowd-reaction fields (sentiment-analyst only)
    let crowdReaction: string | null = null;
    let crowdReactionConfidence: number | null = null;
    let crowdReactionRationale: string | null = null;
    let estimatedReactionWindowMinutes: number | null = null;

    const isSentimentAnalyst = analyst.slug === 'sentiment-analyst';

    if (this.marketsLlm.isLlmEnabled()) {
      const articleText = [article.title, article.summary, article.content?.slice(0, 1500)]
        .filter(Boolean)
        .join('\n');

      const context = this.marketsLlm.buildExecutionContext(
        'system',
        'predictor-scoring',
      );

      const crowdReactionPromptAddition = isSentimentAnalyst
        ? `
Additionally, predict how retail investors will emotionally react when they see this headline.
Will enough people panic-sell (fear) or FOMO-buy (greed) to move the price within 2 hours?
Include these extra fields in your JSON response:
  "crowd_reaction": "<one of: fear_trigger, greed_trigger, noise>",
  "crowd_reaction_confidence": <number 0.0-1.0, how confident you are in this classification>,
  "crowd_reaction_rationale": "<one sentence: why will retail investors react this way?>",
  "estimated_reaction_window_minutes": <integer 15-120, how many minutes before the crowd prices it in>`
        : '';

      // v4 stage-keyed analyst contract + v1 instrument contract (Phase 4 of
      // instrument-contracts effort). The two loads are independent — parallelize.
      const deps = { db: this.db, logger: this.logger, observability: this.observability };
      const [analystLoad, instrumentLoad] = await Promise.all([
        loadContractFragment(
          deps,
          { id: analyst.id, slug: analyst.slug },
          analyst.current_config_version_id,
          WorkflowStage.PredictorGeneration,
        ),
        loadInstrumentContractFragment(
          deps,
          { id: instrument.id, symbol: instrument.symbol },
          WorkflowStage.PredictorGeneration,
        ),
      ]);
      const { stageFragment: analystFragment, fallback: contractFallback } = analystLoad;
      const { stageFragment: instrumentFragment } = instrumentLoad;

      const legacyAnalystBlock = `You are the ${analyst.display_name}. ${analyst.scoring_focus}`;
      const v4AnalystBlock = `You are the ${analyst.display_name}.\n\n${analystFragment}`;
      const analystBlock = contractFallback ? legacyAnalystBlock : v4AnalystBlock;
      const mergedPersonaBlock = instrumentFragment
        ? buildMergedSystemPrompt({
            instrumentSymbol: instrument.symbol,
            instrumentFragment,
            analystSlug: analyst.slug,
            analystFragment: analystBlock,
          })
        : analystBlock;
      const systemPrompt = `${mergedPersonaBlock}
Score the relevance of this news article to a specific financial instrument from YOUR perspective.
Respond with valid JSON only:
{
  "relevance": <number 0.0-1.0, where 0=irrelevant to your analysis, 1=highly relevant to your specialty>,
  "rationale": "<brief one-sentence explanation from your perspective>",
  "dismiss": <boolean, true if article is clearly irrelevant to your type of analysis>
}${crowdReactionPromptAddition}`;
      const userPrompt = `Score this article's relevance to ${instrument.symbol} (${instrument.name}, ${instrument.asset_type}) from your perspective as ${analyst.display_name}:\n\n${articleText}`;
      emitPromptTokenEstimate(this.observability, this.logger, {
        prompt: systemPrompt,
        stage: WorkflowStage.PredictorGeneration,
        subStage: null,
        analystSlug: analyst.slug,
        instrumentSymbol: instrument.symbol,
      });
      try {
        const llmResult = await this.marketsLlm.generateText(context, systemPrompt, userPrompt, undefined, {
          stage: 'predictor_generation',
          articleId: article.id,
          instrumentId: instrument.id,
          analystId: analyst.id,
          analystAuthorUserId: analyst.user_id ?? undefined,
          instrumentAuthorUserId: instrument.user_id ?? undefined,
        });

        llmUsageId = llmResult.llmUsageId ?? null;
        const match = llmResult.text.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]) as Record<string, unknown>;
          relevanceScore = Math.min(1, Math.max(0, Number(parsed['relevance']) || 0.5));
          rationale = String(parsed['rationale'] || llmResult.text.slice(0, 500));
          dismissed = Boolean(parsed['dismiss']);

          if (isSentimentAnalyst) {
            const rawReaction = String(parsed['crowd_reaction'] || '');
            crowdReaction = ['fear_trigger', 'greed_trigger', 'noise'].includes(rawReaction)
              ? rawReaction : 'noise';
            const rawConf = Number(parsed['crowd_reaction_confidence']);
            crowdReactionConfidence = Number.isFinite(rawConf) ? Math.min(1, Math.max(0, rawConf)) : 0;
            crowdReactionRationale = parsed['crowd_reaction_rationale']
              ? String(parsed['crowd_reaction_rationale']).slice(0, 500) : null;
            const rawWindow = Number(parsed['estimated_reaction_window_minutes']);
            estimatedReactionWindowMinutes = Number.isInteger(rawWindow) && rawWindow >= 15 && rawWindow <= 120
              ? rawWindow : null;
          }
        }
      } catch (err) {
        this.logger.debug(
          `LLM scoring failed for ${analyst.slug} on article ${article.id}, using keyword score: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Dismiss if very low relevance
    if (relevanceScore < 0.2) dismissed = true;

    const triple = resolveTripleContext(analyst, instrument);
    await this.upsertPredictor(
      instrument.id,
      article.id,
      relevanceScore,
      dismissed ? 'dismissed' : 'active',
      rationale,
      'system',
      analyst.id,
      llmUsageId,
      triple.authorUserId,
      crowdReaction,
      crowdReactionConfidence,
      crowdReactionRationale,
      estimatedReactionWindowMinutes,
    );

    return { relevanceScore, rationale, dismissed };
  }

  private quickKeywordCheck(article: UnscoredArticle, instrument: ActiveInstrument): number {
    return instrumentKeywordScore(article, instrument);
  }

  /**
   * Flag-gated relevance filter: keep only articles marked is_relevant=true
   * for this instrument in article_instrument_relevance.
   */
  private async filterByRelevance(
    instrument: ActiveInstrument,
    articles: UnscoredArticle[],
  ): Promise<UnscoredArticle[]> {
    if (articles.length === 0) return articles;
    const ids = articles.map(a => a.id);
    const result = await this.db.rawQuery(
      `select article_id from prediction.article_instrument_relevance
       where instrument_id = $1 and is_relevant = true and article_id = any($2::text[])`,
      [instrument.id, ids],
    );
    const relevantIds = new Set(
      ((result.data as Array<{ article_id: string }> | null) ?? []).map(r => r.article_id),
    );
    return articles.filter(a => relevantIds.has(a.id));
  }

  /**
   * Upsert a predictor row with per-analyst scoring.
   */
  private async upsertPredictor(
    instrumentId: string,
    articleId: string,
    relevanceScore: number,
    status: string,
    rationale: string,
    createdBy: string,
    scoredByAnalystId: string,
    llmUsageId: string | null,
    authorUserId: string | null,
    crowdReaction: string | null = null,
    crowdReactionConfidence: number | null = null,
    crowdReactionRationale: string | null = null,
    estimatedReactionWindowMinutes: number | null = null,
  ): Promise<void> {
    const result = await this.db.rawQuery(
      `
      insert into prediction.market_predictors
        (id, instrument_id, article_id, relevance_score,
         status, rationale, created_by, scored_by_analyst_id, llm_usage_id,
         author_user_id,
         crowd_reaction, crowd_reaction_confidence, crowd_reaction_rationale,
         estimated_reaction_window_minutes,
         created_at, updated_at)
      values (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(), now())
      on conflict ((coalesce(author_user_id, 'base')), instrument_id, article_id, scored_by_analyst_id)
      do update set
        relevance_score = excluded.relevance_score,
        status = excluded.status,
        rationale = excluded.rationale,
        llm_usage_id = excluded.llm_usage_id,
        author_user_id = excluded.author_user_id,
        crowd_reaction = excluded.crowd_reaction,
        crowd_reaction_confidence = excluded.crowd_reaction_confidence,
        crowd_reaction_rationale = excluded.crowd_reaction_rationale,
        estimated_reaction_window_minutes = excluded.estimated_reaction_window_minutes,
        updated_at = now()
      `,
      [instrumentId, articleId, relevanceScore, status, rationale, createdBy, scoredByAnalystId, llmUsageId,
       authorUserId, crowdReaction, crowdReactionConfidence, crowdReactionRationale, estimatedReactionWindowMinutes],
    );
    if (result.error) {
      throw new Error(result.error.message);
    }
  }
}
