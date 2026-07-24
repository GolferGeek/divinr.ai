import { Module } from '@nestjs/common';
import { A2AController } from './a2a.controller';
import { A2AInvokeController } from './a2a-invoke.controller';
import { A2AAdminController } from './a2a-admin.controller';
import { ServiceApiKeyService } from '../auth/service-api-key.service';
import { AgentCommerceModule } from '../agent-commerce/agent-commerce.module';
import { AgentCardService } from './agent-card.service';
import { A2APhaseGateGuard } from './a2a-phase-gate.guard';
import { A2ATaskAccessPolicy } from './a2a-task-access.policy';
import { OAuthModule } from '../oauth/oauth.module';

@Module({
  imports: [AgentCommerceModule, OAuthModule],
  controllers: [A2AController, A2AInvokeController, A2AAdminController],
  providers: [
    ServiceApiKeyService,
    AgentCardService,
    A2APhaseGateGuard,
    A2ATaskAccessPolicy,
  ],
  exports: [ServiceApiKeyService],
})
export class A2AModule {}
