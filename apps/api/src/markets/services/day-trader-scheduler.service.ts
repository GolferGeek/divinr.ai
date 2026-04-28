import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { DayTraderRunnerService } from './day-trader-runner.service';
import { IntradayBarRefresherService } from './intraday-bar-refresher.service';
import { MarketHoursService } from './market-hours.service';

export interface MarketDayTraderRunRow {
  id: string;
  fired_at: string;
  market_open: boolean;
  bars_refreshed: number;
  bars_refresh_failed: number;
  portfolios_run: number;
  opens_written: number;
  closes_written: number;
  duration_ms: number;
  error: string | null;
}

const DEFAULT_CRON = '0 14,17,20 * * 1-5';
const DEFAULT_EOD_CRON = '55 15 * * 1-5';
const EOD_CRON_TZ = 'America/New_York';

@Injectable()
export class DayTraderSchedulerService {
  private readonly logger = new Logger(DayTraderSchedulerService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(DayTraderRunnerService) private readonly runner: DayTraderRunnerService,
    @Inject(IntradayBarRefresherService) private readonly refresher: IntradayBarRefresherService,
    @Inject(MarketHoursService) private readonly marketHours: MarketHoursService,
  ) {}

  @Cron(process.env.DAY_TRADER_CRON ?? DEFAULT_CRON)
  async scheduledTick(): Promise<void> {
    if (process.env.DAY_TRADER_DISABLE_CRON === 'true') return;
    try {
      await this.handleCron();
    } catch (err) {
      this.logger.error(
        `scheduledTick failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  @Cron(process.env.DAY_TRADER_EOD_CRON ?? DEFAULT_EOD_CRON, { timeZone: EOD_CRON_TZ })
  async scheduledEodFlat(): Promise<void> {
    if (process.env.DAY_TRADER_DISABLE_CRON === 'true') return;
    try {
      await this.handleCron({ forceEodFlat: true });
    } catch (err) {
      this.logger.error(
        `scheduledEodFlat failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async handleCron(
    opts: { manual?: boolean; forceEodFlat?: boolean } = {},
  ): Promise<MarketDayTraderRunRow> {
    const startedAt = Date.now();
    const now = new Date();
    const open = this.marketHours.isUsEquityMarketOpen(now);

    if (!open) {
      this.logger.log('handleCron: market closed — recording audit row and exiting');
      return this.writeRunRow({
        market_open: false,
        bars_refreshed: 0,
        bars_refresh_failed: 0,
        portfolios_run: 0,
        opens_written: 0,
        closes_written: 0,
        duration_ms: Date.now() - startedAt,
        error: null,
      });
    }

    let barsRefreshed = 0;
    let barsRefreshFailed = 0;
    let portfoliosRun = 0;
    let opensWritten = 0;
    let closesWritten = 0;
    let errorMessage: string | null = null;

    try {
      const instruments = await this.loadActiveInstruments();
      const refresh = await this.refresher.refreshBarsFor(instruments);
      barsRefreshed = refresh.refreshed;
      barsRefreshFailed = refresh.failed;

      const isLastTick = opts.forceEodFlat === true
        || DayTraderRunnerService.isLastTickOfSession(now);
      const runResult = await this.runner.runStrategies({ isLastTickOfSession: isLastTick });
      portfoliosRun = runResult.strategiesRun;
      opensWritten = runResult.opensWritten;
      closesWritten = runResult.closesWritten;
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error(`handleCron error: ${errorMessage}`);
    }

    const row = await this.writeRunRow({
      market_open: true,
      bars_refreshed: barsRefreshed,
      bars_refresh_failed: barsRefreshFailed,
      portfolios_run: portfoliosRun,
      opens_written: opensWritten,
      closes_written: closesWritten,
      duration_ms: Date.now() - startedAt,
      error: errorMessage,
    });

    if (errorMessage) {
      throw new Error(errorMessage);
    }

    return row;
  }

  private async loadActiveInstruments(): Promise<Array<{ id: string; symbol: string }>> {
    const result = await this.db.rawQuery(
      `select distinct on (symbol) id, symbol
         from prediction.instruments
        where is_active = true
          and coalesce(asset_type, 'stock') = 'stock'
          and symbol ~ '^[A-Z]{1,5}$'
        order by symbol`,
      [],
    );
    return ((result.data as Array<{ id: string; symbol: string }> | null) ?? []);
  }

  private async writeRunRow(row: Omit<MarketDayTraderRunRow, 'id' | 'fired_at'>): Promise<MarketDayTraderRunRow> {
    const result = await this.db.rawQuery(
      `insert into prediction.market_day_trader_runs
         (market_open, bars_refreshed, bars_refresh_failed, portfolios_run,
          opens_written, closes_written, duration_ms, error)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning id, fired_at, market_open, bars_refreshed, bars_refresh_failed,
                 portfolios_run, opens_written, closes_written, duration_ms, error`,
      [
        row.market_open,
        row.bars_refreshed,
        row.bars_refresh_failed,
        row.portfolios_run,
        row.opens_written,
        row.closes_written,
        row.duration_ms,
        row.error,
      ],
    );
    const rows = (result.data as MarketDayTraderRunRow[] | null) ?? [];
    if (rows.length === 0) {
      return {
        id: '',
        fired_at: new Date().toISOString(),
        ...row,
      };
    }
    return rows[0];
  }
}
