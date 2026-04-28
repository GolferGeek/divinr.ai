import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { PolygonAdapter } from '../adapters/polygon.adapter';
import { TwelveDataAdapter } from '../adapters/twelve-data.adapter';
import { INTRADAY_BARS_CAP } from '../constants';

export interface IntradayRefreshResult {
  refreshed: number;
  failed: number;
}

@Injectable()
export class IntradayBarRefresherService {
  private readonly logger = new Logger(IntradayBarRefresherService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(PolygonAdapter) private readonly polygon: PolygonAdapter,
    @Inject(TwelveDataAdapter) private readonly twelveData: TwelveDataAdapter,
  ) {}

  async refreshBarsFor(
    instruments: Array<{ id: string; symbol: string }>,
  ): Promise<IntradayRefreshResult> {
    let refreshed = 0;
    let failed = 0;

    for (const inst of instruments) {
      try {
        let bars = await this.polygon.fetchIntradayBars(inst.symbol, 60, INTRADAY_BARS_CAP);
        if (!bars || bars.length === 0) {
          bars = await this.twelveData.fetchIntradayBars(inst.symbol, 60, INTRADAY_BARS_CAP);
        }
        if (!bars || bars.length === 0) {
          failed++;
          continue;
        }
        const trimmed = bars.slice(-INTRADAY_BARS_CAP);
        const result = await this.db.rawQuery(
          `update prediction.instruments
              set current_state = coalesce(current_state, '{}'::jsonb)
                                  || jsonb_build_object('intraday_bars', $1::jsonb),
                  updated_at = now()
            where id = $2`,
          [JSON.stringify(trimmed), inst.id],
        );
        if (result.error) {
          this.logger.warn(
            `refreshBarsFor ${inst.symbol}: db write failed: ${result.error.message}`,
          );
          failed++;
          continue;
        }
        refreshed++;
      } catch (err) {
        this.logger.warn(
          `refreshBarsFor ${inst.symbol} threw: ${err instanceof Error ? err.message : String(err)}`,
        );
        failed++;
      }
    }

    return { refreshed, failed };
  }
}
