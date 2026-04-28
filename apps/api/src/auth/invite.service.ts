/**
 * Invite Service — manages invite-based signup flow.
 * Effort: beta-user-share-path.
 *
 * Creates invite tokens, validates them, and handles invite-based signup
 * that creates a Supabase user with the member role.
 */
import { Injectable, Inject, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import {
  AUTH_SERVICE,
  type AuthServiceProvider,
} from '@orchestratorai/planes/auth';
import { BillingService } from '../billing/billing.service';
import { BillingConfigService } from '../billing/billing-config.service';
import { getBuilderInviterEmails } from './builder-inviters';

interface InviteRow {
  id: string;
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
  email?: string | null;
  expiresAt?: string;
  reason?: string;
}

@Injectable()
export class InviteService {
  private readonly logger = new Logger(InviteService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(AUTH_SERVICE) private readonly authService: AuthServiceProvider,
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(BillingConfigService) private readonly billingConfig: BillingConfigService,
  ) {}

  async createInvite(
    createdBy: string,
    email?: string,
  ): Promise<CreateInviteResult> {
    const id = randomUUID();
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const appUrl = process.env.APP_URL || 'http://localhost:7101';
    const roleName = await this.resolveInviteRole(createdBy);

    await this.db.rawQuery(
      `INSERT INTO authz.invites (id, email, token, role_name, created_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, email ?? null, token, roleName, createdBy, expiresAt],
    );

    return {
      id,
      token,
      inviteUrl: `${appUrl}/signup/${token}`,
      expiresAt,
    };
  }

  async listInvites(createdBy?: string): Promise<InviteRow[]> {
    const result = createdBy
      ? await this.db.rawQuery(
          `SELECT * FROM authz.invites
           WHERE created_by = $1
           ORDER BY created_at DESC`,
          [createdBy],
        )
      : await this.db.rawQuery(
          `SELECT * FROM authz.invites ORDER BY created_at DESC`,
        );
    return (result.data as InviteRow[] | null) ?? [];
  }

  async revokeInvite(id: string, createdBy?: string): Promise<{ revoked: boolean }> {
    const params = createdBy ? [id, createdBy] : [id];
    const ownerClause = createdBy ? 'AND created_by = $2' : '';
    await this.db.rawQuery(
      `UPDATE authz.invites SET revoked_at = now()
       WHERE id = $1 AND revoked_at IS NULL ${ownerClause}`,
      params,
    );
    return { revoked: true };
  }

  async validateInviteToken(token: string): Promise<ValidateResult> {
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
    return {
      valid: true,
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

    try {
      return await this.createAccountAndLogin({
        email,
        password,
        displayName,
        roleName: invite.role_name,
        createdBy: invite.created_by,
      });
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
  }

  async signupPublic(email: string, password: string, displayName?: string) {
    return this.createAccountAndLogin({
      email,
      password,
      displayName,
      roleName: 'member',
      createdBy: 'self-signup',
    });
  }

  private async resolveInviteRole(createdBy: string): Promise<'builder' | 'member'> {
    const result = await this.db.rawQuery(
      `SELECT lower(email) AS email FROM authz.users WHERE id = $1 LIMIT 1`,
      [createdBy],
    );
    const rows = (result.data as Array<{ email: string | null }> | null) ?? [];
    const creatorEmail = rows[0]?.email ?? null;
    if (creatorEmail && getBuilderInviterEmails().includes(creatorEmail)) {
      return 'builder';
    }
    return 'member';
  }

  private async createAccountAndLogin(input: {
    email: string;
    password: string;
    displayName?: string;
    roleName: string;
    createdBy: string;
  }) {
    const createResult = await this.authService.createUser(
      {
        email: input.email,
        password: input.password,
        displayName: input.displayName ?? input.email.split('@')[0],
        roles: input.roleName === 'builder' ? ['member', 'builder'] : [input.roleName],
        emailConfirm: true,
      },
      input.createdBy,
    );
    const createdUserId = (createResult as unknown as Record<string, unknown>)?.id as string | undefined;

    // Seed a 30-day trial subscription for the newly created user.
    // Non-fatal if it errors: the user is created and can recover; billing cron
    // + admin backfill will catch stragglers. Log loudly so ops notices.
    if (createdUserId) {
      try {
        await this.billing.ensureSubscription(createdUserId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`ensureSubscription failed for new user ${createdUserId}: ${message}`);
      }

      // .edu student verification — fires when the signup email's domain suffix
      // matches STUDENT_EDU_ALLOWED_DOMAINS (default: 'edu'). Sets is_student
      // so Phase 4 student-Price routing kicks in for any custom analyst /
      // instrument they author. Re-checked monthly by billing-lifecycle.cron.
      try {
        if (matchesEduDomain(input.email, this.billingConfig.studentEduAllowedDomains)) {
          await this.db.rawQuery(
            `UPDATE authz.users
             SET is_student = true, edu_email = $2, edu_last_verified_at = now()
             WHERE id = $1`,
            [createdUserId, input.email],
          );
          this.logger.log(`Student verified at signup: userId=${createdUserId} email=${input.email}`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`.edu verification failed for ${createdUserId}: ${message}`);
      }

      if (input.roleName === 'builder') {
        await this.bootstrapBuilderProfile(createdUserId);
      }
    }

    // Auto-login and return JWT
    const loginResult = await this.authService.login({ email: input.email, password: input.password });
    return loginResult;
  }

  private async bootstrapBuilderProfile(userId: string): Promise<void> {
    try {
      await this.db.rawQuery(
        `INSERT INTO prediction.user_learning_profiles (user_id, mastery_level, preferred_level)
         VALUES ($1, 'builder', 'builder')
         ON CONFLICT (user_id) DO UPDATE
           SET mastery_level = 'builder',
               preferred_level = 'builder',
               updated_at = now()`,
        [userId],
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Builder profile bootstrap failed for ${userId}: ${message}`);
    }
  }

  /**
   * Get the user's role from rbac_user_roles.
   * Returns the highest-priority role name, or null if no role found.
   */
  async getUserRole(userId: string): Promise<string | null> {
    const result = await this.db.rawQuery(
      `SELECT rr.name
       FROM authz.rbac_user_roles r
       JOIN authz.rbac_roles rr ON rr.id = r.role_id
       WHERE r.user_id = $1
       ORDER BY CASE rr.name
         WHEN 'super-admin' THEN 1
         WHEN 'owner' THEN 2
         WHEN 'admin' THEN 3
         WHEN 'builder' THEN 4
         WHEN 'member' THEN 5
         WHEN 'beta_reader' THEN 6
         ELSE 7
       END
       LIMIT 1`,
      [userId],
    );
    const rows = (result.data as Array<{ name: string }> | null) ?? [];
    return rows.length > 0 ? rows[0].name : null;
  }

  async getUserProfile(userId: string): Promise<{ display_name: string; email: string; status: string } | null> {
    const result = await this.db.rawQuery(
      `SELECT display_name, email, status FROM authz.users WHERE id = $1`,
      [userId],
    );
    const rows = (result.data as Array<{ display_name: string; email: string; status: string }> | null) ?? [];
    return rows.length > 0 ? rows[0] : null;
  }
}

/**
 * Returns true when `email`'s domain ends in any of the configured suffixes.
 * Suffix matching: `edu` matches both `harvard.edu` and `mit.edu`; `ac.uk`
 * matches `cam.ac.uk` but not `ac.com`. Match is case-insensitive.
 *
 * Exported via module-internal scope only (no `export` keyword) — kept in
 * one file with the only caller for now. Promote to a shared helper if a
 * second consumer ever needs it.
 */
function matchesEduDomain(email: string, allowedSuffixes: string[]): boolean {
  const at = email.lastIndexOf('@');
  if (at < 0 || at === email.length - 1) return false;
  const domain = email.slice(at + 1).toLowerCase();
  for (const suffix of allowedSuffixes) {
    const s = suffix.toLowerCase().replace(/^\./, '');
    if (domain === s || domain.endsWith('.' + s)) return true;
  }
  return false;
}
