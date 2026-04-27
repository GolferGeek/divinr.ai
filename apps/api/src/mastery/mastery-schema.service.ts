import { Inject, Injectable, Logger } from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import {
  REQUEST_SCHEMA_BOOTSTRAP_LOCK,
  RuntimeSchemaBootstrapCoordinator,
} from '../bootstrap/runtime-schema-bootstrap-coordinator';

@Injectable()
export class MasterySchemaService {
  private static schemaReady = false;
  private static schemaReadyPromise: Promise<void> | null = null;
  private readonly logger = new Logger(MasterySchemaService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
  ) {}

  async ensureSchema(): Promise<void> {
    if (MasterySchemaService.schemaReady) return;
    await RuntimeSchemaBootstrapCoordinator.runExclusive(REQUEST_SCHEMA_BOOTSTRAP_LOCK, async () => {
      if (MasterySchemaService.schemaReady) return;
      if (MasterySchemaService.schemaReadyPromise) {
        await MasterySchemaService.schemaReadyPromise;
        return;
      }

      MasterySchemaService.schemaReadyPromise = (async () => {
        const ddl = `
          CREATE SCHEMA IF NOT EXISTS prediction;

          CREATE TABLE IF NOT EXISTS prediction.user_learning_profiles (
            user_id TEXT PRIMARY KEY,
            mastery_level TEXT NOT NULL CHECK (
              mastery_level IN ('core_trading', 'competitive_participation', 'community_creation', 'builder', 'operator')
            ) DEFAULT 'core_trading',
            preferred_level TEXT CHECK (
              preferred_level IS NULL OR preferred_level IN ('core_trading', 'competitive_participation', 'community_creation', 'builder', 'operator')
            ),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
          );

          CREATE INDEX IF NOT EXISTS prediction_user_learning_profiles_level_idx
            ON prediction.user_learning_profiles (mastery_level);
        `;

        const result = await this.db.rawQuery(ddl);
        if (result.error) {
          this.logger.error(`ensureSchema failed: ${result.error.message}`);
          throw new Error(result.error.message);
        }

        MasterySchemaService.schemaReady = true;
        this.logger.log('Mastery schema ready');
      })();

      try {
        await MasterySchemaService.schemaReadyPromise;
      } finally {
        if (!MasterySchemaService.schemaReady) {
          MasterySchemaService.schemaReadyPromise = null;
        }
      }
    });
  }
}
