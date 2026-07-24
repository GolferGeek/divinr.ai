import { Module } from '@nestjs/common';
import { AgentCommerceRepository } from './agent-commerce.repository';
import { AgentCommerceSchemaService } from './agent-commerce-schema.service';

@Module({
  providers: [AgentCommerceRepository, AgentCommerceSchemaService],
  exports: [AgentCommerceRepository, AgentCommerceSchemaService],
})
export class AgentCommerceModule {}
