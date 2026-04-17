import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';

export interface RefreshResult {
  refreshed: number;
  failed: string[];
}

export const ATTRIBUTION_VIEWS = [
  'prediction.attribution_per_triple_monthly',
  'prediction.attribution_per_analyst_monthly',
  'prediction.attribution_per_instrument_monthly',
  'prediction.attribution_per_source_monthly',
  'prediction.attribution_per_article_lifetime',
  'prediction.attribution_per_author_monthly',
] as const;

@Injectable()
export class AttributionAggregationService {
  private readonly logger = new Logger(AttributionAggregationService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
  ) {}

  /**
   * Nightly refresh of attribution materialized views.
   * Gated by ATTRIBUTION_DISABLE_NIGHTLY_REFRESH=true. Runs at 00:30 daily (after the
   * evaluation cycle at 00:00 has produced new outcome_records rows).
   */
  @Cron('30 0 * * *')
  async handleNightlyRefresh(): Promise<void> {
    if (process.env.ATTRIBUTION_DISABLE_NIGHTLY_REFRESH === 'true') {
      this.logger.log('Nightly refresh skipped (ATTRIBUTION_DISABLE_NIGHTLY_REFRESH=true)');
      return;
    }
    try {
      await this.refreshViews();
    } catch (err) {
      this.logger.error(`Nightly attribution refresh failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Refresh all 6 attribution materialized views. Tries REFRESH CONCURRENTLY first
   * (requires unique index, which every view has); on failure falls back to
   * non-CONCURRENT refresh; on per-view failure, records the view in `failed` and
   * continues. Never throws.
   */
  async refreshViews(): Promise<RefreshResult> {
    const failed: string[] = [];
    let refreshed = 0;

    for (const view of ATTRIBUTION_VIEWS) {
      let concurrentErr: unknown = null;
      try {
        const res = await this.db.rawQuery(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${view}`);
        if (res?.error) concurrentErr = new Error(res.error.message);
      } catch (thrown) {
        concurrentErr = thrown;
      }
      if (!concurrentErr) {
        refreshed++;
        continue;
      }
      let fallbackErr: unknown = null;
      try {
        const res = await this.db.rawQuery(`REFRESH MATERIALIZED VIEW ${view}`);
        if (res?.error) fallbackErr = new Error(res.error.message);
      } catch (thrown) {
        fallbackErr = thrown;
      }
      if (!fallbackErr) {
        refreshed++;
      } else {
        failed.push(view);
        this.logger.warn(
          `Failed to refresh ${view} (concurrent: ${this.msg(concurrentErr)}, fallback: ${this.msg(fallbackErr)})`,
        );
      }
    }

    this.logger.log(`Attribution views refreshed: ${refreshed}/${ATTRIBUTION_VIEWS.length} (failed: ${failed.length})`);
    return { refreshed, failed };
  }

  private msg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
