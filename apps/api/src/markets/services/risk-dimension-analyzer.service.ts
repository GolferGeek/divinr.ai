import { Injectable, Inject, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ExecutionContext } from '@orchestrator-ai/transport-types';
import { MarketsLlmService } from './markets-llm.service';
import type { RiskDimension, RiskDimensionAssessment } from '../markets.types';

export interface AnalystPerspective {
  name: string;
  weight: number;
  perspective: string;
}

interface AnalyzeInput {
  context: ExecutionContext;
  dimension: RiskDimension;
  instrumentSymbol: string;
  instrumentName: string;
  instrumentId: string;
  runId: string;
  planeContext: string;
  predictorLines: string[];
  contextProviderText: string;
  analystPerspectives: AnalystPerspective[];
}

interface ParsedDimensionOutput {
  score: number;
  confidence: number;
  reasoning: string;
  evidence: string[];
}

/**
 * Analyzes a single risk dimension via LLM, producing a scored assessment.
 * Falls back to deterministic scoring when LLM is disabled.
 */
@Injectable()
export class RiskDimensionAnalyzerService {
  private readonly logger = new Logger(RiskDimensionAnalyzerService.name);

  constructor(@Inject(MarketsLlmService) private readonly llmService: MarketsLlmService) {}

  async analyzeDimension(input: AnalyzeInput): Promise<RiskDimensionAssessment> {
    if (!this.llmService.isLlmEnabled()) {
      return this.deterministicFallback(input);
    }

    const systemPrompt = this.buildSystemPrompt(input.dimension);
    const userPrompt = this.buildUserPrompt(input);

    try {
      const result = await this.llmService.generateText(
        input.context,
        systemPrompt,
        userPrompt,
        undefined,
        {
          stage: 'risk_assessment',
          subStage: 'reflection',
          instrumentId: input.instrumentId,
          cycleId: input.runId,
        },
      );

      const parsed = this.parseOutput(result.text);

      return {
        id: randomUUID(),
        run_id: input.runId,
  
        instrument_id: input.instrumentId,
        dimension_id: input.dimension.id,
        score: parsed.score,
        confidence: parsed.confidence,
        reasoning: parsed.reasoning,
        evidence: parsed.evidence,
        signals: [],
        model_provider: result.provider,
        model_name: result.model,
        llm_usage_id: result.llmUsageId ?? null,
        created_at: new Date().toISOString(),
      };
    } catch (err) {
      this.logger.warn(
        `LLM dimension analysis failed for ${input.dimension.slug}, using fallback: ${err instanceof Error ? err.message : String(err)}`,
      );
      return this.deterministicFallback(input);
    }
  }

  private buildSystemPrompt(dimension: RiskDimension): string {
    const base = dimension.system_prompt || `Analyze ${dimension.name} risk for this instrument.`;
    return `${base}

Respond with valid JSON matching this schema:
{
  "score": <integer 0-100, where 0=no risk, 100=extreme risk>,
  "confidence": <number 0.0-1.0>,
  "reasoning": "<your analysis>",
  "evidence": ["<supporting point 1>", "<supporting point 2>", ...]
}

Respond ONLY with valid JSON. No markdown, no explanation outside the JSON.`;
  }

  private buildUserPrompt(input: AnalyzeInput): string {
    const parts: string[] = [
      `Analyze ${input.dimension.name} for ${input.instrumentSymbol} (${input.instrumentName}).`,
    ];

    if (input.planeContext) {
      parts.push(`\nInstrument context:\n${input.planeContext}`);
    }

    if (input.contextProviderText) {
      parts.push(`\n${input.contextProviderText}`);
    }

    if (input.predictorLines.length > 0) {
      parts.push(`\nActive article predictors:\n${input.predictorLines.join('\n')}`);
    }

    if (input.analystPerspectives.length > 0) {
      const perspectiveLines = input.analystPerspectives.map(
        (a) => `- ${a.name} (weight ${Number(a.weight).toFixed(1)}): ${a.perspective.slice(0, 300)}`,
      );
      parts.push(`\nAnalyst perspectives to consider:\n${perspectiveLines.join('\n')}`);
    }

    return parts.join('\n');
  }

  private parseOutput(text: string): ParsedDimensionOutput {
    // Try JSON parse first
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
        return {
          score: Math.min(100, Math.max(0, Math.round(Number(parsed['score']) || 50))),
          confidence: Math.min(1, Math.max(0, Number(parsed['confidence']) || 0.5)),
          reasoning: String(parsed['reasoning'] || text.slice(0, 1200)),
          evidence: Array.isArray(parsed['evidence'])
            ? (parsed['evidence'] as unknown[]).map(String)
            : [],
        };
      }
    } catch {
      // Fall through to keyword heuristic
    }

    // Keyword fallback
    const lower = text.toLowerCase();
    const score = lower.includes('extreme') || lower.includes('very high')
      ? 82
      : lower.includes('high')
        ? 68
        : lower.includes('low') || lower.includes('minimal')
          ? 25
          : 50;

    return {
      score,
      confidence: 0.5,
      reasoning: text.slice(0, 1200),
      evidence: [],
    };
  }

  private deterministicFallback(input: AnalyzeInput): RiskDimensionAssessment {
    // Produce a deterministic score based on predictor count and dimension type
    const predictorCount = input.predictorLines.length;
    const baseScore = predictorCount > 10 ? 60 : predictorCount > 5 ? 45 : 35;

    return {
      id: randomUUID(),
      run_id: input.runId,

      instrument_id: input.instrumentId,
      dimension_id: input.dimension.id,
      score: baseScore,
      confidence: 0.4,
      reasoning: `Deterministic assessment for ${input.dimension.name} (LLM disabled). Based on ${predictorCount} active predictors.`,
      evidence: [`${predictorCount} active predictors for instrument`],
      signals: [],
      model_provider: 'deterministic_local',
      model_name: 'rules-v1',
      llm_usage_id: null,
      created_at: new Date().toISOString(),
    };
  }
}
