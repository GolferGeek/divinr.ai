import { Injectable, Logger } from '@nestjs/common';
import type { RiskDimension, RiskDimensionAssessment } from '../markets.types';

export interface AggregationResult {
  overallScore: number;
  dimensionScores: Record<string, number>;
  confidence: number;
}

/**
 * Pure computation service for risk score aggregation.
 * No database or LLM dependencies — receives data, returns results.
 */
@Injectable()
export class RiskScoreAggregationService {
  private readonly logger = new Logger(RiskScoreAggregationService.name);

  validateDimensionWeights(dimensions: RiskDimension[]): void {
    const totalWeight = dimensions.reduce((sum, d) => sum + d.weight, 0);
    if (Math.abs(totalWeight - 1.0) > 0.01) {
      this.logger.warn(
        `Dimension weights sum to ${totalWeight.toFixed(3)}, expected ~1.0. Results will be normalized.`,
      );
    }
  }

  aggregateAssessments(
    assessments: RiskDimensionAssessment[],
    dimensions: RiskDimension[],
  ): AggregationResult {
    if (assessments.length === 0) {
      return { overallScore: 0, dimensionScores: {}, confidence: 0 };
    }

    const dimensionMap = new Map(dimensions.map((d) => [d.id, d]));
    let weightedSum = 0;
    let totalWeight = 0;
    const confidences: number[] = [];
    const dimensionScores: Record<string, number> = {};

    for (const assessment of assessments) {
      const dimension = dimensionMap.get(assessment.dimension_id);
      if (!dimension) {
        this.logger.warn(`Assessment references unknown dimension ${assessment.dimension_id}`);
        continue;
      }

      dimensionScores[dimension.slug] = assessment.score;
      weightedSum += assessment.score * dimension.weight;
      totalWeight += dimension.weight;
      confidences.push(assessment.confidence);
    }

    // Weighted average, normalized by actual total weight of assessed dimensions
    const overallScore =
      totalWeight > 0
        ? Math.round(Math.min(100, Math.max(0, weightedSum / totalWeight)))
        : 0;

    // Geometric mean of confidences — penalizes low-confidence dimensions more than arithmetic mean
    const confidence =
      confidences.length > 0
        ? Math.round(
            Math.pow(
              confidences.reduce((prod, c) => prod * Math.max(c, 0.01), 1),
              1 / confidences.length,
            ) * 100,
          ) / 100
        : 0;

    return { overallScore, dimensionScores, confidence };
  }

  applyDebateAdjustment(score: number, adjustment: number): number {
    const clamped = Math.min(30, Math.max(-30, adjustment));
    return Math.min(100, Math.max(0, Math.round(score + clamped)));
  }

  verdictFromScore(score: number): 'low' | 'medium' | 'high' {
    if (score <= 33) return 'low';
    if (score <= 66) return 'medium';
    return 'high';
  }
}
