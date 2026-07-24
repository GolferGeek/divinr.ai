import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AgentContractSchemaRegistry } from '../agent-contracts/contract-bundle';
import { DeviceAuthorizationService } from './device-authorization.service';
import { DPoPProofService } from './dpop-proof.service';
import {
  AGENT_SCOPES,
  DEVICE_GRANT_TYPE,
  DIVINR_A2A_RESOURCE,
  DIVINR_ISSUER,
} from './oauth.constants';
import {
  OAuthDPoPNonceRequiredError,
  OAuthProtocolError,
} from './oauth-errors';
import { OAuthRateLimiter } from './oauth-rate-limiter';
import { OAuthCredentialService } from './oauth-credential.service';
import type { TokenRequest } from './oauth.types';

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
  private readonly registry = new AgentContractSchemaRegistry();

  constructor(
    @Inject(DeviceAuthorizationService)
    private readonly deviceAuthorizations: DeviceAuthorizationService,
    @Inject(DPoPProofService)
    private readonly dpop: DPoPProofService,
    @Inject(OAuthRateLimiter)
    private readonly rateLimiter: OAuthRateLimiter,
    @Inject(OAuthCredentialService)
    private readonly credentials: OAuthCredentialService,
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
    @Res({ passthrough: true }) response: Response,
  ) {
    const source = request.ip || request.socket.remoteAddress || 'unknown';
    this.rateLimiter.assert(`device-poll:${source}`, 120);
    const uri = `${publicOrigin(request)}/oauth/token`;
    const verified = this.dpop.verify(proof, 'POST', uri);
    try {
      this.registry.validate('tokenRequest', body);
    } catch {
      throw new OAuthProtocolError(400, 'invalid_request', 'Token request is invalid');
    }
    const tokenRequest = body as TokenRequest;
    const proofContext = { ...verified, method: 'POST', uri };
    try {
      if (tokenRequest.grant_type === DEVICE_GRANT_TYPE) {
        const authorization = await this.deviceAuthorizations.poll(
          body,
          verified.thumbprint,
        );
        return await this.credentials.exchangeApprovedDevice(
          authorization,
          proofContext,
        );
      }
      if (tokenRequest.grant_type === 'refresh_token') {
        return await this.credentials.refresh(tokenRequest, proofContext);
      }
    } catch (error) {
      if (error instanceof OAuthDPoPNonceRequiredError) {
        response.setHeader('DPoP-Nonce', error.nonce);
        response.setHeader('WWW-Authenticate', 'DPoP error="use_dpop_nonce"');
      }
      throw error;
    }
    throw new OAuthProtocolError(
      400,
      'unsupported_grant_type',
      'OAuth grant type is not supported',
    );
  }

  @Post('revoke')
  async revoke(
    @Body() body: unknown,
    @Headers('dpop') proof: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    try {
      this.registry.validate('revocationRequest', body);
    } catch {
      throw new OAuthProtocolError(400, 'invalid_request', 'Revocation request is invalid');
    }
    const uri = `${publicOrigin(request)}/oauth/revoke`;
    const verified = this.dpop.verify(proof, 'POST', uri);
    const token = (body as { token: string; client_id: string }).token;
    try {
      return await this.credentials.revoke(token, {
        ...verified,
        method: 'POST',
        uri,
      });
    } catch (error) {
      if (error instanceof OAuthDPoPNonceRequiredError) {
        response.setHeader('DPoP-Nonce', error.nonce);
        response.setHeader('WWW-Authenticate', 'DPoP error="use_dpop_nonce"');
      }
      throw error;
    }
  }
}
