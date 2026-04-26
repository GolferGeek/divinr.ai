import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';

/**
 * Idempotent DDL for authz.user_preferences.
 *
 * Mirrors the migration file at apps/api/db/migrations/2026-04-14-user-preferences.sql,
 * but is the source of truth for what actually runs at app boot / first request.
 *
 * Pattern copied from ClubSchemaService: memoize with schemaReady, call ensureSchema()
 * at the top of every service method that touches this table.
 */
@Injectable()
export class OnboardingSchemaService {
  private static schemaReady = false;
  private static schemaReadyPromise: Promise<void> | null = null;
  private readonly logger = new Logger(OnboardingSchemaService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
  ) {}

  async ensureSchema(): Promise<void> {
    if (OnboardingSchemaService.schemaReady) return;
    if (OnboardingSchemaService.schemaReadyPromise) {
      await OnboardingSchemaService.schemaReadyPromise;
      return;
    }

    OnboardingSchemaService.schemaReadyPromise = (async () => {
      const ddl = `
      CREATE TABLE IF NOT EXISTS authz.user_preferences (
        user_id TEXT PRIMARY KEY REFERENCES authz.users(id) ON DELETE CASCADE,
        onboarding_state JSONB NOT NULL DEFAULT jsonb_build_object(
          'started_at',      NULL,
          'completed_at',    NULL,
          'skipped',         FALSE,
          'current_step',    'welcome',
          'steps_completed', '[]'::jsonb,
          'last_seen_at',    NULL
        ),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_user_preferences_updated_at
        ON authz.user_preferences(updated_at);
    `;

      const result = await this.db.rawQuery(ddl);
      if (result.error) {
        this.logger.error(`ensureSchema failed: ${result.error.message}`);
        throw new Error(result.error.message);
      }
      OnboardingSchemaService.schemaReady = true;
    })();

    try {
      await OnboardingSchemaService.schemaReadyPromise;
    } finally {
      if (!OnboardingSchemaService.schemaReady) {
        OnboardingSchemaService.schemaReadyPromise = null;
      }
    }
  }
}
