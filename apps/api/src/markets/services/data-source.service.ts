import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import type { DataSourceAdapter, DataSourceResult } from '../adapters/data-source-adapter';
import { TwelveDataAdapter } from '../adapters/twelve-data.adapter';
import { FmpAdapter } from '../adapters/fmp.adapter';
import { SecEdgarAdapter } from '../adapters/sec-edgar.adapter';
import { FinnhubAdapter } from '../adapters/finnhub.adapter';
import { FredAdapter } from '../adapters/fred.adapter';
import { PolygonAdapter } from '../adapters/polygon.adapter';
import { RedditAdapter } from '../adapters/reddit.adapter';

interface SourceAssignment {
  source_id: string;
  data_types: string[];
}

/**
 * Manages all data source adapters. Fetches specialized data per analyst
 * based on their source assignments in the database.
 */
@Injectable()
export class DataSourceService {
  private readonly logger = new Logger(DataSourceService.name);
  private readonly adapters: Map<string, DataSourceAdapter>;

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(TwelveDataAdapter) twelveData: TwelveDataAdapter,
    @Inject(FmpAdapter) fmp: FmpAdapter,
    @Inject(SecEdgarAdapter) secEdgar: SecEdgarAdapter,
    @Inject(FinnhubAdapter) finnhub: FinnhubAdapter,
    @Inject(FredAdapter) fred: FredAdapter,
    @Inject(PolygonAdapter) polygon: PolygonAdapter,
    @Inject(RedditAdapter) reddit: RedditAdapter,
  ) {
    // Register all adapters by their ID. Adapters are injected via NestJS DI
    // (registered in MarketsModule) so tests can swap them via .overrideProvider().
    const adapterList: DataSourceAdapter[] = [
      twelveData,
      fmp,
      secEdgar,
      finnhub,
      fred,
      polygon,
      reddit,
    ];
    this.adapters = new Map(adapterList.map(a => [a.id, a]));
  }

  /**
   * Fetch all specialized data for a given analyst and instrument symbol.
   * Loads the analyst's source assignments, calls each adapter, and returns
   * combined formatted output ready for prompt injection.
   *
   * Individual adapter failures are handled gracefully — one failure
   * doesn't kill the whole fetch.
   */
  async fetchForAnalyst(
    analystId: string,
    symbol: string,
  ): Promise<{ context: string; sourceContext: Record<string, unknown> }> {
    const assignments = await this.getAssignments(analystId);
    if (assignments.length === 0) {
      return { context: '', sourceContext: {} };
    }

    const results: DataSourceResult[] = [];
    const sourceContext: Record<string, unknown> = {};

    // Fetch from each assigned source in parallel
    const fetches = assignments.map(async (assignment) => {
      const adapter = this.adapters.get(assignment.source_id);
      if (!adapter) {
        this.logger.warn(`No adapter for source ${assignment.source_id}`);
        return;
      }

      try {
        const result = await adapter.fetchData({
          symbol,
          dataTypes: assignment.data_types,
        });

        if (result.data) {
          // Sanitize: strip HTML, cap at 1500 chars per source
          const sanitized = this.sanitize(result.data, 1500);
          results.push({ ...result, data: sanitized });
          sourceContext[adapter.id] = {
            name: adapter.name,
            dataTypes: assignment.data_types,
            cached: result.metadata.cached,
            fetchedAt: result.metadata.fetchedAt,
            charCount: sanitized.length,
          };
        }
      } catch (err) {
        this.logger.warn(
          `Adapter ${adapter.name} failed for ${symbol}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });

    await Promise.all(fetches);

    const context = results
      .filter(r => r.data.length > 0)
      .map(r => r.data)
      .join('\n\n');

    return { context, sourceContext };
  }

  private async getAssignments(analystId: string): Promise<SourceAssignment[]> {
    const result = await this.db.rawQuery(
      `select source_id, data_types from prediction.analyst_source_assignments
       where analyst_id = $1 and is_active = true
       order by priority`,
      [analystId],
    );
    return (result.data as SourceAssignment[] | null) ?? [];
  }

  private sanitize(text: string, maxLen: number): string {
    // Strip HTML tags
    let clean = text.replace(/<[^>]*>/g, '');
    // Remove potentially malicious prompt injection patterns
    clean = clean.replace(/\b(ignore|disregard|forget)\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|context)/gi, '[filtered]');
    // Cap length
    if (clean.length > maxLen) {
      clean = clean.slice(0, maxLen) + '\n[...truncated]';
    }
    return clean;
  }
}
