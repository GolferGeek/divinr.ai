import { Injectable, Inject, ForbiddenException } from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { MarketsSchemaService } from '../schema/markets-schema.service';

@Injectable()
export class WiringService {
  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(MarketsSchemaService) private readonly schema: MarketsSchemaService,
  ) {}

  async listMyWirings(userId: string) {
    await this.schema.ensureSchema();
    // Analysts: authored (user_id = userId) + base (user_id IS NULL, is_active)
    const analysts = await this.db.rawQuery(
      `SELECT id, slug, display_name, user_id FROM prediction.market_analysts
       WHERE is_active = true AND (user_id IS NULL OR user_id = $1)
       ORDER BY display_name`,
      [userId],
    );
    // Instruments: same
    const instruments = await this.db.rawQuery(
      `SELECT id, symbol, name, user_id FROM prediction.instruments
       WHERE is_active = true AND (user_id IS NULL OR user_id = $1)
       ORDER BY symbol`,
      [userId],
    );
    // Wirings
    const wirings = await this.db.rawQuery(
      `SELECT analyst_id AS "analystId", instrument_id AS "instrumentId"
       FROM prediction.viewer_instrument_analyst_assignments
       WHERE viewer_user_id = $1`,
      [userId],
    );
    return {
      analysts: analysts.data ?? [],
      instruments: instruments.data ?? [],
      wirings: wirings.data ?? [],
    };
  }

  async addWiring(userId: string, analystId: string, instrumentId: string) {
    await this.schema.ensureSchema();
    // Validate analyst ownership
    const analystResult = await this.db.rawQuery(
      `SELECT user_id FROM prediction.market_analysts WHERE id = $1`,
      [analystId],
    );
    const analystRows = (analystResult.data as any[] ?? []);
    if (
      analystRows.length > 0 &&
      analystRows[0].user_id !== null &&
      analystRows[0].user_id !== userId
    ) {
      throw new ForbiddenException('Cannot wire another user\'s authored analyst');
    }
    // Insert with ON CONFLICT DO NOTHING (idempotent)
    await this.db.rawQuery(
      `INSERT INTO prediction.viewer_instrument_analyst_assignments
        (viewer_user_id, instrument_id, analyst_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (viewer_user_id, instrument_id, analyst_id) DO NOTHING`,
      [userId, instrumentId, analystId],
    );
    return { analystId, instrumentId };
  }

  async removeWiring(userId: string, analystId: string, instrumentId: string) {
    await this.schema.ensureSchema();
    await this.db.rawQuery(
      `DELETE FROM prediction.viewer_instrument_analyst_assignments
       WHERE viewer_user_id = $1 AND instrument_id = $2 AND analyst_id = $3`,
      [userId, instrumentId, analystId],
    );
    return { removed: true };
  }
}
