/**
 * Invite Service — manages beta-reader invite flow.
 * Effort: beta-user-share-path.
 *
 * Creates invite tokens, validates them, and handles invite-based signup
 * that creates a Supabase user with the beta_reader role.
 */
import { Injectable, Inject, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import {
  AUTH_SERVICE,
  type AuthServiceProvider,
} from '@orchestratorai/planes/auth';

interface InviteRow {
  id: string;
  organization_slug: string;
  email: string | null;
  token: string;
  role_name: string;
  created_by: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

interface CreateInviteResult {
  id: string;
  token: string;
  inviteUrl: string;
  expiresAt: string;
}

interface ValidateResult {
  valid: boolean;
  organizationSlug?: string;
  email?: string | null;
  expiresAt?: string;
  reason?: string;
}

@Injectable()
export class InviteService {
  private readonly logger = new Logger(InviteService.name);
  private schemaReady = false;

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(AUTH_SERVICE) private readonly authService: AuthServiceProvider,
  ) {}

  async ensureSchema(): Promise<void> {
    if (this.schemaReady) return;
    await this.db.rawQuery(`
      CREATE TABLE IF NOT EXISTS authz.invites (
        id text PRIMARY KEY,
        organization_slug text NOT NULL,
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
    // Seed beta_reader role if missing
    await this.db.rawQuery(`
      INSERT INTO authz.rbac_roles (id, name, display_name, description, is_system)
      VALUES ('role-beta-reader', 'beta_reader', 'Beta Reader', 'Read-only access to an organization', true)
      ON CONFLICT (id) DO NOTHING
    `);
    this.schemaReady = true;
  }

  async createInvite(
    organizationSlug: string,
    createdBy: string,
    email?: string,
  ): Promise<CreateInviteResult> {
    await this.ensureSchema();
    const id = randomUUID();
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const appUrl = process.env.APP_URL || 'http://localhost:7101';

    await this.db.rawQuery(
      `INSERT INTO authz.invites (id, organization_slug, email, token, role_name, created_by, expires_at)
       VALUES ($1, $2, $3, $4, 'beta_reader', $5, $6)`,
      [id, organizationSlug, email ?? null, token, createdBy, expiresAt],
    );

    return {
      id,
      token,
      inviteUrl: `${appUrl}/signup/${token}`,
      expiresAt,
    };
  }

  async listInvites(organizationSlug: string): Promise<InviteRow[]> {
    await this.ensureSchema();
    const result = await this.db.rawQuery(
      `SELECT * FROM authz.invites
       WHERE organization_slug = $1
       ORDER BY created_at DESC`,
      [organizationSlug],
    );
    return (result.data as InviteRow[] | null) ?? [];
  }

  async revokeInvite(id: string, organizationSlug: string): Promise<{ revoked: boolean }> {
    await this.ensureSchema();
    const result = await this.db.rawQuery(
      `UPDATE authz.invites SET revoked_at = now()
       WHERE id = $1 AND organization_slug = $2 AND revoked_at IS NULL`,
      [id, organizationSlug],
    );
    return { revoked: true };
  }

  async validateInviteToken(token: string): Promise<ValidateResult> {
    await this.ensureSchema();
    const result = await this.db.rawQuery(
      `SELECT * FROM authz.invites WHERE token = $1`,
      [token],
    );
    const rows = (result.data as InviteRow[] | null) ?? [];
    if (rows.length === 0) {
      return { valid: false, reason: 'Invite not found' };
    }
    const invite = rows[0];
    if (invite.revoked_at) {
      return { valid: false, reason: 'Invite has been revoked' };
    }
    if (invite.accepted_at) {
      return { valid: false, reason: 'Invite has already been used' };
    }
    if (new Date(invite.expires_at) < new Date()) {
      return { valid: false, reason: 'Invite has expired' };
    }
    // Note: organizationSlug is exposed to the public validate endpoint. This is
    // acceptable because invite tokens are UUIDs (unguessable), and the frontend
    // needs the slug for tenant store setup after signup.
    return {
      valid: true,
      organizationSlug: invite.organization_slug,
      email: invite.email,
      expiresAt: invite.expires_at,
    };
  }

  async acceptInvite(
    token: string,
    email: string,
    password: string,
    displayName?: string,
  ) {
    // Atomic claim: mark accepted_at in a single UPDATE that also validates.
    // Prevents race condition where two concurrent signups both pass validation.
    const claimResult = await this.db.rawQuery(
      `UPDATE authz.invites
       SET accepted_at = now()
       WHERE token = $1
         AND accepted_at IS NULL
         AND revoked_at IS NULL
         AND expires_at > now()
       RETURNING *`,
      [token],
    );
    const claimedRows = (claimResult.data as InviteRow[] | null) ?? [];
    if (claimedRows.length === 0) {
      // Re-validate to provide a specific error message
      const validation = await this.validateInviteToken(token);
      throw new BadRequestException(validation.reason ?? 'Invite is no longer valid');
    }
    const invite = claimedRows[0];

    // Check email restriction
    if (invite.email && invite.email.toLowerCase() !== email.toLowerCase()) {
      // Unclaim the invite since the email doesn't match
      await this.db.rawQuery(
        `UPDATE authz.invites SET accepted_at = NULL WHERE id = $1`,
        [invite.id],
      );
      throw new BadRequestException('This invite is restricted to a different email address');
    }

    // Create user via Supabase auth service
    try {
      await this.authService.createUser(
        {
          email,
          password,
          displayName: displayName ?? email.split('@')[0],
          roles: [invite.role_name],
          organizationAccess: [invite.organization_slug],
          emailConfirm: false,
        },
        invite.created_by,
      );
    } catch (err) {
      // Unclaim the invite so it can be retried
      await this.db.rawQuery(
        `UPDATE authz.invites SET accepted_at = NULL WHERE id = $1`,
        [invite.id],
      );
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to create user for invite ${invite.id}: ${message}`);
      throw new BadRequestException(`Account creation failed: ${message}`);
    }

    // Auto-login and return JWT
    const loginResult = await this.authService.login({ email, password });
    return loginResult;
  }

  /**
   * Get the user's org role from rbac_user_org_roles.
   * Returns the highest-priority role name, or null if no role found.
   */
  async getOrgRole(userId: string, organizationSlug: string): Promise<string | null> {
    const result = await this.db.rawQuery(
      `SELECT rr.name
       FROM authz.rbac_user_org_roles r
       JOIN authz.rbac_roles rr ON rr.id = r.role_id
       WHERE r.user_id = $1 AND r.organization_slug = $2
       ORDER BY CASE rr.name
         WHEN 'super-admin' THEN 1
         WHEN 'owner' THEN 2
         WHEN 'member' THEN 3
         WHEN 'beta_reader' THEN 4
         ELSE 5
       END
       LIMIT 1`,
      [userId, organizationSlug],
    );
    const rows = (result.data as Array<{ name: string }> | null) ?? [];
    return rows.length > 0 ? rows[0].name : null;
  }
}
