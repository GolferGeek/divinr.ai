import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';

/**
 * Daily SPY benchmark ingestion via Polygon.
 * Writes one row per trading day into prediction.benchmark_series.
 */
@Injectable()
export class BenchmarkIngestService {
  private readonly logger = new Logger(BenchmarkIngestService.name);

  constructor(@Inject(DATABASE_SERVICE) private readonly db: DatabaseService) {}

  @Cron('0 23 * * 1-5')
  async handleCron(): Promise<void> {
    if (process.env.MARKETS_DISABLE_BENCHMARK_INGEST === 'true') return;
    try {
      await this.ingestSpy();
    } catch (err) {
      this.logger.error(`Benchmark ingest cron failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async ingestSpy(): Promise<{ rowsWritten: number; symbol: string; tradingDate: string | null }> {
    const polygonKey = process.env.POLYGON_API_KEY;
    if (!polygonKey) {
      this.logger.warn('POLYGON_API_KEY not set — falling back to last cached SPY price from instruments table');
      return this.fallbackFromInstruments();
    }

    const bar = await this.fetchSpyPrev(polygonKey);
    if (!bar) {
      this.logger.warn('Polygon returned no SPY bar — falling back to instruments cache');
      return this.fallbackFromInstruments();
    }

    const tradingDate = new Date(bar.t).toISOString().slice(0, 10);
    const result = await this.db.rawQuery(
      `insert into prediction.benchmark_series (symbol, trading_date, close_price, source)
       values ('SPY', $1, $2, 'polygon')
       on conflict (symbol, trading_date) do update set close_price = excluded.close_price, source = excluded.source
       returning symbol`,
      [tradingDate, bar.c],
    );
    const rows = ((result.data as Array<{ symbol: string }> | null) ?? []).length;
    this.logger.log(`SPY benchmark ingested: ${tradingDate} close=${bar.c}`);
    return { rowsWritten: rows, symbol: 'SPY', tradingDate };
  }

  private async fetchSpyPrev(apiKey: string): Promise<{ c: number; t: number } | null> {
    try {
      const response = await fetch(
        `https://api.polygon.io/v2/aggs/ticker/SPY/prev?adjusted=true&apiKey=${apiKey}`,
      );
      if (!response.ok) {
        this.logger.warn(`Polygon SPY fetch ${response.status}: ${response.statusText}`);
        return null;
      }
      const data = (await response.json()) as { results?: Array<{ c: number; t: number }> };
      if (!data.results || data.results.length === 0) return null;
      return { c: data.results[0].c, t: data.results[0].t };
    } catch (err) {
      this.logger.error(`Polygon SPY fetch failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /**
   * Fallback when no API key — read SPY price from prediction.instruments cache
   * if it exists. Lets the dev environment populate at least one row so Phase 5
   * benchmark overlay has data to render.
   */
  private async fallbackFromInstruments(): Promise<{ rowsWritten: number; symbol: string; tradingDate: string | null }> {
    const result = await this.db.rawQuery(
      `select current_state from prediction.instruments where symbol = 'SPY' and is_active = true limit 1`,
    );
    const rows = (result.data as Array<{ current_state: Record<string, unknown> | null }> | null) ?? [];
    if (rows.length === 0) {
      this.logger.warn('No SPY instrument found in cache — nothing to ingest');
      return { rowsWritten: 0, symbol: 'SPY', tradingDate: null };
    }
    const cs = rows[0].current_state ?? {};
    const price = Number((cs as Record<string, unknown>)['price'] ?? 0);
    if (!Number.isFinite(price) || price <= 0) {
      return { rowsWritten: 0, symbol: 'SPY', tradingDate: null };
    }
    const tradingDate = new Date().toISOString().slice(0, 10);
    const ins = await this.db.rawQuery(
      `insert into prediction.benchmark_series (symbol, trading_date, close_price, source)
       values ('SPY', $1, $2, 'instruments_cache')
       on conflict (symbol, trading_date) do update set close_price = excluded.close_price
       returning symbol`,
      [tradingDate, price],
    );
    const written = ((ins.data as Array<{ symbol: string }> | null) ?? []).length;
    return { rowsWritten: written, symbol: 'SPY', tradingDate };
  }
}
