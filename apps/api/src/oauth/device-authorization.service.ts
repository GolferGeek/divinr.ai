import { Inject, Injectable } from '@nestjs/common';
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import {
  DATABASE_SERVICE,
  type DatabaseService,
  type QueryResult,
} from '@orchestratorai/planes/database';
import { AgentContractSchemaRegistry } from '../agent-contracts/contract-bundle';
import { APPLE_ASSISTANT_OAUTH_CLIENT_ID } from '../agent-commerce/agent-commerce-schema.constants';
import {
  DEVICE_CODE_LIFETIME_SECONDS,
  DEVICE_GRANT_TYPE,
  DEVICE_POLL_INTERVAL_SECONDS,
  DEVICE_VERIFICATION_URI,
  DIVINR_A2A_RESOURCE,
  FROZEN_AUTHORITY_REVIEW,
} from './oauth.constants';
import { OAuthProtocolError } from './oauth-errors';
import type {
  DeviceAuthorizationRequest,
  DeviceAuthorizationRow,
  TokenRequest,
} from './oauth.types';

function resultRows<T>(result: QueryResult, operation: string): T[] {
  if (result.error) {
    throw new Error(`${operation} failed: ${result.error.message}`);
  }
  return (result.data as T[] | null) ?? [];
}

function normalizeScope(scope: string): string[] {
  const members = scope.trim().split(/\s+/).filter(Boolean);
  if (members.length === 0 || new Set(members).size !== members.length) {
    throw new OAuthProtocolError(400, 'invalid_scope', 'Scope must contain unique space-delimited values');
  }
  return members.sort();
}

function resolveUserCodeHmacKey(): string {
  const configured = process.env.OAUTH_DEVICE_USER_CODE_HMAC_KEY;
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'OAUTH_DEVICE_USER_CODE_HMAC_KEY is required in production',
    );
  }
  return randomBytes(32).toString('base64url');
}

@Injectable()
export class DeviceAuthorizationService {
  private readonly registry = new AgentContractSchemaRegistry();
  private readonly userCodeHmacKey = resolveUserCodeHmacKey();

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
  ) {}

  userCodeHash(userCode: string): string {
    return createHmac('sha256', this.userCodeHmacKey)
      .update(this.normalizeUserCode(userCode))
      .digest('hex');
  }

  deviceCodeHash(deviceCode: string): string {
    return createHash('sha256').update(deviceCode).digest('hex');
  }

  normalizeUserCode(userCode: string): string {
    const compact = userCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!/^[A-Z0-9]{8}$/.test(compact)) {
      throw new OAuthProtocolError(404, 'invalid_request', 'Device approval request was not found');
    }
    return `${compact.slice(0, 4)}-${compact.slice(4)}`;
  }

  async initiate(
    body: unknown,
    proposedDpopJkt: string,
  ): Promise<Record<string, unknown>> {
    try {
      this.registry.validate('deviceAuthorizationRequest', body);
    } catch {
      throw new OAuthProtocolError(400, 'invalid_request', 'Device authorization request is invalid');
    }
    const request = body as DeviceAuthorizationRequest;
    const requestedScopes = normalizeScope(request.scope);
    const clients = resultRows<{
      id: string;
      allowed_scopes: string[];
      allowed_audiences: string[];
      status: string;
    }>(
      await this.db.rawQuery(
        `SELECT id, allowed_scopes, allowed_audiences, status
           FROM agent_commerce.oauth_clients
          WHERE client_id = $1`,
        [request.client_id],
      ),
      'read OAuth client',
    );
    const client = clients[0];
    if (!client || client.status !== 'active' || request.client_id !== APPLE_ASSISTANT_OAUTH_CLIENT_ID) {
      throw new OAuthProtocolError(400, 'unauthorized_client', 'OAuth client is not authorized');
    }
    if (
      request.resource !== DIVINR_A2A_RESOURCE
      || !client.allowed_audiences.includes(request.resource)
      || requestedScopes.some((scope) => !client.allowed_scopes.includes(scope))
    ) {
      throw new OAuthProtocolError(400, 'invalid_scope', 'Requested scope or resource is not allowed');
    }

    const deviceCode = randomBytes(32).toString('base64url');
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = randomBytes(8);
    const compactCode = [...bytes].map((value) => alphabet[value % alphabet.length]).join('');
    const userCode = `${compactCode.slice(0, 4)}-${compactCode.slice(4)}`;
    const expiresAt = new Date(Date.now() + DEVICE_CODE_LIFETIME_SECONDS * 1000);
    resultRows(
      await this.db.rawQuery(
        `INSERT INTO agent_commerce.oauth_device_authorizations (
           authorization_id, oauth_client_id, installation_request_id,
           installation_name, proposed_dpop_jkt, device_code_hash,
           user_code_keyed_hash, requested_scopes, requested_audiences,
           requested_authority, verification_uri, poll_interval_seconds,
           status, expires_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,'pending',$13
         ) RETURNING id`,
        [
          randomUUID(),
          client.id,
          request.installation_id,
          request.installation_name.trim(),
          proposedDpopJkt,
          this.deviceCodeHash(deviceCode),
          this.userCodeHash(userCode),
          requestedScopes,
          [request.resource],
          JSON.stringify(FROZEN_AUTHORITY_REVIEW),
          DEVICE_VERIFICATION_URI,
          DEVICE_POLL_INTERVAL_SECONDS,
          expiresAt.toISOString(),
        ],
      ),
      'create device authorization',
    );
    const response = {
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: DEVICE_VERIFICATION_URI,
      verification_uri_complete:
        `${DEVICE_VERIFICATION_URI}?user_code=${encodeURIComponent(userCode)}`,
      expires_in: DEVICE_CODE_LIFETIME_SECONDS,
      interval: DEVICE_POLL_INTERVAL_SECONDS,
    };
    this.registry.validate('deviceAuthorizationResponse', response);
    return response;
  }

  async poll(
    body: unknown,
    proofThumbprint: string,
  ): Promise<never> {
    try {
      this.registry.validate('tokenRequest', body);
    } catch {
      throw new OAuthProtocolError(400, 'invalid_request', 'Token request is invalid');
    }
    const request = body as TokenRequest;
    if (request.client_id !== APPLE_ASSISTANT_OAUTH_CLIENT_ID) {
      throw new OAuthProtocolError(400, 'unauthorized_client', 'OAuth client is not authorized');
    }
    if (request.grant_type !== DEVICE_GRANT_TYPE || !request.device_code) {
      throw new OAuthProtocolError(
        400,
        'unsupported_grant_type',
        'Refresh credentials are enabled in Phase 5',
      );
    }
    const rows = resultRows<DeviceAuthorizationRow>(
      await this.db.rawQuery(
        `SELECT authorization.*
           FROM agent_commerce.oauth_device_authorizations authorization
           JOIN agent_commerce.oauth_clients client
             ON client.id = authorization.oauth_client_id
          WHERE authorization.device_code_hash = $1
            AND client.client_id = $2`,
        [this.deviceCodeHash(request.device_code), request.client_id],
      ),
      'read device authorization',
    );
    const authorization = rows[0];
    if (!authorization || authorization.proposed_dpop_jkt !== proofThumbprint) {
      throw new OAuthProtocolError(400, 'invalid_grant', 'Device authorization is invalid');
    }
    const now = new Date();
    if (new Date(authorization.expires_at) <= now || authorization.status === 'expired') {
      await this.db.rawQuery(
        `UPDATE agent_commerce.oauth_device_authorizations
            SET status = 'expired', lock_version = lock_version + 1
          WHERE id = $1 AND status = 'pending'`,
        [authorization.id],
      );
      throw new OAuthProtocolError(400, 'expired_token', 'Device code has expired');
    }
    if (authorization.status === 'denied') {
      throw new OAuthProtocolError(400, 'access_denied', 'The resource owner denied the request');
    }
    if (authorization.status === 'consumed') {
      throw new OAuthProtocolError(400, 'invalid_grant', 'Device code was already consumed');
    }
    const lastPoll = authorization.last_polled_at
      ? new Date(authorization.last_polled_at).getTime()
      : 0;
    if (lastPoll && now.getTime() - lastPoll < authorization.poll_interval_seconds * 1000) {
      throw new OAuthProtocolError(
        400,
        'slow_down',
        'Polling occurred before the required interval',
        { interval: authorization.poll_interval_seconds + 5 },
      );
    }
    await this.db.rawQuery(
      `UPDATE agent_commerce.oauth_device_authorizations
          SET last_polled_at = $2, lock_version = lock_version + 1
        WHERE id = $1`,
      [authorization.id, now.toISOString()],
    );
    if (authorization.status === 'pending') {
      throw new OAuthProtocolError(400, 'authorization_pending', 'Authorization is still pending');
    }
    throw new OAuthProtocolError(
      503,
      'temporarily_unavailable',
      'Authorization is approved; sender-constrained credential issuance is enabled in Phase 5',
    );
  }
}
