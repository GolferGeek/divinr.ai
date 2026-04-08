import { Injectable, Logger } from '@nestjs/common';
import type { DataSourceAdapter, DataSourceFetchParams, DataSourceResult } from './data-source-adapter';
import { RateLimiter } from './rate-limiter';
import { DataCache } from './data-cache';

const logger = new Logger('RedditAdapter');

@Injectable()
export class RedditAdapter implements DataSourceAdapter {
  id = 'ds-reddit';
  name = 'Reddit';
  provider = 'reddit';
  tier = 'free';
  rateLimitPerMinute = 100;

  private limiter = new RateLimiter(100);
  private cache = new DataCache();
  private cacheTtl = 1800;

  async fetchData(params: DataSourceFetchParams): Promise<DataSourceResult> {
    const cacheKey = DataCache.buildKey(this.provider, params.symbol, 'posts');
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return { data: cached, metadata: { source: this.name, fetchedAt: new Date().toISOString(), cached: true, dataTypes: params.dataTypes } };
    }

    const subreddits = ['wallstreetbets', 'stocks'];
    const allPosts: Array<{ title: string; score: number; subreddit: string }> = [];

    for (const sub of subreddits) {
      try {
        await this.limiter.acquire();
        const url = `https://www.reddit.com/r/${sub}/search.json?q=${params.symbol}&sort=new&limit=5&restrict_sr=on&t=week`;
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Divinr/1.0 (analytics@divinr.ai)' },
        });
        if (!res.ok) {
          logger.warn(`Reddit r/${sub} failed: ${res.status}`);
          continue;
        }
        const json = await res.json() as { data?: { children?: Array<{ data: { title: string; score: number; subreddit: string } }> } };
        const children = json.data?.children ?? [];
        for (const child of children) {
          allPosts.push({ title: child.data.title, score: child.data.score, subreddit: child.data.subreddit });
        }
      } catch (err) {
        logger.warn(`Reddit r/${sub} error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (allPosts.length === 0) return this.emptyResult(params);

    // Sort by score descending, take top 8
    allPosts.sort((a, b) => b.score - a.score);
    const top = allPosts.slice(0, 8);
    const formatted = `[Social Sentiment — Reddit]\n${top.map(p => `r/${p.subreddit} (${p.score}↑): ${p.title.slice(0, 120)}`).join('\n')}`;

    this.cache.set(cacheKey, formatted, this.cacheTtl);
    return {
      data: formatted,
      metadata: { source: this.name, fetchedAt: new Date().toISOString(), cached: false, dataTypes: params.dataTypes },
    };
  }

  private emptyResult(params: DataSourceFetchParams): DataSourceResult {
    return { data: '', metadata: { source: this.name, fetchedAt: new Date().toISOString(), cached: false, dataTypes: params.dataTypes } };
  }
}
