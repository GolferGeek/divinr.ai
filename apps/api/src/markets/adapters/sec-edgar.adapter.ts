import { Injectable, Logger } from '@nestjs/common';
import type { DataSourceAdapter, DataSourceFetchParams, DataSourceResult } from './data-source-adapter';
import { RateLimiter } from './rate-limiter';
import { DataCache } from './data-cache';

const logger = new Logger('SecEdgarAdapter');

// Symbol → CIK mapping for tracked instruments
const CIK_MAP: Record<string, string> = {
  AAPL: '0000320193', MSFT: '0000789019', TSLA: '0001318605',
  GOOGL: '0001652044', AMZN: '0001018724', META: '0001326801',
  NVDA: '0001045810', JPM: '0000019617', V: '0001403161',
  JNJ: '0000200406', WMT: '0000104169', PG: '0000080424',
};

@Injectable()
export class SecEdgarAdapter implements DataSourceAdapter {
  id = 'ds-sec-edgar';
  name = 'SEC EDGAR';
  provider = 'sec-edgar';
  tier = 'free';
  rateLimitPerMinute = 600;

  private limiter = new RateLimiter(600);
  private cache = new DataCache();
  private cacheTtl = 86400;

  async fetchData(params: DataSourceFetchParams): Promise<DataSourceResult> {
    const cik = CIK_MAP[params.symbol];
    if (!cik) {
      return this.emptyResult(params);
    }

    const cacheKey = DataCache.buildKey(this.provider, params.symbol, 'financials');
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return { data: cached, metadata: { source: this.name, fetchedAt: new Date().toISOString(), cached: true, dataTypes: params.dataTypes } };
    }

    try {
      await this.limiter.acquire();
      const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Divinr AI analytics@divinr.ai', Accept: 'application/json' },
      });
      if (!res.ok) {
        logger.warn(`SEC EDGAR failed: ${res.status}`);
        return this.emptyResult(params);
      }
      const json = await res.json() as { facts?: { 'us-gaap'?: Record<string, { units?: { USD?: Array<{ val: number; fy: number; fp: string; end: string }> } }> } };
      const formatted = this.format(json, params.symbol);
      if (formatted) this.cache.set(cacheKey, formatted, this.cacheTtl);
      return {
        data: formatted ?? '',
        metadata: { source: this.name, fetchedAt: new Date().toISOString(), cached: false, dataTypes: params.dataTypes },
      };
    } catch (err) {
      logger.warn(`SEC EDGAR error: ${err instanceof Error ? err.message : String(err)}`);
      return this.emptyResult(params);
    }
  }

  private format(json: { facts?: { 'us-gaap'?: Record<string, { units?: { USD?: Array<{ val: number; fy: number; fp: string; end: string }> } }> } }, symbol: string): string | null {
    const gaap = json.facts?.['us-gaap'];
    if (!gaap) return null;

    const getLatest = (concept: string): string => {
      const entries = gaap[concept]?.units?.USD;
      if (!entries || entries.length === 0) return 'N/A';
      const quarterly = entries.filter(e => e.fp?.startsWith('Q')).sort((a, b) => b.end.localeCompare(a.end));
      const latest = quarterly[0] ?? entries[entries.length - 1];
      const val = latest.val;
      if (Math.abs(val) >= 1e9) return `$${(val / 1e9).toFixed(1)}B`;
      if (Math.abs(val) >= 1e6) return `$${(val / 1e6).toFixed(1)}M`;
      return `$${val.toLocaleString()}`;
    };

    const lines = [
      `[SEC EDGAR Financials — ${symbol}]`,
      `Revenue: ${getLatest('Revenues') !== 'N/A' ? getLatest('Revenues') : getLatest('RevenueFromContractWithCustomerExcludingAssessedTax')}`,
      `Net Income: ${getLatest('NetIncomeLoss')}`,
      `EPS: ${getLatest('EarningsPerShareDiluted')}`,
      `Total Debt: ${getLatest('LongTermDebt')}`,
      `Cash: ${getLatest('CashAndCashEquivalentsAtCarryingValue')}`,
    ];
    return lines.join('\n');
  }

  private emptyResult(params: DataSourceFetchParams): DataSourceResult {
    return { data: '', metadata: { source: this.name, fetchedAt: new Date().toISOString(), cached: false, dataTypes: params.dataTypes } };
  }
}
