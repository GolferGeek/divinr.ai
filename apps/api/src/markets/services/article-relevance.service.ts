import { Injectable, Inject, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { ObservabilityEventsService } from '@orchestratorai/planes/observability';
import { MarketsLlmService } from './markets-llm.service';
import { WorkflowStage } from '../workflow-stages/workflow-stage';
import { instrumentKeywordScore } from '../utils/instrument-keyword-match';

interface RelevanceResult {
  pairsEvaluated: number;
  keywordDecided: number;
  llmDecided: number;
  relevantPairs: number;
}

interface ArticleRow {
  id: string;
  title: string | null;
  summary: string | null;
  content: string | null;
}

interface InstrumentRow {
  id: string;
  symbol: string;
  name: string;
}

@Injectable()
export class ArticleRelevanceService {
  private readonly logger = new Logger(ArticleRelevanceService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(ObservabilityEventsService) private readonly observability: ObservabilityEventsService,
    @Inject(MarketsLlmService) private readonly llmService: MarketsLlmService,
  ) {}

  private emit(type: string, message: string, data?: Record<string, unknown>): void {
    this.observability.push({
      context: { conversationId: 'pipeline', userId: 'system', agentSlug: 'article-relevance' } as never,
      source_app: 'divinr-api',
      hook_event_type: `pipeline.article_processing.${type}`,
      status: type === 'error' ? 'error' : 'running',
      message,
      progress: null,
      step: null,
      payload: { workflow_stage: WorkflowStage.ArticleProcessing, ...(data ?? {}) },
      timestamp: Date.now(),
    }).catch(() => {});
  }

  async classifyNewArticles(): Promise<RelevanceResult> {
    const result: RelevanceResult = { pairsEvaluated: 0, keywordDecided: 0, llmDecided: 0, relevantPairs: 0 };

    const instruments = await this.getActiveInstruments();
    if (instruments.length === 0) return result;

    const articles = await this.getRecentUnclassifiedArticles(instruments.map(i => i.id));
    if (articles.length === 0) return result;

    this.emit('start', `Classifying ${articles.length} articles against ${instruments.length} instruments`);

    for (const article of articles) {
      for (const instrument of instruments) {
        const exists = await this.pairExists(article.id, instrument.id);
        if (exists) continue;

        result.pairsEvaluated++;
        const keywordScore = instrumentKeywordScore(article, instrument);

        if (keywordScore >= 0.7) {
          await this.writeRelevance(article.id, instrument.id, true, 'keyword', keywordScore, null, null);
          result.keywordDecided++;
          result.relevantPairs++;
        } else if (keywordScore === 0) {
          await this.writeRelevance(article.id, instrument.id, false, 'keyword', 0, null, null);
          result.keywordDecided++;
        } else {
          const llmResult = await this.llmClassify(article, instrument);
          await this.writeRelevance(
            article.id, instrument.id,
            llmResult.isRelevant, 'llm', keywordScore,
            llmResult.rationale, llmResult.llmUsageId,
          );
          result.llmDecided++;
          if (llmResult.isRelevant) result.relevantPairs++;
        }
      }
    }

    this.emit('complete', `Classified ${result.pairsEvaluated} pairs: ${result.keywordDecided} keyword, ${result.llmDecided} LLM, ${result.relevantPairs} relevant`);
    this.logger.log(`Article relevance: ${result.pairsEvaluated} pairs evaluated, ${result.relevantPairs} relevant`);
    return result;
  }

  private async getActiveInstruments(): Promise<InstrumentRow[]> {
    const res = await this.db.rawQuery(
      `select id, symbol, name from prediction.instruments where is_active = true order by symbol`,
    );
    return (res.data as InstrumentRow[] | null) ?? [];
  }

  private async getRecentUnclassifiedArticles(instrumentIds: string[]): Promise<ArticleRow[]> {
    const res = await this.db.rawQuery(
      `select distinct ma.id, ma.title, ma.summary, ma.content
       from prediction.market_articles ma
       where coalesce(ma.published_at, ma.first_seen_at, ma.created_at) >= now() - interval '7 days'
         and not exists (
           select 1 from prediction.article_instrument_relevance air
           where air.article_id = ma.id
         )
       order by ma.id
       limit 100`,
    );
    return (res.data as ArticleRow[] | null) ?? [];
  }

  private async pairExists(articleId: string, instrumentId: string): Promise<boolean> {
    const res = await this.db.rawQuery(
      `select 1 from prediction.article_instrument_relevance where article_id = $1 and instrument_id = $2 limit 1`,
      [articleId, instrumentId],
    );
    return ((res.data as unknown[] | null) ?? []).length > 0;
  }

  private async writeRelevance(
    articleId: string, instrumentId: string,
    isRelevant: boolean, method: 'keyword' | 'llm',
    keywordScore: number, llmRationale: string | null, llmUsageId: string | null,
  ): Promise<void> {
    await this.db.rawQuery(
      `insert into prediction.article_instrument_relevance
        (id, article_id, instrument_id, is_relevant, relevance_method, keyword_score, llm_rationale, llm_usage_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (article_id, instrument_id) do nothing`,
      [randomUUID(), articleId, instrumentId, isRelevant, method, keywordScore, llmRationale, llmUsageId],
    );
  }

  private async llmClassify(
    article: ArticleRow, instrument: InstrumentRow,
  ): Promise<{ isRelevant: boolean; rationale: string; llmUsageId: string | null }> {
    if (!this.llmService.isLlmEnabled()) {
      return { isRelevant: false, rationale: 'LLM disabled — defaulting to not relevant', llmUsageId: null };
    }

    const articleText = [article.title, article.summary, article.content?.slice(0, 1500)]
      .filter(Boolean)
      .join('\n');

    const systemPrompt = `You are an instrument-relevance classifier. Determine if the article is relevant to the financial instrument ${instrument.symbol} (${instrument.name}). Respond with valid JSON: {"is_relevant": true/false, "rationale": "brief explanation"}. Use the language "analysis" and "signal", never "advice" or "recommendation".`;
    const userPrompt = `Article:\n${articleText}\n\nIs this article relevant to ${instrument.symbol} (${instrument.name})?`;

    try {
      const context = { conversationId: 'pipeline', userId: 'system', agentSlug: 'article-relevance' } as never;
      const res = await this.llmService.generateText(context, systemPrompt, userPrompt);
      const parsed = JSON.parse(res.text);
      return {
        isRelevant: !!parsed.is_relevant,
        rationale: parsed.rationale ?? '',
        llmUsageId: res.llmUsageId ?? null,
      };
    } catch (err) {
      this.logger.warn(`LLM relevance classification failed for article=${article.id} instrument=${instrument.id}: ${err instanceof Error ? err.message : String(err)}`);
      return { isRelevant: false, rationale: 'LLM classification failed — defaulting to not relevant', llmUsageId: null };
    }
  }
}
