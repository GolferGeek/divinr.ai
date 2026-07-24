import assert from 'node:assert/strict';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  createPublicKey,
  generateKeyPairSync,
} from 'node:crypto';
import request from 'supertest';
import { A2AController } from '../../src/a2a/a2a.controller';
import { A2AInvokeController } from '../../src/a2a/a2a-invoke.controller';
import { A2APhaseGateGuard } from '../../src/a2a/a2a-phase-gate.guard';
import { AgentCardService } from '../../src/a2a/agent-card.service';
import {
  AGENT_KEY_PROVIDER,
  type AgentKeyProvider,
} from '../../src/agent-commerce/agent-key-provider';

const generated = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const exported = createPublicKey(generated.privateKey).export({ format: 'jwk' });
const testKeys: AgentKeyProvider = {
  getSigningKey: async () => ({
    keyId: 'divinr-agent-card-v1',
    role: 'agent-card',
    privateKey: generated.privateKey,
    publicJwk: {
      kty: 'EC',
      crv: 'P-256',
      x: String(exported.x),
      y: String(exported.y),
      use: 'sig',
      alg: 'ES256',
      kid: 'divinr-agent-card-v1',
      gg_role: 'agent-card',
    },
    fallback: true,
  }),
  getPublicKeys: async () => [{
    kty: 'EC',
    crv: 'P-256',
    x: String(exported.x),
    y: String(exported.y),
    use: 'sig',
    alg: 'ES256',
    kid: 'divinr-agent-card-v1',
    gg_role: 'agent-card',
  }],
  assertProductionReady: async () => undefined,
};

@Module({
  controllers: [A2AController, A2AInvokeController],
  providers: [
    AgentCardService,
    A2APhaseGateGuard,
    { provide: AGENT_KEY_PROVIDER, useValue: testKeys },
  ],
})
class A2AConformanceTestModule {}

async function main(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(
    A2AConformanceTestModule,
    { logger: false, rawBody: true },
  );
  await app.init();
  try {
    const server = app.getHttpServer();
    const card = await request(server)
      .get('/.well-known/agent-card.json')
      .expect(200);
    assert.equal(card.body.name, 'Divinr');
    assert.equal(card.body.supportedInterfaces[0].protocolVersion, '1.0');
    assert.equal(card.body.skills.length, 7);
    assert.equal(card.body.signatures.length, 1);

    const jwks = await request(server)
      .get('/.well-known/jwks.json')
      .expect(200);
    assert.equal(jwks.body.keys.length, 1);
    assert.equal(jwks.body.keys[0].gg_role, 'agent-card');
    await request(server).get('/.well-known/agent.json').expect(404);

    const protectedBody = {
      jsonrpc: '2.0',
      id: 'rpc-1',
      method: 'GetTask',
      params: { id: 'task-1' },
    };
    const unauthenticated = await request(server)
      .post('/a2a')
      .set('A2A-Version', '1.0')
      .send(protectedBody)
      .expect(401);
    assert.equal(unauthenticated.body.code, 'AUTH_REQUIRED');

    await request(server)
      .post('/a2a')
      .set('A2A-Version', '1.0')
      .set('Authorization', 'Bearer div_sk_cannot_impersonate')
      .set('X-Machine-Identity', 'legacy-machine')
      .send(protectedBody)
      .expect(401);

    await request(server)
      .post('/a2a')
      .set('Content-Type', 'application/json')
      .send({ data: 'x'.repeat(300 * 1024) })
      .expect(413);
  } finally {
    await app.close();
  }
  console.log('A2A HTTP conformance tests passed');
}

void main();
