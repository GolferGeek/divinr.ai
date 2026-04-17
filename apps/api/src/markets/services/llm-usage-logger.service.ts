import { Injectable, Inject, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import type { LlmTextResult, LlmUsageContext } from './markets-llm.service';

interface PricingRow {
  pricing_info_json: { input_per_1k?: number; output_per_1k?: number } | null;
}

@Injectable()
export class LlmUsageLogger {
  private readonly logger = new Logger(LlmUsageLogger.name);
  private pricingCache = new Map<string, { inputPer1k: number; outputPer1k: number }>();
  private cacheLoadedAt = 0;

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
  ) {}

  async record(
    result: LlmTextResult,
    context: LlmUsageContext,
    latencyMs: number,
    promptText: string,
    tokensIn: number,
    tokensOut: number,
    error?: string,
  ): Promise<string | null> {
    const id = randomUUID();

    try {
      const isLocal = result.provider === 'ollama_local' || result.provider === 'local-ollama';
      const isByo = false;

      let costCents: number | null = null;
      if (!isLocal && !isByo && tokensIn + tokensOut > 0) {
        costCents = await this.computeCostCents(result.provider, result.model, tokensIn, tokensOut);
      }

      const promptHash = promptText ? sha256(promptText) : null;
      const outputHash = result.text ? sha256(result.text) : null;

      await this.db.rawQuery(
        `INSERT INTO prediction.llm_usage_log (
          id, "timestamp", article_id, instrument_id, analyst_id,
          billed_user_id, analyst_author_user_id, instrument_author_user_id,
          stage, sub_stage, model, provider, via_byo_key,
          tokens_in, tokens_out, cost_cents, latency_ms,
          prompt_hash, output_hash, cycle_id, error, metadata
        ) VALUES (
          $1, now(), $2, $3, $4,
          $5, $6, $7,
          $8, $9, $10, $11, $12,
          $13, $14, $15, $16,
          $17, $18, $19, $20, $21
        )`,
        [
          id,
          context.articleId ?? null,
          context.instrumentId ?? null,
          context.analystId ?? null,
          context.billedUserId ?? null,
          context.analystAuthorUserId ?? null,
          context.instrumentAuthorUserId ?? null,
          context.stage,
          context.subStage ?? null,
          result.model,
          result.provider,
          isByo,
          tokensIn,
          tokensOut,
          costCents,
          Math.round(latencyMs),
          promptHash,
          outputHash,
          context.cycleId ?? null,
          error ?? null,
          null,
        ],
      );

      return id;
    } catch (err) {
      this.logger.error(
        `Failed to record LLM usage: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  private async computeCostCents(
    provider: string,
    model: string,
    tokensIn: number,
    tokensOut: number,
  ): Promise<number | null> {
    try {
      if (Date.now() - this.cacheLoadedAt > 5 * 60 * 1000) {
        await this.loadPricingCache();
      }

      const key = `${provider.toLowerCase()}:${model.toLowerCase()}`;
      const pricing = this.pricingCache.get(key) ?? this.findPartialMatch(provider, model);
      if (!pricing) return null;

      const cost = (tokensIn / 1000) * pricing.inputPer1k + (tokensOut / 1000) * pricing.outputPer1k;
      return Math.round(cost * 100);
    } catch {
      return null;
    }
  }

  private async loadPricingCache(): Promise<void> {
    try {
      const result = await this.db.rawQuery(
        `SELECT model_name, provider_name, pricing_info_json
         FROM public.llm_models WHERE is_active = true`,
      );
      const rows = (result.data as Array<{ model_name: string; provider_name: string; pricing_info_json: PricingRow['pricing_info_json'] }> | null) ?? [];
      this.pricingCache.clear();
      for (const row of rows) {
        const p = row.pricing_info_json;
        if (p && typeof p.input_per_1k === 'number' && typeof p.output_per_1k === 'number') {
          this.pricingCache.set(
            `${row.provider_name.toLowerCase()}:${row.model_name.toLowerCase()}`,
            { inputPer1k: p.input_per_1k, outputPer1k: p.output_per_1k },
          );
        }
      }
      this.cacheLoadedAt = Date.now();
    } catch {
      // pricing unavailable — cost_cents will be NULL
    }
  }

  private findPartialMatch(
    provider: string,
    model: string,
  ): { inputPer1k: number; outputPer1k: number } | undefined {
    const pLower = provider.toLowerCase();
    const mLower = model.toLowerCase();
    for (const [key, pricing] of this.pricingCache.entries()) {
      const [cachedProvider, cachedModel] = key.split(':');
      if (cachedProvider === pLower && cachedModel && mLower.includes(cachedModel)) {
        return pricing;
      }
    }
    return undefined;
  }
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
