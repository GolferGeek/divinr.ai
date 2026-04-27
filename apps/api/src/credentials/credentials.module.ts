import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { CredentialsSchemaService } from './credentials-schema.service';
import { CredentialEncryptionService } from './credential-encryption.service';
import { CredentialsService } from './credentials.service';
import { CredentialsController } from './credentials.controller';

@Module({
  imports: [BillingModule],
  controllers: [CredentialsController],
  providers: [CredentialsSchemaService, CredentialEncryptionService, CredentialsService],
  exports: [CredentialsService, CredentialsSchemaService],
})
export class CredentialsModule {}
