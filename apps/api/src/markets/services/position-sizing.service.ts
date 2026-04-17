import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import type { PositionSizingTier } from '../markets.types';

/**
 * Calculates position sizes based on confidence tiers.
 * Tiers are configurable per organization (falls back to global '*' defaults).
 */
@Injectable()
export class PositionSizingService {
  private readonly logger = new Logger(PositionSizingService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
  ) {}

  async getPositionPercent(confidence: number): Promise<number> {
    const tiers = await this.loadTiers();
    for (const tier of tiers) {
      if (confidence >= tier.min_confidence && confidence < tier.max_confidence) {
        return tier.position_percent;
      }
    }
    return 0; // Below minimum confidence — no position
  }

  async getMinimumConfidence(): Promise<number> {
    const tiers = await this.loadTiers();
    if (tiers.length === 0) return 60;
    return Math.min(...tiers.map(t => t.min_confidence));
  }

  calculatePositionSize(
    portfolioBalance: number,
    entryPrice: number,
    positionPercent: number,
  ): number {
    if (positionPercent <= 0 || entryPrice <= 0) return 0;
    const positionValue = portfolioBalance * positionPercent;
    return Math.max(0, Math.floor(positionValue / entryPrice));
  }

  calculatePnl(
    direction: 'long' | 'short',
    entryPrice: number,
    currentPrice: number,
    quantity: number,
  ): number {
    if (direction === 'long') {
      return (currentPrice - entryPrice) * quantity;
    }
    return (entryPrice - currentPrice) * quantity;
  }

  determinePortfolioStatus(
    currentBalance: number,
    initialBalance: number,
  ): 'active' | 'warning' | 'probation' | 'suspended' {
    const ratio = currentBalance / initialBalance;
    if (ratio >= 0.8) return 'active';
    if (ratio >= 0.6) return 'warning';
    if (ratio >= 0.4) return 'probation';
    return 'suspended';
  }

  /**
   * Adjust confidence by analyst calibration accuracy.
   * Well-calibrated analysts get full credit; overconfident analysts get reduced position sizes.
   */
  async getEffectiveConfidence(confidence: number, analystId: string): Promise<number> {
    try {
      const result = await this.db.rawQuery(
        `select calibration_score from prediction.analyst_performance_profiles
         where analyst_id = $1
         order by computed_at desc limit 1`,
        [analystId],
      );
      const rows = (result.data as Array<{ calibration_score: number | null }> | null) ?? [];
      const calibration = rows[0]?.calibration_score;
      if (calibration != null && calibration > 0) {
        return Math.min(100, Math.max(0, confidence * calibration));
      }
    } catch {
      // No calibration data — use raw confidence
    }
    return confidence;
  }

  getWeightMultiplier(status: string): number {
    if (status === 'probation') return 0.5;
    if (status === 'suspended') return 0;
    return 1.0;
  }

  private async loadTiers(): Promise<PositionSizingTier[]> {
    const result = await this.db.rawQuery(
      `select * from prediction.position_sizing_config
       order by min_confidence asc`,
    );
    if (result.error) {
      this.logger.warn(`Failed to load sizing tiers: ${result.error.message}`);
      return this.defaultTiers();
    }
    const rows = (result.data as PositionSizingTier[] | null) ?? [];
    if (rows.length === 0) return this.defaultTiers();

    // Deduplicate: org-specific overrides global for same tier
    const seen = new Set<string>();
    return rows.filter((r) => {
      if (seen.has(r.tier_name)) return false;
      seen.add(r.tier_name);
      return true;
    });
  }

  private defaultTiers(): PositionSizingTier[] {
    return [
      { id: 'default_low', tier_name: 'low', min_confidence: 60, max_confidence: 70, position_percent: 0.05 },
      { id: 'default_medium', tier_name: 'medium', min_confidence: 70, max_confidence: 80, position_percent: 0.10 },
      { id: 'default_high', tier_name: 'high', min_confidence: 80, max_confidence: 100, position_percent: 0.15 },
    ];
  }
}
