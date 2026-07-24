import assert from 'node:assert/strict';
import {
  generateKeyPairSync,
  randomUUID,
  sign,
} from 'node:crypto';
import { AgentContractSchemaRegistry } from '../../src/agent-contracts/contract-bundle';
import { canonicalJson } from '../../src/agent-contracts/canonical-json';
import { DeviceAuthorizationService } from '../../src/oauth/device-authorization.service';
import { DPoPProofService } from '../../src/oauth/dpop-proof.service';
import {
  OAuthMetadataController,
} from '../../src/oauth/oauth.controller';
import { OAuthProtocolError } from '../../src/oauth/oauth-errors';

const { privateKey, publicKey } = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
});
const jwk = publicKey.export({ format: 'jwk' });

function proof(
  uri: string,
  overrides: Record<string, unknown> = {},
): string {
  const header = {
    typ: 'dpop+jwt',
    alg: 'ES256',
    jwk,
  };
  const payload = {
    htm: 'POST',
    htu: uri,
    iat: Math.floor(Date.now() / 1000),
    jti: randomUUID(),
    ...overrides,
  };
  const encodedHeader = Buffer.from(canonicalJson(header)).toString('base64url');
  const encodedPayload = Buffer.from(canonicalJson(payload)).toString('base64url');
  const signature = sign(
    'sha256',
    Buffer.from(`${encodedHeader}.${encodedPayload}`),
    { key: privateKey, dsaEncoding: 'ieee-p1363' },
  ).toString('base64url');
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function protocolError(error: unknown, expected: string): boolean {
  return error instanceof OAuthProtocolError
    && (error.getResponse() as { error?: string }).error === expected;
}

async function main(): Promise<void> {
  const priorNodeEnv = process.env.NODE_ENV;
  delete process.env.OAUTH_DEVICE_USER_CODE_HMAC_KEY;
  process.env.NODE_ENV = 'production';
  assert.throws(
    () => new DeviceAuthorizationService({} as never),
    /OAUTH_DEVICE_USER_CODE_HMAC_KEY is required in production/,
  );
  if (priorNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = priorNodeEnv;
  }
  process.env.OAUTH_DEVICE_USER_CODE_HMAC_KEY = 'phase-4-test-hmac-key';
  const registry = new AgentContractSchemaRegistry();
  const metadata = new OAuthMetadataController();
  registry.validate(
    'oauthAuthorizationServerMetadata',
    metadata.authorizationServerMetadata(),
  );
  registry.validate(
    'oauthProtectedResourceMetadata',
    metadata.protectedResourceMetadata(),
  );

  const dpop = new DPoPProofService();
  const uri = 'https://divinr.ai/oauth/device_authorization';
  const compact = proof(uri);
  const verified = dpop.verify(compact, 'POST', uri);
  assert.match(verified.thumbprint, /^[A-Za-z0-9_-]{43}$/);
  assert.throws(
    () => dpop.verify(compact, 'POST', uri),
    (error) => protocolError(error, 'invalid_dpop_proof'),
  );
  assert.throws(
    () => dpop.verify(proof(uri, { htm: 'GET' }), 'POST', uri),
    (error) => protocolError(error, 'invalid_dpop_proof'),
  );
  assert.throws(
    () => dpop.verify(proof(uri, { iat: Math.floor(Date.now() / 1000) - 61 }), 'POST', uri),
    (error) => protocolError(error, 'invalid_dpop_proof'),
  );

  const executed: Array<{ sql: string; params: unknown[] }> = [];
  let pollRow: Record<string, unknown> | undefined;
  const database = {
    rawQuery: async (sql: string, params: unknown[] = []) => {
      executed.push({ sql, params });
      if (sql.includes('FROM agent_commerce.oauth_clients')) {
        return {
          data: [{
            id: '10000000-0000-0000-0000-000000000001',
            allowed_scopes: [
              'analysis:purchase',
              'commerce:purchase',
              'receipts:read',
              'tournaments:join',
              'tournaments:read',
              'tournaments:trade',
              'updates:read',
            ],
            allowed_audiences: ['https://divinr.ai/a2a'],
            status: 'active',
          }],
          error: null,
        };
      }
      if (sql.includes('SELECT authorization.*')) {
        return { data: pollRow ? [pollRow] : [], error: null };
      }
      return { data: [{ id: 'created' }], error: null };
    },
  };
  const service = new DeviceAuthorizationService(database as never);
  const request = {
    client_id: 'apple-assistant-native-v1',
    scope: 'updates:read commerce:purchase receipts:read',
    resource: 'https://divinr.ai/a2a',
    installation_id: 'apple-installation-test-001',
    installation_name: 'Test Apple Assistant',
  };
  const response = await service.initiate(request, verified.thumbprint);
  registry.validate('deviceAuthorizationResponse', response);
  const insert = executed.find((entry) =>
    entry.sql.includes('INSERT INTO agent_commerce.oauth_device_authorizations'));
  assert(insert);
  assert(!insert.sql.includes('device_code,'));
  assert(!insert.sql.includes('user_code,'));
  assert.equal(String(insert.params[5]).length, 64);
  assert.equal(String(insert.params[6]).length, 64);
  assert.notEqual(insert.params[5], response.device_code);
  assert.notEqual(insert.params[6], response.user_code);

  await assert.rejects(
    () => service.initiate({ ...request, scope: `${request.scope} admin:write` }, verified.thumbprint),
    (error) => protocolError(error, 'invalid_scope'),
  );
  await assert.rejects(
    () => service.initiate({ ...request, unexpected: true }, verified.thumbprint),
    (error) => protocolError(error, 'invalid_request'),
  );

  const deviceCode = String(response.device_code);
  const baseAuthorization = {
    id: '20000000-0000-0000-0000-000000000001',
    authorization_id: 'authorization-test-001',
    oauth_client_id: '10000000-0000-0000-0000-000000000001',
    installation_request_id: request.installation_id,
    installation_name: request.installation_name,
    user_id: null,
    proposed_dpop_jkt: verified.thumbprint,
    requested_scopes: ['commerce:purchase', 'receipts:read', 'updates:read'],
    requested_audiences: ['https://divinr.ai/a2a'],
    requested_authority: { profileVersion: 2 },
    verification_uri: 'https://divinr.ai/connect/device',
    poll_interval_seconds: 5,
    status: 'pending',
    expires_at: new Date(Date.now() + 300_000).toISOString(),
    created_at: new Date().toISOString(),
    last_polled_at: null,
    approving_user_id: null,
    denied_at: null,
  };
  pollRow = baseAuthorization;
  const tokenBody = {
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    device_code: deviceCode,
    client_id: 'apple-assistant-native-v1',
  };
  await assert.rejects(
    () => service.poll(tokenBody, verified.thumbprint),
    (error) => protocolError(error, 'authorization_pending'),
  );
  pollRow = { ...baseAuthorization, last_polled_at: new Date().toISOString() };
  await assert.rejects(
    () => service.poll(tokenBody, verified.thumbprint),
    (error) => protocolError(error, 'slow_down'),
  );
  pollRow = { ...baseAuthorization, status: 'denied' };
  await assert.rejects(
    () => service.poll(tokenBody, verified.thumbprint),
    (error) => protocolError(error, 'access_denied'),
  );
  pollRow = {
    ...baseAuthorization,
    status: 'pending',
    expires_at: new Date(Date.now() - 1_000).toISOString(),
  };
  await assert.rejects(
    () => service.poll(tokenBody, verified.thumbprint),
    (error) => protocolError(error, 'expired_token'),
  );
  pollRow = { ...baseAuthorization, status: 'approved' };
  assert.equal(
    (await service.poll(tokenBody, verified.thumbprint)).status,
    'approved',
  );
  await assert.rejects(
    () => service.poll(tokenBody, 'different-thumbprint'),
    (error) => protocolError(error, 'invalid_grant'),
  );

  console.log('OAuth device authorization tests passed');
}

void main();
