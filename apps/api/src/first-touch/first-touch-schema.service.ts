import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';

/**
 * Idempotent DDL for prediction.user_surface_touches.
 *
 * Mirrors the migration file at apps/api/db/migrations/2026-04-19-user-surface-touches.sql,
 * but is the source of truth for what actually runs at app boot / first request.
 *
 * Pattern copied from OnboardingSchemaService: memoize with schemaReady, call
 * ensureSchema() at the top of every service method that touches this table.
 */
@Injectable()
export class FirstTouchSchemaService {
  private schemaReady = false;
  private readonly logger = new Logger(FirstTouchSchemaService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
  ) {}

  async ensureSchema(): Promise<void> {
    if (this.schemaReady) return;

    const ddl = `
      CREATE TABLE IF NOT EXISTS prediction.user_surface_touches (
        user_id           TEXT NOT NULL,
        surface_key       TEXT NOT NULL,
        first_touched_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        dismissed         BOOLEAN NOT NULL DEFAULT false,
        PRIMARY KEY (user_id, surface_key)
      );

      CREATE INDEX IF NOT EXISTS idx_user_surface_touches_user
        ON prediction.user_surface_touches(user_id);
    `;

    const result = await this.db.rawQuery(ddl);
    if (result.error) {
      this.logger.error(`ensureSchema failed: ${result.error.message}`);
      throw new Error(result.error.message);
    }
    this.schemaReady = true;
  }
}
