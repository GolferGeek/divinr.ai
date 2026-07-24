import { Inject, Injectable } from '@nestjs/common';
import {
  createHash,
  randomBytes,
  randomUUID,
  sign,
} from 'node:crypto';
import {
  DATABASE_SERVICE,
  runSerializableTransaction,
  type DatabaseService,
  type DatabaseTransaction,
  type QueryResult,
} from '@orchestratorai/planes/database';
import {
  AGENT_KEY_PROVIDER,
  type AgentKeyProvider,
  type AgentSigningKey,
} from '../agent-commerce/agent-key-provider';
import { AgentCommerceRepository } from '../agent-commerce/agent-commerce.repository';
import type { AuditEventInput } from '../agent-commerce/agent-commerce.types';
import { canonicalJson } from '../agent-contracts/canonical-json';
import {
  ACCESS_TOKEN_LIFETIME_SECONDS,
  APPLE_ASSISTANT_CLIENT_ID,
  DIVINR_A2A_RESOURCE,
  DIVINR_ISSUER,
} from './oauth.constants';
import {
  OAuthDPoPNonceRequiredError,
  OAuthProtocolError,
} from './oauth-errors';
import type {
  DeviceAuthorizationRow,
  TokenRequest,
} from './oauth.types';

interface CredentialRow {
  authorization_id?: string;
  authorization_internal_id?: string;
  user_id: string;
  dpop_jkt: string;
  scopes: string[];
  installation_internal_id: string;
  installation_id: string;
  grant_internal_id: string;
  grant_id: string;
  grant_valid_until: string;
  family_internal_id?: string;
  family_id?: string;
  family_status?: string;
  current_generation?: number;
  refresh_internal_id?: string;
  refresh_generation?: number;
  refresh_expires_at?: string;
  refresh_used_at?: string | null;
  refresh_revoked_at?: string | null;
}

export interface OAuthDPoPProofContext {
  thumbprint: string;
  jti: string;
  nonce?: string;
  method: string;
  uri: string;
}

function rows<T>(result: QueryResult, operation: string): T[] {
  if (result.error) throw new Error(`${operation} failed: ${result.error.message}`);
  return (result.data as T[] | null) ?? [];
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function encode(value: unknown): string {
  return Buffer.from(canonicalJson(value)).toString('base64url');
}

@Injectable()
export class OAuthCredentialService {
  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(AGENT_KEY_PROVIDER) private readonly keys: AgentKeyProvider,
    @Inject(AgentCommerceRepository)
    private readonly commerce: AgentCommerceRepository,
  ) {}

  async exchangeApprovedDevice(
    authorization: DeviceAuthorizationRow,
    proof: OAuthDPoPProofContext,
  ): Promise<Record<string, unknown>> {
    if (
      authorization.status !== 'approved'
      || !authorization.user_id
      || authorization.proposed_dpop_jkt !== proof.thumbprint
    ) {
      throw new OAuthProtocolError(400, 'invalid_grant', 'Device authorization is invalid');
    }
    const signingKey = await this.keys.getSigningKey('oauth-access-token');
    const result = await runSerializableTransaction(this.db, async (transaction) => {
      const credential = rows<CredentialRow>(
        await transaction.rawQuery(
          `SELECT authorization.id AS authorization_internal_id,
                  authorization.authorization_id,
                  authorization.user_id,
                  authorization.proposed_dpop_jkt AS dpop_jkt,
                  authorization.requested_scopes AS scopes,
                  installation.id AS installation_internal_id,
                  installation.installation_id,
                  grant.id AS grant_internal_id,
                  grant.grant_id,
                  grant.valid_until AS grant_valid_until
             FROM agent_commerce.oauth_device_authorizations authorization
             JOIN agent_commerce.agent_installations installation
               ON installation.installation_id = authorization.installation_request_id
              AND installation.user_id = authorization.user_id
              AND installation.oauth_client_id = authorization.oauth_client_id
             JOIN agent_commerce.agent_grants grant
               ON grant.installation_id = installation.id
              AND grant.user_id = authorization.user_id
              AND grant.status = 'active'
            WHERE authorization.id = $1
              AND authorization.status = 'approved'
              AND authorization.expires_at > now()
              AND installation.status = 'active'
              AND grant.valid_until > now()
            FOR UPDATE OF authorization, installation, grant`,
          [authorization.id],
        ),
        'lock approved device authorization',
      )[0];
      if (!credential || credential.dpop_jkt !== proof.thumbprint) {
        throw new OAuthProtocolError(400, 'invalid_grant', 'Device authorization is invalid');
      }
      const proofState = await this.enforceTokenProof(
        transaction,
        credential,
        proof,
      );
      if (proofState) return proofState;
      const familyInternalId = randomUUID();
      const familyId = randomUUID();
      rows(
        await transaction.rawQuery(
          `INSERT INTO agent_commerce.oauth_refresh_token_families (
             id, family_id, user_id, grant_id, dpop_jkt, status,
             current_generation
           ) VALUES ($1,$2,$3,$4,$5,'active',0)
           RETURNING id`,
          [
            familyInternalId,
            familyId,
            credential.user_id,
            credential.grant_internal_id,
            credential.dpop_jkt,
          ],
        ),
        'create refresh token family',
      );
      const response = await this.issueCredentialPair(
        transaction,
        signingKey,
        credential,
        familyInternalId,
        0,
      );
      rows(
        await transaction.rawQuery(
          `UPDATE agent_commerce.oauth_device_authorizations
              SET status = 'consumed', consumed_at = now(),
                  lock_version = lock_version + 1
            WHERE id = $1 AND status = 'approved'
            RETURNING id`,
          [credential.authorization_internal_id],
        ),
        'consume device authorization',
      );
      await this.audit(transaction, credential, 'oauth.device-token.issued', {
        authorizationId: credential.authorization_id,
        familyId,
      });
      return { response };
    });
    if ('challenge' in result) {
      if (typeof result.challenge !== 'string') {
        throw new OAuthProtocolError(401, 'invalid_dpop_proof', 'DPoP nonce is invalid');
      }
      throw new OAuthDPoPNonceRequiredError(result.challenge);
    }
    if ('replay' in result) {
      throw new OAuthProtocolError(
        401,
        'invalid_dpop_proof',
        'DPoP proof was already used',
      );
    }
    return result.response;
  }

  async refresh(
    request: TokenRequest,
    proof: OAuthDPoPProofContext,
  ): Promise<Record<string, unknown>> {
    if (!request.refresh_token) {
      throw new OAuthProtocolError(400, 'invalid_request', 'Refresh token is required');
    }
    const signingKey = await this.keys.getSigningKey('oauth-access-token');
    const tokenHash = sha256(request.refresh_token);
    const result = await runSerializableTransaction(this.db, async (transaction) => {
      const credential = rows<CredentialRow>(
        await transaction.rawQuery(
          `SELECT token.id AS refresh_internal_id,
                  token.generation AS refresh_generation,
                  token.expires_at AS refresh_expires_at,
                  token.used_at AS refresh_used_at,
                  token.revoked_at AS refresh_revoked_at,
                  family.id AS family_internal_id,
                  family.family_id,
                  family.status AS family_status,
                  family.current_generation,
                  family.user_id,
                  family.dpop_jkt,
                  grant.id AS grant_internal_id,
                  grant.grant_id,
                  grant.granted_scopes AS scopes,
                  grant.valid_until AS grant_valid_until,
                  installation.id AS installation_internal_id,
                  installation.installation_id
             FROM agent_commerce.oauth_refresh_tokens token
             JOIN agent_commerce.oauth_refresh_token_families family
               ON family.id = token.family_id
             JOIN agent_commerce.agent_grants grant ON grant.id = family.grant_id
             JOIN agent_commerce.agent_installations installation
               ON installation.id = grant.installation_id
             JOIN agent_commerce.oauth_clients client
               ON client.id = installation.oauth_client_id
            WHERE token.token_hash = $1 AND client.client_id = $2
            FOR UPDATE OF token, family, grant, installation`,
          [tokenHash, request.client_id],
        ),
        'lock refresh token',
      )[0];
      if (!credential || credential.dpop_jkt !== proof.thumbprint) {
        throw new OAuthProtocolError(400, 'invalid_grant', 'Refresh credential is invalid');
      }
      const proofState = await this.enforceTokenProof(
        transaction,
        credential,
        proof,
      );
      if (proofState) return proofState;
      if (
        credential.refresh_used_at
        || credential.refresh_revoked_at
        || credential.refresh_generation !== credential.current_generation
      ) {
        await this.compromiseFamily(transaction, credential, 'rotated_refresh_reuse');
        return { reuseDetected: true } as const;
      }
      if (
        credential.family_status !== 'active'
        || new Date(String(credential.refresh_expires_at)) <= new Date()
        || new Date(credential.grant_valid_until) <= new Date()
      ) {
        throw new OAuthProtocolError(400, 'invalid_grant', 'Refresh credential is expired or revoked');
      }
      const nextGeneration = Number(credential.refresh_generation) + 1;
      const response = await this.issueCredentialPair(
        transaction,
        signingKey,
        credential,
        String(credential.family_internal_id),
        nextGeneration,
      );
      const replacementHash = sha256(String(response.refresh_token));
      const replacement = rows<{ id: string }>(
        await transaction.rawQuery(
          `SELECT id FROM agent_commerce.oauth_refresh_tokens
            WHERE token_hash = $1`,
          [replacementHash],
        ),
        'resolve replacement refresh token',
      )[0];
      rows(
        await transaction.rawQuery(
          `UPDATE agent_commerce.oauth_refresh_tokens
              SET used_at = now(), replacement_token_id = $2,
                  lock_version = lock_version + 1
            WHERE id = $1 AND used_at IS NULL AND revoked_at IS NULL
            RETURNING id`,
          [credential.refresh_internal_id, replacement?.id],
        ),
        'consume refresh token',
      );
      rows(
        await transaction.rawQuery(
          `UPDATE agent_commerce.oauth_refresh_token_families
              SET current_generation = $2, last_used_at = now(),
                  lock_version = lock_version + 1
            WHERE id = $1 AND status = 'active'
            RETURNING id`,
          [credential.family_internal_id, nextGeneration],
        ),
        'advance refresh token family',
      );
      await this.audit(transaction, credential, 'oauth.refresh.rotated', {
        familyId: credential.family_id,
        generation: nextGeneration,
      });
      return response;
    });
    if ('challenge' in result) {
      if (typeof result.challenge !== 'string') {
        throw new OAuthProtocolError(401, 'invalid_dpop_proof', 'DPoP nonce is invalid');
      }
      throw new OAuthDPoPNonceRequiredError(result.challenge);
    }
    if ('replay' in result) {
      throw new OAuthProtocolError(
        401,
        'invalid_dpop_proof',
        'DPoP proof was already used',
      );
    }
    if ('reuseDetected' in result) {
      throw new OAuthProtocolError(
        400,
        'invalid_grant',
        'Refresh credential reuse was detected',
      );
    }
    return result;
  }

  async revoke(token: string, proof: OAuthDPoPProofContext): Promise<null> {
    const tokenHash = sha256(token);
    const result = await runSerializableTransaction(this.db, async (transaction) => {
      const access = rows<CredentialRow & { access_internal_id: string }>(
        await transaction.rawQuery(
          `SELECT access.id AS access_internal_id, access.user_id,
                  access.dpop_jkt, grant.id AS grant_internal_id,
                  grant.grant_id, grant.granted_scopes AS scopes,
                  grant.valid_until AS grant_valid_until,
                  installation.id AS installation_internal_id,
                  installation.installation_id
             FROM agent_commerce.oauth_access_token_jtis access
             JOIN agent_commerce.agent_grants grant ON grant.id = access.grant_id
             JOIN agent_commerce.agent_installations installation
               ON installation.id = grant.installation_id
            WHERE access.token_hash = $1
            FOR UPDATE OF access`,
          [tokenHash],
        ),
        'resolve access token revocation',
      )[0];
      if (access) {
        if (access.dpop_jkt !== proof.thumbprint) {
          throw new OAuthProtocolError(401, 'invalid_dpop_proof', 'DPoP key does not match token');
        }
        const proofState = await this.enforceTokenProof(
          transaction,
          access,
          proof,
        );
        if (proofState) return proofState;
        await transaction.rawQuery(
          `UPDATE agent_commerce.oauth_access_token_jtis
              SET revoked_at = COALESCE(revoked_at, now()),
                  lock_version = lock_version + 1
            WHERE id = $1 AND revoked_at IS NULL`,
          [access.access_internal_id],
        );
        await this.audit(transaction, access, 'oauth.access-token.revoked', {});
        return null;
      }
      const refresh = rows<CredentialRow>(
        await transaction.rawQuery(
          `SELECT family.id AS family_internal_id, family.family_id,
                  family.user_id, family.dpop_jkt,
                  grant.id AS grant_internal_id, grant.grant_id,
                  grant.granted_scopes AS scopes,
                  grant.valid_until AS grant_valid_until,
                  installation.id AS installation_internal_id,
                  installation.installation_id
             FROM agent_commerce.oauth_refresh_tokens token
             JOIN agent_commerce.oauth_refresh_token_families family
               ON family.id = token.family_id
             JOIN agent_commerce.agent_grants grant ON grant.id = family.grant_id
             JOIN agent_commerce.agent_installations installation
               ON installation.id = grant.installation_id
            WHERE token.token_hash = $1
            FOR UPDATE OF family`,
          [tokenHash],
        ),
        'resolve refresh token revocation',
      )[0];
      if (!refresh) return null;
      if (refresh.dpop_jkt !== proof.thumbprint) {
        throw new OAuthProtocolError(401, 'invalid_dpop_proof', 'DPoP key does not match token');
      }
      const proofState = await this.enforceTokenProof(
        transaction,
        refresh,
        proof,
      );
      if (proofState) return proofState;
      await this.revokeFamily(transaction, refresh, 'client_revocation');
      return null;
    });
    if (result && 'challenge' in result) {
      throw new OAuthDPoPNonceRequiredError(result.challenge);
    }
    if (result && 'replay' in result) {
      throw new OAuthProtocolError(
        401,
        'invalid_dpop_proof',
        'DPoP proof was already used',
      );
    }
    return null;
  }

  private async issueCredentialPair(
    transaction: DatabaseTransaction,
    signingKey: AgentSigningKey,
    credential: CredentialRow,
    familyInternalId: string,
    generation: number,
  ): Promise<Record<string, unknown>> {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const expiresSeconds = nowSeconds + ACCESS_TOKEN_LIFETIME_SECONDS;
    const tokenJti = randomUUID();
    const scope = [...credential.scopes].sort().join(' ');
    const payload = {
      iss: DIVINR_ISSUER,
      sub: credential.user_id,
      aud: DIVINR_A2A_RESOURCE,
      client_id: APPLE_ASSISTANT_CLIENT_ID,
      installation_id: credential.installation_id,
      scope,
      cnf: { jkt: credential.dpop_jkt },
      iat: nowSeconds,
      nbf: nowSeconds,
      exp: expiresSeconds,
      jti: tokenJti,
    };
    const header = {
      alg: 'ES256',
      kid: signingKey.keyId,
      typ: 'at+jwt',
    };
    const signingInput = `${encode(header)}.${encode(payload)}`;
    const signature = sign(
      'sha256',
      new TextEncoder().encode(signingInput),
      { key: signingKey.privateKey, dsaEncoding: 'ieee-p1363' },
    ).toString('base64url');
    const accessToken = `${signingInput}.${signature}`;
    const refreshToken = randomBytes(48).toString('base64url');
    const issuedAt = new Date(nowSeconds * 1000).toISOString();
    const accessExpiresAt = new Date(expiresSeconds * 1000).toISOString();
    const refreshExpiresAt = credential.grant_valid_until;
    rows(
      await transaction.rawQuery(
        `INSERT INTO agent_commerce.oauth_refresh_tokens (
           user_id, family_id, generation, token_hash, issued_at, expires_at
         ) VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id`,
        [
          credential.user_id,
          familyInternalId,
          generation,
          sha256(refreshToken),
          issuedAt,
          refreshExpiresAt,
        ],
      ),
      'store refresh token',
    );
    rows(
      await transaction.rawQuery(
        `INSERT INTO agent_commerce.oauth_access_token_jtis (
           token_jti, token_hash, user_id, grant_id, audience,
           scopes_hash, dpop_jkt, issued_at, expires_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id`,
        [
          tokenJti,
          sha256(accessToken),
          credential.user_id,
          credential.grant_internal_id,
          DIVINR_A2A_RESOURCE,
          sha256(scope),
          credential.dpop_jkt,
          issuedAt,
          accessExpiresAt,
        ],
      ),
      'store access token JTI',
    );
    return {
      access_token: accessToken,
      token_type: 'DPoP',
      expires_in: ACCESS_TOKEN_LIFETIME_SECONDS,
      refresh_token: refreshToken,
      scope,
    };
  }

  private async compromiseFamily(
    transaction: DatabaseTransaction,
    credential: CredentialRow,
    reason: string,
  ): Promise<void> {
    await transaction.rawQuery(
      `UPDATE agent_commerce.oauth_refresh_token_families
          SET status = 'compromised', compromised_at = now(),
              lock_version = lock_version + 1
        WHERE id = $1 AND status <> 'compromised'`,
      [credential.family_internal_id],
    );
    await transaction.rawQuery(
      `UPDATE agent_commerce.oauth_refresh_tokens
          SET revoked_at = COALESCE(revoked_at, now()),
              lock_version = lock_version + 1
        WHERE family_id = $1 AND revoked_at IS NULL`,
      [credential.family_internal_id],
    );
    await transaction.rawQuery(
      `UPDATE agent_commerce.oauth_access_token_jtis
          SET revoked_at = COALESCE(revoked_at, now()),
              lock_version = lock_version + 1
        WHERE grant_id = $1 AND revoked_at IS NULL`,
      [credential.grant_internal_id],
    );
    await this.audit(transaction, credential, 'oauth.refresh.reuse-detected', {
      familyId: credential.family_id,
      reason,
    }, 'denied', reason);
  }

  private async revokeFamily(
    transaction: DatabaseTransaction,
    credential: CredentialRow,
    reason: string,
  ): Promise<void> {
    await transaction.rawQuery(
      `UPDATE agent_commerce.oauth_refresh_token_families
          SET status = 'revoked', revoked_at = COALESCE(revoked_at, now()),
              lock_version = lock_version + 1
        WHERE id = $1 AND status <> 'revoked'`,
      [credential.family_internal_id],
    );
    await transaction.rawQuery(
      `UPDATE agent_commerce.oauth_refresh_tokens
          SET revoked_at = COALESCE(revoked_at, now()),
              lock_version = lock_version + 1
        WHERE family_id = $1 AND revoked_at IS NULL`,
      [credential.family_internal_id],
    );
    await transaction.rawQuery(
      `UPDATE agent_commerce.oauth_access_token_jtis
          SET revoked_at = COALESCE(revoked_at, now()),
              lock_version = lock_version + 1
        WHERE grant_id = $1 AND revoked_at IS NULL`,
      [credential.grant_internal_id],
    );
    await this.audit(transaction, credential, 'oauth.refresh-family.revoked', {
      familyId: credential.family_id,
    }, 'succeeded', reason);
  }

  private async audit(
    transaction: DatabaseTransaction,
    credential: CredentialRow,
    action: string,
    detail: Record<string, unknown>,
    outcome: AuditEventInput['outcome'] = 'succeeded',
    reason?: string,
  ): Promise<void> {
    await this.commerce.appendAuditEvent(transaction, {
      eventId: randomUUID(),
      orderingKey: `installation:${credential.installation_internal_id}`,
      actorPrincipal: `agent:${credential.installation_id}`,
      userId: credential.user_id,
      installationId: credential.installation_internal_id,
      action,
      outcome,
      reason,
      redactedDetail: detail,
    });
  }

  private async enforceTokenProof(
    transaction: DatabaseTransaction,
    credential: CredentialRow,
    proof: OAuthDPoPProofContext,
  ): Promise<{ challenge: string } | { replay: true } | null> {
    const replay = rows<{ present: boolean }>(
      await transaction.rawQuery(
        `SELECT EXISTS (
           SELECT 1 FROM agent_commerce.dpop_proof_replays
            WHERE dpop_jkt = $1 AND proof_jti = $2 AND expires_at > now()
         ) AS present`,
        [credential.dpop_jkt, proof.jti],
      ),
      'check OAuth DPoP replay',
    )[0]?.present;
    if (replay) return { replay: true };
    if (proof.nonce) {
      const consumed = rows<{ id: string }>(
        await transaction.rawQuery(
          `UPDATE agent_commerce.dpop_nonces
              SET consumed_at = now(), lock_version = lock_version + 1
            WHERE nonce_hash = $1
              AND user_id = $2
              AND installation_id = $3
              AND dpop_jkt = $4
              AND purpose = 'token'
              AND consumed_at IS NULL
              AND expires_at > now()
            RETURNING id`,
          [
            sha256(proof.nonce),
            credential.user_id,
            credential.installation_internal_id,
            credential.dpop_jkt,
          ],
        ),
        'consume OAuth DPoP nonce',
      )[0];
      if (consumed) {
        const inserted = rows(
          await transaction.rawQuery(
            `INSERT INTO agent_commerce.dpop_proof_replays (
               user_id, dpop_jkt, proof_jti, http_method,
               canonical_uri_hash, expires_at
             ) VALUES ($1,$2,$3,$4,$5,now() + interval '10 minutes')
             ON CONFLICT (dpop_jkt, proof_jti) DO NOTHING
             RETURNING id`,
            [
              credential.user_id,
              credential.dpop_jkt,
              proof.jti,
              proof.method.toUpperCase(),
              sha256(proof.uri),
            ],
          ),
          'record OAuth DPoP proof',
        );
        return inserted.length === 1 ? null : { replay: true };
      }
    }
    const nonce = randomBytes(32).toString('base64url');
    await transaction.rawQuery(
      `UPDATE agent_commerce.dpop_nonces
          SET consumed_at = now(), lock_version = lock_version + 1
        WHERE id IN (
          SELECT id
            FROM agent_commerce.dpop_nonces
           WHERE installation_id = $1
             AND purpose = 'token'
             AND consumed_at IS NULL
             AND expires_at > now()
           ORDER BY issued_at DESC
           OFFSET 3
        )`,
      [credential.installation_internal_id],
    );
    rows(
      await transaction.rawQuery(
        `INSERT INTO agent_commerce.dpop_nonces (
           user_id, nonce_hash, dpop_jkt, installation_id, purpose,
           issued_at, expires_at
         ) VALUES ($1,$2,$3,$4,'token',now(),now() + interval '5 minutes')
         RETURNING id`,
        [
          credential.user_id,
          sha256(nonce),
          credential.dpop_jkt,
          credential.installation_internal_id,
        ],
      ),
      'issue OAuth DPoP nonce',
    );
    return { challenge: nonce };
  }
}
