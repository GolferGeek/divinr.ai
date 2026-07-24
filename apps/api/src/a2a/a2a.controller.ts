import { Controller, Get, Inject } from '@nestjs/common';
import { Public } from '@orchestratorai/planes/auth';
import { AgentCardService } from './agent-card.service';

/**
 * A2A Discovery Controller — serves signed, public v0.2 discovery metadata.
 * Unauthenticated (public) for protocol compliance.
 */
@Controller('.well-known')
export class A2AController {
  constructor(
    @Inject(AgentCardService) private readonly agentCard: AgentCardService,
  ) {}

  @Public()
  @Get('agent-card.json')
  async getAgentCard() {
    return this.agentCard.getAgentCard();
  }

  @Public()
  @Get('jwks.json')
  async getJwks() {
    return this.agentCard.getJwks();
  }
}
