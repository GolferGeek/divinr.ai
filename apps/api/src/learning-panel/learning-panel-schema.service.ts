import { Inject, Injectable, Logger } from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';

@Injectable()
export class LearningPanelSchemaService {
  private static schemaReady = false;
  private static schemaReadyPromise: Promise<void> | null = null;
  private readonly logger = new Logger(LearningPanelSchemaService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
  ) {}

  async ensureSchema(): Promise<void> {
    if (LearningPanelSchemaService.schemaReady) return;
    if (LearningPanelSchemaService.schemaReadyPromise) {
      await LearningPanelSchemaService.schemaReadyPromise;
      return;
    }

    LearningPanelSchemaService.schemaReadyPromise = (async () => {
      const ddl = `
      CREATE TABLE IF NOT EXISTS prediction.learning_panel_threads (
        id UUID PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        origin_surface_key TEXT,
        archived_at TIMESTAMPTZ,
        last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS prediction_learning_panel_threads_user_last_message_idx
        ON prediction.learning_panel_threads (user_id, last_message_at DESC);
      CREATE INDEX IF NOT EXISTS prediction_learning_panel_threads_user_archived_idx
        ON prediction.learning_panel_threads (user_id, archived_at);

      CREATE TABLE IF NOT EXISTS prediction.learning_panel_messages (
        id UUID PRIMARY KEY,
        thread_id UUID NOT NULL REFERENCES prediction.learning_panel_threads(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system_summary')),
        content_markdown TEXT NOT NULL,
        surface_key TEXT,
        citations_json JSONB,
        llm_usage_id UUID,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS prediction_learning_panel_messages_thread_created_idx
        ON prediction.learning_panel_messages (thread_id, created_at);
      CREATE INDEX IF NOT EXISTS prediction_learning_panel_messages_llm_usage_idx
        ON prediction.learning_panel_messages (llm_usage_id) WHERE llm_usage_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS prediction.learning_panel_thread_state (
        thread_id UUID PRIMARY KEY REFERENCES prediction.learning_panel_threads(id) ON DELETE CASCADE,
        summary_markdown TEXT NOT NULL DEFAULT '',
        summary_version INTEGER NOT NULL DEFAULT 1,
        message_count INTEGER NOT NULL DEFAULT 0,
        last_compacted_message_id UUID,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `;

      const result = await this.db.rawQuery(ddl);
      if (result.error) {
        this.logger.error(`ensureSchema failed: ${result.error.message}`);
        throw new Error(result.error.message);
      }

      LearningPanelSchemaService.schemaReady = true;
      this.logger.log('Learning panel schema ready');
    })();

    try {
      await LearningPanelSchemaService.schemaReadyPromise;
    } finally {
      if (!LearningPanelSchemaService.schemaReady) {
        LearningPanelSchemaService.schemaReadyPromise = null;
      }
    }
  }
}
