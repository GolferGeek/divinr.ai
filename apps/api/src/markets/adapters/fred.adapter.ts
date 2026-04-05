import { Logger } from '@nestjs/common';
import type { DataSourceAdapter, DataSourceFetchParams, DataSourceResult } from './data-source-adapter';
import { RateLimiter } from './rate-limiter';
import { DataCache } from './data-cache';

const logger = new Logger('FredAdapter');

const SERIES_MAP: Record<string, string> = {
  'yield-curve': 'T10Y2Y',
  'cpi': 'CPIAUCSL',
  'unemployment': 'UNRATE',
  'vix': 'VIXCLS',
  'gdp': 'GDP',
  'fed-funds': 'FEDFUNDS',
  '10y': 'DGS10',
  '2y': 'DGS2',
};

export class FredAdapter implements DataSourceAdapter {
  id = 'ds-fred';
  name = 'FRED';
  provider = 'fred';
  tier = 'free';
  rateLimitPerMinute = 120;

  private limiter = new RateLimiter(120);
  private cache = new DataCache();
  private cacheTtl = 3600;

  async fetchData(params: DataSourceFetchParams): Promise<DataSourceResult> {
    const apiKey = process.env.FRED_API_KEY;
    if (!apiKey) {
      logger.warn('FRED_API_KEY not set — returning empty context');
      return this.emptyResult(params);
    }

    const sections: string[] = [];

    for (const dataType of params.dataTypes) {
      const seriesId = SERIES_MAP[dataType] ?? dataType.toUpperCase();
      const cacheKey = DataCache.buildKey(this.provider, 'macro', seriesId);
      const cached = this.cache.get(cacheKey);
      if (cached) { sections.push(cached); continue; }

      try {
        await this.limiter.acquire();
        const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=5`;
        const res = await fetch(url);
        if (!res.ok) { logger.warn(`FRED ${seriesId} failed: ${res.status}`); continue; }
        const json = await res.json() as { observations?: Array<{ date: string; value: string }> };
        const formatted = this.format(dataType, seriesId, json.observations ?? []);
        if (formatted) {
          this.cache.set(cacheKey, formatted, this.cacheTtl);
          sections.push(formatted);
        }
      } catch (err) {
        logger.warn(`FRED ${seriesId} error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return {
      data: sections.length > 0 ? `[Macro Economics — FRED]\n${sections.join('\n')}` : '',
      metadata: { source: this.name, fetchedAt: new Date().toISOString(), cached: false, dataTypes: params.dataTypes },
    };
  }

  private format(dataType: string, seriesId: string, observations: Array<{ date: string; value: string }>): string | null {
    if (observations.length === 0) return null;
    const latest = observations.find(o => o.value !== '.')?.value ?? observations[0].value;
    if (latest === '.') return null;

    const labels: Record<string, string> = {
      'yield-curve': `Yield Curve (10Y-2Y): ${latest}%`,
      'cpi': `CPI: ${latest} (YoY inflation proxy)`,
      'unemployment': `Unemployment: ${latest}%`,
      'vix': `VIX: ${latest}`,
      'gdp': `GDP: $${(parseFloat(latest) / 1000).toFixed(1)}T`,
      'fed-funds': `Fed Funds Rate: ${latest}%`,
      '10y': `10Y Treasury: ${latest}%`,
      '2y': `2Y Treasury: ${latest}%`,
    };

    return labels[dataType] ?? `${seriesId}: ${latest}`;
  }

  private emptyResult(params: DataSourceFetchParams): DataSourceResult {
    return { data: '', metadata: { source: this.name, fetchedAt: new Date().toISOString(), cached: false, dataTypes: params.dataTypes } };
  }
}
