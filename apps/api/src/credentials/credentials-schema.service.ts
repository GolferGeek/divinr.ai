import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';

@Injectable()
export class CredentialsSchemaService {
  private schemaReady = false;
  private readonly logger = new Logger(CredentialsSchemaService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
  ) {}

  async ensureSchema(): Promise<void> {
    if (this.schemaReady) return;
    const ddl = `
      CREATE SCHEMA IF NOT EXISTS credentials;

      CREATE TABLE IF NOT EXISTS credentials.user_llm_credentials (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id text NOT NULL,
        provider text NOT NULL CHECK (provider IN ('anthropic', 'openai', 'openrouter')),
        label text NOT NULL,
        encrypted_secret bytea NOT NULL,
        encryption_iv bytea NOT NULL,
        encryption_tag bytea NOT NULL,
        last_used_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        revoked_at timestamptz
      );

      CREATE INDEX IF NOT EXISTS user_llm_credentials_user_active_idx
        ON credentials.user_llm_credentials (user_id)
        WHERE revoked_at IS NULL;
    `;
    const result = await this.db.rawQuery(ddl);
    if (result.error) throw new Error(`Credentials schema creation failed: ${result.error.message}`);
    this.schemaReady = true;
    this.logger.log('Credentials schema ready');
  }
}
