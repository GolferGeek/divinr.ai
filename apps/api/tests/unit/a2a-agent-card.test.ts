import assert from 'node:assert/strict';
import {
  createPublicKey,
  generateKeyPairSync,
  verify,
} from 'node:crypto';
import { AgentCardService } from '../../src/a2a/agent-card.service';
import { canonicalJsonBytes } from '../../src/agent-contracts/canonical-json';
import { RegistryBackedAgentKeyProvider } from '../../src/agent-commerce/agent-key-provider';

async function main(): Promise<void> {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalPrivateJwk = process.env.DIVINR_AGENT_CARD_PRIVATE_JWK;
  const originalKeyId = process.env.DIVINR_AGENT_CARD_KEY_ID;
  const originalOauthPrivateJwk =
    process.env.DIVINR_OAUTH_ACCESS_TOKEN_PRIVATE_JWK;
  const originalOauthKeyId = process.env.DIVINR_OAUTH_ACCESS_TOKEN_KEY_ID;
  try {
    process.env.NODE_ENV = 'test';
    delete process.env.DIVINR_AGENT_CARD_PRIVATE_JWK;
    delete process.env.DIVINR_AGENT_CARD_KEY_ID;
    delete process.env.DIVINR_OAUTH_ACCESS_TOKEN_PRIVATE_JWK;
    delete process.env.DIVINR_OAUTH_ACCESS_TOKEN_KEY_ID;
    const db = {
      rawQuery: async () => {
        throw new Error('fallback test key must not query the registry');
      },
    };
    const provider = new RegistryBackedAgentKeyProvider(db as never);
    const service = new AgentCardService(provider);
    const card = await service.getAgentCard();

    assert.equal(card.name, 'Divinr');
    assert.deepEqual(card.supportedInterfaces, [{
      url: 'https://divinr.ai/a2a',
      protocolBinding: 'JSONRPC',
      protocolVersion: '1.0',
    }]);
    assert.equal((card.skills as unknown[]).length, 7);
    assert.deepEqual(
      (card.skills as Array<{ id: string }>).map((skill) => skill.id).sort(),
      [
        'analysis_request',
        'general_updates',
        'personal_updates',
        'tournament_context',
        'tournament_join',
        'tournament_trade',
        'tournaments_list',
      ],
    );
    const capabilities = card.capabilities as {
      streaming: boolean;
      pushNotifications: boolean;
      extensions: Array<{ required: boolean }>;
    };
    assert.equal(capabilities.streaming, false);
    assert.equal(capabilities.pushNotifications, false);
    assert.equal(capabilities.extensions[0].required, false);

    const signatures = card.signatures as Array<{
      protected: string;
      signature: string;
    }>;
    assert.equal(signatures.length, 1);
    assert.equal(signatures[0].signature.length, 86);
    const protectedHeader = JSON.parse(
      Buffer.from(signatures[0].protected, 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    assert.deepEqual(protectedHeader, {
      alg: 'ES256',
      kid: 'divinr-agent-card-v1',
      typ: 'application/a2a-agent-card+jws',
    });

    const { signatures: _removed, ...unsignedCard } = card;
    const payload = Buffer.from(canonicalJsonBytes(unsignedCard)).toString('base64url');
    const jwks = await service.getJwks();
    assert.equal(jwks.keys.length, 2);
    const jwk = (jwks.keys as Array<Record<string, unknown>>).find(
      (key) => key.gg_role === 'agent-card',
    ) as {
      kty: 'EC';
      crv: 'P-256';
      x: string;
      y: string;
      kid: string;
      gg_role: string;
    };
    assert.equal(jwk.gg_role, 'agent-card');
    const publicKey = createPublicKey({
      key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
      format: 'jwk',
    });
    assert.equal(
      verify(
        'sha256',
        new TextEncoder().encode(`${signatures[0].protected}.${payload}`),
        { key: publicKey, dsaEncoding: 'ieee-p1363' },
        Buffer.from(signatures[0].signature, 'base64url'),
      ),
      true,
    );

    const configuredPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const configuredPrivate = configuredPair.privateKey.export({ format: 'jwk' });
    const configuredPublic = createPublicKey(configuredPair.privateKey)
      .export({ format: 'jwk' });
    const retiringPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const retiringPublic = createPublicKey(retiringPair.privateKey)
      .export({ format: 'jwk' });
    process.env.DIVINR_AGENT_CARD_PRIVATE_JWK = JSON.stringify(configuredPrivate);
    process.env.DIVINR_AGENT_CARD_KEY_ID = 'divinr-agent-card-v2';
    const registryDb = {
      rawQuery: async (sql: string) => {
        if (sql.includes('SELECT key_id, key_role, public_jwk')) {
          return {
            data: [
              {
                key_id: 'divinr-agent-card-v2',
                key_role: 'agent_card',
                public_jwk: configuredPublic,
              },
              {
                key_id: 'divinr-agent-card-v1',
                key_role: 'agent_card',
                public_jwk: retiringPublic,
              },
            ],
            error: null,
          };
        }
        return {
          data: [{
            key_id: 'divinr-agent-card-v2',
            algorithm: 'ES256',
            public_jwk: configuredPublic,
            external_custody_ref: 'keychain://divinr/agent-card-v2',
            status: 'active',
            valid_from: '2026-07-24T00:00:00.000Z',
            valid_until: null,
          }],
          error: null,
        };
      },
    };
    const configuredProvider = new RegistryBackedAgentKeyProvider(registryDb as never);
    const configuredKey = await configuredProvider.getSigningKey('agent-card');
    assert.equal(configuredKey.fallback, false);
    assert.equal((await configuredProvider.getPublicKeys()).length, 3);

    delete process.env.DIVINR_AGENT_CARD_PRIVATE_JWK;
    delete process.env.DIVINR_AGENT_CARD_KEY_ID;
    process.env.NODE_ENV = 'production';
    const productionProvider = new RegistryBackedAgentKeyProvider(db as never);
    await assert.rejects(
      () => productionProvider.assertProductionReady(),
      /Production requires externally custodied/,
    );

    console.log('A2A Agent Card and key custody tests passed');
  } finally {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalPrivateJwk === undefined) {
      delete process.env.DIVINR_AGENT_CARD_PRIVATE_JWK;
    } else {
      process.env.DIVINR_AGENT_CARD_PRIVATE_JWK = originalPrivateJwk;
    }
    if (originalKeyId === undefined) delete process.env.DIVINR_AGENT_CARD_KEY_ID;
    else process.env.DIVINR_AGENT_CARD_KEY_ID = originalKeyId;
    if (originalOauthPrivateJwk === undefined) {
      delete process.env.DIVINR_OAUTH_ACCESS_TOKEN_PRIVATE_JWK;
    } else {
      process.env.DIVINR_OAUTH_ACCESS_TOKEN_PRIVATE_JWK =
        originalOauthPrivateJwk;
    }
    if (originalOauthKeyId === undefined) {
      delete process.env.DIVINR_OAUTH_ACCESS_TOKEN_KEY_ID;
    } else {
      process.env.DIVINR_OAUTH_ACCESS_TOKEN_KEY_ID = originalOauthKeyId;
    }
  }
}

void main();
