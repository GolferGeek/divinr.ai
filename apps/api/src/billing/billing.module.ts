import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { BillingSchemaService } from './billing-schema.service';
import { BillingService } from './billing.service';
import { BillingConfigService } from './billing-config.service';
import { StripeService } from './stripe.service';
import { BillingStripeSyncService } from './billing-stripe-sync.service';
import { BillingController } from './billing.controller';
import { AdminBillingController, AdminBillingOpsController } from './admin-billing.controller';
import { BillingLifecycleCron } from './cron/billing-lifecycle.cron';
import { ReadOnlyGuard } from './read-only.guard';

@Module({
  controllers: [BillingController, AdminBillingController, AdminBillingOpsController],
  providers: [
    BillingSchemaService,
    BillingService,
    BillingConfigService,
    StripeService,
    BillingStripeSyncService,
    BillingLifecycleCron,
    { provide: APP_GUARD, useClass: ReadOnlyGuard },
  ],
  exports: [BillingService, BillingSchemaService, BillingConfigService, StripeService, BillingStripeSyncService],
})
export class BillingModule {}
