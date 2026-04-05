import { Module } from '@nestjs/common';
import { A2AController } from './a2a.controller';
import { A2AInvokeController } from './a2a-invoke.controller';
import { A2AAdminController } from './a2a-admin.controller';
import { MarketsModule } from '../markets/markets.module';
import { ServiceApiKeyService } from '../auth/service-api-key.service';
import { ServiceApiKeyGuard } from '../auth/service-api-key.guard';

@Module({
  imports: [MarketsModule],
  controllers: [A2AController, A2AInvokeController, A2AAdminController],
  providers: [ServiceApiKeyService, ServiceApiKeyGuard],
  exports: [ServiceApiKeyService],
})
export class A2AModule {}
