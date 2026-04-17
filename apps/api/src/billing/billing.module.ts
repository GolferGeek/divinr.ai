import { Module } from '@nestjs/common';
import { BillingSchemaService } from './billing-schema.service';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';

@Module({
  controllers: [BillingController],
  providers: [BillingSchemaService, BillingService],
  exports: [BillingService, BillingSchemaService],
})
export class BillingModule {}
