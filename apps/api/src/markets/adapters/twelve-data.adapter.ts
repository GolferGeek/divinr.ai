import { Logger } from '@nestjs/common';
import type { DataSourceAdapter, DataSourceFetchParams, DataSourceResult } from './data-source-adapter';
import { RateLimiter } from './rate-limiter';
import { DataCache } from './data-cache';

const logger = new Logger('TwelveDataAdapter');

export class TwelveDataAdapter implements DataSourceAdapter {
  id = 'ds-twelve-data';
  name = 'Twelve Data';
  provider = 'twelve-data';
  tier = 'free';
  rateLimitPerMinute = 8;

  private limiter = new RateLimiter(8);
  private cache = new DataCache();
  private cacheTtl = 900;

  async fetchData(params: DataSourceFetchParams): Promise<DataSourceResult> {
    const apiKey = process.env.TWELVE_DATA_API_KEY;
    if (!apiKey) {
      logger.warn('TWELVE_DATA_API_KEY not set — returning empty context');
      return this.emptyResult(params);
    }

    const sections: string[] = [];

    for (const dataType of params.dataTypes) {
      const cacheKey = DataCache.buildKey(this.provider, params.symbol, dataType);
      const cached = this.cache.get(cacheKey);
      if (cached) {
        sections.push(cached);
        continue;
      }

      try {
        await this.limiter.acquire();
        const endpoint = this.getEndpoint(dataType);
        const url = `https://api.twelvedata.com/${endpoint}?symbol=${params.symbol}&interval=1day&apikey=${apiKey}&outputsize=5`;
        const res = await fetch(url);
        if (!res.ok) {
          logger.warn(`Twelve Data ${dataType} failed: ${res.status}`);
          continue;
        }
        const json = await res.json() as Record<string, unknown>;
        const formatted = this.format(dataType, json);
        if (formatted) {
          this.cache.set(cacheKey, formatted, this.cacheTtl);
          sections.push(formatted);
        }
      } catch (err) {
        logger.warn(`Twelve Data ${dataType} error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return {
      data: sections.length > 0 ? `[Technical Indicators — Twelve Data]\n${sections.join('\n')}` : '',
      metadata: { source: this.name, fetchedAt: new Date().toISOString(), cached: false, dataTypes: params.dataTypes },
    };
  }

  private getEndpoint(dataType: string): string {
    const map: Record<string, string> = { rsi: 'rsi', macd: 'macd', sma: 'sma', ema: 'ema', bbands: 'bbands', roc: 'roc' };
    return map[dataType] ?? dataType;
  }

  private format(dataType: string, json: Record<string, unknown>): string | null {
    if (json.status === 'error' || !json.values) return null;
    const values = json.values as Array<Record<string, string>>;
    if (!values || values.length === 0) return null;
    const latest = values[0];

    switch (dataType) {
      case 'rsi': {
        const val = parseFloat(latest.rsi);
        const zone = val > 70 ? 'overbought' : val < 30 ? 'oversold' : 'neutral';
        return `RSI(14): ${val.toFixed(1)} (${zone})`;
      }
      case 'macd': return `MACD: ${latest.macd} | Signal: ${latest.macd_signal} | Hist: ${latest.macd_hist}`;
      case 'sma': return `SMA(20): ${latest.sma}`;
      case 'ema': return `EMA(20): ${latest.ema}`;
      case 'bbands': return `Bollinger: Upper=${latest.upper_band} Mid=${latest.middle_band} Lower=${latest.lower_band}`;
      case 'roc': return `ROC(10): ${latest.roc}`;
      default: return `${dataType}: ${JSON.stringify(latest).slice(0, 200)}`;
    }
  }

  private emptyResult(params: DataSourceFetchParams): DataSourceResult {
    return { data: '', metadata: { source: this.name, fetchedAt: new Date().toISOString(), cached: false, dataTypes: params.dataTypes } };
  }
}
