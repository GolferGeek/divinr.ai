import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { APPLE_ASSISTANT_OAUTH_CLIENT_ID } from '../agent-commerce/agent-commerce-schema.constants';
import { DeviceAuthorizationService } from './device-authorization.service';
import { DPoPProofService } from './dpop-proof.service';
import {
  AGENT_SCOPES,
  DEVICE_GRANT_TYPE,
  DIVINR_A2A_RESOURCE,
  DIVINR_ISSUER,
} from './oauth.constants';
import { OAuthProtocolError } from './oauth-errors';
import { OAuthRateLimiter } from './oauth-rate-limiter';

function publicOrigin(request: Request): string {
  if (process.env.OAUTH_PUBLIC_ORIGIN) return process.env.OAUTH_PUBLIC_ORIGIN.replace(/\/$/, '');
  if (process.env.NODE_ENV === 'production') return DIVINR_ISSUER;
  return `${request.protocol}://${request.get('host')}`;
}

@Controller('.well-known')
export class OAuthMetadataController {
  @Get('oauth-authorization-server')
  authorizationServerMetadata() {
    return {
      issuer: DIVINR_ISSUER,
      device_authorization_endpoint: `${DIVINR_ISSUER}/oauth/device_authorization`,
      token_endpoint: `${DIVINR_ISSUER}/oauth/token`,
      revocation_endpoint: `${DIVINR_ISSUER}/oauth/revoke`,
      jwks_uri: `${DIVINR_ISSUER}/.well-known/jwks.json`,
      grant_types_supported: [DEVICE_GRANT_TYPE, 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'],
      dpop_signing_alg_values_supported: ['ES256'],
      scopes_supported: [...AGENT_SCOPES],
    };
  }

  @Get('oauth-protected-resource')
  protectedResourceMetadata() {
    return {
      resource: DIVINR_A2A_RESOURCE,
      authorization_servers: [DIVINR_ISSUER],
      scopes_supported: [...AGENT_SCOPES],
      bearer_methods_supported: ['header'],
      dpop_bound_access_tokens_required: true,
    };
  }
}

@Controller('oauth')
export class OAuthController {
  constructor(
    @Inject(DeviceAuthorizationService)
    private readonly deviceAuthorizations: DeviceAuthorizationService,
    @Inject(DPoPProofService)
    private readonly dpop: DPoPProofService,
    @Inject(OAuthRateLimiter)
    private readonly rateLimiter: OAuthRateLimiter,
  ) {}

  @Post('device_authorization')
  async initiate(
    @Body() body: unknown,
    @Headers('dpop') proof: string | undefined,
    @Req() request: Request,
  ) {
    const source = request.ip || request.socket.remoteAddress || 'unknown';
    this.rateLimiter.assert(`device-init:${source}`, 10);
    const uri = `${publicOrigin(request)}/oauth/device_authorization`;
    const verified = this.dpop.verify(proof, 'POST', uri);
    return this.deviceAuthorizations.initiate(body, verified.thumbprint);
  }

  @Post('token')
  async token(
    @Body() body: unknown,
    @Headers('dpop') proof: string | undefined,
    @Req() request: Request,
  ) {
    const source = request.ip || request.socket.remoteAddress || 'unknown';
    this.rateLimiter.assert(`device-poll:${source}`, 120);
    const uri = `${publicOrigin(request)}/oauth/token`;
    const verified = this.dpop.verify(proof, 'POST', uri);
    return this.deviceAuthorizations.poll(body, verified.thumbprint);
  }

  @Post('revoke')
  revoke() {
    throw new OAuthProtocolError(
      503,
      'temporarily_unavailable',
      `Credential revocation for ${APPLE_ASSISTANT_OAUTH_CLIENT_ID} is enabled in Phase 5`,
    );
  }
}
