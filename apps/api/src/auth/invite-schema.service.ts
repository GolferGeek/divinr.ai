import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';

@Injectable()
export class InviteSchemaService {
  private schemaReady = false;
  private readonly logger = new Logger(InviteSchemaService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
  ) {}

  async ensureSchema(): Promise<void> {
    if (this.schemaReady) return;
    const result = await this.db.rawQuery(`
      CREATE SCHEMA IF NOT EXISTS authz;

      CREATE TABLE IF NOT EXISTS authz.invites (
        id text PRIMARY KEY,
        email text,
        token text UNIQUE NOT NULL,
        role_name text NOT NULL DEFAULT 'beta_reader',
        created_by text NOT NULL,
        expires_at timestamptz NOT NULL,
        accepted_at timestamptz,
        revoked_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    if (result.error) {
      throw new Error(`Invite schema creation failed: ${result.error.message}`);
    }

    await this.db.rawQuery(`
      INSERT INTO authz.rbac_roles (id, name, display_name, description, is_system)
      VALUES ('role-beta-reader', 'beta_reader', 'Beta Reader', 'Read-only access to an organization', true)
      ON CONFLICT (id) DO NOTHING
    `);
    await this.db.rawQuery(`
      INSERT INTO authz.rbac_role_permissions (role_id, permission_id)
      VALUES ('role-beta-reader', 'markets-instruments-read')
      ON CONFLICT DO NOTHING
    `);

    this.schemaReady = true;
    this.logger.log('Invite schema ready');
  }
}
