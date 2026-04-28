import { Injectable, Logger } from '@nestjs/common';
import type { DataSourceAdapter, DataSourceFetchParams, DataSourceResult } from './data-source-adapter';
import { RateLimiter } from './rate-limiter';
import { DataCache } from './data-cache';
import type { IntradayBar } from './twelve-data.adapter';

const logger = new Logger('PolygonAdapter');
const DEFAULT_RATE_LIMIT_PER_MINUTE = 60;

@Injectable()
export class PolygonAdapter implements DataSourceAdapter {
  id = 'ds-polygon';
  name = 'Polygon.io';
  provider = 'polygon';
  tier = 'premium';
  rateLimitPerMinute = Number(process.env.POLYGON_RATE_LIMIT_PER_MINUTE ?? DEFAULT_RATE_LIMIT_PER_MINUTE);

  private limiter = new RateLimiter(this.rateLimitPerMinute);
  private cache = new DataCache();
  private cacheTtl = 900;

  async fetchData(params: DataSourceFetchParams): Promise<DataSourceResult> {
    const apiKey = process.env.POLYGON_API_KEY;
    if (!apiKey) {
      logger.warn('POLYGON_API_KEY not set — returning empty context');
      return this.emptyResult(params);
    }

    const cacheKey = DataCache.buildKey(this.provider, params.symbol, 'snapshot');
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return { data: cached, metadata: { source: this.name, fetchedAt: new Date().toISOString(), cached: true, dataTypes: params.dataTypes } };
    }

    try {
      await this.limiter.acquire();
      const url = new URL(`https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${params.symbol}`);
      url.searchParams.set('apiKey', apiKey);
      const res = await fetch(url);
      if (!res.ok) {
        logger.warn(`Polygon snapshot failed: ${res.status}`);
        return this.emptyResult(params);
      }
      const json = await res.json() as {
        ticker?: {
          day?: { o: number; h: number; l: number; c: number; v: number };
          prevDay?: { o: number; h: number; l: number; c: number; v: number };
          min?: { av: number };
          todaysChange?: number;
          todaysChangePerc?: number;
        };
      };
      const formatted = this.format(json, params.symbol);
      if (formatted) this.cache.set(cacheKey, formatted, this.cacheTtl);
      return {
        data: formatted ?? '',
        metadata: { source: this.name, fetchedAt: new Date().toISOString(), cached: false, dataTypes: params.dataTypes },
      };
    } catch (err) {
      logger.warn(`Polygon error: ${err instanceof Error ? err.message : String(err)}`);
      return this.emptyResult(params);
    }
  }

  private format(json: Record<string, unknown>, symbol: string): string | null {
    const ticker = json.ticker as Record<string, unknown> | undefined;
    if (!ticker) return null;

    const day = ticker.day as { o: number; h: number; l: number; c: number; v: number } | undefined;
    const prevDay = ticker.prevDay as { c: number; v: number } | undefined;
    if (!day) return null;

    const change = ticker.todaysChange as number ?? 0;
    const changePct = ticker.todaysChangePerc as number ?? 0;
    const volRatio = prevDay?.v ? (day.v / prevDay.v).toFixed(1) : 'N/A';

    const lines = [
      `[Price & Volume — Polygon.io]`,
      `${symbol}: $${day.c?.toFixed(2)} (${change >= 0 ? '+' : ''}${change.toFixed(2)}, ${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%)`,
      `Day Range: $${day.l?.toFixed(2)} - $${day.h?.toFixed(2)}`,
      `Volume: ${this.formatVolume(day.v)} (${volRatio}x prev day)`,
    ];
    return lines.join('\n');
  }

  private formatVolume(v: number): string {
    if (!v) return 'N/A';
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
    return String(v);
  }

  private emptyResult(params: DataSourceFetchParams): DataSourceResult {
    return { data: '', metadata: { source: this.name, fetchedAt: new Date().toISOString(), cached: false, dataTypes: params.dataTypes } };
  }

  async fetchIntradayBars(
    symbol: string,
    intervalMinutes: number,
    limit: number,
  ): Promise<IntradayBar[]> {
    const apiKey = process.env.POLYGON_API_KEY;
    if (!apiKey) {
      logger.warn('POLYGON_API_KEY not set — returning empty intraday bars');
      return [];
    }

    const normalized = symbol.trim().toUpperCase();
    const multiplier = Math.max(1, Math.round(intervalMinutes));
    const timespan = multiplier % 60 === 0 ? 'hour' : 'minute';
    const rangeMultiplier = timespan === 'hour' ? Math.max(1, multiplier / 60) : multiplier;
    const cacheKey = DataCache.buildKey(this.provider, normalized, `aggs:${rangeMultiplier}:${timespan}:${limit}`);
    const cachedRaw = this.cache.get(cacheKey);
    if (cachedRaw) {
      try {
        return JSON.parse(cachedRaw) as IntradayBar[];
      } catch {
        // fall through to refetch if cache entry is corrupt
      }
    }

    const to = new Date();
    const from = new Date(to.getTime() - Math.max(limit * intervalMinutes * 2, 24 * 60) * 60_000);

    try {
      await this.limiter.acquire();
      const url = new URL(
        `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(normalized)}/range/${rangeMultiplier}/${timespan}/${this.formatDate(from)}/${this.formatDate(to)}`,
      );
      url.searchParams.set('adjusted', 'true');
      url.searchParams.set('sort', 'asc');
      url.searchParams.set('limit', String(Math.max(limit, 50)));
      url.searchParams.set('apiKey', apiKey);

      const res = await fetch(url);
      if (!res.ok) {
        logger.warn(`Polygon aggregate bars ${normalized} failed: ${res.status}`);
        return [];
      }
      const json = await res.json() as {
        status?: string;
        results?: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }>;
        error?: string;
      };
      if (json.status === 'ERROR' || !Array.isArray(json.results)) {
        if (json.error) logger.warn(`Polygon aggregate bars ${normalized}: ${json.error}`);
        return [];
      }

      const bars = json.results
        .map((row) => ({
          t: new Date(row.t).toISOString(),
          o: Number(row.o),
          h: Number(row.h),
          l: Number(row.l),
          c: Number(row.c),
          v: Number(row.v ?? 0),
        }))
        .filter((row) =>
          Number.isFinite(row.o) &&
          Number.isFinite(row.h) &&
          Number.isFinite(row.l) &&
          Number.isFinite(row.c) &&
          Number.isFinite(row.v),
        )
        .slice(-limit);

      this.cache.set(cacheKey, JSON.stringify(bars), this.cacheTtl);
      return bars;
    } catch (err) {
      logger.warn(`Polygon aggregate bars ${normalized} error: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  private formatDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
}
