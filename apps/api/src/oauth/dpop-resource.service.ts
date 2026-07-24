import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import {
  createHash,
  createPublicKey,
  randomBytes,
  verify,
} from 'node:crypto';
import {
  DATABASE_SERVICE,
  runSerializableTransaction,
  type DatabaseService,
  type QueryResult,
} from '@orchestratorai/planes/database';
import {
  AGENT_KEY_PROVIDER,
  type AgentKeyProvider,
  type AgentPublicJwk,
} from '../agent-commerce/agent-key-provider';
import { canonicalJsonBytes } from '../agent-contracts/canonical-json';
import {
  ACCESS_TOKEN_LIFETIME_SECONDS,
  APPLE_ASSISTANT_CLIENT_ID,
  DIVINR_A2A_RESOURCE,
  DIVINR_ISSUER,
} from './oauth.constants';

interface AccessClaims {
  iss: string;
  sub: string;
  aud: string;
  client_id: string;
  installation_id: string;
  scope: string;
  cnf: { jkt: string };
  iat: number;
  nbf: number;
  exp: number;
  jti: string;
}

interface AccessRow {
  user_id: string;
  grant_internal_id: string;
  grant_id: string;
  grant_status: string;
  grant_valid_until: string;
  installation_internal_id: string;
  installation_id: string;
  installation_status: string;
  dpop_jkt: string;
  audience: string;
  scopes_hash: string;
  token_hash: string;
  token_jti: string;
  expires_at: string;
  revoked_at: string | null;
}

interface ProofClaims {
  htm?: unknown;
  htu?: unknown;
  iat?: unknown;
  jti?: unknown;
  ath?: unknown;
  nonce?: unknown;
}

export interface VerifiedAgentPrincipal {
  userId: string;
  installationInternalId: string;
  installationId: string;
  grantInternalId: string;
  grantId: string;
  scopes: readonly string[];
  dpopJkt: string;
  accessTokenJti: string;
}

export class DPoPNonceRequiredError extends UnauthorizedException {
  constructor(readonly nonce: string) {
    super({
      code: 'DPOP_NONCE_REQUIRED',
      message: 'Retry with the supplied one-use DPoP nonce.',
      retryable: true,
    });
  }
}

function rows<T>(result: QueryResult, operation: string): T[] {
  if (result.error) throw new Error(`${operation} failed: ${result.error.message}`);
  return (result.data as T[] | null) ?? [];
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sha256Base64Url(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

function parseJson<T>(encoded: string, label: string): T {
  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as T;
  } catch {
    throw new UnauthorizedException(`Invalid ${label}`);
  }
}

function publicProofJwk(value: unknown): {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new UnauthorizedException('DPoP public JWK is required');
  }
  const jwk = value as Record<string, unknown>;
  if (
    jwk.kty !== 'EC'
    || jwk.crv !== 'P-256'
    || typeof jwk.x !== 'string'
    || typeof jwk.y !== 'string'
    || 'd' in jwk
  ) {
    throw new UnauthorizedException('DPoP public JWK is invalid');
  }
  return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
}

@Injectable()
export class DPoPResourceService {
  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(AGENT_KEY_PROVIDER) private readonly keys: AgentKeyProvider,
  ) {}

  async authenticate(
    authorization: string | undefined,
    proof: string | undefined,
    method: string,
    canonicalUri: string,
  ): Promise<VerifiedAgentPrincipal> {
    const accessToken = this.readAuthorization(authorization);
    const claims = await this.verifyAccessToken(accessToken);
    const access = await this.loadAccessState(claims, accessToken);
    const proofClaims = this.verifyProof(
      proof,
      method,
      canonicalUri,
      accessToken,
      access.dpop_jkt,
    );
    if (typeof proofClaims.nonce !== 'string') {
      throw new DPoPNonceRequiredError(await this.issueNonce(access));
    }
    const nonceHash = sha256Hex(proofClaims.nonce);
    const replayExpiresAt = new Date(Date.now() + 600_000).toISOString();
    const accepted = await runSerializableTransaction(this.db, async (transaction) => {
      const replayExists = rows<{ present: boolean }>(
        await transaction.rawQuery(
          `SELECT EXISTS (
             SELECT 1 FROM agent_commerce.dpop_proof_replays
              WHERE dpop_jkt = $1 AND proof_jti = $2 AND expires_at > now()
           ) AS present`,
          [access.dpop_jkt, proofClaims.jti],
        ),
        'check DPoP proof replay',
      )[0]?.present;
      if (replayExists) return 'replay' as const;
      const nonce = rows<{ id: string }>(
        await transaction.rawQuery(
          `UPDATE agent_commerce.dpop_nonces
              SET consumed_at = now(), lock_version = lock_version + 1
            WHERE nonce_hash = $1
              AND user_id = $2
              AND installation_id = $3
              AND dpop_jkt = $4
              AND purpose = 'resource'
              AND consumed_at IS NULL
              AND expires_at > now()
            RETURNING id`,
          [
            nonceHash,
            access.user_id,
            access.installation_internal_id,
            access.dpop_jkt,
          ],
        ),
        'consume DPoP nonce',
      )[0];
      if (!nonce) return 'nonce' as const;
      const replay = await transaction.rawQuery(
        `INSERT INTO agent_commerce.dpop_proof_replays (
           user_id, dpop_jkt, proof_jti, http_method, canonical_uri_hash,
           access_token_hash, expires_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (dpop_jkt, proof_jti) DO NOTHING
         RETURNING id`,
        [
          access.user_id,
          access.dpop_jkt,
          proofClaims.jti,
          method.toUpperCase(),
          sha256Hex(canonicalUri),
          access.token_hash,
          replayExpiresAt,
        ],
      );
      return rows(replay, 'record DPoP proof replay').length === 1
        ? 'accepted' as const
        : 'replay' as const;
    });
    if (accepted === 'replay') {
      throw new UnauthorizedException({
        code: 'DPOP_REPLAY',
        message: 'DPoP proof was already used.',
        retryable: false,
      });
    }
    if (accepted === 'nonce') {
      throw new DPoPNonceRequiredError(await this.issueNonce(access));
    }
    await this.db.rawQuery(
      `UPDATE agent_commerce.agent_installations
          SET last_used_at = now(), lock_version = lock_version + 1
        WHERE id = $1 AND status = 'active'`,
      [access.installation_internal_id],
    );
    return {
      userId: access.user_id,
      installationInternalId: access.installation_internal_id,
      installationId: access.installation_id,
      grantInternalId: access.grant_internal_id,
      grantId: access.grant_id,
      scopes: claims.scope.split(' '),
      dpopJkt: access.dpop_jkt,
      accessTokenJti: access.token_jti,
    };
  }

  private readAuthorization(value: string | undefined): string {
    const match = value?.match(/^DPoP ([A-Za-z0-9._-]+)$/);
    if (!match) throw new UnauthorizedException('DPoP access token is required');
    return match[1];
  }

  private async verifyAccessToken(token: string): Promise<AccessClaims> {
    const parts = token.split('.');
    if (parts.length !== 3) throw new UnauthorizedException('Access token is malformed');
    const header = parseJson<Record<string, unknown>>(parts[0], 'access token header');
    const claims = parseJson<AccessClaims>(parts[1], 'access token claims');
    if (
      header.alg !== 'ES256'
      || header.typ !== 'at+jwt'
      || typeof header.kid !== 'string'
    ) {
      throw new UnauthorizedException('Access token header is invalid');
    }
    const allowedClaims = [
      'aud', 'client_id', 'cnf', 'exp', 'iat', 'installation_id',
      'iss', 'jti', 'nbf', 'scope', 'sub',
    ];
    if (Object.keys(claims).sort().join(',') !== allowedClaims.sort().join(',')) {
      throw new UnauthorizedException('Access token claims are invalid');
    }
    const key = (await this.keys.getPublicKeys()).find(
      (candidate) =>
        candidate.kid === header.kid
        && candidate.gg_role === 'oauth-access-token',
    );
    if (!key || !this.verifySignature(parts, key)) {
      throw new UnauthorizedException('Access token signature is invalid');
    }
    const now = Math.floor(Date.now() / 1000);
    if (
      claims.iss !== DIVINR_ISSUER
      || claims.aud !== DIVINR_A2A_RESOURCE
      || claims.client_id !== APPLE_ASSISTANT_CLIENT_ID
      || typeof claims.sub !== 'string'
      || typeof claims.installation_id !== 'string'
      || typeof claims.scope !== 'string'
      || !claims.cnf
      || typeof claims.cnf.jkt !== 'string'
      || !Number.isInteger(claims.iat)
      || !Number.isInteger(claims.nbf)
      || !Number.isInteger(claims.exp)
      || typeof claims.jti !== 'string'
      || claims.nbf > now
      || claims.exp <= now
      || claims.exp - claims.iat > ACCESS_TOKEN_LIFETIME_SECONDS
    ) {
      throw new UnauthorizedException('Access token is expired or invalid');
    }
    return claims;
  }

  private verifySignature(parts: string[], key: AgentPublicJwk): boolean {
    try {
      return verify(
        'sha256',
        new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
        {
          key: createPublicKey({
            key: {
              kty: key.kty,
              crv: key.crv,
              x: key.x,
              y: key.y,
            },
            format: 'jwk',
          }),
          dsaEncoding: 'ieee-p1363',
        },
        Uint8Array.from(Buffer.from(parts[2], 'base64url')),
      );
    } catch {
      return false;
    }
  }

  private async loadAccessState(
    claims: AccessClaims,
    token: string,
  ): Promise<AccessRow> {
    const access = rows<AccessRow>(
      await this.db.rawQuery(
        `SELECT access.user_id,
                access.grant_id AS grant_internal_id,
                access.token_jti, access.token_hash, access.audience,
                access.scopes_hash, access.dpop_jkt, access.expires_at,
                access.revoked_at,
                grant.grant_id, grant.status AS grant_status,
                grant.valid_until AS grant_valid_until,
                installation.id AS installation_internal_id,
                installation.installation_id,
                installation.status AS installation_status
           FROM agent_commerce.oauth_access_token_jtis access
           JOIN agent_commerce.agent_grants grant ON grant.id = access.grant_id
           JOIN agent_commerce.agent_installations installation
             ON installation.id = grant.installation_id
          WHERE access.token_jti = $1`,
        [claims.jti],
      ),
      'read access token state',
    )[0];
    const scopeHash = sha256Hex(claims.scope);
    if (
      !access
      || access.token_hash !== sha256Hex(token)
      || access.user_id !== claims.sub
      || access.installation_id !== claims.installation_id
      || access.audience !== claims.aud
      || access.scopes_hash !== scopeHash
      || access.dpop_jkt !== claims.cnf.jkt
      || access.revoked_at
      || access.grant_status !== 'active'
      || access.installation_status !== 'active'
      || new Date(access.expires_at) <= new Date()
      || new Date(access.grant_valid_until) <= new Date()
    ) {
      throw new UnauthorizedException('Access token is revoked or invalid');
    }
    return access;
  }

  private verifyProof(
    compact: string | undefined,
    method: string,
    canonicalUri: string,
    accessToken: string,
    expectedJkt: string,
  ): ProofClaims {
    const parts = compact?.split('.') ?? [];
    if (parts.length !== 3) throw new UnauthorizedException('DPoP proof is required');
    const header = parseJson<Record<string, unknown>>(parts[0], 'DPoP header');
    const claims = parseJson<ProofClaims>(parts[1], 'DPoP claims');
    const jwk = publicProofJwk(header.jwk);
    if (header.alg !== 'ES256' || String(header.typ).toLowerCase() !== 'dpop+jwt') {
      throw new UnauthorizedException('DPoP header is invalid');
    }
    let signatureValid = false;
    try {
      signatureValid = verify(
        'sha256',
        new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
        {
          key: createPublicKey({ key: jwk, format: 'jwk' }),
          dsaEncoding: 'ieee-p1363',
        },
        Uint8Array.from(Buffer.from(parts[2], 'base64url')),
      );
    } catch {
      signatureValid = false;
    }
    const jkt = createHash('sha256')
      .update(canonicalJsonBytes(jwk))
      .digest('base64url');
    const now = Math.floor(Date.now() / 1000);
    if (
      !signatureValid
      || jkt !== expectedJkt
      || claims.htm !== method.toUpperCase()
      || claims.htu !== canonicalUri
      || claims.ath !== sha256Base64Url(accessToken)
      || typeof claims.iat !== 'number'
      || !Number.isInteger(claims.iat)
      || Math.abs(now - claims.iat) > 60
      || typeof claims.jti !== 'string'
      || claims.jti.length < 1
      || claims.jti.length > 128
    ) {
      throw new UnauthorizedException('DPoP proof is invalid');
    }
    return claims;
  }

  private async issueNonce(access: AccessRow): Promise<string> {
    const nonce = randomBytes(32).toString('base64url');
    await runSerializableTransaction(this.db, async (transaction) => {
      await transaction.rawQuery(
        `UPDATE agent_commerce.dpop_nonces
            SET consumed_at = now(), lock_version = lock_version + 1
          WHERE id IN (
            SELECT id
              FROM agent_commerce.dpop_nonces
             WHERE installation_id = $1
               AND purpose = 'resource'
               AND consumed_at IS NULL
               AND expires_at > now()
             ORDER BY issued_at DESC
             OFFSET 3
          )`,
        [access.installation_internal_id],
      );
      rows(
        await transaction.rawQuery(
          `INSERT INTO agent_commerce.dpop_nonces (
             user_id, nonce_hash, dpop_jkt, installation_id, purpose,
             issued_at, expires_at
           ) VALUES ($1,$2,$3,$4,'resource',now(),now() + interval '5 minutes')
           RETURNING id`,
          [
            access.user_id,
            sha256Hex(nonce),
            access.dpop_jkt,
            access.installation_internal_id,
          ],
        ),
        'issue DPoP nonce',
      );
    });
    return nonce;
  }
}
