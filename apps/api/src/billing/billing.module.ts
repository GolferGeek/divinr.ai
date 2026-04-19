import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { BillingSchemaService } from './billing-schema.service';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { BillingLifecycleCron } from './cron/billing-lifecycle.cron';
import { ReadOnlyGuard } from './read-only.guard';

@Module({
  controllers: [BillingController],
  providers: [
    BillingSchemaService,
    BillingService,
    BillingLifecycleCron,
    { provide: APP_GUARD, useClass: ReadOnlyGuard },
  ],
  exports: [BillingService, BillingSchemaService],
})
export class BillingModule {}
