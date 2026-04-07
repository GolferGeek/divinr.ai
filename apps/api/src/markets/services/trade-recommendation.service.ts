import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { MarketsSchemaService } from '../schema/markets-schema.service';
import type { TradeAction, TradeRecommendation } from '../markets.types';

/**
 * Phase 6: Portfolio Manager
 *
 * Converts the arbitrator's composite prediction + composite risk score +
 * analyst consensus + portfolio state into a sized BUY/SELL/HOLD trade
 * recommendation. Position sizing uses the Kelly criterion adjusted by
 * arbitrator calibration accuracy and the composite risk score, then clamped
 * by sane bounds.
 *
 * The math is deliberately implemented as pure helper methods so it can be
 * unit-tested without a DB.
 */
@Injectable()
export class TradeRecommendationService {
  private readonly logger = new Logger(TradeRecommendationService.name);

  // Sane-bounds constants. These are intentionally conservative.
  static readonly MAX_POSITION_PERCENT = 0.10;       // never more than 10% of portfolio per position
  static readonly MIN_KELLY_THRESHOLD = 0.01;        // below this → HOLD instead of BUY/SELL
  static readonly DEFAULT_REWARD_TO_RISK = 2;        // assume 2:1 reward:risk (2% target / 1% stop)
  static readonly DEFAULT_STOP_LOSS_PCT = 0.01;      // 1% from entry
  static readonly DEFAULT_TAKE_PROFIT_PCT = 0.02;    // 2% from entry
  static readonly DEFAULT_CALIBRATION_ACCURACY = 0.85; // assumed when no calibration history exists
  static readonly CALIBRATING_THRESHOLD = 50;        // <50 resolved arbitrator predictions → calibrating badge

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    private readonly schema: MarketsSchemaService,
  ) {}

  // ─── Public API ─────────────────────────────────────────────────

  /**
   * Generate (or fetch existing) the **portfolio-agnostic** trade recommendation
   * for a completed prediction run. The persisted recommendation has
   * `quantity = 0` because quantity is per-user (depends on the viewer's
   * portfolio balance). Use {@link sizeForUser} to compute quantity at read
   * time. Idempotent: if a portfolio_manager prediction already exists for
   * the run, returns it without regenerating.
   */
  async generateForRun(input: {
    runId: string;
    organizationSlug: string;
  }): Promise<TradeRecommendation | null> {
    await this.schema.ensureSchema();

    const existing = await this.fetchExisting(input.runId, input.organizationSlug);
    if (existing) return existing;

    const context = await this.loadRunContext(input.runId, input.organizationSlug);
    if (!context) {
      this.logger.warn(`No arbitrator prediction for run ${input.runId} — cannot generate recommendation`);
      return null;
    }

    const calibrationAccuracy = await this.loadArbitratorCalibrationAccuracy(input.organizationSlug);
    const isCalibrating = await this.checkCalibratingStatus(input.organizationSlug);

    // Compute with portfolioBalance = 0; quantity will be 0 in the persisted
    // row. Real per-user quantity is computed by sizeForUser() at read time.
    const recommendation = this.computeRecommendation({
      arbitratorDirection: context.direction,
      arbitratorConfidence: context.confidence,
      compositeRiskScore: context.compositeRiskScore,
      consensusBullishCount: context.bullishCount,
      consensusBearishCount: context.bearishCount,
      consensusTotal: context.totalAnalysts,
      portfolioBalance: 0,
      entryPrice: context.entryPrice,
      calibrationAccuracy,
    });

    return await this.persist({
      runId: input.runId,
      organizationSlug: input.organizationSlug,
      instrumentId: context.instrumentId,
      symbol: context.symbol,
      arbitratorDirection: context.direction,
      arbitratorConfidence: context.confidence,
      compositeRiskScore: context.compositeRiskScore,
      bullishCount: context.bullishCount,
      bearishCount: context.bearishCount,
      totalAnalysts: context.totalAnalysts,
      entryPrice: context.entryPrice,
      isCalibrating,
      computed: recommendation,
    });
  }

  /**
   * Take a portfolio-agnostic recommendation and compute the per-user
   * quantity given that user's portfolio balance. Returns a new object;
   * does not mutate the input. Pure function.
   *
   * This is the read-time per-user sizing step. It exists because the
   * persisted recommendation row is shared across all users viewing the
   * same run, so quantity cannot be baked into persistence.
   */
  static sizeForUser(
    recommendation: TradeRecommendation,
    portfolioBalance: number,
  ): TradeRecommendation {
    if (recommendation.action === 'hold' || recommendation.entry_price <= 0 || portfolioBalance <= 0) {
      return { ...recommendation, quantity: 0 };
    }
    const quantity = Math.max(
      0,
      Math.floor((portfolioBalance * recommendation.position_percent) / recommendation.entry_price),
    );
    return { ...recommendation, quantity };
  }

  async fetchExisting(runId: string, organizationSlug: string): Promise<TradeRecommendation | null> {
    const result = await this.db.rawQuery(
      `select mp.id, mp.run_id, mp.organization_slug, mp.instrument_id,
              mp.predicted_direction, mp.confidence, mp.rationale, mp.trade_metadata,
              mp.created_at, i.symbol
       from prediction.market_predictions mp
       join prediction.instruments i on i.id = mp.instrument_id
       where mp.run_id = $1
         and (mp.organization_slug = $2 or mp.organization_slug = '__base__')
         and mp.role = 'portfolio_manager'
       limit 1`,
      [runId, organizationSlug],
    );
    if (result.error) return null;
    const rows = (result.data as Array<Record<string, unknown>>) ?? [];
    if (rows.length === 0) return null;
    return this.rowToRecommendation(rows[0]!);
  }

  // ─── Pure computation (unit-tested) ─────────────────────────────

  /**
   * Map arbitrator direction to trade action. Pure function — no I/O.
   */
  static directionToAction(direction: 'up' | 'down' | 'flat'): TradeAction {
    if (direction === 'up') return 'buy';
    if (direction === 'down') return 'sell';
    return 'hold';
  }

  /**
   * Apply calibration accuracy to raw confidence to get a "true" probability.
   * If the arbitrator has been historically 80% accurate at its claimed
   * confidence, then a stated 75% confidence is really 75% × 0.80 = 60%.
   */
  static calibrationAdjustedProbability(confidencePct: number, calibrationAccuracy: number): number {
    const p = Math.min(1, Math.max(0, confidencePct / 100));
    const cal = Math.min(1, Math.max(0, calibrationAccuracy));
    return Math.min(1, Math.max(0, p * cal));
  }

  /**
   * Compute the raw Kelly fraction for a directional bet with assumed
   * reward:risk ratio b. f* = (bp - q) / b where q = 1 - p.
   *
   * Returns 0 (rather than negative) for unfavorable bets — Kelly says
   * "don't bet" when negative.
   */
  static kellyFraction(probability: number, rewardToRisk: number = TradeRecommendationService.DEFAULT_REWARD_TO_RISK): number {
    if (probability <= 0 || rewardToRisk <= 0) return 0;
    const q = 1 - probability;
    const f = (rewardToRisk * probability - q) / rewardToRisk;
    return Math.max(0, f);
  }

  /**
   * Adjust raw Kelly by composite risk score (0-100, higher = riskier) and
   * by analyst consensus alignment with the proposed direction.
   *
   * - High composite risk linearly scales the fraction down: at risk=100
   *   the fraction is halved.
   * - Weak analyst consensus (<60% agreement with direction) halves the
   *   fraction. This prevents oversized bets when the analysts are split.
   */
  static adjustKellyForRiskAndConsensus(
    rawKelly: number,
    compositeRiskScore: number | null,
    consensusAlignmentRatio: number, // 0-1, how many analysts agreed with the direction
  ): number {
    let adjusted = rawKelly;
    if (compositeRiskScore != null) {
      const risk = Math.min(100, Math.max(0, compositeRiskScore));
      adjusted = adjusted * (1 - risk / 200); // risk=0 → ×1.0, risk=100 → ×0.5
    }
    if (consensusAlignmentRatio < 0.6) {
      adjusted = adjusted * 0.5;
    }
    return adjusted;
  }

  /**
   * Apply sane bounds: cap at MAX_POSITION_PERCENT, and if below
   * MIN_KELLY_THRESHOLD treat as HOLD (caller decides).
   */
  static clampPositionPercent(fraction: number): number {
    return Math.min(TradeRecommendationService.MAX_POSITION_PERCENT, Math.max(0, fraction));
  }

  /**
   * Compute stop-loss price given entry and direction.
   */
  static computeStopLoss(entryPrice: number, action: TradeAction): number | null {
    if (entryPrice <= 0) return null;
    if (action === 'buy') return Number((entryPrice * (1 - TradeRecommendationService.DEFAULT_STOP_LOSS_PCT)).toFixed(2));
    if (action === 'sell') return Number((entryPrice * (1 + TradeRecommendationService.DEFAULT_STOP_LOSS_PCT)).toFixed(2));
    return null;
  }

  static computeTakeProfit(entryPrice: number, action: TradeAction): number | null {
    if (entryPrice <= 0) return null;
    if (action === 'buy') return Number((entryPrice * (1 + TradeRecommendationService.DEFAULT_TAKE_PROFIT_PCT)).toFixed(2));
    if (action === 'sell') return Number((entryPrice * (1 - TradeRecommendationService.DEFAULT_TAKE_PROFIT_PCT)).toFixed(2));
    return null;
  }

  /**
   * Pure end-to-end recommendation computation. No I/O.
   * Returns the structural fields (action, sizes, prices, rationale).
   */
  computeRecommendation(input: {
    arbitratorDirection: 'up' | 'down' | 'flat';
    arbitratorConfidence: number; // 0-100
    compositeRiskScore: number | null;
    consensusBullishCount: number;
    consensusBearishCount: number;
    consensusTotal: number;
    portfolioBalance: number;
    entryPrice: number;
    calibrationAccuracy: number;
  }): {
    action: TradeAction;
    positionPercent: number;
    kellyFractionRaw: number;
    kellyFractionApplied: number;
    quantity: number;
    entryPrice: number;
    stopLoss: number | null;
    takeProfit: number | null;
    calibrationAdjustedConfidence: number;
    rationale: string;
  } {
    const action = TradeRecommendationService.directionToAction(input.arbitratorDirection);

    // Probability and raw Kelly
    const adjP = TradeRecommendationService.calibrationAdjustedProbability(
      input.arbitratorConfidence,
      input.calibrationAccuracy,
    );
    const rawKelly = TradeRecommendationService.kellyFraction(adjP);

    // Consensus alignment with the action's direction
    const aligned =
      action === 'buy'
        ? input.consensusBullishCount
        : action === 'sell'
        ? input.consensusBearishCount
        : 0;
    const alignmentRatio = input.consensusTotal > 0 ? aligned / input.consensusTotal : 0;

    const adjustedKelly = TradeRecommendationService.adjustKellyForRiskAndConsensus(
      rawKelly,
      input.compositeRiskScore,
      alignmentRatio,
    );

    const clampedPercent = TradeRecommendationService.clampPositionPercent(adjustedKelly);

    // If the arbitrator is flat, OR Kelly drops below threshold, force HOLD
    let finalAction: TradeAction = action;
    let finalPercent = clampedPercent;
    if (action === 'hold' || clampedPercent < TradeRecommendationService.MIN_KELLY_THRESHOLD) {
      finalAction = 'hold';
      finalPercent = 0;
    }

    // Quantity (shares)
    const quantity =
      finalAction === 'hold' || input.entryPrice <= 0
        ? 0
        : Math.max(0, Math.floor((input.portfolioBalance * finalPercent) / input.entryPrice));

    const stopLoss = TradeRecommendationService.computeStopLoss(input.entryPrice, finalAction);
    const takeProfit = TradeRecommendationService.computeTakeProfit(input.entryPrice, finalAction);

    const rationale = this.buildRationale({
      action: finalAction,
      adjustedProbability: adjP,
      rawKelly,
      adjustedKelly,
      finalPercent,
      compositeRiskScore: input.compositeRiskScore,
      alignmentRatio,
      consensusBullish: input.consensusBullishCount,
      consensusBearish: input.consensusBearishCount,
      consensusTotal: input.consensusTotal,
      calibrationAccuracy: input.calibrationAccuracy,
    });

    return {
      action: finalAction,
      positionPercent: finalPercent,
      kellyFractionRaw: rawKelly,
      kellyFractionApplied: adjustedKelly,
      quantity,
      entryPrice: input.entryPrice,
      stopLoss,
      takeProfit,
      calibrationAdjustedConfidence: adjP * 100,
      rationale,
    };
  }

  private buildRationale(input: {
    action: TradeAction;
    adjustedProbability: number;
    rawKelly: number;
    adjustedKelly: number;
    finalPercent: number;
    compositeRiskScore: number | null;
    alignmentRatio: number;
    consensusBullish: number;
    consensusBearish: number;
    consensusTotal: number;
    calibrationAccuracy: number;
  }): string {
    const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
    const lines: string[] = [];
    lines.push(`Action: ${input.action.toUpperCase()}.`);
    lines.push(
      `Calibration-adjusted probability: ${pct(input.adjustedProbability)} (raw arbitrator confidence × calibration accuracy ${pct(input.calibrationAccuracy)}).`,
    );
    lines.push(`Raw Kelly fraction: ${pct(input.rawKelly)}.`);
    if (input.compositeRiskScore != null) {
      lines.push(`Composite risk score: ${input.compositeRiskScore.toFixed(0)}/100 → risk-adjusted Kelly: ${pct(input.adjustedKelly)}.`);
    }
    lines.push(
      `Analyst consensus: ${input.consensusBullish} bullish / ${input.consensusBearish} bearish of ${input.consensusTotal} total (alignment with ${input.action}: ${pct(input.alignmentRatio)}).`,
    );
    lines.push(`Final position: ${pct(input.finalPercent)} of portfolio (capped at ${pct(TradeRecommendationService.MAX_POSITION_PERCENT)}).`);
    if (input.action === 'hold') {
      lines.push(`Hold reason: Kelly below ${pct(TradeRecommendationService.MIN_KELLY_THRESHOLD)} or arbitrator flat.`);
    }
    return lines.join(' ');
  }

  // ─── DB I/O ─────────────────────────────────────────────────────

  private async loadRunContext(runId: string, organizationSlug: string): Promise<{
    instrumentId: string;
    symbol: string;
    direction: 'up' | 'down' | 'flat';
    confidence: number;
    compositeRiskScore: number | null;
    bullishCount: number;
    bearishCount: number;
    totalAnalysts: number;
    entryPrice: number;
  } | null> {
    // Arbitrator prediction + instrument
    const arbResult = await this.db.rawQuery(
      `select mp.instrument_id, mp.predicted_direction, mp.confidence,
              i.symbol, i.current_state
       from prediction.market_predictions mp
       join prediction.instruments i on i.id = mp.instrument_id
       where mp.run_id = $1
         and (mp.organization_slug = $2 or mp.organization_slug = '__base__')
         and mp.role = 'arbitrator'
       limit 1`,
      [runId, organizationSlug],
    );
    if (arbResult.error) return null;
    const arbRows = (arbResult.data as Array<Record<string, unknown>>) ?? [];
    if (arbRows.length === 0) return null;
    const arb = arbRows[0]!;

    // Composite risk score (most recent for this run, if any)
    const riskResult = await this.db.rawQuery(
      `select overall_score from prediction.risk_composite_scores
       where run_id = $1 order by computed_at desc limit 1`,
      [runId],
    );
    const riskRows = (riskResult.data as Array<{ overall_score: number | null }> | null) ?? [];
    const compositeRiskScore = riskRows[0]?.overall_score != null ? Number(riskRows[0]!.overall_score) : null;

    // Analyst consensus
    const consensusResult = await this.db.rawQuery(
      `select
         count(*) filter (where predicted_direction = 'up') as bullish,
         count(*) filter (where predicted_direction = 'down') as bearish,
         count(*) as total
       from prediction.market_predictions
       where run_id = $1 and role = 'analyst'`,
      [runId],
    );
    const consensusRows = (consensusResult.data as Array<{ bullish: string; bearish: string; total: string }> | null) ?? [];
    const bullishCount = Number(consensusRows[0]?.bullish ?? 0);
    const bearishCount = Number(consensusRows[0]?.bearish ?? 0);
    const totalAnalysts = Number(consensusRows[0]?.total ?? 0);

    // Entry price from instrument current_state (set by price update job)
    const currentState = (arb.current_state as Record<string, unknown> | null) ?? {};
    const entryPrice = Number(currentState.price ?? currentState.last_price ?? 0);

    return {
      instrumentId: String(arb.instrument_id),
      symbol: String(arb.symbol),
      direction: String(arb.predicted_direction) as 'up' | 'down' | 'flat',
      confidence: Number(arb.confidence),
      compositeRiskScore,
      bullishCount,
      bearishCount,
      totalAnalysts,
      entryPrice,
    };
  }

  /**
   * Compute the arbitrator's historical accuracy from resolved evaluations.
   * Falls back to DEFAULT_CALIBRATION_ACCURACY if there isn't enough history.
   */
  private async loadArbitratorCalibrationAccuracy(organizationSlug: string): Promise<number> {
    try {
      const result = await this.db.rawQuery(
        `select
           count(*) as total,
           count(*) filter (where was_correct = true) as correct
         from prediction.market_run_evaluations
         where (organization_slug = $1 or organization_slug = '__base__')`,
        [organizationSlug],
      );
      const rows = (result.data as Array<{ total: string; correct: string }> | null) ?? [];
      const total = Number(rows[0]?.total ?? 0);
      const correct = Number(rows[0]?.correct ?? 0);
      if (total >= 20) {
        return Math.min(1, Math.max(0.1, correct / total));
      }
    } catch (err) {
      this.logger.warn(`Failed to load calibration accuracy: ${(err as Error).message}`);
    }
    return TradeRecommendationService.DEFAULT_CALIBRATION_ACCURACY;
  }

  private async checkCalibratingStatus(organizationSlug: string): Promise<boolean> {
    const result = await this.db.rawQuery(
      `select count(*) as total from prediction.market_run_evaluations
       where (organization_slug = $1 or organization_slug = '__base__')`,
      [organizationSlug],
    );
    const rows = (result.data as Array<{ total: string }> | null) ?? [];
    const total = Number(rows[0]?.total ?? 0);
    return total < TradeRecommendationService.CALIBRATING_THRESHOLD;
  }

  private async persist(input: {
    runId: string;
    organizationSlug: string;
    instrumentId: string;
    symbol: string;
    arbitratorDirection: 'up' | 'down' | 'flat';
    arbitratorConfidence: number;
    compositeRiskScore: number | null;
    bullishCount: number;
    bearishCount: number;
    totalAnalysts: number;
    entryPrice: number;
    isCalibrating: boolean;
    computed: ReturnType<TradeRecommendationService['computeRecommendation']>;
  }): Promise<TradeRecommendation> {
    const id = `pm_${input.runId}`;
    const tradeMetadata = {
      action: input.computed.action,
      position_percent: input.computed.positionPercent,
      kelly_fraction_raw: input.computed.kellyFractionRaw,
      kelly_fraction_applied: input.computed.kellyFractionApplied,
      quantity: input.computed.quantity,
      entry_price: input.computed.entryPrice,
      stop_loss: input.computed.stopLoss,
      take_profit: input.computed.takeProfit,
      calibration_adjusted_confidence: input.computed.calibrationAdjustedConfidence,
      composite_risk_score: input.compositeRiskScore,
      consensus_bullish: input.bullishCount,
      consensus_bearish: input.bearishCount,
      consensus_total: input.totalAnalysts,
      is_calibrating: input.isCalibrating,
    };

    // Persist with role='portfolio_manager'. predicted_direction passes through
    // the arbitrator's direction (CHECK constraint allows up/down/flat only).
    const sql = `
      insert into prediction.market_predictions (
        id, run_id, organization_slug, instrument_id,
        predicted_direction, confidence, horizon_minutes, rationale,
        analyst_id, role, trade_metadata, created_at
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'portfolio_manager', $10::jsonb, now())
      on conflict do nothing
    `;
    await this.db.rawQuery(sql, [
      id,
      input.runId,
      input.organizationSlug,
      input.instrumentId,
      input.arbitratorDirection,
      input.arbitratorConfidence,
      240,
      input.computed.rationale,
      'pm-base-portfolio-manager',
      JSON.stringify(tradeMetadata),
    ]);

    return {
      id,
      run_id: input.runId,
      organization_slug: input.organizationSlug,
      instrument_id: input.instrumentId,
      symbol: input.symbol,
      action: input.computed.action,
      position_percent: input.computed.positionPercent,
      kelly_fraction_raw: input.computed.kellyFractionRaw,
      kelly_fraction_applied: input.computed.kellyFractionApplied,
      quantity: input.computed.quantity,
      entry_price: input.computed.entryPrice,
      stop_loss: input.computed.stopLoss,
      take_profit: input.computed.takeProfit,
      arbitrator_direction: input.arbitratorDirection,
      arbitrator_confidence: input.arbitratorConfidence,
      calibration_adjusted_confidence: input.computed.calibrationAdjustedConfidence,
      composite_risk_score: input.compositeRiskScore,
      consensus_bullish_count: input.bullishCount,
      consensus_bearish_count: input.bearishCount,
      consensus_total: input.totalAnalysts,
      is_calibrating: input.isCalibrating,
      rationale: input.computed.rationale,
      created_at: new Date().toISOString(),
    };
  }

  private rowToRecommendation(row: Record<string, unknown>): TradeRecommendation {
    const meta = (row.trade_metadata as Record<string, unknown> | null) ?? {};
    return {
      id: String(row.id),
      run_id: String(row.run_id),
      organization_slug: String(row.organization_slug),
      instrument_id: String(row.instrument_id),
      symbol: String(row.symbol ?? ''),
      action: String(meta.action ?? 'hold') as TradeAction,
      position_percent: Number(meta.position_percent ?? 0),
      kelly_fraction_raw: Number(meta.kelly_fraction_raw ?? 0),
      kelly_fraction_applied: Number(meta.kelly_fraction_applied ?? 0),
      quantity: Number(meta.quantity ?? 0),
      entry_price: Number(meta.entry_price ?? 0),
      stop_loss: meta.stop_loss != null ? Number(meta.stop_loss) : null,
      take_profit: meta.take_profit != null ? Number(meta.take_profit) : null,
      arbitrator_direction: String(row.predicted_direction) as 'up' | 'down' | 'flat',
      arbitrator_confidence: Number(row.confidence),
      calibration_adjusted_confidence: Number(meta.calibration_adjusted_confidence ?? 0),
      composite_risk_score: meta.composite_risk_score != null ? Number(meta.composite_risk_score) : null,
      consensus_bullish_count: Number(meta.consensus_bullish ?? 0),
      consensus_bearish_count: Number(meta.consensus_bearish ?? 0),
      consensus_total: Number(meta.consensus_total ?? 0),
      is_calibrating: Boolean(meta.is_calibrating),
      rationale: String(row.rationale ?? ''),
      created_at: String(row.created_at ?? ''),
    };
  }
}
