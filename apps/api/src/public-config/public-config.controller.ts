import { Controller, Get, Inject } from '@nestjs/common';
import { BillingConfigService } from '../billing/billing-config.service';

/**
 * Unauthenticated endpoint surfacing client-safe config.
 *
 * Lives at /api/config/public so the SPA bundle doesn't have to embed values
 * that may be rotated independently of a frontend rebuild.
 */
@Controller('api/config/public')
export class PublicConfigController {
  constructor(
    @Inject(BillingConfigService) private readonly billingConfig: BillingConfigService,
  ) {}

  @Get()
  getPublicConfig(): { stripePublishableKey: string | null } {
    return {
      stripePublishableKey: this.billingConfig.stripePublishableKey,
    };
  }
}
