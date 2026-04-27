import { Injectable, Inject, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { MarketsSchemaService } from '../schema/markets-schema.service';
import { NotificationService } from './notification.service';
import type { FearGreedAlert } from '../markets.types';

const CONFIDENCE_THRESHOLD = 0.7;
const MAX_UNREAD_ALERTS = 5;

@Injectable()
export class FearGreedAlertService {
  private readonly logger = new Logger(FearGreedAlertService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(MarketsSchemaService) private readonly schema: MarketsSchemaService,
    @Inject(NotificationService) private readonly notifications: NotificationService,
  ) {}

  /**
   * Evaluate all predictors scored in the last 10 minutes for fear/greed triggers.
   * Called by the analyst pipeline after the predictor-scoring step.
   */
  async evaluateRecentPredictors(): Promise<number> {
    await this.schema.ensureSchema();
    const result = await this.db.rawQuery(
      `select id from prediction.market_predictors
       where crowd_reaction in ('fear_trigger', 'greed_trigger')
         and crowd_reaction_confidence >= $1
         and updated_at >= now() - interval '10 minutes'`,
      [CONFIDENCE_THRESHOLD],
    );
    const rows = (result.data as Array<{ id: string }> | null) ?? [];
    if (rows.length === 0) return 0;
    return this.evaluatePredictors(rows.map(r => r.id));
  }

  /**
   * Evaluate specific predictors for fear/greed triggers and generate
   * alerts for affected users.
   */
  async evaluatePredictors(predictorIds: string[]): Promise<number> {
    if (predictorIds.length === 0) return 0;

    await this.schema.ensureSchema();

    // Find sentiment-analyst predictors with crowd_reaction triggers above threshold
    const placeholders = predictorIds.map((_, i) => `$${i + 1}`).join(', ');
    const thresholdParam = `$${predictorIds.length + 1}`;
    const result = await this.db.rawQuery(
      `select mp.id as predictor_id, mp.instrument_id, mp.crowd_reaction,
              mp.crowd_reaction_confidence, mp.crowd_reaction_rationale,
              mp.estimated_reaction_window_minutes,
              i.symbol, i.name as instrument_name
       from prediction.market_predictors mp
       join prediction.instruments i on i.id = mp.instrument_id
       where mp.id in (${placeholders})
         and mp.crowd_reaction in ('fear_trigger', 'greed_trigger')
         and mp.crowd_reaction_confidence >= ${thresholdParam}`,
      [...predictorIds, CONFIDENCE_THRESHOLD],
    );

    if (result.error) {
      this.logger.error(`Failed to query predictors: ${result.error.message}`);
      return 0;
    }

    const triggers = (result.data as Array<{
      predictor_id: string;
      instrument_id: string;
      crowd_reaction: 'fear_trigger' | 'greed_trigger';
      crowd_reaction_confidence: number;
      crowd_reaction_rationale: string | null;
      estimated_reaction_window_minutes: number | null;
      symbol: string;
      instrument_name: string;
    }> | null) ?? [];

    let alertCount = 0;
    for (const trigger of triggers) {
      alertCount += await this.generateAlertsForTrigger(trigger);
    }

    if (alertCount > 0) {
      this.logger.log(`Generated ${alertCount} fear/greed alerts from ${triggers.length} triggers`);
    }

    return alertCount;
  }

  private async generateAlertsForTrigger(trigger: {
    predictor_id: string;
    instrument_id: string;
    crowd_reaction: 'fear_trigger' | 'greed_trigger';
    crowd_reaction_confidence: number;
    crowd_reaction_rationale: string | null;
    estimated_reaction_window_minutes: number | null;
    symbol: string;
    instrument_name: string;
  }): Promise<number> {
    // Find users who hold or watch this instrument
    const usersResult = await this.db.rawQuery(
      `select distinct user_id from prediction.user_positions
       where instrument_id = $1 and status = 'open'
       union
       select distinct user_id from prediction.user_trade_queue
       where instrument_id = $1 and status = 'queued'`,
      [trigger.instrument_id],
    );
    const users = (usersResult.data as Array<{ user_id: string }> | null) ?? [];
    if (users.length === 0) {
      // Fallback: alert all users with portfolios (capped to prevent alert explosion)
      const allResult = await this.db.rawQuery(
        `select distinct user_id from prediction.user_portfolios limit 50`,
      );
      const allUsers = (allResult.data as Array<{ user_id: string }> | null) ?? [];
      users.push(...allUsers);
    }

    // Look up latest trade recommendation for this instrument
    const tradeRec = await this.fetchLatestTradeRec(trigger.instrument_id);

    let alertCount = 0;
    for (const { user_id } of users) {
      const created = await this.createAlertForUser(user_id, trigger, tradeRec);
      if (created) alertCount++;
    }
    return alertCount;
  }

  private async createAlertForUser(
    userId: string,
    trigger: {
      predictor_id: string;
      instrument_id: string;
      crowd_reaction: 'fear_trigger' | 'greed_trigger';
      crowd_reaction_confidence: number;
      estimated_reaction_window_minutes: number | null;
      symbol: string;
    },
    tradeRec: { action: string; entry_price: number; stop_loss: number | null; take_profit: number | null } | null,
  ): Promise<boolean> {
    // Check idempotency: no existing alert for same predictor + user
    const existingResult = await this.db.rawQuery(
      `select 1 from prediction.fear_greed_alerts
       where predictor_id = $1 and user_id = $2 limit 1`,
      [trigger.predictor_id, userId],
    );
    const existing = (existingResult.data as unknown[] | null) ?? [];
    if (existing.length > 0) return false;

    // Check alert cap: max unread alerts per user
    const countResult = await this.db.rawQuery(
      `select count(*) as cnt from prediction.fear_greed_alerts
       where user_id = $1 and is_read = false`,
      [userId],
    );
    const count = parseInt(
      ((countResult.data as Array<{ cnt: string }> | null) ?? [])[0]?.cnt ?? '0',
      10,
    );
    if (count >= MAX_UNREAD_ALERTS) return false;

    const id = randomUUID();
    const isFear = trigger.crowd_reaction === 'fear_trigger';
    const reactionLabel = isFear ? 'fear selling' : 'greed buying';
    const actionLabel = tradeRec
      ? `Sentiment Analyst signals ${tradeRec.action}ing ${trigger.symbol}`
      : `Analysis pending for ${trigger.symbol}`;
    const windowLabel = trigger.estimated_reaction_window_minutes
      ? ` — act within ~${trigger.estimated_reaction_window_minutes} min`
      : '';

    const title = `${isFear ? 'FEAR' : 'GREED'} ALERT: ${trigger.symbol} — ${reactionLabel} signal`;
    const summary = `${actionLabel}${windowLabel}`;

    // Push notification — continue with null ID if notification fails
    let notificationId: string | null = null;
    try {
      notificationId = await this.notifications.notify(userId, {
        event_type: 'fear_greed_alert',
        urgency: 'immediate',
        title,
        summary,
        link_to: `/markets/instruments/${trigger.instrument_id}`,
      });
    } catch (err) {
      this.logger.warn(`Notification push failed for fear/greed alert: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Insert the fear/greed alert row
    const insertResult = await this.db.rawQuery(
      `insert into prediction.fear_greed_alerts
        (id, user_id, predictor_id, instrument_id, symbol, crowd_reaction,
         crowd_reaction_confidence, estimated_reaction_window_minutes,
         trade_action, entry_price, stop_loss, take_profit, notification_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       on conflict (predictor_id, user_id) do nothing`,
      [
        id, userId, trigger.predictor_id, trigger.instrument_id, trigger.symbol,
        trigger.crowd_reaction, trigger.crowd_reaction_confidence,
        trigger.estimated_reaction_window_minutes,
        tradeRec?.action ?? null, tradeRec?.entry_price ?? null,
        tradeRec?.stop_loss ?? null, tradeRec?.take_profit ?? null,
        notificationId,
      ],
    );

    if (insertResult.error) {
      this.logger.error(`Failed to insert fear/greed alert: ${insertResult.error.message}`);
      return false;
    }

    return true;
  }

  private async fetchLatestTradeRec(instrumentId: string): Promise<{
    action: string; entry_price: number; stop_loss: number | null; take_profit: number | null;
  } | null> {
    const result = await this.db.rawQuery(
      `select mp.direction as action, mp.entry_price,
              mp.stop_loss_price as stop_loss, mp.take_profit_price as take_profit
       from prediction.market_predictions mp
       join prediction.orchestration_runs r on r.id = mp.run_id
       where r.instrument_id = $1
         and mp.role = 'portfolio_manager'
         and r.status = 'completed'
       order by mp.created_at desc
       limit 1`,
      [instrumentId],
    );
    const rows = (result.data as Array<{
      action: string; entry_price: number; stop_loss: number | null; take_profit: number | null;
    }> | null) ?? [];
    return rows[0] ?? null;
  }

  // ─── Read API ─────────────────────────────────────────────────

  async getAlerts(userId: string, unreadOnly = false): Promise<FearGreedAlert[]> {
    const whereClause = unreadOnly
      ? 'where user_id = $1 and is_read = false'
      : 'where user_id = $1';
    const result = await this.db.rawQuery(
      `select * from prediction.fear_greed_alerts
       ${whereClause}
       order by created_at desc
       limit 100`,
      [userId],
    );
    if (result.error) throw new Error(result.error.message);
    return (result.data as FearGreedAlert[] | null) ?? [];
  }

  async getUnreadCount(userId: string): Promise<number> {
    const result = await this.db.rawQuery(
      `select count(*) as cnt from prediction.fear_greed_alerts
       where user_id = $1 and is_read = false`,
      [userId],
    );
    if (result.error) throw new Error(result.error.message);
    const rows = (result.data as Array<{ cnt: string }> | null) ?? [];
    return parseInt(rows[0]?.cnt ?? '0', 10);
  }

  async markRead(id: string, userId: string): Promise<void> {
    await this.schema.ensureSchema();
    await this.db.rawQuery(
      `update prediction.fear_greed_alerts
       set is_read = true
       where id = $1 and user_id = $2`,
      [id, userId],
    );
  }

  async markAllRead(userId: string): Promise<void> {
    await this.schema.ensureSchema();
    await this.db.rawQuery(
      `update prediction.fear_greed_alerts
       set is_read = true
       where user_id = $1 and is_read = false`,
      [userId],
    );
  }
}
