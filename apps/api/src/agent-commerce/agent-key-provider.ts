import {
  Inject,
  Injectable,
} from '@nestjs/common';
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
} from 'node:crypto';
import {
  DATABASE_SERVICE,
  type DatabaseService,
} from '@orchestratorai/planes/database';

export const AGENT_KEY_PROVIDER = Symbol('AGENT_KEY_PROVIDER');

export type AgentKeyRole =
  | 'agent-card'
  | 'oauth-access-token'
  | 'checkout'
  | 'quote'
  | 'checkout-receipt'
  | 'payment-receipt'
  | 'service-receipt'
  | 'refund-receipt'
  | 'push'
  | 'settlement';

export interface AgentPublicJwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
  use: 'sig';
  alg: 'ES256';
  kid: string;
  gg_role: AgentKeyRole;
}

export interface AgentSigningKey {
  keyId: string;
  role: AgentKeyRole;
  privateKey: KeyObject;
  publicJwk: AgentPublicJwk;
  fallback: boolean;
}

export interface AgentKeyProvider {
  getSigningKey(role: AgentKeyRole): Promise<AgentSigningKey>;
  getPublicKeys(): Promise<AgentPublicJwk[]>;
  assertProductionReady(): Promise<void>;
}

interface StoredKeyRow {
  key_id: string;
  algorithm: string;
  public_jwk: Record<string, unknown>;
  external_custody_ref: string;
  status: string;
  valid_from: string;
  valid_until: string | null;
}

interface ExportedEcJwk {
  kty?: string;
  crv?: string;
  x?: string;
  y?: string;
}

function publicJwk(
  keyId: string,
  role: AgentKeyRole,
  privateKey: KeyObject,
): AgentPublicJwk {
  const exported = createPublicKey(privateKey).export({ format: 'jwk' }) as ExportedEcJwk;
  if (
    exported.kty !== 'EC'
    || exported.crv !== 'P-256'
    || typeof exported.x !== 'string'
    || typeof exported.y !== 'string'
  ) {
    throw new Error(`Signing key ${keyId} is not an ES256 P-256 key`);
  }
  return {
    kty: 'EC',
    crv: 'P-256',
    x: exported.x,
    y: exported.y,
    use: 'sig',
    alg: 'ES256',
    kid: keyId,
    gg_role: role,
  };
}

function parsePrivateJwk(raw: string): KeyObject {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (
    parsed.kty !== 'EC'
    || parsed.crv !== 'P-256'
    || typeof parsed.d !== 'string'
  ) {
    throw new Error('Configured signing key must be a private P-256 JWK');
  }
  return createPrivateKey({ key: parsed, format: 'jwk' });
}

function assertDivinrKeyId(keyId: string): void {
  if (!/^divinr-[a-z0-9-]+-v[1-9][0-9]*$/.test(keyId)) {
    throw new Error(`Invalid Divinr key ID: ${keyId}`);
  }
}

@Injectable()
export class RegistryBackedAgentKeyProvider
implements AgentKeyProvider {
  private readonly signingKeys = new Map<AgentKeyRole, AgentSigningKey>();

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
  ) {}

  async assertProductionReady(): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      await this.getSigningKey('agent-card');
      await this.getSigningKey('oauth-access-token');
    }
  }

  async getSigningKey(role: AgentKeyRole): Promise<AgentSigningKey> {
    if (!['agent-card', 'oauth-access-token'].includes(role)) {
      throw new Error(`Signing key role is not implemented yet: ${role}`);
    }
    const cached = this.signingKeys.get(role);
    if (cached) return cached;

    const configured = role === 'agent-card'
      ? process.env.DIVINR_AGENT_CARD_PRIVATE_JWK
      : process.env.DIVINR_OAUTH_ACCESS_TOKEN_PRIVATE_JWK;
    const keyId = role === 'agent-card'
      ? process.env.DIVINR_AGENT_CARD_KEY_ID ?? 'divinr-agent-card-v1'
      : process.env.DIVINR_OAUTH_ACCESS_TOKEN_KEY_ID ?? 'divinr-oauth-access-token-v1';
    assertDivinrKeyId(keyId);
    if (!configured) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          `Production requires externally custodied ${
            role === 'agent-card'
              ? 'DIVINR_AGENT_CARD_PRIVATE_JWK'
              : 'DIVINR_OAUTH_ACCESS_TOKEN_PRIVATE_JWK'
          }`,
        );
      }
      const generated = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      const generatedKey = {
        keyId,
        role,
        privateKey: generated.privateKey,
        publicJwk: publicJwk(keyId, role, generated.privateKey),
        fallback: true,
      };
      this.signingKeys.set(role, generatedKey);
      return generatedKey;
    }

    const privateKey = parsePrivateJwk(configured);
    const derivedPublicJwk = publicJwk(keyId, role, privateKey);
    await this.verifyRegistryBinding(keyId, role, derivedPublicJwk);
    const signingKey = {
      keyId,
      role,
      privateKey,
      publicJwk: derivedPublicJwk,
      fallback: false,
    };
    this.signingKeys.set(role, signingKey);
    return signingKey;
  }

  async getPublicKeys(): Promise<AgentPublicJwk[]> {
    const activeKeys = await Promise.all([
      this.getSigningKey('agent-card'),
      this.getSigningKey('oauth-access-token'),
    ]);
    if (activeKeys.every((key) => key.fallback)) {
      return activeKeys.map((key) => key.publicJwk);
    }
    const result = await this.db.rawQuery(
      `SELECT key_id, key_role, public_jwk
         FROM agent_commerce.cryptographic_key_registry
        WHERE owner_service = 'divinr'
          AND key_role IN ('agent_card','oauth_signing')
          AND status IN ('active','retiring')
          AND valid_from <= now()
          AND (valid_until IS NULL OR valid_until > now())
        ORDER BY key_role, CASE status WHEN 'active' THEN 0 ELSE 1 END, valid_from DESC`,
    );
    if (result.error) {
      throw new Error(`Agent Card JWKS registry lookup failed: ${result.error.message}`);
    }
    const rows = (result.data as Array<{
      key_id: string;
      key_role: 'agent_card' | 'oauth_signing';
      public_jwk: Record<string, unknown>;
    }> | null) ?? [];
    const keys = rows.map((row): AgentPublicJwk => {
      assertDivinrKeyId(row.key_id);
      if (
        row.public_jwk.kty !== 'EC'
        || row.public_jwk.crv !== 'P-256'
        || typeof row.public_jwk.x !== 'string'
        || typeof row.public_jwk.y !== 'string'
      ) {
        throw new Error(`Invalid Agent Card public JWK for ${row.key_id}`);
      }
      return {
        kty: 'EC',
        crv: 'P-256',
        x: row.public_jwk.x,
        y: row.public_jwk.y,
        use: 'sig',
        alg: 'ES256',
        kid: row.key_id,
        gg_role: row.key_role === 'agent_card'
          ? 'agent-card'
          : 'oauth-access-token',
      };
    });
    for (const signingKey of activeKeys.filter((key) => !key.fallback)) {
      if (!keys.some((key) => key.kid === signingKey.keyId)) {
        throw new Error(
          `JWKS does not contain the active ${signingKey.role} signing key`,
        );
      }
    }
    for (const signingKey of activeKeys.filter((key) => key.fallback)) {
      keys.push(signingKey.publicJwk);
    }
    return keys;
  }

  private async verifyRegistryBinding(
    keyId: string,
    role: AgentKeyRole,
    derived: AgentPublicJwk,
  ): Promise<void> {
    const registryRole = role === 'agent-card' ? 'agent_card' : 'oauth_signing';
    const result = await this.db.rawQuery(
      `SELECT key_id, algorithm, public_jwk, external_custody_ref, status,
              valid_from, valid_until
        FROM agent_commerce.cryptographic_key_registry
        WHERE owner_service = 'divinr'
          AND key_role = $2
          AND key_id = $1
          AND status IN ('active','retiring')
          AND valid_from <= now()
          AND (valid_until IS NULL OR valid_until > now())
        LIMIT 1`,
      [keyId, registryRole],
    );
    if (result.error) {
      throw new Error(`${role} key registry lookup failed: ${result.error.message}`);
    }
    const row = (result.data as StoredKeyRow[] | null)?.[0];
    if (!row) {
      throw new Error(`No active ${role} registry binding for ${keyId}`);
    }
    if (
      row.algorithm !== 'ES256'
      || row.public_jwk.kty !== derived.kty
      || row.public_jwk.crv !== derived.crv
      || row.public_jwk.x !== derived.x
      || row.public_jwk.y !== derived.y
    ) {
      throw new Error(`${role} public key registry mismatch for ${keyId}`);
    }
    if (!row.external_custody_ref) {
      throw new Error(`${role} key ${keyId} has no external custody reference`);
    }
  }
}
