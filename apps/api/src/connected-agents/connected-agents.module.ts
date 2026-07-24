import { Module } from '@nestjs/common';
import { AgentCommerceModule } from '../agent-commerce/agent-commerce.module';
import { OAuthModule } from '../oauth/oauth.module';
import { ConnectedAgentsController } from './connected-agents.controller';
import { ConnectedAgentsService } from './connected-agents.service';

@Module({
  imports: [AgentCommerceModule, OAuthModule],
  controllers: [ConnectedAgentsController],
  providers: [ConnectedAgentsService],
})
export class ConnectedAgentsModule {}
