import { Module } from '@nestjs/common';
import { AgentCommerceRepository } from './agent-commerce.repository';
import { AgentCommerceSchemaService } from './agent-commerce-schema.service';
import {
  AGENT_KEY_PROVIDER,
  RegistryBackedAgentKeyProvider,
} from './agent-key-provider';

@Module({
  providers: [
    AgentCommerceRepository,
    AgentCommerceSchemaService,
    RegistryBackedAgentKeyProvider,
    {
      provide: AGENT_KEY_PROVIDER,
      useExisting: RegistryBackedAgentKeyProvider,
    },
  ],
  exports: [
    AgentCommerceRepository,
    AgentCommerceSchemaService,
    AGENT_KEY_PROVIDER,
  ],
})
export class AgentCommerceModule {}
