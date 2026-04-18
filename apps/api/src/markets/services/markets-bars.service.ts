import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import type { IntradayBar } from '../adapters/twelve-data.adapter';
import { IntradayBarRefresherService } from './intraday-bar-refresher.service';
import { MarketHoursService } from './market-hours.service';

interface InstrumentRow {
  id: string;
  symbol: string;
  current_state: Record<string, unknown> | null;
}

@Injectable()
export class MarketsBarsService {
  private readonly logger = new Logger(MarketsBarsService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(IntradayBarRefresherService) private readonly refresher: IntradayBarRefresherService,
    @Inject(MarketHoursService) private readonly marketHours: MarketHoursService,
  ) {}

  async getIntradayBarsForSymbols(symbols: string[]): Promise<Map<string, IntradayBar[]>> {
    const normalized = Array.from(
      new Set(
        (symbols ?? [])
          .map(s => (typeof s === 'string' ? s.trim().toUpperCase() : ''))
          .filter(s => s.length > 0),
      ),
    );

    const out = new Map<string, IntradayBar[]>();
    for (const s of normalized) out.set(s, []);
    if (normalized.length === 0) return out;

    const rows = await this.loadInstruments(normalized);
    for (const row of rows) {
      out.set(row.symbol, this.extractBars(row.current_state));
    }

    const missing = rows.filter(r => this.extractBars(r.current_state).length === 0);

    if (missing.length > 0 && this.marketHours.isUsEquityMarketOpen(new Date())) {
      try {
        await this.refresher.refreshBarsFor(
          missing.map(r => ({ id: r.id, symbol: r.symbol })),
        );
      } catch (err) {
        this.logger.warn(
          `refreshBarsFor threw for ${missing.map(m => m.symbol).join(',')}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      const refreshed = await this.loadInstruments(missing.map(r => r.symbol));
      for (const row of refreshed) {
        out.set(row.symbol, this.extractBars(row.current_state));
      }
    }

    return out;
  }

  private async loadInstruments(symbols: string[]): Promise<InstrumentRow[]> {
    if (symbols.length === 0) return [];
    const result = await this.db.rawQuery(
      `select id, symbol, current_state
         from prediction.instruments
        where symbol = any($1::text[])`,
      [symbols],
    );
    if (result.error) {
      this.logger.warn(`loadInstruments failed: ${result.error.message}`);
      return [];
    }
    return (result.data as InstrumentRow[] | null) ?? [];
  }

  private extractBars(currentState: Record<string, unknown> | null): IntradayBar[] {
    if (!currentState) return [];
    const raw = (currentState as Record<string, unknown>).intraday_bars;
    if (!Array.isArray(raw)) return [];
    const bars: IntradayBar[] = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      const t = typeof e.t === 'string' ? e.t : null;
      const o = Number(e.o);
      const h = Number(e.h);
      const l = Number(e.l);
      const c = Number(e.c);
      const v = Number(e.v ?? 0);
      if (!t || !Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c) || !Number.isFinite(v)) {
        continue;
      }
      bars.push({ t, o, h, l, c, v });
    }
    return bars;
  }
}
