import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  DATABASE_SERVICE,
  type DatabaseService,
} from '@orchestratorai/planes/database';
import { ObservabilityEventsService } from '@orchestratorai/planes/observability';
import Parser from 'rss-parser';
import {
  demoDefaultInt,
  getDisabledSourceKeys,
  getEnabledSourceKeys,
  isMarketsDemoMode,
} from '../utils/demo-mode';

interface RssItem {
  title?: string;
  link?: string;
  description?: string;
  author?: string;
  'content:encoded'?: string;
  guid?: string;
  content?: string;
  contentSnippet?: string;
  creator?: string;
  pubDate?: string;
  isoDate?: string;
}

interface CrawlableSource {
  id: string;
  source_key: string;
  display_name: string;
  base_url: string;
  tier: string;
  source_type?: string;
  crawl_frequency_minutes?: number;
  last_crawled_at?: string;
}

interface CrawlResult {
  sourcesProcessed: number;
  sourcesSucceeded: number;
  sourcesFailed: number;
  articlesNew: number;
  errors: string[];
}

/**
 * CrawlerService — Crawls entitled sources and stores articles in market_articles.
 *
 * Schedule: Every 15 minutes (configurable via MARKETS_CRAWL_INTERVAL_MINUTES).
 * Disable: MARKETS_DISABLE_CRAWLING=true
 *
 * Flow:
 * 1. Get all sources from source_catalog that are due for crawl
 * 2. For each source, fetch content (RSS, web via FireCrawl, or API)
 * 3. Deduplicate and store articles in market_articles
 * 4. Update source last_crawled_at
 */
@Injectable()
export class CrawlerService {
  private readonly logger = new Logger(CrawlerService.name);
  private readonly rssParser = new Parser({
    headers: {
      'User-Agent':
        'Mozilla/5.0 (compatible; DivinrAI/1.0; +https://divinr.ai)',
      Accept: 'application/rss+xml, application/xml, text/xml, */*',
    },
    timeout: 30000,
  });
  private isRunning = false;

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(ObservabilityEventsService) private readonly observability: ObservabilityEventsService,
  ) {}

  private emit(type: string, message: string, data?: Record<string, unknown>): void {
    this.observability.push({
      context: { conversationId: 'pipeline', userId: 'system', agentSlug: 'crawler' } as never,
      source_app: 'divinr-api',
      hook_event_type: `pipeline.crawler.${type}`,
      status: type === 'error' ? 'error' : 'running',
      message,
      progress: null,
      step: null,
      payload: data ?? {},
      timestamp: Date.now(),
    }).catch(() => {});
  }

  private isDisabled(): boolean {
    return process.env.MARKETS_DISABLE_CRAWLING === 'true';
  }

  /**
   * Scheduled crawl — every 15 minutes by default
   */
  @Cron('*/15 * * * *')
  async scheduledCrawl(): Promise<void> {
    if (this.isDisabled()) return;
    await this.runCrawl();
  }

  /**
   * Run a full crawl cycle across all sources due for refresh.
   */
  async runCrawl(): Promise<CrawlResult> {
    if (this.isDisabled()) {
      this.logger.debug('Crawling disabled by MARKETS_DISABLE_CRAWLING');
      return { sourcesProcessed: 0, sourcesSucceeded: 0, sourcesFailed: 0, articlesNew: 0, errors: [] };
    }

    if (this.isRunning) {
      this.logger.warn('Skipping crawl — previous run still in progress');
      return { sourcesProcessed: 0, sourcesSucceeded: 0, sourcesFailed: 0, articlesNew: 0, errors: [] };
    }

    this.isRunning = true;
    const startTime = Date.now();
    const errors: string[] = [];
    let sourcesSucceeded = 0;
    let sourcesFailed = 0;
    let articlesNew = 0;

    try {
      const sources = await this.getSourcesDueForCrawl();
      if (sources.length === 0) {
        this.logger.debug('No sources due for crawl');
        return { sourcesProcessed: 0, sourcesSucceeded: 0, sourcesFailed: 0, articlesNew: 0, errors: [] };
      }

      this.logger.log(`Starting crawl for ${sources.length} sources`);
      this.emit('started', `Crawling ${sources.length} sources`, { sourceCount: sources.length });

      for (const source of sources) {
        try {
          this.emit('source.started', `Crawling ${source.display_name}`, { source: source.display_name, url: source.base_url });
          const newCount = await this.crawlSource(source);
          articlesNew += newCount;
          sourcesSucceeded++;
          this.emit('source.complete', `${source.display_name}: ${newCount} new articles`, { source: source.display_name, articlesNew: newCount });
        } catch (err) {
          sourcesFailed++;
          const msg = `Failed to crawl ${source.display_name}: ${err instanceof Error ? err.message : String(err)}`;
          errors.push(msg);
          this.logger.error(msg);
          this.emit('error', msg, { source: source.display_name });
        }
      }

      const duration = Date.now() - startTime;
      this.logger.log(
        `Crawl complete: ${sourcesSucceeded}/${sources.length} sources, ` +
          `${articlesNew} new articles (${duration}ms)`,
      );
      this.emit('complete', `Crawl complete: ${sourcesSucceeded}/${sources.length} sources, ${articlesNew} new articles`, { sourcesSucceeded, articlesNew, duration });

      return {
        sourcesProcessed: sources.length,
        sourcesSucceeded,
        sourcesFailed,
        articlesNew,
        errors,
      };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Get sources from source_catalog that are due for a crawl.
   * A source is due if it has never been crawled, or if enough time has
   * elapsed since last_crawled_at based on its crawl_frequency_minutes
   * (default 15 minutes).
   */
  private async getSourcesDueForCrawl(): Promise<CrawlableSource[]> {
    const sourceLimit = demoDefaultInt('MARKETS_CRAWL_SOURCE_LIMIT', 2, 50);
    const enabledSourceKeys = getEnabledSourceKeys();
    const disabledSourceKeys = getDisabledSourceKeys();
    const result = await this.db.rawQuery(
      `
      select id, source_key, display_name, base_url, tier,
             source_type, crawl_frequency_minutes, last_crawled_at
      from prediction.source_catalog sc
      left join prediction.tenant_source_entitlements tse on tse.source_id = sc.id
      where coalesce(tse.is_enabled, sc.is_global_default) = true
        and (cardinality($2::text[]) = 0 or lower(sc.source_key) = any($2::text[]))
        and not (lower(sc.source_key) = any($3::text[]))
        and (
          sc.last_crawled_at is null
          or sc.last_crawled_at < now() - (coalesce(sc.crawl_frequency_minutes, 15) || ' minutes')::interval
        )
      order by sc.last_crawled_at asc nulls first
      limit $1
      `,
      [sourceLimit, enabledSourceKeys, disabledSourceKeys],
    );
    if (result.error) {
      this.logger.error(`Failed to query sources: ${result.error.message}`);
      return [];
    }
    return (result.data as CrawlableSource[] | null) ?? [];
  }

  /**
   * Crawl a single source: fetch items, deduplicate, store as market_articles.
   * Returns count of new articles inserted.
   */
  private async crawlSource(source: CrawlableSource): Promise<number> {
    const sourceType = source.source_type ?? this.inferSourceType(source.base_url);
    let items: Array<{
      url: string;
      title?: string;
      content?: string;
      summary?: string;
      author?: string;
      published_at?: string;
    }> = [];

    switch (sourceType) {
      case 'rss':
        items = await this.fetchRssItems(source);
        break;
      case 'web':
        items = await this.fetchWebItems(source);
        break;
      case 'api':
        items = await this.fetchApiItems(source);
        break;
      default:
        items = await this.fetchRssItems(source); // default to RSS
        break;
    }

    if (items.length === 0) {
      await this.markSourceCrawled(source.id);
      return 0;
    }

    let newCount = 0;
    for (const item of items) {
      if (!item.url) continue;
      try {
        const inserted = await this.upsertArticle(source, item);
        if (inserted) newCount++;
      } catch (err) {
        this.logger.debug(
          `Failed to upsert article ${item.url}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    await this.markSourceCrawled(source.id);
    return newCount;
  }

  /**
   * Infer source type from URL if not explicitly set.
   */
  private inferSourceType(url: string): string {
    if (/\/rss|\/feed|\.xml|atom/i.test(url)) return 'rss';
    if (/\/api\//i.test(url)) return 'api';
    return 'rss'; // default to RSS — most common for news
  }

  /**
   * Fetch items from an RSS feed.
   */
  private async fetchRssItems(source: CrawlableSource): Promise<
    Array<{
      url: string;
      title?: string;
      content?: string;
      summary?: string;
      author?: string;
      published_at?: string;
    }>
  > {
    const feed = await this.rssParser.parseURL(source.base_url);
    return (feed.items || []).map((feedItem) => {
      const item = feedItem as unknown as RssItem;
      return {
        url: item.link || item.guid || '',
        title: item.title || undefined,
        content:
          item.content ||
          item['content:encoded'] ||
          item.description ||
          undefined,
        summary: item.contentSnippet || item.description || undefined,
        author: item.creator || item.author || undefined,
        published_at: item.pubDate || item.isoDate || undefined,
      };
    });
  }

  /**
   * Fetch items via FireCrawl (web scraping).
   * Falls back to a simple fetch if FIRECRAWL_API_KEY not set.
   */
  private async fetchWebItems(source: CrawlableSource): Promise<
    Array<{
      url: string;
      title?: string;
      content?: string;
      summary?: string;
    }>
  > {
    if (isMarketsDemoMode() && process.env.MARKETS_DEMO_ALLOW_FIRECRAWL !== 'true') {
      this.logger.debug(`Demo mode — skipping Firecrawl web scrape for ${source.display_name}`);
      return [];
    }

    const firecrawlKey = process.env.FIRECRAWL_API_KEY;
    if (!firecrawlKey) {
      this.logger.debug(`No FIRECRAWL_API_KEY — skipping web crawl for ${source.display_name}`);
      return [];
    }

    try {
      const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${firecrawlKey}`,
        },
        body: JSON.stringify({
          url: source.base_url,
          formats: ['markdown'],
        }),
      });

      if (!response.ok) {
        throw new Error(`FireCrawl ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as {
        success: boolean;
        data?: { markdown?: string; metadata?: { title?: string } };
      };

      if (!data.success || !data.data) return [];

      return [
        {
          url: source.base_url,
          title: data.data.metadata?.title,
          content: data.data.markdown,
          summary: data.data.markdown?.slice(0, 500),
        },
      ];
    } catch (err) {
      this.logger.error(
        `FireCrawl error for ${source.display_name}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  /**
   * Fetch items from an API endpoint.
   */
  private async fetchApiItems(source: CrawlableSource): Promise<
    Array<{
      url: string;
      title?: string;
      content?: string;
    }>
  > {
    const response = await fetch(source.base_url);
    if (!response.ok) {
      throw new Error(`API ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as Record<string, unknown>;
    const items = (
      Array.isArray(data)
        ? data
        : (data.items as unknown[]) ||
          (data.articles as unknown[]) ||
          (data.results as unknown[]) || [data]
    ) as Record<string, unknown>[];

    return items.map((item) => ({
      url: (item.url || item.link || source.base_url) as string,
      title: (item.title || item.headline) as string | undefined,
      content: (item.content || item.body || item.text) as string | undefined,
    }));
  }

  /**
   * Upsert an article into market_articles. Returns true if a new row was inserted.
   */
  private async upsertArticle(
    source: CrawlableSource,
    item: {
      url: string;
      title?: string;
      content?: string;
      summary?: string;
      author?: string;
      published_at?: string;
    },
  ): Promise<boolean> {
    // Normalize URL: strip tracking params and fragments for dedup
    const normalizedUrl = item.url.split('?')[0].split('#')[0];
    const externalArticleId = normalizedUrl;
    const contentHash = item.title
      ? Buffer.from(item.title.toLowerCase().trim()).toString('base64').slice(0, 64)
      : item.content
        ? Buffer.from(item.content).toString('base64').slice(0, 64)
        : null;

    // Skip if we already have an article with same title from same source (title-based dedup)
    if (item.title) {
      const existing = await this.db.rawQuery(
        `select 1 from prediction.market_articles
         where source_id = $1 and title = $2 limit 1`,
        [source.id, item.title],
      );
      if (((existing.data as unknown[] | null) ?? []).length > 0) {
        return false;
      }
    }

    // Clean up summary — don't store if it's just the title repeated
    let summary = item.summary || null;
    if (summary && item.title && summary.trim().replace(/\s+/g, ' ') === item.title.trim().replace(/\s+/g, ' ')) {
      summary = null;
    }

    const result = await this.db.rawQuery(
      `
      insert into prediction.market_articles
        (id, external_article_id, external_source_id, source_id, source_origin,
         title, url, summary, author, content, content_hash,
         published_at, first_seen_at, created_at, updated_at)
      values
        (gen_random_uuid()::text, $1, $2, $3, 'divinr',
         $4, $5, $6, $7, $8, $9,
         $10, now(), now(), now())
      on conflict (external_article_id) do nothing
      returning id
      `,
      [
        externalArticleId,
        source.id,
        source.id,
        item.title || null,
        item.url,
        summary,
        item.author || null,
        item.content || null,
        contentHash,
        item.published_at || null,
      ],
    );

    if (result.error) {
      throw new Error(result.error.message);
    }

    const rows = (result.data as Array<{ id: string }> | null) ?? [];
    return rows.length > 0;
  }

  /**
   * Mark a source as successfully crawled.
   */
  private async markSourceCrawled(sourceId: string): Promise<void> {
    await this.db.rawQuery(
      `update prediction.source_catalog set last_crawled_at = now() where id = $1`,
      [sourceId],
    );
  }
}
