import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_SERVICE, DatabaseService, QueryResult } from '@/database';
import { getTableName } from '@orchestratorai/planes/database';

export interface ModelPricing {
  inputPer1k: number;
  outputPer1k: number;
  cachedInputPer1k?: number;
  thinkingPer1k?: number;
}

interface PricingInfoJson {
  input_per_1k?: number;
  output_per_1k?: number;
  cached_input_per_1k?: number;
  thinking_per_1k?: number;
}

interface LLMModelRow {
  model_name: string;
  provider_name: string;
  pricing_info_json: PricingInfoJson | null;
}

/**
 * Service for looking up LLM pricing from the database.
 *
 * Pricing is stored in public.llm_models.pricing_info_json as:
 * {
 *   input_per_1k: number,   // Cost per 1000 input tokens (USD)
 *   output_per_1k: number,  // Cost per 1000 output tokens (USD)
 *   cached_input_per_1k?: number,  // Optional: cost for cached input
 *   thinking_per_1k?: number,      // Optional: cost for thinking tokens
 * }
 */
@Injectable()
export class LLMPricingService {
  private readonly logger = new Logger(LLMPricingService.name);

  // In-memory cache for pricing to avoid DB lookups on every request
  private pricingCache = new Map<string, ModelPricing>();
  private cacheLoadedAt: number | null = null;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  // Default pricing for unknown models (per 1K tokens)
  private readonly DEFAULT_PRICING: ModelPricing = {
    inputPer1k: 0.001,
    outputPer1k: 0.002,
  };

  constructor(@Inject(DATABASE_SERVICE) private readonly db: DatabaseService) {}

  /**
   * Get pricing for a specific model.
   * Returns cached pricing if available, otherwise queries DB.
   */
  async getModelPricing(
    provider: string,
    model: string,
  ): Promise<ModelPricing> {
    const cacheKey = this.getCacheKey(provider, model);

    // Check if cache needs refresh
    if (this.shouldRefreshCache()) {
      await this.loadPricingCache();
    }

    // Try exact match first
    let pricing = this.pricingCache.get(cacheKey);
    if (pricing) {
      return pricing;
    }

    // Try partial match (model name might have version suffix)
    pricing = this.findPartialMatch(provider, model);
    if (pricing) {
      // Cache the partial match for future lookups
      this.pricingCache.set(cacheKey, pricing);
      return pricing;
    }

    // Fall back to DB query for this specific model
    const fetchedPricing = await this.fetchModelPricing(provider, model);
    if (fetchedPricing) {
      this.pricingCache.set(cacheKey, fetchedPricing);
      return fetchedPricing;
    }

    this.logger.warn(
      `No pricing found for ${provider}/${model}, using default`,
    );
    return this.DEFAULT_PRICING;
  }

  /**
   * Calculate cost for a request based on token counts.
   * This is the main method that LLM services should use.
   */
  async calculateCost(
    provider: string,
    model: string,
    inputTokens: number,
    outputTokens: number,
    options?: {
      cachedInputTokens?: number;
      thinkingTokens?: number;
    },
  ): Promise<{
    inputCost: number;
    outputCost: number;
    cachedInputCost?: number;
    thinkingCost?: number;
    totalCost: number;
  }> {
    const pricing = await this.getModelPricing(provider, model);

    const inputCost = (inputTokens / 1000) * pricing.inputPer1k;
    const outputCost = (outputTokens / 1000) * pricing.outputPer1k;

    let cachedInputCost: number | undefined;
    let thinkingCost: number | undefined;

    if (options?.cachedInputTokens && pricing.cachedInputPer1k) {
      cachedInputCost =
        (options.cachedInputTokens / 1000) * pricing.cachedInputPer1k;
    }

    if (options?.thinkingTokens && pricing.thinkingPer1k) {
      thinkingCost = (options.thinkingTokens / 1000) * pricing.thinkingPer1k;
    }

    const totalCost =
      inputCost + outputCost + (cachedInputCost || 0) + (thinkingCost || 0);

    return {
      inputCost,
      outputCost,
      cachedInputCost,
      thinkingCost,
      totalCost,
    };
  }

  /**
   * Calculate cost synchronously using cached pricing.
   * Falls back to default if pricing not in cache.
   * Use this when you can't await (e.g., in synchronous code paths).
   */
  calculateCostSync(
    provider: string,
    model: string,
    inputTokens: number,
    outputTokens: number,
  ): number {
    const cacheKey = this.getCacheKey(provider, model);
    const pricing =
      this.pricingCache.get(cacheKey) ||
      this.findPartialMatch(provider, model) ||
      this.DEFAULT_PRICING;

    const inputCost = (inputTokens / 1000) * pricing.inputPer1k;
    const outputCost = (outputTokens / 1000) * pricing.outputPer1k;

    return inputCost + outputCost;
  }

  /**
   * Preload all pricing into cache.
   * Call this at app startup or periodically.
   */
  async loadPricingCache(): Promise<void> {
    try {
      const { data, error } = (await this.db
        .from(null, getTableName('llm_models'))
        .select('model_name, provider_name, pricing_info_json')
        .eq('is_active', true)) as QueryResult<unknown>;

      if (error) {
        this.logger.error('Failed to load pricing cache:', error);
        return;
      }

      const rows = data as LLMModelRow[] | null;
      if (!rows) {
        this.logger.warn('No models found in llm_models table');
        return;
      }

      // Clear existing cache
      this.pricingCache.clear();

      for (const row of rows) {
        const pricing = this.parsePricingJson(row.pricing_info_json);
        if (pricing) {
          const cacheKey = this.getCacheKey(row.provider_name, row.model_name);
          this.pricingCache.set(cacheKey, pricing);
        }
      }

      this.cacheLoadedAt = Date.now();
      this.logger.log(`Loaded pricing for ${this.pricingCache.size} models`);
    } catch (error) {
      this.logger.error('Error loading pricing cache:', error);
    }
  }

  /**
   * Get all available models with pricing (for frontend dropdowns).
   */
  async getModelsWithPricing(provider?: string): Promise<
    Array<{
      provider: string;
      model: string;
      displayName: string;
      inputPer1k: number;
      outputPer1k: number;
      modelTier: string;
      speedTier: string;
      isLocal: boolean;
    }>
  > {
    try {
      let query = this.db
        .from(null, getTableName('llm_models'))
        .select(
          'model_name, provider_name, display_name, pricing_info_json, model_tier, speed_tier, is_local',
        )
        .eq('is_active', true)
        .order('provider_name')
        .order('model_tier')
        .order('display_name');

      if (provider) {
        query = query.eq('provider_name', provider);
      }

      const { data, error } = (await query) as QueryResult<unknown>;

      if (error) {
        this.logger.error('Failed to get models with pricing:', error);
        return [];
      }

      const rows = data as Array<{
        model_name: string;
        provider_name: string;
        display_name: string | null;
        pricing_info_json: PricingInfoJson | null;
        model_tier: string | null;
        speed_tier: string | null;
        is_local: boolean;
      }> | null;

      if (!rows) return [];

      return rows.map((row) => {
        const pricing =
          this.parsePricingJson(row.pricing_info_json) || this.DEFAULT_PRICING;
        return {
          provider: row.provider_name,
          model: row.model_name,
          displayName: row.display_name || row.model_name,
          inputPer1k: pricing.inputPer1k,
          outputPer1k: pricing.outputPer1k,
          modelTier: row.model_tier || 'standard',
          speedTier: row.speed_tier || 'medium',
          isLocal: row.is_local,
        };
      });
    } catch (error) {
      this.logger.error('Error getting models with pricing:', error);
      return [];
    }
  }

  /**
   * Get all active providers.
   */
  async getProviders(): Promise<
    Array<{
      name: string;
      displayName: string;
      isLocal: boolean;
    }>
  > {
    try {
      const { data, error } = (await this.db
        .from(null, getTableName('llm_providers'))
        .select('name, display_name, is_local')
        .eq('is_active', true)
        .order('display_name')) as QueryResult<unknown>;

      if (error) {
        this.logger.error('Failed to get providers:', error);
        return [];
      }

      const rows = data as Array<{
        name: string;
        display_name: string;
        is_local: boolean;
      }> | null;

      if (!rows) return [];

      return rows.map((row) => ({
        name: row.name,
        displayName: row.display_name,
        isLocal: row.is_local || false,
      }));
    } catch (error) {
      this.logger.error('Error getting providers:', error);
      return [];
    }
  }

  // ==================== Private Helper Methods ====================

  private getCacheKey(provider: string, model: string): string {
    return `${provider.toLowerCase()}:${model.toLowerCase()}`;
  }

  private shouldRefreshCache(): boolean {
    if (!this.cacheLoadedAt) return true;
    return Date.now() - this.cacheLoadedAt > this.CACHE_TTL_MS;
  }

  private findPartialMatch(
    provider: string,
    model: string,
  ): ModelPricing | undefined {
    const providerLower = provider.toLowerCase();
    const modelLower = model.toLowerCase();

    // Look for partial matches (e.g., "claude-sonnet-4-20250514" matches "claude-sonnet-4")
    for (const [key, pricing] of this.pricingCache.entries()) {
      const parts = key.split(':');
      const cachedProvider = parts[0];
      const cachedModel = parts[1];
      if (
        cachedProvider &&
        cachedModel &&
        cachedProvider === providerLower &&
        modelLower.includes(cachedModel)
      ) {
        return pricing;
      }
    }

    return undefined;
  }

  private async fetchModelPricing(
    provider: string,
    model: string,
  ): Promise<ModelPricing | null> {
    try {
      const { data, error } = (await this.db
        .from(null, getTableName('llm_models'))
        .select('pricing_info_json')
        .eq('provider_name', provider)
        .eq('model_name', model)
        .single()) as QueryResult<unknown>;

      if (error || !data) {
        return null;
      }

      const row = data as { pricing_info_json: PricingInfoJson | null };
      return this.parsePricingJson(row.pricing_info_json);
    } catch {
      return null;
    }
  }

  private parsePricingJson(json: PricingInfoJson | null): ModelPricing | null {
    if (!json) return null;

    const inputPer1k = json.input_per_1k;
    const outputPer1k = json.output_per_1k;

    if (typeof inputPer1k !== 'number' || typeof outputPer1k !== 'number') {
      return null;
    }

    return {
      inputPer1k,
      outputPer1k,
      cachedInputPer1k: json.cached_input_per_1k,
      thinkingPer1k: json.thinking_per_1k,
    };
  }
}
