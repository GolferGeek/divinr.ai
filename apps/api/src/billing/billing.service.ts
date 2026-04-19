import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { BillingSchemaService } from './billing-schema.service';

export type SubscriptionStatus = 'trial' | 'active' | 'past_due' | 'canceled' | 'dormant';
export type SubscriptionEventTrigger = 'system' | 'user' | 'admin' | 'stripe';

/** Shape of a billing.subscriptions row. */
export interface BillingSubscription {
  user_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  status: SubscriptionStatus;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  expired_at: string | null;
  purge_scheduled_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Shape of a billing.subscription_events row. Append-only audit log. */
export interface SubscriptionEvent {
  id: string;
  user_id: string;
  from_status: SubscriptionStatus | null;
  to_status: SubscriptionStatus;
  reason: string;
  triggered_by: SubscriptionEventTrigger;
  created_at: string;
}

/** Shape of a billing.authored_items row. */
export interface BillingAuthoredItem {
  id: string;
  user_id: string;
  item_kind: string;
  item_id: string | null;
  monthly_usd_cents: number;
  stripe_subscription_item_id: string | null;
  status: 'active' | 'canceled' | 'pending_payment';
  activated_at: string;
  canceled_at: string | null;
}

/** Shape returned by getBillingPreview. */
export interface BillingPreview {
  basicMonthlyUsd: number;
  authoredItems: Array<{
    kind: string;
    itemId: string | null;
    monthlyUsd: number;
    status: string;
  }>;
  byoPlatformFeeUsd: number;
  totalMonthlyUsd: number;
}

type ItemKind = 'custom_analyst' | 'custom_instrument' | 'analyst_contract_override' | 'instrument_contract_override' | 'byo_platform_fee';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly lifecycleLogger = new Logger('BillingLifecycleEvents');

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(BillingSchemaService) private readonly schema: BillingSchemaService,
  ) {}

  // ─── Pricing helpers ──────────────────────────────────────────

  private get basicMonthlyUsd(): number {
    return Number(process.env.BASIC_MONTHLY_USD ?? '50');
  }

  private get byoPlatformFeeUsd(): number {
    return Number(process.env.BYO_PLATFORM_FEE_USD ?? '10');
  }

  private centsForKind(kind: ItemKind): number {
    switch (kind) {
      case 'custom_analyst':
        return Number(process.env.ANALYST_AUTHORSHIP_USD ?? '60') * 100;
      case 'custom_instrument':
        return Number(process.env.INSTRUMENT_AUTHORSHIP_USD ?? '20') * 100;
      case 'analyst_contract_override':
      case 'instrument_contract_override':
        return Number(process.env.CONTRACT_OVERRIDE_USD ?? '0') * 100;
      case 'byo_platform_fee':
        return this.byoPlatformFeeUsd * 100;
      default:
        return 0;
    }
  }

  // ─── Subscription management ──────────────────────────────────

  async ensureSubscription(userId: string): Promise<BillingSubscription> {
    await this.schema.ensureSchema();
    const now = new Date().toISOString();
    const trialEnds = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const result = await this.db.rawQuery(
      `INSERT INTO billing.subscriptions (user_id, status, trial_started_at, trial_ends_at)
       VALUES ($1, 'trial', $2, $3)
       ON CONFLICT (user_id) DO NOTHING
       RETURNING *`,
      [userId, now, trialEnds],
    );
    if (result.error) throw new Error(`ensureSubscription failed: ${result.error.message}`);
    const rows = (result.data as BillingSubscription[] | null) ?? [];
    if (rows.length > 0) return rows[0];
    // Row already existed — fetch it
    return (await this.getSubscription(userId))!;
  }

  async getSubscription(userId: string): Promise<BillingSubscription | null> {
    await this.schema.ensureSchema();
    const result = await this.db.rawQuery(
      `SELECT * FROM billing.subscriptions WHERE user_id = $1`,
      [userId],
    );
    if (result.error) throw new Error(`getSubscription failed: ${result.error.message}`);
    const rows = (result.data as BillingSubscription[] | null) ?? [];
    return rows.length > 0 ? rows[0] : null;
  }

  async isSubscriptionActive(userId: string): Promise<boolean> {
    const sub = await this.getSubscription(userId);
    if (!sub) return true; // No subscription row yet = pre-billing, treat as active
    return ['trial', 'active'].includes(sub.status);
  }

  /**
   * Read-only gate. Returns true iff the user's subscription is in a terminal
   * state (canceled or dormant). `past_due` is intentionally NOT read-only —
   * see PRD Risk §7.4 (grace window owned by Stripe retry logic).
   * Missing row returns false (pre-signup / trial seeding race — real users
   * are guaranteed a row by the signup wiring + migration backfill).
   */
  async isReadOnly(userId: string): Promise<boolean> {
    const sub = await this.getSubscription(userId);
    if (!sub) return false;
    return sub.status === 'canceled' || sub.status === 'dormant';
  }

  /**
   * Append a single row to the subscription_events audit table.
   * The service exposes no update or delete path — the table is append-only.
   */
  async appendSubscriptionEvent(params: {
    userId: string;
    fromStatus: SubscriptionStatus | null;
    toStatus: SubscriptionStatus;
    reason: string;
    triggeredBy: SubscriptionEventTrigger;
  }): Promise<SubscriptionEvent> {
    await this.schema.ensureSchema();
    const result = await this.db.rawQuery(
      `INSERT INTO billing.subscription_events (user_id, from_status, to_status, reason, triggered_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [params.userId, params.fromStatus, params.toStatus, params.reason, params.triggeredBy],
    );
    if (result.error) throw new Error(`appendSubscriptionEvent failed: ${result.error.message}`);
    const rows = (result.data as SubscriptionEvent[] | null) ?? [];
    return rows[0];
  }

  /**
   * Transition a subscription to `canceled` with a purge scheduled 6 months out.
   * Idempotent at the service layer: reads prior status, flips, writes one audit row.
   * Caller is the cron (`trial_ended_no_card`) or an admin action.
   * Emits a structured log line on the `BillingLifecycleEvents` channel for future
   * event-bus wiring (real transport lands with notification-system).
   */
  async markExpired(userId: string, reason: string, triggeredBy: 'system' | 'admin'): Promise<void> {
    await this.schema.ensureSchema();
    const prior = await this.getSubscription(userId);
    if (!prior) throw new Error(`markExpired: no subscription row for user ${userId}`);
    const now = new Date().toISOString();
    const purgeAt = new Date(Date.now() + 6 * 30 * 24 * 60 * 60 * 1000).toISOString();
    const result = await this.db.rawQuery(
      `UPDATE billing.subscriptions
       SET status = 'canceled',
           expired_at = $2,
           purge_scheduled_at = $3,
           updated_at = $2
       WHERE user_id = $1`,
      [userId, now, purgeAt],
    );
    if (result.error) throw new Error(`markExpired failed: ${result.error.message}`);
    await this.appendSubscriptionEvent({
      userId,
      fromStatus: prior.status,
      toStatus: 'canceled',
      reason,
      triggeredBy,
    });
    this.lifecycleLogger.log(JSON.stringify({
      event: 'billing.subscription_lifecycle_transition',
      user_id: userId,
      from_status: prior.status,
      to_status: 'canceled',
      reason,
      triggered_by: triggeredBy,
      at: now,
    }));
  }

  // ─── Authored items ──────────────────────────────────────────

  async addAuthoredItem(userId: string, kind: ItemKind, itemId: string | null): Promise<BillingAuthoredItem> {
    await this.schema.ensureSchema();
    await this.ensureSubscription(userId);
    const cents = this.centsForKind(kind);
    const result = await this.db.rawQuery(
      `INSERT INTO billing.authored_items (user_id, item_kind, item_id, monthly_usd_cents)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [userId, kind, itemId, cents],
    );
    if (result.error) throw new Error(`addAuthoredItem failed: ${result.error.message}`);
    const rows = (result.data as BillingAuthoredItem[] | null) ?? [];
    this.logger.log(`Billing item added: ${kind} ${itemId} for user ${userId} at ${cents} cents/mo`);
    return rows[0];
  }

  async cancelAuthoredItem(userId: string, kind: ItemKind, itemId: string | null): Promise<void> {
    await this.schema.ensureSchema();
    const result = await this.db.rawQuery(
      `UPDATE billing.authored_items
       SET status = 'canceled', canceled_at = now()
       WHERE user_id = $1 AND item_kind = $2 AND item_id = $3 AND status = 'active'`,
      [userId, kind, itemId],
    );
    if (result.error) throw new Error(`cancelAuthoredItem failed: ${result.error.message}`);
    this.logger.log(`Billing item canceled: ${kind} ${itemId} for user ${userId}`);
  }

  // ─── Billing preview ─────────────────────────────────────────

  async getBillingPreview(userId: string): Promise<BillingPreview> {
    await this.schema.ensureSchema();
    const result = await this.db.rawQuery(
      `SELECT item_kind, item_id, monthly_usd_cents, status
       FROM billing.authored_items
       WHERE user_id = $1 AND status = 'active'`,
      [userId],
    );
    if (result.error) throw new Error(`getBillingPreview failed: ${result.error.message}`);
    const rows = (result.data as Array<{ item_kind: string; item_id: string | null; monthly_usd_cents: number; status: string }> | null) ?? [];

    const contentRows = rows.filter(r => r.item_kind !== 'byo_platform_fee');
    const authoredItems = contentRows.map(r => ({
      kind: r.item_kind,
      itemId: r.item_id,
      monthlyUsd: r.monthly_usd_cents / 100,
      status: r.status,
    }));

    const contentTotal = contentRows.reduce((sum, r) => sum + r.monthly_usd_cents, 0) / 100;
    const basic = this.basicMonthlyUsd;
    const hasByo = rows.some(r => r.item_kind === 'byo_platform_fee');
    const byoFee = hasByo ? this.byoPlatformFeeUsd : 0;

    return {
      basicMonthlyUsd: basic,
      authoredItems,
      byoPlatformFeeUsd: byoFee,
      totalMonthlyUsd: basic + contentTotal + byoFee,
    };
  }
}
