import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { getBuilderInviterEmails } from './builder-inviters';

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
        role_name text NOT NULL DEFAULT 'member',
        created_by text NOT NULL,
        expires_at timestamptz NOT NULL,
        accepted_at timestamptz,
        revoked_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      ALTER TABLE authz.invites
      ALTER COLUMN role_name SET DEFAULT 'member'
    `);
    if (result.error) {
      throw new Error(`Invite schema creation failed: ${result.error.message}`);
    }

    await this.db.rawQuery(`
      INSERT INTO authz.rbac_roles (id, name, display_name, description, is_system)
      VALUES
        ('role-beta-reader', 'beta_reader', 'Beta Reader', 'Read-only access to an organization', true),
        ('role-builder', 'builder', 'Builder', 'Can author custom analysts and instruments', true)
      ON CONFLICT (id) DO NOTHING
    `);
    await this.db.rawQuery(`
      INSERT INTO authz.rbac_role_permissions (role_id, permission_id)
      VALUES
        ('role-beta-reader', 'markets-instruments-read'),
        ('role-builder', 'markets-instruments-read'),
        ('role-builder', 'markets-instruments-write')
      ON CONFLICT DO NOTHING
    `);
    await this.db.rawQuery(
      `INSERT INTO authz.rbac_user_roles (user_id, role_id, assigned_by)
       SELECT u.id, 'role-builder', 'builder-inviter-bootstrap'
       FROM authz.users u
       WHERE lower(u.email) = ANY($1::text[])
       ON CONFLICT (user_id, role_id) DO NOTHING`,
      [getBuilderInviterEmails()],
    );
    await this.db.rawQuery(
      `INSERT INTO authz.rbac_user_roles (user_id, role_id, assigned_by)
       SELECT u.id, 'role-member', 'builder-inviter-bootstrap'
       FROM authz.users u
       WHERE lower(u.email) = ANY($1::text[])
       ON CONFLICT (user_id, role_id) DO NOTHING`,
      [getBuilderInviterEmails()],
    );

    this.schemaReady = true;
    this.logger.log('Invite schema ready');
  }
}
