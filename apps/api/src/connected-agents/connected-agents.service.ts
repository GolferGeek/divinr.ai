import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  DATABASE_SERVICE,
  runSerializableTransaction,
  type DatabaseService,
  type DatabaseTransaction,
  type QueryResult,
} from '@orchestratorai/planes/database';
import { AgentCommerceRepository } from '../agent-commerce/agent-commerce.repository';
import { DeviceAuthorizationService } from '../oauth/device-authorization.service';
import { connectedAgentError } from '../oauth/oauth-errors';
import type { DeviceAuthorizationRow } from '../oauth/oauth.types';
import type {
  ApprovalBody,
  DenialBody,
  RevocationBody,
} from './connected-agents.types';

function rows<T>(result: QueryResult, operation: string): T[] {
  if (result.error) throw new Error(`${operation} failed: ${result.error.message}`);
  return (result.data as T[] | null) ?? [];
}

function safeReason(value: unknown): string {
  if (value === undefined) return 'owner_requested';
  if (typeof value !== 'string' || value.trim().length < 3 || value.length > 160) {
    throw connectedAgentError(400, 'SCHEMA_INVALID', 'Revocation reason must be 3–160 characters');
  }
  return value.trim();
}

@Injectable()
export class ConnectedAgentsService {
  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(DeviceAuthorizationService)
    private readonly deviceAuthorizations: DeviceAuthorizationService,
    @Inject(AgentCommerceRepository)
    private readonly commerce: AgentCommerceRepository,
  ) {}

  async review(userId: string, userCode: string) {
    const codeHash = this.deviceAuthorizations.userCodeHash(userCode);
    return runSerializableTransaction(this.db, async (transaction) => {
      await transaction.rawQuery(
        `UPDATE agent_commerce.oauth_device_authorizations
            SET user_id = $2, lock_version = lock_version + 1
          WHERE user_code_keyed_hash = $1
            AND user_id IS NULL
            AND status = 'pending'
            AND expires_at > now()`,
        [codeHash, userId],
      );
      const authorization = await this.readReviewAuthorization(
        transaction,
        codeHash,
        userId,
        false,
      );
      return this.toReview(authorization);
    });
  }

  async approve(userId: string, userCode: string, body: ApprovalBody) {
    const codeHash = this.deviceAuthorizations.userCodeHash(userCode);
    return runSerializableTransaction(this.db, async (transaction) => {
      await transaction.rawQuery(
        `UPDATE agent_commerce.oauth_device_authorizations
            SET user_id = $2, lock_version = lock_version + 1
          WHERE user_code_keyed_hash = $1
            AND user_id IS NULL
            AND status = 'pending'
            AND expires_at > now()`,
        [codeHash, userId],
      );
      const authorization = await this.readReviewAuthorization(
        transaction,
        codeHash,
        userId,
        true,
      );
      this.assertApproval(body, authorization);

      const existing = rows<{ id: string; user_id: string }>(
        await transaction.rawQuery(
          `SELECT id, user_id
             FROM agent_commerce.agent_installations
            WHERE installation_id = $1
            FOR UPDATE`,
          [authorization.installation_request_id],
        ),
        'lock installation',
      )[0];
      if (existing && existing.user_id !== userId) {
        throw connectedAgentError(404, 'RESOURCE_NOT_FOUND', 'Device approval request was not found');
      }

      let installationId: string;
      if (existing) {
        installationId = existing.id;
        await this.revokeInstallationCredentials(
          transaction,
          installationId,
          userId,
          'reauthorized',
        );
        rows(
          await transaction.rawQuery(
            `UPDATE agent_commerce.agent_installations
                SET display_name = $2, dpop_jkt = $3, status = 'active',
                    approved_scopes = $4, revoked_at = NULL,
                    revoked_reason = NULL, lock_version = lock_version + 1
              WHERE id = $1 AND user_id = $5
              RETURNING id`,
            [
              installationId,
              authorization.installation_name,
              authorization.proposed_dpop_jkt,
              authorization.requested_scopes,
              userId,
            ],
          ),
          'reauthorize installation',
        );
      } else {
        installationId = randomUUID();
        rows(
          await transaction.rawQuery(
            `INSERT INTO agent_commerce.agent_installations (
               id, installation_id, user_id, oauth_client_id, display_name,
               dpop_jkt, dpop_algorithm, status, approved_scopes
             ) VALUES ($1,$2,$3,$4,$5,$6,'ES256','active',$7)
             RETURNING id`,
            [
              installationId,
              authorization.installation_request_id,
              userId,
              authorization.oauth_client_id,
              authorization.installation_name,
              authorization.proposed_dpop_jkt,
              authorization.requested_scopes,
            ],
          ),
          'create installation',
        );
      }

      const grantInternalId = randomUUID();
      const grantId = randomUUID();
      const approvedAt = new Date();
      const validUntil = new Date(approvedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
      rows(
        await transaction.rawQuery(
          `INSERT INTO agent_commerce.agent_grants (
             id, grant_id, user_id, installation_id, granted_scopes, status,
             valid_from, valid_until, owner_authority_ref, open_authority_ref,
             approved_at, approved_by
           ) VALUES (
             $1,$2,$3,$4,$5,'active',$6,$7,$8,$9,$6,$3
           ) RETURNING id`,
          [
            grantInternalId,
            grantId,
            userId,
            installationId,
            authorization.requested_scopes,
            approvedAt.toISOString(),
            validUntil.toISOString(),
            `owner:${userId}:agent-connect:v2`,
            'ap2-open-authority-profile:v0.2',
          ],
        ),
        'create agent grant',
      );
      rows(
        await transaction.rawQuery(
          `UPDATE agent_commerce.oauth_device_authorizations
              SET status = 'approved', approving_user_id = $2,
                  approved_at = $3, lock_version = lock_version + 1
            WHERE id = $1 AND status = 'pending' AND user_id = $2
            RETURNING id`,
          [authorization.id, userId, approvedAt.toISOString()],
        ),
        'approve device authorization',
      );
      await this.commerce.appendAuditEvent(transaction, {
        eventId: randomUUID(),
        orderingKey: `installation:${installationId}`,
        actorPrincipal: `user:${userId}`,
        userId,
        installationId,
        action: 'agent.installation.approved',
        outcome: 'succeeded',
        redactedDetail: {
          authorizationId: authorization.authorization_id,
          grantId,
          scopes: authorization.requested_scopes,
          authorityProfileVersion: 2,
          dpopJktSuffix: authorization.proposed_dpop_jkt.slice(-10),
        },
      });
      return {
        status: 'approved',
        installationId: authorization.installation_request_id,
        grantId,
        approvedAt: approvedAt.toISOString(),
      };
    });
  }

  async deny(userId: string, userCode: string, body: DenialBody) {
    const codeHash = this.deviceAuthorizations.userCodeHash(userCode);
    return runSerializableTransaction(this.db, async (transaction) => {
      await transaction.rawQuery(
        `UPDATE agent_commerce.oauth_device_authorizations
            SET user_id = $2, lock_version = lock_version + 1
          WHERE user_code_keyed_hash = $1
            AND user_id IS NULL
            AND status = 'pending'
            AND expires_at > now()`,
        [codeHash, userId],
      );
      const existing = rows<DeviceAuthorizationRow>(
        await transaction.rawQuery(
          `SELECT * FROM agent_commerce.oauth_device_authorizations
            WHERE user_code_keyed_hash = $1 AND user_id = $2
            FOR UPDATE`,
          [codeHash, userId],
        ),
        'lock denial request',
      )[0];
      if (!existing || new Date(existing.expires_at) <= new Date()) {
        throw connectedAgentError(404, 'RESOURCE_NOT_FOUND', 'Device approval request was not found');
      }
      if (
        body.confirmation !== 'DENY'
        || body.schemaVersion !== 2
        || body.installationId !== existing.installation_request_id
      ) {
        throw connectedAgentError(400, 'APPROVAL_INVALID', 'Typed denial details do not match the request');
      }
      if (existing.status === 'denied') return { status: 'denied' };
      if (existing.status !== 'pending') {
        throw connectedAgentError(400, 'APPROVAL_INVALID', 'Device request is no longer pending');
      }
      const deniedAt = new Date().toISOString();
      rows(
        await transaction.rawQuery(
          `UPDATE agent_commerce.oauth_device_authorizations
              SET status = 'denied', denied_at = $3, denial_reason = 'owner_denied',
                  approving_user_id = $2, lock_version = lock_version + 1
            WHERE id = $1 AND status = 'pending'
            RETURNING id`,
          [existing.id, userId, deniedAt],
        ),
        'deny device authorization',
      );
      await this.commerce.appendAuditEvent(transaction, {
        eventId: randomUUID(),
        orderingKey: `authorization:${existing.authorization_id}`,
        actorPrincipal: `user:${userId}`,
        userId,
        action: 'agent.installation.denied',
        outcome: 'denied',
        reason: 'owner_denied',
        redactedDetail: {
          authorizationId: existing.authorization_id,
          installationId: existing.installation_request_id,
        },
      });
      return { status: 'denied', deniedAt };
    });
  }

  async list(userId: string) {
    return rows(
      await this.db.rawQuery(
        `SELECT installation.installation_id AS "installationId",
                installation.display_name AS "displayName",
                installation.dpop_jkt AS "dpopJkt",
                installation.status,
                installation.approved_scopes AS "approvedScopes",
                installation.created_at AS "createdAt",
                installation.last_used_at AS "lastUsedAt",
                installation.revoked_at AS "revokedAt",
                COALESCE((
                  SELECT jsonb_agg(jsonb_build_object(
                    'grantId', grant.grant_id,
                    'status', grant.status,
                    'scopes', grant.granted_scopes,
                    'validFrom', grant.valid_from,
                    'validUntil', grant.valid_until,
                    'approvedAt', grant.approved_at,
                    'revokedAt', grant.revoked_at
                  ) ORDER BY grant.approved_at DESC)
                  FROM agent_commerce.agent_grants grant
                  WHERE grant.installation_id = installation.id
                ), '[]'::jsonb) AS grants
           FROM agent_commerce.agent_installations installation
          WHERE installation.user_id = $1
          ORDER BY installation.created_at DESC`,
        [userId],
      ),
      'list connected agents',
    );
  }

  async detail(userId: string, externalInstallationId: string) {
    const installation = rows<Record<string, unknown> & { id: string }>(
      await this.db.rawQuery(
        `SELECT id, installation_id AS "installationId",
                display_name AS "displayName", dpop_jkt AS "dpopJkt",
                status, approved_scopes AS "approvedScopes",
                created_at AS "createdAt", last_used_at AS "lastUsedAt",
                revoked_at AS "revokedAt", revoked_reason AS "revokedReason"
           FROM agent_commerce.agent_installations
          WHERE user_id = $1 AND installation_id = $2`,
        [userId, externalInstallationId],
      ),
      'read connected agent',
    )[0];
    if (!installation) {
      throw connectedAgentError(404, 'RESOURCE_NOT_FOUND', 'Connected agent was not found');
    }
    const grants = rows(
      await this.db.rawQuery(
        `SELECT grant_id AS "grantId", granted_scopes AS scopes, status,
                valid_from AS "validFrom", valid_until AS "validUntil",
                owner_authority_ref AS "ownerAuthorityRef",
                open_authority_ref AS "openAuthorityRef",
                approved_at AS "approvedAt", revoked_at AS "revokedAt",
                revoked_reason AS "revokedReason"
           FROM agent_commerce.agent_grants
          WHERE user_id = $1 AND installation_id = $2
          ORDER BY approved_at DESC`,
        [userId, installation.id],
      ),
      'read connected agent grants',
    );
    const audit = rows(
      await this.db.rawQuery(
        `SELECT event_id AS "eventId", action, outcome, reason,
                redacted_detail AS detail, occurred_at AS "occurredAt"
           FROM agent_commerce.security_audit_events
          WHERE user_id = $1 AND installation_id = $2
          ORDER BY occurred_at DESC LIMIT 100`,
        [userId, installation.id],
      ),
      'read connected agent audit',
    );
    const receipts = rows(
      await this.db.rawQuery(
        `SELECT receipt.receipt_id AS "receiptId",
                receipt.receipt_type AS "receiptType",
                receipt.verification_state AS "verificationState",
                receipt.signed_receipt_ref AS "signedReceiptRef",
                receipt.created_at AS "createdAt"
           FROM agent_commerce.receipt_records receipt
           JOIN agent_commerce.a2a_tasks task ON task.id = receipt.task_id
          WHERE receipt.user_id = $1 AND task.installation_id = $2
          ORDER BY receipt.created_at DESC LIMIT 100`,
        [userId, installation.id],
      ),
      'read connected agent receipts',
    );
    const { id: _internalId, ...safeInstallation } = installation;
    return { ...safeInstallation, grants, audit, receipts };
  }

  async revokeGrant(
    userId: string,
    externalInstallationId: string,
    grantId: string,
    body: RevocationBody,
  ) {
    if (body.confirmation !== 'REVOKE GRANT') {
      throw connectedAgentError(400, 'APPROVAL_INVALID', 'Type REVOKE GRANT to continue');
    }
    const reason = safeReason(body.reason);
    return runSerializableTransaction(this.db, async (transaction) => {
      const grant = rows<{ id: string; installation_id: string }>(
        await transaction.rawQuery(
          `SELECT grant.id, grant.installation_id
             FROM agent_commerce.agent_grants grant
             JOIN agent_commerce.agent_installations installation
               ON installation.id = grant.installation_id
            WHERE grant.user_id = $1 AND grant.grant_id = $2
              AND installation.installation_id = $3
            FOR UPDATE`,
          [userId, grantId, externalInstallationId],
        ),
        'lock grant for revocation',
      )[0];
      if (!grant) {
        throw connectedAgentError(404, 'RESOURCE_NOT_FOUND', 'Connected agent grant was not found');
      }
      await this.revokeGrantCredentials(transaction, grant.id, userId, reason);
      await this.commerce.appendAuditEvent(transaction, {
        eventId: randomUUID(),
        orderingKey: `installation:${grant.installation_id}`,
        actorPrincipal: `user:${userId}`,
        userId,
        installationId: grant.installation_id,
        action: 'agent.grant.revoked',
        outcome: 'succeeded',
        reason,
        redactedDetail: { grantId },
      });
      return { status: 'revoked', grantId };
    });
  }

  async revokeInstallation(
    userId: string,
    externalInstallationId: string,
    body: RevocationBody,
  ) {
    if (body.confirmation !== 'REVOKE AGENT') {
      throw connectedAgentError(400, 'APPROVAL_INVALID', 'Type REVOKE AGENT to continue');
    }
    const reason = safeReason(body.reason);
    return runSerializableTransaction(this.db, async (transaction) => {
      const installation = rows<{ id: string; status: string }>(
        await transaction.rawQuery(
          `SELECT id, status FROM agent_commerce.agent_installations
            WHERE user_id = $1 AND installation_id = $2
            FOR UPDATE`,
          [userId, externalInstallationId],
        ),
        'lock installation for revocation',
      )[0];
      if (!installation) {
        throw connectedAgentError(404, 'RESOURCE_NOT_FOUND', 'Connected agent was not found');
      }
      await this.revokeInstallationCredentials(transaction, installation.id, userId, reason);
      await transaction.rawQuery(
        `UPDATE agent_commerce.agent_installations
            SET status = 'revoked', revoked_at = now(), revoked_reason = $3,
                lock_version = lock_version + 1
          WHERE id = $1 AND user_id = $2 AND status <> 'revoked'`,
        [installation.id, userId, reason],
      );
      await this.commerce.appendAuditEvent(transaction, {
        eventId: randomUUID(),
        orderingKey: `installation:${installation.id}`,
        actorPrincipal: `user:${userId}`,
        userId,
        installationId: installation.id,
        action: 'agent.installation.revoked',
        outcome: 'succeeded',
        reason,
        redactedDetail: { installationId: externalInstallationId },
      });
      return { status: 'revoked', installationId: externalInstallationId };
    });
  }

  private async readReviewAuthorization(
    transaction: DatabaseTransaction,
    codeHash: string,
    userId: string,
    forUpdate: boolean,
  ): Promise<DeviceAuthorizationRow> {
    const authorization = rows<DeviceAuthorizationRow>(
      await transaction.rawQuery(
        `SELECT * FROM agent_commerce.oauth_device_authorizations
          WHERE user_code_keyed_hash = $1 AND user_id = $2
          ${forUpdate ? 'FOR UPDATE' : ''}`,
        [codeHash, userId],
      ),
      'read device approval',
    )[0];
    if (
      !authorization
      || authorization.status !== 'pending'
      || new Date(authorization.expires_at) <= new Date()
    ) {
      throw connectedAgentError(404, 'RESOURCE_NOT_FOUND', 'Device approval request was not found');
    }
    return authorization;
  }

  private toReview(authorization: DeviceAuthorizationRow) {
    return {
      schemaVersion: 2,
      installationId: authorization.installation_request_id,
      installationName: authorization.installation_name,
      dpopJkt: authorization.proposed_dpop_jkt,
      scopes: authorization.requested_scopes,
      resources: authorization.requested_audiences,
      authority: authorization.requested_authority,
      expiresAt: authorization.expires_at,
      status: authorization.status,
    };
  }

  private assertApproval(body: ApprovalBody, authorization: DeviceAuthorizationRow): void {
    const scopes = Array.isArray(body.scopes)
      && body.scopes.every((scope) => typeof scope === 'string')
      ? [...body.scopes].sort()
      : null;
    if (
      body.confirmation !== 'APPROVE'
      || body.schemaVersion !== 2
      || body.installationId !== authorization.installation_request_id
      || body.dpopJkt !== authorization.proposed_dpop_jkt
      || body.authorityProfileVersion !== 2
      || !scopes
      || JSON.stringify(scopes) !== JSON.stringify([...authorization.requested_scopes].sort())
    ) {
      throw connectedAgentError(400, 'APPROVAL_INVALID', 'Typed approval details do not match the request');
    }
  }

  private async revokeInstallationCredentials(
    transaction: DatabaseTransaction,
    installationId: string,
    userId: string,
    reason: string,
  ): Promise<void> {
    const grants = rows<{ id: string }>(
      await transaction.rawQuery(
        `SELECT id FROM agent_commerce.agent_grants
          WHERE installation_id = $1 AND user_id = $2 AND status = 'active'
          FOR UPDATE`,
        [installationId, userId],
      ),
      'lock installation grants',
    );
    for (const grant of grants) {
      await this.revokeGrantCredentials(transaction, grant.id, userId, reason);
    }
  }

  private async revokeGrantCredentials(
    transaction: DatabaseTransaction,
    grantInternalId: string,
    userId: string,
    reason: string,
  ): Promise<void> {
    await transaction.rawQuery(
      `UPDATE agent_commerce.oauth_access_token_jtis
          SET revoked_at = COALESCE(revoked_at, now()), lock_version = lock_version + 1
        WHERE grant_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [grantInternalId, userId],
    );
    await transaction.rawQuery(
      `UPDATE agent_commerce.oauth_refresh_token_families
          SET status = 'revoked', revoked_at = COALESCE(revoked_at, now()),
              lock_version = lock_version + 1
        WHERE grant_id = $1 AND user_id = $2 AND status = 'active'`,
      [grantInternalId, userId],
    );
    await transaction.rawQuery(
      `UPDATE agent_commerce.agent_grants
          SET status = 'revoked', revoked_at = COALESCE(revoked_at, now()),
              revoked_by = $2, revoked_reason = COALESCE(revoked_reason, $3),
              lock_version = lock_version + 1
        WHERE id = $1 AND user_id = $2 AND status = 'active'`,
      [grantInternalId, userId, reason],
    );
  }
}
