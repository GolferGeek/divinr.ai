import { Module } from '@nestjs/common';
import { AgentCommerceRepository } from './agent-commerce.repository';
import { AgentCommerceSchemaService } from './agent-commerce-schema.service';
import {
  AGENT_KEY_PROVIDER,
  RegistryBackedAgentKeyProvider,
} from './agent-key-provider';
import {
  AGENT_MERCHANT_INVOICE_ISSUER,
  AgentQuoteService,
  PhaseSixMerchantInvoiceIssuer,
} from './agent-quote.service';

@Module({
  providers: [
    AgentCommerceRepository,
    AgentCommerceSchemaService,
    RegistryBackedAgentKeyProvider,
    AgentQuoteService,
    PhaseSixMerchantInvoiceIssuer,
    {
      provide: AGENT_KEY_PROVIDER,
      useExisting: RegistryBackedAgentKeyProvider,
    },
    {
      provide: AGENT_MERCHANT_INVOICE_ISSUER,
      useExisting: PhaseSixMerchantInvoiceIssuer,
    },
  ],
  exports: [
    AgentCommerceRepository,
    AgentCommerceSchemaService,
    AGENT_KEY_PROVIDER,
    AgentQuoteService,
    AGENT_MERCHANT_INVOICE_ISSUER,
  ],
})
export class AgentCommerceModule {}
