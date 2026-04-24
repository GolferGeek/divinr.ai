import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { BillingSchemaService } from './billing-schema.service';
import { BillingService } from './billing.service';
import { BillingConfigService } from './billing-config.service';
import { StripeService } from './stripe.service';
import { BillingController } from './billing.controller';
import { AdminBillingController } from './admin-billing.controller';
import { BillingLifecycleCron } from './cron/billing-lifecycle.cron';
import { ReadOnlyGuard } from './read-only.guard';

@Module({
  controllers: [BillingController, AdminBillingController],
  providers: [
    BillingSchemaService,
    BillingService,
    BillingConfigService,
    StripeService,
    BillingLifecycleCron,
    { provide: APP_GUARD, useClass: ReadOnlyGuard },
  ],
  exports: [BillingService, BillingSchemaService, BillingConfigService, StripeService],
})
export class BillingModule {}
