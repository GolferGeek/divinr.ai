import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { PublicConfigController } from './public-config.controller';

/**
 * Hosts the unauthenticated /api/config/public endpoint.
 *
 * Named PublicConfigModule (not ConfigModule) to avoid collision with
 * @nestjs/config's ConfigModule, which is already imported by AppModule.
 */
@Module({
  imports: [BillingModule],
  controllers: [PublicConfigController],
})
export class PublicConfigModule {}
