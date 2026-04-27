import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import {
  REQUEST_SCHEMA_BOOTSTRAP_LOCK,
  RuntimeSchemaBootstrapCoordinator,
} from '../bootstrap/runtime-schema-bootstrap-coordinator';

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
  private static schemaReady = false;
  private static schemaReadyPromise: Promise<void> | null = null;
  private readonly logger = new Logger(FirstTouchSchemaService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
  ) {}

  async ensureSchema(): Promise<void> {
    if (FirstTouchSchemaService.schemaReady) return;
    await RuntimeSchemaBootstrapCoordinator.runExclusive(REQUEST_SCHEMA_BOOTSTRAP_LOCK, async () => {
      if (FirstTouchSchemaService.schemaReady) return;
      if (FirstTouchSchemaService.schemaReadyPromise) {
        await FirstTouchSchemaService.schemaReadyPromise;
        return;
      }

      FirstTouchSchemaService.schemaReadyPromise = (async () => {
        const ddl = `
      CREATE SCHEMA IF NOT EXISTS prediction;

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
        FirstTouchSchemaService.schemaReady = true;
      })();

      try {
        await FirstTouchSchemaService.schemaReadyPromise;
      } finally {
        if (!FirstTouchSchemaService.schemaReady) {
          FirstTouchSchemaService.schemaReadyPromise = null;
        }
      }
    });
  }
}
