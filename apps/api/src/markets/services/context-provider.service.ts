import { Injectable, Inject, Logger } from '@nestjs/common';
import type { ExecutionContext } from '@orchestrator-ai/transport-types';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { MarketsLlmService } from './markets-llm.service';
import type { MarketAnalyst } from '../markets.types';

export interface ContextProviderOutput {
  analystId: string;
  analystName: string;
  scopeLabel: string;
  content: string;
}

/**
 * Loads and executes context_provider analysts to produce knowledge layers
 * that get injected into personality analyst prompts.
 */
@Injectable()
export class ContextProviderService {
  private readonly logger = new Logger(ContextProviderService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(MarketsLlmService) private readonly llmService: MarketsLlmService,
  ) {}

  async loadContextProviders(
    organizationSlug: string,
    instrumentId: string,
  ): Promise<MarketAnalyst[]> {
    // Load context_provider analysts that are enabled and match the instrument's universe
    const result = await this.db.rawQuery(
      `
      select ma.*
      from prediction.market_analysts ma
      where ma.organization_slug = $1
        and ma.analyst_type = 'context_provider'
        and ma.is_enabled = true
        and ma.is_active = true
        and (
          ma.universe_slug is null
          or ma.universe_slug = (
            select i.universe_slug from prediction.instruments i where i.id = $2
          )
        )
      order by ma.created_at asc
      `,
      [organizationSlug, instrumentId],
    );
    if (result.error) {
      this.logger.warn(`Failed to load context providers: ${result.error.message}`);
      return [];
    }
    return (result.data as MarketAnalyst[] | null) ?? [];
  }

  async executeContextProviders(
    context: ExecutionContext,
    providers: MarketAnalyst[],
    instrumentSymbol: string,
    instrumentName: string,
    planeContext: string,
  ): Promise<ContextProviderOutput[]> {
    if (!this.llmService.isLlmEnabled() || providers.length === 0) {
      return [];
    }

    const outputs: ContextProviderOutput[] = [];

    for (const provider of providers) {
      try {
        const scopeLabel = provider.universe_slug
          ? `${provider.display_name} (${provider.universe_slug})`
          : `${provider.display_name} (general)`;

        const systemPrompt = `You are ${provider.display_name}, a knowledge provider. ${provider.persona_prompt}

Provide relevant context and knowledge for analyzing ${instrumentSymbol} (${instrumentName}).
Be concise and factual. Focus on information that would help a decision-making analyst.`;

        const userPrompt = `Provide your domain expertise for ${instrumentSymbol}.\n\n${planeContext}`;

        const result = await this.llmService.generateText(context, systemPrompt, userPrompt);

        outputs.push({
          analystId: provider.id,
          analystName: provider.display_name,
          scopeLabel,
          content: result.text.slice(0, 1500),
        });
      } catch (err) {
        this.logger.warn(
          `Context provider ${provider.slug} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return outputs;
  }

  formatContextForPrompt(outputs: ContextProviderOutput[]): string {
    if (outputs.length === 0) return '';

    const sections = outputs.map(
      (o) => `## ${o.scopeLabel}\n${o.content}`,
    );
    return `\nContext from knowledge providers:\n${sections.join('\n\n')}\n`;
  }
}
