import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DATABASE_SERVICE } from '@orchestratorai/planes/database';
import { DeviceAuthorizationService } from '../../src/oauth/device-authorization.service';
import { DPoPProofService } from '../../src/oauth/dpop-proof.service';
import {
  OAuthController,
  OAuthMetadataController,
} from '../../src/oauth/oauth.controller';
import { OAuthRateLimiter } from '../../src/oauth/oauth-rate-limiter';

const authorizations = new Map<string, Record<string, unknown>>();

const database = {
  rawQuery: async (sql: string, params: unknown[] = []) => {
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
    if (sql.includes('INSERT INTO agent_commerce.oauth_device_authorizations')) {
      authorizations.set(String(params[5]), {
        id: '20000000-0000-0000-0000-000000000001',
        authorization_id: params[0],
        oauth_client_id: params[1],
        installation_request_id: params[2],
        installation_name: params[3],
        user_id: null,
        proposed_dpop_jkt: params[4],
        requested_scopes: params[7],
        requested_audiences: params[8],
        requested_authority: JSON.parse(String(params[9])),
        verification_uri: params[10],
        poll_interval_seconds: params[11],
        status: 'pending',
        expires_at: params[12],
        created_at: new Date().toISOString(),
        last_polled_at: null,
        approving_user_id: null,
        denied_at: null,
      });
      return { data: [{ id: 'created' }], error: null };
    }
    if (sql.includes('SELECT authorization.*')) {
      const authorization = authorizations.get(String(params[0]));
      return { data: authorization ? [authorization] : [], error: null };
    }
    if (sql.includes('SET last_polled_at')) {
      const authorization = [...authorizations.values()]
        .find((entry) => entry.id === params[0]);
      if (authorization) authorization.last_polled_at = params[1];
      return { data: [{ id: params[0] }], error: null };
    }
    return { data: [], error: null };
  },
};

@Module({
  controllers: [OAuthMetadataController, OAuthController],
  providers: [
    DeviceAuthorizationService,
    DPoPProofService,
    OAuthRateLimiter,
    { provide: DATABASE_SERVICE, useValue: database },
  ],
})
class OAuthDeviceHarnessModule {}

async function main(): Promise<void> {
  process.env.OAUTH_DEVICE_USER_CODE_HMAC_KEY = 'curl-harness-hmac-key';
  const app = await NestFactory.create<NestExpressApplication>(
    OAuthDeviceHarnessModule,
    { logger: false },
  );
  const port = Number(process.env.OAUTH_DEVICE_HARNESS_PORT ?? 7199);
  await app.listen(port, '127.0.0.1');
  console.log(`OAuth device harness listening on ${port}`);
}

void main();
