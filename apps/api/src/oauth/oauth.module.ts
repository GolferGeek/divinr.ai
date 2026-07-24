import { Module } from '@nestjs/common';
import { AgentCommerceModule } from '../agent-commerce/agent-commerce.module';
import { DeviceAuthorizationService } from './device-authorization.service';
import { DPoPProofService } from './dpop-proof.service';
import {
  OAuthController,
  OAuthMetadataController,
} from './oauth.controller';
import { OAuthRateLimiter } from './oauth-rate-limiter';
import { OAuthCredentialService } from './oauth-credential.service';
import { DPoPResourceService } from './dpop-resource.service';

@Module({
  imports: [AgentCommerceModule],
  controllers: [OAuthMetadataController, OAuthController],
  providers: [
    DeviceAuthorizationService,
    DPoPProofService,
    OAuthRateLimiter,
    OAuthCredentialService,
    DPoPResourceService,
  ],
  exports: [
    DeviceAuthorizationService,
    DPoPProofService,
    OAuthCredentialService,
    DPoPResourceService,
    OAuthRateLimiter,
  ],
})
export class OAuthModule {}
