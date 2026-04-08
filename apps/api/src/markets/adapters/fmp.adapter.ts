import { Injectable, Logger } from '@nestjs/common';
import type { DataSourceAdapter, DataSourceFetchParams, DataSourceResult } from './data-source-adapter';
import { RateLimiter } from './rate-limiter';
import { DataCache } from './data-cache';

const logger = new Logger('FmpAdapter');

@Injectable()
export class FmpAdapter implements DataSourceAdapter {
  id = 'ds-fmp';
  name = 'Financial Modeling Prep';
  provider = 'fmp';
  tier = 'free';
  rateLimitPerMinute = 4;

  private limiter = new RateLimiter(4);
  private cache = new DataCache();

  async fetchData(params: DataSourceFetchParams): Promise<DataSourceResult> {
    const apiKey = process.env.FMP_API_KEY;
    if (!apiKey) {
      logger.warn('FMP_API_KEY not set — returning empty context');
      return this.emptyResult(params);
    }

    const sections: string[] = [];

    for (const dataType of params.dataTypes) {
      const ttl = dataType === 'sector-performance' ? 3600 : 86400;
      const cacheKey = DataCache.buildKey(this.provider, params.symbol, dataType);
      const cached = this.cache.get(cacheKey);
      if (cached) { sections.push(cached); continue; }

      try {
        await this.limiter.acquire();
        const url = this.buildUrl(dataType, params.symbol, apiKey);
        const res = await fetch(url);
        if (!res.ok) { logger.warn(`FMP ${dataType} failed: ${res.status}`); continue; }
        const json = await res.json();
        const formatted = this.format(dataType, json);
        if (formatted) {
          this.cache.set(cacheKey, formatted, ttl);
          sections.push(formatted);
        }
      } catch (err) {
        logger.warn(`FMP ${dataType} error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return {
      data: sections.length > 0 ? `[Fundamentals — FMP]\n${sections.join('\n')}` : '',
      metadata: { source: this.name, fetchedAt: new Date().toISOString(), cached: false, dataTypes: params.dataTypes },
    };
  }

  private buildUrl(dataType: string, symbol: string, apiKey: string): string {
    const base = 'https://financialmodelingprep.com/api/v3';
    switch (dataType) {
      case 'ratios': return `${base}/ratios/${symbol}?limit=1&apikey=${apiKey}`;
      case 'earnings': return `${base}/earning_calendar?symbol=${symbol}&limit=4&apikey=${apiKey}`;
      case 'income-statement': return `${base}/income-statement/${symbol}?limit=1&apikey=${apiKey}`;
      case 'earnings-surprise': return `${base}/earnings-surprises/${symbol}?apikey=${apiKey}`;
      case 'sector-performance': return `${base}/sectors-performance?apikey=${apiKey}`;
      default: return `${base}/${dataType}/${symbol}?limit=1&apikey=${apiKey}`;
    }
  }

  private format(dataType: string, json: unknown): string | null {
    const data = Array.isArray(json) ? json[0] : json;
    if (!data) return null;

    switch (dataType) {
      case 'ratios': {
        const r = data as Record<string, number>;
        return `P/E: ${r.priceEarningsRatio?.toFixed(1) ?? 'N/A'} | EV/EBITDA: ${r.enterpriseValueOverEBITDA?.toFixed(1) ?? 'N/A'} | FCF Yield: ${((r.freeCashFlowYield ?? 0) * 100).toFixed(1)}% | ROE: ${((r.returnOnEquity ?? 0) * 100).toFixed(1)}%`;
      }
      case 'earnings': {
        const e = data as Record<string, string | number>;
        return `Earnings: EPS est ${e.epsEstimated} | Date: ${e.date} | Revenue est: ${e.revenueEstimated}`;
      }
      case 'income-statement': {
        const i = data as Record<string, number | string>;
        return `Revenue: ${this.formatLarge(i.revenue as number)} | Net Income: ${this.formatLarge(i.netIncome as number)} | EPS: ${i.eps}`;
      }
      case 'earnings-surprise': {
        const s = data as Record<string, number | string>;
        return `Earnings Surprise: actual ${s.actualEarningResult} vs est ${s.estimatedEarning} (${((Number(s.actualEarningResult) - Number(s.estimatedEarning)) / Math.abs(Number(s.estimatedEarning)) * 100).toFixed(1)}% surprise)`;
      }
      case 'sector-performance': {
        if (!Array.isArray(json)) return null;
        const top3 = (json as Array<Record<string, string>>).slice(0, 5);
        return `Sector Performance:\n${top3.map(s => `  ${s.sector}: ${s.changesPercentage}`).join('\n')}`;
      }
      default: return `${dataType}: ${JSON.stringify(data).slice(0, 300)}`;
    }
  }

  private formatLarge(n: number): string {
    if (!n) return 'N/A';
    if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
    if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
    return `$${n.toLocaleString()}`;
  }

  private emptyResult(params: DataSourceFetchParams): DataSourceResult {
    return { data: '', metadata: { source: this.name, fetchedAt: new Date().toISOString(), cached: false, dataTypes: params.dataTypes } };
  }
}
