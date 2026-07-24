import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign,
} from 'node:crypto';
import { DATABASE_SERVICE } from '@orchestratorai/planes/database';
import { A2AInvokeController } from '../../src/a2a/a2a-invoke.controller';
import { A2APhaseGateGuard } from '../../src/a2a/a2a-phase-gate.guard';
import { canonicalJson } from '../../src/agent-contracts/canonical-json';
import {
  AGENT_KEY_PROVIDER,
  type AgentPublicJwk,
} from '../../src/agent-commerce/agent-key-provider';
import { DPoPResourceService } from '../../src/oauth/dpop-resource.service';

function encode(value: unknown): string {
  return Buffer.from(canonicalJson(value)).toString('base64url');
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

const oauthPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const oauthExport = createPublicKey(oauthPair.privateKey).export({ format: 'jwk' });
const oauthJwk: AgentPublicJwk = {
  kty: 'EC',
  crv: 'P-256',
  x: String(oauthExport.x),
  y: String(oauthExport.y),
  use: 'sig',
  alg: 'ES256',
  kid: 'divinr-oauth-access-token-v1',
  gg_role: 'oauth-access-token',
};

let accessRow: Record<string, unknown> | undefined;
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
      const valid = activeNonceHash === String(params[0]);
      if (valid) activeNonceHash = undefined;
      return { data: valid ? [{ id: 'nonce' }] : [], error: null };
    }
    if (sql.includes('INSERT INTO agent_commerce.dpop_proof_replays')) {
      const jti = String(params[2]);
      if (replayJtis.has(jti)) return { data: [], error: null };
      replayJtis.add(jti);
      return { data: [{ id: 'replay' }], error: null };
    }
    if (sql.includes('INSERT INTO agent_commerce.dpop_nonces')) {
      activeNonceHash = String(params[1]);
      return { data: [{ id: 'nonce' }], error: null };
    }
    return { data: [], error: null };
  },
};

const database = {
  rawQuery: async (sql: string, params: unknown[] = []) => {
    if (sql.includes('FROM agent_commerce.oauth_access_token_jtis access')) {
      return {
        data: accessRow?.token_jti === params[0] ? [accessRow] : [],
        error: null,
      };
    }
    return { data: [], error: null };
  },
  withTransaction: async (
    work: (value: typeof transaction) => Promise<unknown>,
  ) => work(transaction),
};

function issueToken(expired: boolean) {
  const configured = process.env.OAUTH_DPOP_CLIENT_PUBLIC_JWK;
  if (!configured) throw new Error('OAUTH_DPOP_CLIENT_PUBLIC_JWK is required');
  const clientPublicJwk = JSON.parse(configured) as Record<string, unknown>;
  const publicKey = createPublicKey({
    key: clientPublicJwk,
    format: 'jwk',
  });
  const normalized = publicKey.export({ format: 'jwk' });
  const jkt = createHash('sha256').update(Buffer.from(canonicalJson({
    kty: 'EC',
    crv: 'P-256',
    x: normalized.x,
    y: normalized.y,
  }))).digest('base64url');
  const now = Math.floor(Date.now() / 1000);
  const tokenJti = randomUUID();
  const scope = 'commerce:purchase receipts:read updates:read';
  const claims = {
    iss: 'https://divinr.ai',
    sub: '10000000-0000-0000-0000-000000000001',
    aud: 'https://divinr.ai/a2a',
    client_id: 'apple-assistant-native-v1',
    installation_id: 'apple-installation-curl-001',
    scope,
    cnf: { jkt },
    iat: expired ? now - 1200 : now,
    nbf: expired ? now - 1200 : now,
    exp: expired ? now - 600 : now + 600,
    jti: tokenJti,
  };
  const input = `${encode({
    alg: 'ES256',
    kid: oauthJwk.kid,
    typ: 'at+jwt',
  })}.${encode(claims)}`;
  const signature = sign(
    'sha256',
    new TextEncoder().encode(input),
    { key: oauthPair.privateKey, dsaEncoding: 'ieee-p1363' },
  ).toString('base64url');
  const token = `${input}.${signature}`;
  accessRow = {
    user_id: claims.sub,
    grant_internal_id: '20000000-0000-0000-0000-000000000001',
    grant_id: 'grant-curl-001',
    grant_status: 'active',
    grant_valid_until: new Date(Date.now() + 86_400_000).toISOString(),
    installation_internal_id: '30000000-0000-0000-0000-000000000001',
    installation_id: claims.installation_id,
    installation_status: 'active',
    dpop_jkt: jkt,
    audience: claims.aud,
    scopes_hash: sha256(scope),
    token_hash: sha256(token),
    token_jti: tokenJti,
    expires_at: new Date(claims.exp * 1000).toISOString(),
    revoked_at: null,
  };
  activeNonceHash = undefined;
  replayJtis.clear();
  return { access_token: token };
}

@Module({
  controllers: [A2AInvokeController],
  providers: [
    A2APhaseGateGuard,
    DPoPResourceService,
    { provide: DATABASE_SERVICE, useValue: database },
    {
      provide: AGENT_KEY_PROVIDER,
      useValue: {
        getPublicKeys: async () => [oauthJwk],
      },
    },
  ],
})
class OAuthDPoPHarnessModule {}

async function main(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(
    OAuthDPoPHarnessModule,
    { logger: false },
  );
  const express = app.getHttpAdapter().getInstance();
  express.get('/_test/status', (_request: unknown, response: {
    json(value: unknown): void;
  }) => response.json({ ok: true }));
  express.post('/_test/issue', (_request: unknown, response: {
    json(value: unknown): void;
  }) => response.json(issueToken(false)));
  express.post('/_test/issue-expired', (_request: unknown, response: {
    json(value: unknown): void;
  }) => response.json(issueToken(true)));
  express.post('/_test/revoke', (_request: unknown, response: {
    json(value: unknown): void;
  }) => {
    if (accessRow) accessRow.revoked_at = new Date().toISOString();
    response.json({ ok: true });
  });
  const port = Number(process.env.OAUTH_DPOP_HARNESS_PORT ?? 7198);
  await app.listen(port, '127.0.0.1');
  console.log(`OAuth DPoP harness listening on ${port}`);
}

void main();
