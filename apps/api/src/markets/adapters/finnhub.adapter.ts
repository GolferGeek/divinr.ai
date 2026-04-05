import { Logger } from '@nestjs/common';
import type { DataSourceAdapter, DataSourceFetchParams, DataSourceResult } from './data-source-adapter';
import { RateLimiter } from './rate-limiter';
import { DataCache } from './data-cache';

const logger = new Logger('FinnhubAdapter');

export class FinnhubAdapter implements DataSourceAdapter {
  id = 'ds-finnhub';
  name = 'Finnhub';
  provider = 'finnhub';
  tier = 'free';
  rateLimitPerMinute = 60;

  private limiter = new RateLimiter(60);
  private cache = new DataCache();
  private cacheTtl = 1800;

  async fetchData(params: DataSourceFetchParams): Promise<DataSourceResult> {
    const apiKey = process.env.FINNHUB_API_KEY;
    if (!apiKey) {
      logger.warn('FINNHUB_API_KEY not set — returning empty context');
      return this.emptyResult(params);
    }

    const sections: string[] = [];

    for (const dataType of params.dataTypes) {
      const cacheKey = DataCache.buildKey(this.provider, params.symbol, dataType);
      const cached = this.cache.get(cacheKey);
      if (cached) { sections.push(cached); continue; }

      try {
        await this.limiter.acquire();
        const url = this.buildUrl(dataType, params.symbol, apiKey);
        const res = await fetch(url);
        if (!res.ok) { logger.warn(`Finnhub ${dataType} failed: ${res.status}`); continue; }
        const json = await res.json();
        const formatted = this.format(dataType, json, params.symbol);
        if (formatted) {
          this.cache.set(cacheKey, formatted, this.cacheTtl);
          sections.push(formatted);
        }
      } catch (err) {
        logger.warn(`Finnhub ${dataType} error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return {
      data: sections.length > 0 ? `[Sentiment & Ratings — Finnhub]\n${sections.join('\n')}` : '',
      metadata: { source: this.name, fetchedAt: new Date().toISOString(), cached: false, dataTypes: params.dataTypes },
    };
  }

  private buildUrl(dataType: string, symbol: string, apiKey: string): string {
    const base = 'https://finnhub.io/api/v1';
    switch (dataType) {
      case 'recommendations': return `${base}/stock/recommendation?symbol=${symbol}&token=${apiKey}`;
      case 'insider-transactions': return `${base}/stock/insider-transactions?symbol=${symbol}&token=${apiKey}`;
      case 'price-targets': return `${base}/stock/price-target?symbol=${symbol}&token=${apiKey}`;
      default: return `${base}/stock/${dataType}?symbol=${symbol}&token=${apiKey}`;
    }
  }

  private format(dataType: string, json: unknown, symbol: string): string | null {
    switch (dataType) {
      case 'recommendations': {
        const recs = json as Array<{ buy: number; hold: number; sell: number; strongBuy: number; strongSell: number; period: string }>;
        if (!Array.isArray(recs) || recs.length === 0) return null;
        const latest = recs[0];
        return `Analyst Consensus (${latest.period}): ${latest.strongBuy + latest.buy} Buy, ${latest.hold} Hold, ${latest.sell + latest.strongSell} Sell`;
      }
      case 'insider-transactions': {
        const data = json as { data?: Array<{ name: string; change: number; transactionDate: string }> };
        const txns = data.data ?? [];
        if (txns.length === 0) return null;
        const buys = txns.filter(t => t.change > 0).length;
        const sells = txns.filter(t => t.change < 0).length;
        return `Insider Activity (recent): ${buys} buys, ${sells} sells in last 30d`;
      }
      case 'price-targets': {
        const pt = json as { targetHigh?: number; targetLow?: number; targetMean?: number; targetMedian?: number };
        if (!pt.targetMean) return null;
        return `Price Targets: High $${pt.targetHigh} | Mean $${pt.targetMean?.toFixed(0)} | Median $${pt.targetMedian?.toFixed(0)} | Low $${pt.targetLow}`;
      }
      default: return `${symbol} ${dataType}: ${JSON.stringify(json).slice(0, 300)}`;
    }
  }

  private emptyResult(params: DataSourceFetchParams): DataSourceResult {
    return { data: '', metadata: { source: this.name, fetchedAt: new Date().toISOString(), cached: false, dataTypes: params.dataTypes } };
  }
}
