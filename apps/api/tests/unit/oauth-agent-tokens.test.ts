import assert from 'node:assert/strict';
import {
  createPublicKey,
  generateKeyPairSync,
  verify,
} from 'node:crypto';
import { AgentContractSchemaRegistry } from '../../src/agent-contracts/contract-bundle';
import { OAuthCredentialService } from '../../src/oauth/oauth-credential.service';
import {
  OAuthDPoPNonceRequiredError,
  OAuthProtocolError,
} from '../../src/oauth/oauth-errors';

async function main(): Promise<void> {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicJwk = createPublicKey(pair.privateKey).export({ format: 'jwk' });
  const signingKey = {
    keyId: 'divinr-oauth-access-token-v1',
    role: 'oauth-access-token',
    privateKey: pair.privateKey,
    publicJwk: {
      kty: 'EC',
      crv: 'P-256',
      x: String(publicJwk.x),
      y: String(publicJwk.y),
      use: 'sig',
      alg: 'ES256',
      kid: 'divinr-oauth-access-token-v1',
      gg_role: 'oauth-access-token',
    },
    fallback: true,
  } as const;
  const keys = { getSigningKey: async () => signingKey };
  const executed: Array<{ sql: string; params: unknown[] }> = [];
  const audits: unknown[] = [];
  const credential = {
    authorization_internal_id: '10000000-0000-0000-0000-000000000001',
    authorization_id: 'authorization-test-001',
    user_id: '20000000-0000-0000-0000-000000000001',
    dpop_jkt: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    scopes: ['updates:read', 'commerce:purchase', 'receipts:read'],
    installation_internal_id: '30000000-0000-0000-0000-000000000001',
    installation_id: 'apple-installation-test-001',
    grant_internal_id: '40000000-0000-0000-0000-000000000001',
    grant_id: 'grant-test-001',
    grant_valid_until: new Date(Date.now() + 86_400_000).toISOString(),
  };
  const transaction = {
    rawQuery: async (sql: string, params: unknown[] = []) => {
      executed.push({ sql, params });
      if (sql.includes('SELECT authorization.id AS authorization_internal_id')) {
        return { data: [credential], error: null };
      }
      return { data: [{ id: 'created' }], error: null };
    },
  };
  const database = {
    withTransaction: async (
      work: (tx: typeof transaction) => Promise<unknown>,
    ) => work(transaction),
  };
  const service = new OAuthCredentialService(
    database as never,
    keys as never,
    {
      appendAuditEvent: async (_transaction: unknown, input: unknown) => {
        audits.push(input);
        return { eventId: 'audit-event' };
      },
    } as never,
  );
  const authorization = {
      id: credential.authorization_internal_id,
      authorization_id: credential.authorization_id,
      oauth_client_id: '50000000-0000-0000-0000-000000000001',
      installation_request_id: credential.installation_id,
      installation_name: 'Test Apple Assistant',
      user_id: credential.user_id,
      proposed_dpop_jkt: credential.dpop_jkt,
      requested_scopes: credential.scopes,
      requested_audiences: ['https://divinr.ai/a2a'],
      requested_authority: { profileVersion: 2 },
      verification_uri: 'https://divinr.ai/connect/device',
      poll_interval_seconds: 5,
      status: 'approved',
      expires_at: new Date(Date.now() + 300_000).toISOString(),
      created_at: new Date().toISOString(),
      last_polled_at: null,
      approving_user_id: credential.user_id,
      denied_at: null,
  };
  let tokenNonce = '';
  await assert.rejects(
    () => service.exchangeApprovedDevice(authorization, {
      thumbprint: credential.dpop_jkt,
      jti: 'device-proof-initial',
      method: 'POST',
      uri: 'https://divinr.ai/oauth/token',
    }),
    (error) => {
      if (!(error instanceof OAuthDPoPNonceRequiredError)) return false;
      tokenNonce = error.nonce;
      return tokenNonce.length >= 32;
    },
  );
  const response = await service.exchangeApprovedDevice(authorization, {
    thumbprint: credential.dpop_jkt,
    jti: 'device-proof-with-nonce',
    nonce: tokenNonce,
    method: 'POST',
    uri: 'https://divinr.ai/oauth/token',
  });
  new AgentContractSchemaRegistry().validate('tokenResponse', response);
  const accessToken = String(response.access_token);
  const parts = accessToken.split('.');
  assert.equal(parts.length, 3);
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  assert.deepEqual(header, {
    alg: 'ES256',
    kid: 'divinr-oauth-access-token-v1',
    typ: 'at+jwt',
  });
  assert.deepEqual(Object.keys(claims).sort(), [
    'aud', 'client_id', 'cnf', 'exp', 'iat', 'installation_id',
    'iss', 'jti', 'nbf', 'scope', 'sub',
  ]);
  assert.equal(claims.sub, credential.user_id);
  assert.equal(claims.installation_id, credential.installation_id);
  assert.equal(claims.cnf.jkt, credential.dpop_jkt);
  assert.equal(claims.exp - claims.iat, 600);
  assert.equal(
    verify(
      'sha256',
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
      {
        key: createPublicKey({
          key: {
            kty: 'EC',
            crv: 'P-256',
            x: String(publicJwk.x),
            y: String(publicJwk.y),
          },
          format: 'jwk',
        }),
        dsaEncoding: 'ieee-p1363',
      },
      Uint8Array.from(Buffer.from(parts[2], 'base64url')),
    ),
    true,
  );
  assert(executed.some((entry) =>
    entry.sql.includes("SET status = 'consumed'")));
  const refreshInsert = executed.find((entry) =>
    entry.sql.includes('INSERT INTO agent_commerce.oauth_refresh_tokens'));
  assert(refreshInsert);
  assert.match(String(refreshInsert.params[3]), /^[a-f0-9]{64}$/);
  assert.notEqual(refreshInsert.params[3], response.refresh_token);
  assert.equal(audits.length, 1);

  let compromiseCommitted = false;
  const reuseQueries: string[] = [];
  const reuseTransaction = {
    rawQuery: async (sql: string) => {
      reuseQueries.push(sql);
      if (sql.includes('SELECT token.id AS refresh_internal_id')) {
        return {
          data: [{
            ...credential,
            family_internal_id: '60000000-0000-0000-0000-000000000001',
            family_id: 'family-test-001',
            family_status: 'active',
            current_generation: 1,
            refresh_internal_id: '70000000-0000-0000-0000-000000000001',
            refresh_generation: 0,
            refresh_expires_at: credential.grant_valid_until,
            refresh_used_at: new Date().toISOString(),
            refresh_revoked_at: null,
          }],
          error: null,
        };
      }
      return { data: [{ id: 'updated' }], error: null };
    },
  };
  const reuseService = new OAuthCredentialService(
    {
      withTransaction: async (
        work: (tx: typeof reuseTransaction) => Promise<unknown>,
      ) => {
        const result = await work(reuseTransaction);
        compromiseCommitted = true;
        return result;
      },
    } as never,
    keys as never,
    { appendAuditEvent: async () => ({ eventId: 'audit-reuse' }) } as never,
  );
  await assert.rejects(
    () => reuseService.refresh(
      {
        grant_type: 'refresh_token',
        refresh_token: 'r'.repeat(48),
        client_id: 'apple-assistant-native-v1',
      },
      {
        thumbprint: credential.dpop_jkt,
        jti: 'refresh-reuse-proof',
        nonce: 'refresh-reuse-nonce',
        method: 'POST',
        uri: 'https://divinr.ai/oauth/token',
      },
    ),
    (error) => (
      error instanceof OAuthProtocolError
      && (error.getResponse() as { error?: string }).error === 'invalid_grant'
    ),
  );
  assert.equal(compromiseCommitted, true);
  assert(reuseQueries.some((sql) =>
    sql.includes("SET status = 'compromised'")));
  assert(reuseQueries.some((sql) =>
    sql.includes('UPDATE agent_commerce.oauth_access_token_jtis')));

  const revocationQueries: string[] = [];
  const revocationTransaction = {
    rawQuery: async (sql: string) => {
      revocationQueries.push(sql);
      if (sql.includes('SELECT access.id AS access_internal_id')) {
        return {
          data: [{
            ...credential,
            access_internal_id: '80000000-0000-0000-0000-000000000001',
          }],
          error: null,
        };
      }
      if (sql.includes('SELECT EXISTS')) {
        return { data: [{ present: false }], error: null };
      }
      if (
        sql.includes('UPDATE agent_commerce.dpop_nonces')
        && sql.includes('nonce_hash')
      ) {
        return { data: [{ id: 'nonce-consumed' }], error: null };
      }
      return { data: [{ id: 'updated' }], error: null };
    },
  };
  const revokeService = new OAuthCredentialService(
    {
      withTransaction: async (
        work: (tx: typeof revocationTransaction) => Promise<unknown>,
      ) => work(revocationTransaction),
    } as never,
    keys as never,
    { appendAuditEvent: async () => ({ eventId: 'audit-revoke' }) } as never,
  );
  let revokeNonce = '';
  await assert.rejects(
    () => revokeService.revoke('a'.repeat(64), {
      thumbprint: credential.dpop_jkt,
      jti: 'revoke-proof-initial',
      method: 'POST',
      uri: 'https://divinr.ai/oauth/revoke',
    }),
    (error) => {
      if (!(error instanceof OAuthDPoPNonceRequiredError)) return false;
      revokeNonce = error.nonce;
      return revokeNonce.length >= 32;
    },
  );
  assert.equal(
    await revokeService.revoke('a'.repeat(64), {
      thumbprint: credential.dpop_jkt,
      jti: 'revoke-proof-with-nonce',
      nonce: revokeNonce,
      method: 'POST',
      uri: 'https://divinr.ai/oauth/revoke',
    }),
    null,
  );
  assert(revocationQueries.some((sql) =>
    sql.includes('SET revoked_at = COALESCE(revoked_at, now())')));

  console.log('OAuth agent token and refresh recovery tests passed');
}

void main();
