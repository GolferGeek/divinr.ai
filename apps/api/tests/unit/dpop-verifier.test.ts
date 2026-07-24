import assert from 'node:assert/strict';
import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign,
} from 'node:crypto';
import { canonicalJson } from '../../src/agent-contracts/canonical-json';
import {
  DPoPNonceRequiredError,
  DPoPResourceService,
} from '../../src/oauth/dpop-resource.service';

function encode(value: unknown): string {
  return Buffer.from(canonicalJson(value)).toString('base64url');
}

function hashHex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function compactJwt(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'],
): string {
  const input = `${encode(header)}.${encode(payload)}`;
  const signature = sign(
    'sha256',
    new TextEncoder().encode(input),
    { key: privateKey, dsaEncoding: 'ieee-p1363' },
  ).toString('base64url');
  return `${input}.${signature}`;
}

async function main(): Promise<void> {
  const oauthPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const oauthPublic = createPublicKey(oauthPair.privateKey).export({ format: 'jwk' });
  const dpopPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const dpopPublic = createPublicKey(dpopPair.privateKey).export({ format: 'jwk' });
  const proofJwk = {
    kty: 'EC' as const,
    crv: 'P-256' as const,
    x: String(dpopPublic.x),
    y: String(dpopPublic.y),
  };
  const dpopJkt = createHash('sha256')
    .update(Buffer.from(canonicalJson(proofJwk)))
    .digest('base64url');
  const now = Math.floor(Date.now() / 1000);
  const scope = 'commerce:purchase receipts:read updates:read';
  const tokenJti = randomUUID();
  const accessToken = compactJwt(
    { alg: 'ES256', kid: 'divinr-oauth-access-token-v1', typ: 'at+jwt' },
    {
      iss: 'https://divinr.ai',
      sub: '10000000-0000-0000-0000-000000000001',
      aud: 'https://divinr.ai/a2a',
      client_id: 'apple-assistant-native-v1',
      installation_id: 'apple-installation-test-001',
      scope,
      cnf: { jkt: dpopJkt },
      iat: now,
      nbf: now,
      exp: now + 600,
      jti: tokenJti,
    },
    oauthPair.privateKey,
  );

  let activeNonceHash: string | undefined;
  const replayJtis = new Set<string>();
  const transaction = {
    rawQuery: async (sql: string, params: unknown[] = []) => {
      if (sql.includes('SELECT EXISTS')) {
        return {
          data: [{ present: replayJtis.has(String(params[1])) }],
          error: null,
        };
      }
      if (sql.includes('UPDATE agent_commerce.dpop_nonces') && sql.includes('nonce_hash')) {
        const accepted = activeNonceHash === params[0];
        if (accepted) activeNonceHash = undefined;
        return { data: accepted ? [{ id: 'nonce-row' }] : [], error: null };
      }
      if (sql.includes('INSERT INTO agent_commerce.dpop_proof_replays')) {
        replayJtis.add(String(params[2]));
        return { data: [{ id: 'replay-row' }], error: null };
      }
      if (sql.includes('INSERT INTO agent_commerce.dpop_nonces')) {
        activeNonceHash = String(params[1]);
        return { data: [{ id: 'nonce-row' }], error: null };
      }
      return { data: [], error: null };
    },
  };
  const database = {
    rawQuery: async (sql: string) => {
      if (sql.includes('FROM agent_commerce.oauth_access_token_jtis access')) {
        return {
          data: [{
            user_id: '10000000-0000-0000-0000-000000000001',
            grant_internal_id: '20000000-0000-0000-0000-000000000001',
            grant_id: 'grant-test-001',
            grant_status: 'active',
            grant_valid_until: new Date(Date.now() + 86_400_000).toISOString(),
            installation_internal_id: '30000000-0000-0000-0000-000000000001',
            installation_id: 'apple-installation-test-001',
            installation_status: 'active',
            dpop_jkt: dpopJkt,
            audience: 'https://divinr.ai/a2a',
            scopes_hash: hashHex(scope),
            token_hash: hashHex(accessToken),
            token_jti: tokenJti,
            expires_at: new Date(Date.now() + 600_000).toISOString(),
            revoked_at: null,
          }],
          error: null,
        };
      }
      return { data: [], error: null };
    },
    withTransaction: async (
      work: (tx: typeof transaction) => Promise<unknown>,
    ) => work(transaction),
  };
  const keys = {
    getPublicKeys: async () => [{
      kty: 'EC',
      crv: 'P-256',
      x: String(oauthPublic.x),
      y: String(oauthPublic.y),
      use: 'sig',
      alg: 'ES256',
      kid: 'divinr-oauth-access-token-v1',
      gg_role: 'oauth-access-token',
    }],
  };
  const service = new DPoPResourceService(database as never, keys as never);
  const proof = (nonce?: string, pair = dpopPair) => compactJwt(
    {
      alg: 'ES256',
      typ: 'dpop+jwt',
      jwk: {
        kty: 'EC',
        crv: 'P-256',
        x: String(createPublicKey(pair.privateKey).export({ format: 'jwk' }).x),
        y: String(createPublicKey(pair.privateKey).export({ format: 'jwk' }).y),
      },
    },
    {
      htm: 'POST',
      htu: 'https://divinr.ai/a2a',
      iat: Math.floor(Date.now() / 1000),
      jti: randomUUID(),
      ath: createHash('sha256').update(accessToken).digest('base64url'),
      ...(nonce ? { nonce } : {}),
    },
    pair.privateKey,
  );

  let challenge = '';
  await assert.rejects(
    () => service.authenticate(
      `DPoP ${accessToken}`,
      proof(),
      'POST',
      'https://divinr.ai/a2a',
    ),
    (error) => {
      if (!(error instanceof DPoPNonceRequiredError)) return false;
      challenge = error.nonce;
      return challenge.length >= 32;
    },
  );
  const acceptedProof = proof(challenge);
  const principal = await service.authenticate(
    `DPoP ${accessToken}`,
    acceptedProof,
    'POST',
    'https://divinr.ai/a2a',
  );
  assert.equal(principal.userId, '10000000-0000-0000-0000-000000000001');
  assert.equal(principal.installationId, 'apple-installation-test-001');
  await assert.rejects(
    () => service.authenticate(
      `DPoP ${accessToken}`,
      acceptedProof,
      'POST',
      'https://divinr.ai/a2a',
    ),
    (error: unknown) => (
      typeof error === 'object'
      && error !== null
      && 'getResponse' in error
      && (error as { getResponse(): { code?: string } }).getResponse().code
        === 'DPOP_REPLAY'
    ),
  );
  const wrongPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  await assert.rejects(
    () => service.authenticate(
      `DPoP ${accessToken}`,
      proof(undefined, wrongPair),
      'POST',
      'https://divinr.ai/a2a',
    ),
    /DPoP proof is invalid/,
  );

  console.log('Persistent DPoP verifier tests passed');
}

void main();
