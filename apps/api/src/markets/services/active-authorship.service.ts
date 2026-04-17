import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { MarketsSchemaService } from '../schema/markets-schema.service';

@Injectable()
export class ActiveAuthorshipService {
  private readonly logger = new Logger(ActiveAuthorshipService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(MarketsSchemaService) private readonly schema: MarketsSchemaService,
  ) {}

  /**
   * Pre-billing placeholder: all authors are active.
   * When billing integration ships, this will check subscription status.
   */
  async isAuthorActive(userId: string): Promise<boolean> {
    return userId !== null && userId !== undefined;
  }

  /**
   * List authored analysts wired to a specific instrument via
   * viewer_instrument_analyst_assignments. Only returns analysts
   * where user_id IS NOT NULL (authored, not base).
   */
  async listActiveAuthoredAnalysts(instrumentId: string): Promise<any[]> {
    await this.schema.ensureSchema();
    const result = await this.db.rawQuery(
      `SELECT DISTINCT ma.id, ma.slug, ma.display_name, ma.user_id, ma.current_config_version_id,
              viaa.viewer_user_id
       FROM prediction.viewer_instrument_analyst_assignments viaa
       JOIN prediction.market_analysts ma ON ma.id = viaa.analyst_id
       WHERE viaa.instrument_id = $1
         AND ma.is_active = true
         AND ma.user_id IS NOT NULL`,
      [instrumentId],
    );
    return (result.data as any[] | null) ?? [];
  }

  /**
   * List all active authored instruments (user_id IS NOT NULL).
   */
  async listActiveAuthoredInstruments(): Promise<any[]> {
    await this.schema.ensureSchema();
    const result = await this.db.rawQuery(
      `SELECT id, symbol, name, asset_type, user_id
       FROM prediction.instruments
       WHERE is_active = true AND user_id IS NOT NULL`,
    );
    return (result.data as any[] | null) ?? [];
  }
}
