import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  DATABASE_SERVICE,
  type DatabaseService,
} from '@orchestratorai/planes/database';
import { ObservabilityEventsService } from '@orchestratorai/planes/observability';
import { MarketsLlmService } from './markets-llm.service';

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
  organization_slug: string;
  symbol: string;
  name: string;
  asset_type: string;
}

interface PredictorGenResult {
  articlesProcessed: number;
  predictorsCreated: number;
  predictorsDismissed: number;
  instrumentsAffected: number;
  errors: string[];
}

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
    private readonly marketsLlm: MarketsLlmService,
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
      payload: data ?? {},
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
    if (this.isRunning) {
      this.logger.warn('Skipping predictor generation — previous run still in progress');
      return { articlesProcessed: 0, predictorsCreated: 0, predictorsDismissed: 0, instrumentsAffected: 0, errors: [] };
    }

    this.isRunning = true;
    const startTime = Date.now();
    const errors: string[] = [];
    let articlesProcessed = 0;
    let predictorsCreated = 0;
    let predictorsDismissed = 0;
    const affectedInstruments = new Set<string>();

    try {
      // Get all active instruments across all organizations
      const instruments = await this.getActiveInstruments();
      if (instruments.length === 0) {
        this.logger.debug('No active instruments');
        return { articlesProcessed: 0, predictorsCreated: 0, predictorsDismissed: 0, instrumentsAffected: 0, errors: [] };
      }

      // For each instrument, find unscored articles and score them
      for (const instrument of instruments) {
        try {
          const unscoredArticles = await this.getUnscoredArticles(instrument);
          if (unscoredArticles.length === 0) continue;

          this.emit('instrument.scoring', `Scoring ${unscoredArticles.length} articles for ${instrument.symbol}`, { symbol: instrument.symbol, articleCount: unscoredArticles.length });
          for (const article of unscoredArticles) {
            try {
              const result = await this.scoreArticleForInstrument(article, instrument);
              articlesProcessed++;

              if (result.dismissed) {
                predictorsDismissed++;
              } else {
                predictorsCreated++;
                affectedInstruments.add(instrument.id);
                this.emit('predictor.created', `Predictor: "${(article.title || 'untitled').slice(0, 60)}" → ${instrument.symbol} (relevance: ${result.relevanceScore.toFixed(2)})`, { symbol: instrument.symbol, title: article.title, relevance: result.relevanceScore });
              }
            } catch (err) {
              const msg = `Error scoring article ${article.id} for ${instrument.symbol}: ${err instanceof Error ? err.message : String(err)}`;
              errors.push(msg);
              this.logger.error(msg);
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
      this.emit('complete', `Predictor generation: ${predictorsCreated} created, ${predictorsDismissed} dismissed from ${articlesProcessed} articles`, { articlesProcessed, predictorsCreated, predictorsDismissed, instrumentsAffected: affectedInstruments.size, duration });

      return {
        articlesProcessed,
        predictorsCreated,
        predictorsDismissed,
        instrumentsAffected: affectedInstruments.size,
        errors,
      };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Get all active __base__ instruments. Pipeline runs once for base instruments;
   * all orgs see the base results.
   */
  private async getActiveInstruments(): Promise<ActiveInstrument[]> {
    const result = await this.db.rawQuery(
      `select id, organization_slug, symbol, name, asset_type
       from prediction.instruments
       where is_active = true
         and organization_slug = '__base__'
       order by symbol`,
    );
    if (result.error) {
      this.logger.error(`Failed to query instruments: ${result.error.message}`);
      return [];
    }
    return (result.data as ActiveInstrument[] | null) ?? [];
  }

  /**
   * Find articles that have NOT yet been scored against a specific instrument.
   * Only considers articles from the last 7 days to avoid scoring stale content.
   * Limited to 20 per instrument per cycle to avoid overwhelming the LLM.
   */
  private async getUnscoredArticles(instrument: ActiveInstrument): Promise<UnscoredArticle[]> {
    const result = await this.db.rawQuery(
      `
      select ma.id, ma.title, ma.summary, ma.content, ma.source_id, ma.published_at
      from prediction.market_articles ma
      where ma.id not in (
        select mp.article_id
        from prediction.market_predictors mp
        where mp.instrument_id = $1
          and mp.organization_slug = $2
      )
      and coalesce(ma.published_at, ma.first_seen_at, ma.created_at) >= now() - interval '7 days'
      order by coalesce(ma.published_at, ma.first_seen_at, ma.created_at) desc
      limit 20
      `,
      [instrument.id, instrument.organization_slug],
    );
    if (result.error) {
      this.logger.error(`Failed to query unscored articles for ${instrument.symbol}: ${result.error.message}`);
      return [];
    }
    return (result.data as UnscoredArticle[] | null) ?? [];
  }

  /**
   * Score a single article's relevance to an instrument using LLM.
   * Creates a market_predictor row with the score.
   */
  private async scoreArticleForInstrument(
    article: UnscoredArticle,
    instrument: ActiveInstrument,
  ): Promise<{ relevanceScore: number; rationale: string; dismissed: boolean }> {
    // Quick keyword check for a preliminary score
    const quickScore = this.quickKeywordCheck(article, instrument);

    // Use LLM for nuanced scoring when available, even if keyword check found nothing
    let relevanceScore = quickScore;
    let rationale = quickScore > 0 ? 'Keyword match' : 'No keyword match';
    let dismissed = false;

    if (this.marketsLlm.isLlmEnabled()) {
      const articleText = [article.title, article.summary, article.content?.slice(0, 1500)]
        .filter(Boolean)
        .join('\n');

      const context = this.marketsLlm.buildExecutionContext(
        instrument.organization_slug,
        'system',
        'predictor-scoring',
      );

      try {
        const llmResult = await this.marketsLlm.generateText(
          context,
          `You are scoring the relevance of a news article to a specific financial instrument.
Respond with valid JSON only:
{
  "relevance": <number 0.0-1.0, where 0=irrelevant, 1=highly relevant>,
  "rationale": "<brief one-sentence explanation>",
  "dismiss": <boolean, true if article is clearly irrelevant to this instrument>
}`,
          `Score this article's relevance to ${instrument.symbol} (${instrument.name}, ${instrument.asset_type}):\n\n${articleText}`,
        );

        const match = llmResult.text.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]) as Record<string, unknown>;
          relevanceScore = Math.min(1, Math.max(0, Number(parsed['relevance']) || 0.5));
          rationale = String(parsed['rationale'] || llmResult.text.slice(0, 500));
          dismissed = Boolean(parsed['dismiss']);
        }
      } catch (err) {
        this.logger.debug(
          `LLM scoring failed for article ${article.id}, using keyword score: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Dismiss if very low relevance
    if (relevanceScore < 0.2) dismissed = true;

    await this.upsertPredictor(
      instrument.organization_slug,
      instrument.id,
      article.id,
      relevanceScore,
      dismissed ? 'dismissed' : 'active',
      rationale,
      'system',
    );

    return { relevanceScore, rationale, dismissed };
  }

  /**
   * Quick keyword check — does the article mention the instrument at all?
   * Returns a preliminary relevance score (0 = no mention, 0.5-1.0 = mentioned).
   */
  private quickKeywordCheck(article: UnscoredArticle, instrument: ActiveInstrument): number {
    const text = [article.title, article.summary, article.content?.slice(0, 3000)]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    const symbol = instrument.symbol.toLowerCase();
    const name = instrument.name.toLowerCase();

    // Direct symbol match (word boundary)
    const symbolRegex = new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (symbolRegex.test(text)) return 1.0;

    // Full company name match
    if (text.includes(name)) return 0.9;

    // First word of company name (if > 3 chars)
    const firstName = name.split(/\s+/)[0];
    if (firstName && firstName.length > 3 && text.includes(firstName)) return 0.7;

    return 0;
  }

  /**
   * Upsert a predictor row.
   */
  private async upsertPredictor(
    organizationSlug: string,
    instrumentId: string,
    articleId: string,
    relevanceScore: number,
    status: string,
    rationale: string,
    createdBy: string,
  ): Promise<void> {
    const result = await this.db.rawQuery(
      `
      insert into prediction.market_predictors
        (id, organization_slug, instrument_id, article_id, relevance_score,
         status, rationale, created_by, created_at, updated_at)
      values (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, now(), now())
      on conflict (organization_slug, instrument_id, article_id)
      do update set
        relevance_score = excluded.relevance_score,
        status = excluded.status,
        rationale = excluded.rationale,
        updated_at = now()
      `,
      [organizationSlug, instrumentId, articleId, relevanceScore, status, rationale, createdBy],
    );
    if (result.error) {
      throw new Error(result.error.message);
    }
  }
}
