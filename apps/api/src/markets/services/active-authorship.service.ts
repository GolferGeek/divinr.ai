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
   * Checks whether the author's billing subscription is in an active state.
   * Returns true for trial/active subscriptions and for users with no
   * subscription row (pre-billing state).
   */
  async isAuthorActive(userId: string): Promise<boolean> {
    if (!userId) return false;
    const result = await this.db.rawQuery(
      `SELECT status FROM billing.subscriptions WHERE user_id = $1`,
      [userId],
    );
    const rows = (result.data as Array<{ status: string }> | null) ?? [];
    if (rows.length === 0) return true; // No subscription row yet = pre-billing, treat as active
    return ['trial', 'active'].includes(rows[0].status);
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
