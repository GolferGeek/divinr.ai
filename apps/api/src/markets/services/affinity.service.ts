import { Injectable, Inject, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { MarketsSchemaService } from '../schema/markets-schema.service';
import { NotificationService } from './notification.service';
import type { AffinitySignalType, ContrarianAlert, UserAnalystAffinity } from '../markets.types';

/** Signal weights by type — trade signals strongest, browse weakest. */
const SIGNAL_WEIGHTS: Record<AffinitySignalType, number> = {
  buy_agreement: 1.0,
  sell_agreement: 1.0,
  skip_disagreement: 1.0,
  challenge_accept: 0.8,
  challenge_reject: 0.8,
  browse_interest: 0.2,
};

/** Half-life for exponential decay in days. */
const DECAY_HALF_LIFE_DAYS = 30;

/** Default affinity when no signals exist. */
const DEFAULT_AFFINITY = 0.5;

/**
 * Manages user-analyst affinity: signal recording, score recomputation,
 * nightly decay, and contrarian alert generation.
 */
@Injectable()
export class AffinityService {
  private readonly logger = new Logger(AffinityService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(MarketsSchemaService) private readonly schema: MarketsSchemaService,
    @Inject(NotificationService) private readonly notifications: NotificationService,
  ) {}

  /**
   * Record a behavioral signal and recompute the affinity score.
   */
  async recordSignal(
    userId: string,
    analystId: string,
    signalType: AffinitySignalType,
    predictionId?: string,
    instrumentId?: string,
  ): Promise<void> {
    await this.schema.ensureSchema();

    const weight = SIGNAL_WEIGHTS[signalType];
    const id = randomUUID();

    await this.db.rawQuery(
      `insert into prediction.user_affinity_signals
        (id, user_id, analyst_id, signal_type, prediction_id, instrument_id, weight)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [id, userId, analystId, signalType, predictionId ?? null, instrumentId ?? null, weight],
    );

    await this.recomputeAffinity(userId, analystId);
  }

  /**
   * Recompute affinity score for a user+analyst pair from the signal history.
   * Uses exponential decay with a 30-day half-life so recent signals matter more.
   */
  async recomputeAffinity(userId: string, analystId: string): Promise<number> {
    await this.schema.ensureSchema();

    // Fetch all signals for this pair
    const result = await this.db.rawQuery(
      `select signal_type, weight, created_at
       from prediction.user_affinity_signals
       where user_id = $1 and analyst_id = $2
       order by created_at desc`,
      [userId, analystId],
    );
    const signals = (result.data as Array<{ signal_type: string; weight: number; created_at: string }> | null) ?? [];

    if (signals.length === 0) {
      // No signals → default
      await this.upsertAffinity(userId, analystId, DEFAULT_AFFINITY, {
        signal_count: 0,
        buy_agreement: 0,
        skip_disagreement: 0,
        challenge_accept: 0,
        challenge_reject: 0,
        browse_signals: 0,
      });
      return DEFAULT_AFFINITY;
    }

    const now = Date.now();
    let positiveWeighted = 0;
    let negativeWeighted = 0;

    const counters = {
      signal_count: signals.length,
      buy_agreement: 0,
      skip_disagreement: 0,
      challenge_accept: 0,
      challenge_reject: 0,
      browse_signals: 0,
    };

    for (const sig of signals) {
      const ageMs = now - new Date(sig.created_at).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      const decayFactor = Math.pow(0.5, ageDays / DECAY_HALF_LIFE_DAYS);
      const effectiveWeight = Number(sig.weight) * decayFactor;

      // Count by type
      switch (sig.signal_type) {
        case 'buy_agreement':
        case 'sell_agreement':
          counters.buy_agreement += sig.signal_type === 'buy_agreement' ? 1 : 0;
          positiveWeighted += effectiveWeight;
          break;
        case 'challenge_accept':
          counters.challenge_accept++;
          positiveWeighted += effectiveWeight;
          break;
        case 'browse_interest':
          counters.browse_signals++;
          positiveWeighted += effectiveWeight * 0.5; // mild positive
          break;
        case 'skip_disagreement':
          counters.skip_disagreement++;
          negativeWeighted += effectiveWeight;
          break;
        case 'challenge_reject':
          counters.challenge_reject++;
          negativeWeighted += effectiveWeight;
          break;
      }
    }

    // sell_agreement also counts as buy_agreement bucket for the counter
    for (const sig of signals) {
      if (sig.signal_type === 'sell_agreement') counters.buy_agreement++;
    }

    // Compute score: ratio of positive to total, scaled to 0–1
    // With a baseline pull toward 0.5 to prevent wild swings on few signals
    const rawRatio = (positiveWeighted + negativeWeighted) > 0
      ? positiveWeighted / (positiveWeighted + negativeWeighted)
      : DEFAULT_AFFINITY;
    const bayesianWeight = Math.min(signals.length / 10, 1); // reaches full weight at 10 signals
    const score = DEFAULT_AFFINITY * (1 - bayesianWeight) + rawRatio * bayesianWeight;
    const clampedScore = Math.max(0, Math.min(1, score));

    await this.upsertAffinity(userId, analystId, clampedScore, counters);
    return clampedScore;
  }

  /**
   * Get the full affinity profile for a user — all analyst affinities sorted by score.
   */
  async getUserAffinityProfile(userId: string): Promise<Array<UserAnalystAffinity & { display_name: string; slug: string }>> {
    const result = await this.db.rawQuery(
      `select a.*, ma.display_name, ma.slug
       from prediction.user_analyst_affinity a
       join prediction.market_analysts ma on ma.id = a.analyst_id
       where a.user_id = $1
       order by a.affinity_score desc`,
      [userId],
    );
    return (result.data as Array<UserAnalystAffinity & { display_name: string; slug: string }> | null) ?? [];
  }

  // ─── Contrarian Alerts ─────────────────────────────────────

  /**
   * Compute the user's affinity-weighted consensus direction for a prediction run.
   * Returns the weighted direction and per-analyst breakdown.
   */
  async getAffinityWeightedConsensus(
    userId: string,
    runId: string,
  ): Promise<{
    direction: 'up' | 'down' | 'flat';
    score: number;
    analysts: Array<{ analyst_id: string; direction: string; confidence: number; affinity: number }>;
  }> {
    await this.schema.ensureSchema();

    // Load all analyst predictions for this run
    const predResult = await this.db.rawQuery(
      `select analyst_id, predicted_direction, confidence
       from prediction.market_predictions
       where run_id = $1 and role = 'analyst' and analyst_id is not null`,
      [runId],
    );
    const preds = (predResult.data as Array<{ analyst_id: string; predicted_direction: string; confidence: number }> | null) ?? [];
    if (preds.length === 0) return { direction: 'flat', score: 0, analysts: [] };

    // Load user's affinities
    const affinityResult = await this.db.rawQuery(
      `select analyst_id, affinity_score from prediction.user_analyst_affinity
       where user_id = $1`,
      [userId],
    );
    const affinities = new Map<string, number>();
    for (const row of ((affinityResult.data as Array<{ analyst_id: string; affinity_score: number }> | null) ?? [])) {
      affinities.set(row.analyst_id, Number(row.affinity_score));
    }

    // Compute weighted consensus
    let weightedSum = 0;
    let totalWeight = 0;
    const breakdown: Array<{ analyst_id: string; direction: string; confidence: number; affinity: number }> = [];

    for (const p of preds) {
      const affinity = affinities.get(p.analyst_id) ?? DEFAULT_AFFINITY;
      const directionValue = p.predicted_direction === 'up' ? 1 : p.predicted_direction === 'down' ? -1 : 0;
      weightedSum += directionValue * affinity * Number(p.confidence);
      totalWeight += affinity * Number(p.confidence);
      breakdown.push({ analyst_id: p.analyst_id, direction: p.predicted_direction, confidence: Number(p.confidence), affinity });
    }

    const normalizedScore = totalWeight > 0 ? weightedSum / totalWeight : 0;
    const direction: 'up' | 'down' | 'flat' =
      normalizedScore > 0.1 ? 'up' : normalizedScore < -0.1 ? 'down' : 'flat';

    return { direction, score: normalizedScore, analysts: breakdown };
  }

  /**
   * Generate contrarian alerts for a user when a low-affinity analyst
   * disagrees with the weighted consensus at high confidence.
   */
  async generateContrarianAlerts(userId: string, runId: string): Promise<number> {
    await this.schema.ensureSchema();

    // Check unread alert cap (max 3)
    const unreadResult = await this.db.rawQuery(
      `select count(*) as cnt from prediction.user_contrarian_alerts
       where user_id = $1 and is_read = false`,
      [userId],
    );
    const unreadCount = Number(((unreadResult.data as Array<{ cnt: number }>) ?? [])[0]?.cnt ?? 0);
    if (unreadCount >= 3) return 0;

    const consensus = await this.getAffinityWeightedConsensus(userId, runId);
    if (consensus.direction === 'flat') return 0;

    let alertsCreated = 0;
    const maxNew = 3 - unreadCount;

    for (const analyst of consensus.analysts) {
      if (alertsCreated >= maxNew) break;

      // Only low-affinity analysts (< 0.5) with high confidence (≥ 80) that disagree
      if (analyst.affinity >= 0.5) continue;
      if (analyst.confidence < 80) continue;
      if (analyst.direction === consensus.direction) continue;
      if (analyst.direction === 'flat') continue;

      // Get the prediction details for rationale
      const predDetail = await this.db.rawQuery(
        `select mp.id, mp.rationale, mp.instrument_id, i.symbol
         from prediction.market_predictions mp
         join prediction.instruments i on i.id = mp.instrument_id
         where mp.run_id = $1 and mp.analyst_id = $2 and mp.role = 'analyst'
         limit 1`,
        [runId, analyst.analyst_id],
      );
      const pred = ((predDetail.data as Array<Record<string, unknown>> | null) ?? [])[0];
      if (!pred) continue;

      const id = randomUUID();
      await this.db.rawQuery(
        `insert into prediction.user_contrarian_alerts
          (id, user_id, analyst_id, prediction_id, instrument_id, symbol,
           user_weighted_direction, contrarian_direction, contrarian_confidence,
           affinity_score_at_alert, rationale)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          id, userId, analyst.analyst_id, String(pred.id), String(pred.instrument_id),
          String(pred.symbol), consensus.direction, analyst.direction,
          analyst.confidence, analyst.affinity,
          String(pred.rationale ?? 'No rationale provided'),
        ],
      );

      await this.notifications.notify(userId, {
        event_type: 'contrarian_alert',
        urgency: 'actionable',
        title: `Contrarian alert: ${String(pred.symbol)} (${analyst.direction})`,
        summary: `Analyst disagrees with consensus (${consensus.direction}), confidence ${analyst.confidence}%`,
        link_to: '/affinity',
      }).catch(err => this.logger.warn(`Notification failed: ${err}`));

      alertsCreated++;
    }

    if (alertsCreated > 0) {
      this.logger.log(`Generated ${alertsCreated} contrarian alerts for user ${userId}`);
    }
    return alertsCreated;
  }

  /**
   * Get contrarian alerts for a user.
   */
  async getContrarianAlerts(userId: string, unreadOnly = false): Promise<ContrarianAlert[]> {
    const whereClause = unreadOnly
      ? `where a.user_id = $1 and a.is_read = false`
      : `where a.user_id = $1`;

    const result = await this.db.rawQuery(
      `select a.*, ma.display_name as analyst_name, ma.slug as analyst_slug
       from prediction.user_contrarian_alerts a
       join prediction.market_analysts ma on ma.id = a.analyst_id
       ${whereClause}
       order by a.created_at desc
       limit 20`,
      [userId],
    );
    return (result.data as ContrarianAlert[] | null) ?? [];
  }

  /**
   * Mark a contrarian alert as read.
   */
  async markAlertRead(alertId: string, userId: string): Promise<void> {
    await this.schema.ensureSchema();
    await this.db.rawQuery(
      `update prediction.user_contrarian_alerts
       set is_read = true
       where id = $1 and user_id = $2`,
      [alertId, userId],
    );
  }

  // ─── Nightly Decay & Normalization ─────────────────────────

  /**
   * Decay signals and recompute affinities for a single user (or all users if null).
   * - Prunes signals older than 90 days
   * - Recomputes all affected affinity scores (decay is implicit in recompute)
   * - Normalizes scores if they cluster within 0.1 range
   */
  async decayAndNormalize(userId?: string): Promise<void> {
    await this.schema.ensureSchema();

    // Prune old signals (> 90 days)
    const pruneCondition = userId
      ? `where user_id = $1 and created_at < now() - interval '90 days'`
      : `where created_at < now() - interval '90 days'`;
    const pruneParams = userId ? [userId] : [];
    await this.db.rawQuery(
      `delete from prediction.user_affinity_signals ${pruneCondition}`,
      pruneParams,
    );

    // Find all affected user+analyst pairs
    const pairCondition = userId ? `where user_id = $1` : '';
    const pairParams = userId ? [userId] : [];
    const pairResult = await this.db.rawQuery(
      `select distinct user_id, analyst_id from prediction.user_affinity_signals ${pairCondition}`,
      pairParams,
    );
    const pairs = (pairResult.data as Array<{ user_id: string; analyst_id: string }> | null) ?? [];

    // Recompute each pair (decay is embedded in recomputeAffinity)
    for (const pair of pairs) {
      await this.recomputeAffinity(pair.user_id, pair.analyst_id);
    }

    // Clean up affinity rows that no longer have signals
    const staleCondition = userId
      ? `where user_id = $1 and not exists (
           select 1 from prediction.user_affinity_signals s
           where s.user_id = a.user_id and s.analyst_id = a.analyst_id
         )`
      : `where not exists (
           select 1 from prediction.user_affinity_signals s
           where s.user_id = a.user_id and s.analyst_id = a.analyst_id
         )`;
    const staleParams = userId ? [userId] : [];
    await this.db.rawQuery(
      `delete from prediction.user_analyst_affinity a ${staleCondition}`,
      staleParams,
    );

    // Normalize per user: if scores cluster within 0.1 range, spread them
    const userIds = userId
      ? [userId]
      : [...new Set(pairs.map(p => p.user_id))];

    for (const uid of userIds) {
      await this.normalizeUserScores(uid);
    }
  }

  /**
   * Run decay/normalization for all users with affinity data.
   * Called by the nightly evaluation pipeline.
   */
  async decayAllAffinities(): Promise<number> {
    await this.schema.ensureSchema();

    const result = await this.db.rawQuery(
      `select distinct user_id from prediction.user_affinity_signals`,
    );
    const users = (result.data as Array<{ user_id: string }> | null) ?? [];

    for (const u of users) {
      try {
        await this.decayAndNormalize(u.user_id);
      } catch (err) {
        this.logger.warn(`Affinity decay failed for user ${u.user_id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    this.logger.log(`Affinity decay complete for ${users.length} users`);
    return users.length;
  }

  /**
   * Spread scores when they cluster too tightly.
   * If max - min < 0.1 and there are 2+ analysts, linearly scale to use [0.2, 0.8] range.
   */
  private async normalizeUserScores(userId: string): Promise<void> {
    const result = await this.db.rawQuery(
      `select analyst_id, affinity_score from prediction.user_analyst_affinity
       where user_id = $1`,
      [userId],
    );
    const rows = (result.data as Array<{ analyst_id: string; affinity_score: number }> | null) ?? [];
    if (rows.length < 2) return;

    const scores = rows.map(r => Number(r.affinity_score));
    const min = Math.min(...scores);
    const max = Math.max(...scores);

    if (max - min >= 0.1) return; // Already spread enough

    // Linearly scale to [0.2, 0.8]
    const targetMin = 0.2;
    const targetMax = 0.8;
    const range = max - min || 1; // avoid division by zero

    for (const row of rows) {
      const normalized = targetMin + ((Number(row.affinity_score) - min) / range) * (targetMax - targetMin);
      await this.db.rawQuery(
        `update prediction.user_analyst_affinity
         set affinity_score = $1, updated_at = now()
         where user_id = $2 and analyst_id = $3`,
        [normalized, userId, row.analyst_id],
      );
    }
  }

  // ─── Internal Helpers ─────────────────────────────────────

  private async upsertAffinity(
    userId: string,
    analystId: string,
    score: number,
    counters: {
      signal_count: number;
      buy_agreement: number;
      skip_disagreement: number;
      challenge_accept: number;
      challenge_reject: number;
      browse_signals: number;
    },
  ): Promise<void> {
    const id = randomUUID();
    await this.db.rawQuery(
      `insert into prediction.user_analyst_affinity
        (id, user_id, analyst_id, affinity_score, signal_count,
         buy_agreement, skip_disagreement, challenge_accept, challenge_reject,
         browse_signals, last_signal_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), now())
       on conflict (user_id, analyst_id) do update set
         affinity_score = excluded.affinity_score,
         signal_count = excluded.signal_count,
         buy_agreement = excluded.buy_agreement,
         skip_disagreement = excluded.skip_disagreement,
         challenge_accept = excluded.challenge_accept,
         challenge_reject = excluded.challenge_reject,
         browse_signals = excluded.browse_signals,
         last_signal_at = excluded.last_signal_at,
         updated_at = now()`,
      [
        id, userId, analystId, score, counters.signal_count,
        counters.buy_agreement, counters.skip_disagreement,
        counters.challenge_accept, counters.challenge_reject,
        counters.browse_signals,
      ],
    );
  }
}

// ─── Exported constants for testing ───────────────────────────

export { SIGNAL_WEIGHTS, DECAY_HALF_LIFE_DAYS, DEFAULT_AFFINITY };
