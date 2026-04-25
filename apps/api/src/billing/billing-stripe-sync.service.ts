import { Inject, Injectable, Logger } from '@nestjs/common';
import type Stripe from 'stripe';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { BillingService, type SubscriptionStatus } from './billing.service';
import { StripeService } from './stripe.service';
import { BillingConfigService } from './billing-config.service';

/**
 * Translates Stripe webhook payloads into BillingService state transitions.
 *
 * The webhook controller is responsible for raw-body capture, signature
 * verification, and event-id idempotency. This service only sees fully
 * verified events and is the only place that maps Stripe-side state into
 * the local subscription mirror.
 *
 * Every state transition emits an `appendSubscriptionEvent` row with
 * triggered_by='stripe' so the audit trail captures Stripe-driven changes
 * distinctly from user/admin/system actions.
 */
@Injectable()
export class BillingStripeSyncService {
  private readonly logger = new Logger(BillingStripeSyncService.name);

  constructor(
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(StripeService) private readonly stripe: StripeService,
    @Inject(BillingConfigService) private readonly config: BillingConfigService,
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
  ) {}

  async handle(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await this.handleSubscriptionUpsert(event);
        return;
      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(event);
        return;
      case 'customer.subscription.trial_will_end':
        await this.handleTrialWillEnd(event);
        return;
      case 'invoice.paid':
        await this.handleInvoicePaid(event);
        return;
      case 'invoice.payment_failed':
        await this.handleInvoicePaymentFailed(event);
        return;
      case 'payment_method.attached':
        await this.handlePaymentMethodAttached(event);
        return;
      case 'checkout.session.completed':
        // Subscription state will be created/updated by customer.subscription.created
        // arriving alongside this event. Log for traceability.
        this.logger.log(`checkout.session.completed: ${event.id}`);
        return;
      default:
        this.logger.debug(`Unhandled Stripe event type: ${event.type} (${event.id})`);
    }
  }

  // ─── Handlers ──────────────────────────────────────────────────

  private async handleSubscriptionUpsert(event: Stripe.Event): Promise<void> {
    const sub = event.data.object as Stripe.Subscription;
    const userId = await this.resolveUserId(sub.customer as string, sub.metadata?.userId);
    if (!userId) {
      this.logger.warn(`subscription.${event.type}: cannot resolve userId for customer=${sub.customer} (${event.id})`);
      return;
    }
    const prior = await this.billing.getSubscription(userId);
    const newStatus = mapStripeStatus(sub.status);
    const trialEndsAt = sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null;
    const periodEnd = epochToIso(stripeSubscriptionPeriodEnd(sub));
    const basicPriceId = pickBasicPriceId(sub, this.config.stripePriceBasicMonthly);

    await this.billing.updateStripeFields(userId, {
      stripe_customer_id: sub.customer as string,
      stripe_subscription_id: sub.id,
      stripe_price_id_basic: basicPriceId,
      stripe_latest_invoice_id: typeof sub.latest_invoice === 'string' ? sub.latest_invoice : sub.latest_invoice?.id ?? null,
      stripe_default_payment_method_id: typeof sub.default_payment_method === 'string'
        ? sub.default_payment_method
        : sub.default_payment_method?.id ?? null,
      status: newStatus,
      trial_ends_at: trialEndsAt,
      current_period_end: periodEnd,
    });

    if (!prior || prior.status !== newStatus) {
      await this.billing.appendSubscriptionEvent({
        userId,
        fromStatus: prior?.status ?? null,
        toStatus: newStatus,
        reason: `${event.type} ${event.id}`,
        triggeredBy: 'stripe',
      });
    }

    // Re-sync the per-item Price mirror. Catches mid-stream Price swaps —
    // primarily the .edu-lapse path (Phase 4) where every authored item flips
    // from student to regular Price in a single subscription.update event.
    await this.syncAuthoredItemPrices(sub);
  }

  private async syncAuthoredItemPrices(sub: Stripe.Subscription): Promise<void> {
    for (const item of sub.items?.data ?? []) {
      const itemPriceId = item.price?.id;
      if (!itemPriceId || !item.id) continue;
      // Only update if our mirror has a different price id for this subscription_item.
      // Using rawQuery via the BillingService helper to avoid touching unrelated rows.
      await this.billingRawUpdate(
        `UPDATE billing.authored_items
         SET stripe_price_id = $2
         WHERE stripe_subscription_item_id = $1 AND (stripe_price_id IS NULL OR stripe_price_id <> $2)`,
        [item.id, itemPriceId],
      );
    }
  }

  private async handleSubscriptionDeleted(event: Stripe.Event): Promise<void> {
    const sub = event.data.object as Stripe.Subscription;
    const userId = await this.resolveUserId(sub.customer as string, sub.metadata?.userId);
    if (!userId) {
      this.logger.warn(`subscription.deleted: cannot resolve userId for customer=${sub.customer} (${event.id})`);
      return;
    }
    const prior = await this.billing.getSubscription(userId);
    const dormancyMs = this.config.dormancyMonthsBeforePurge * 30 * 24 * 60 * 60 * 1000;
    const purgeAt = new Date(Date.now() + dormancyMs).toISOString();
    await this.billing.updateStripeFields(userId, {
      status: 'canceled',
    });
    // expired_at + purge_scheduled_at are set via a direct query because they
    // aren't routine update fields — borrow markExpired's contract by writing
    // the columns inline, then append the event ourselves so we control the
    // reason string.
    const result = await this.billingRawUpdate(
      `UPDATE billing.subscriptions
       SET status = 'canceled', expired_at = COALESCE(expired_at, now()), purge_scheduled_at = $2, updated_at = now()
       WHERE user_id = $1`,
      [userId, purgeAt],
    );
    if (result.error) throw new Error(`subscription.deleted SQL update failed: ${result.error.message}`);

    await this.billing.appendSubscriptionEvent({
      userId,
      fromStatus: prior?.status ?? null,
      toStatus: 'canceled',
      reason: `customer.subscription.deleted ${event.id}`,
      triggeredBy: 'stripe',
    });
  }

  private async handleTrialWillEnd(event: Stripe.Event): Promise<void> {
    const sub = event.data.object as Stripe.Subscription;
    const userId = await this.resolveUserId(sub.customer as string, sub.metadata?.userId);
    if (!userId) return;
    // Notification side-effect: insert a notify.notifications row if the
    // table exists. Best-effort — failure here doesn't block the webhook
    // ack because Stripe will not retry on this event.
    await this.tryInsertNotification(userId, 'trial_will_end', 'Your Divinr trial ends in 3 days. Add a card to keep your subscription active.');
  }

  private async handleInvoicePaid(event: Stripe.Event): Promise<void> {
    const inv = event.data.object as Stripe.Invoice;
    const customerId = typeof inv.customer === 'string' ? inv.customer : inv.customer?.id;
    if (!customerId) return;
    const userId = await this.resolveUserId(customerId);
    if (!userId) return;
    const prior = await this.billing.getSubscription(userId);
    await this.billing.updateStripeFields(userId, {
      stripe_latest_invoice_id: inv.id ?? null,
    });
    if (prior && (prior.status === 'trial' || prior.status === 'past_due')) {
      await this.billing.updateStripeFields(userId, { status: 'active' });
      await this.billing.appendSubscriptionEvent({
        userId,
        fromStatus: prior.status,
        toStatus: 'active',
        reason: `invoice.paid ${event.id}`,
        triggeredBy: 'stripe',
      });
    }
  }

  private async handleInvoicePaymentFailed(event: Stripe.Event): Promise<void> {
    const inv = event.data.object as Stripe.Invoice;
    const customerId = typeof inv.customer === 'string' ? inv.customer : inv.customer?.id;
    if (!customerId) return;
    const userId = await this.resolveUserId(customerId);
    if (!userId) return;
    const prior = await this.billing.getSubscription(userId);
    if (!prior) return;
    if (prior.status !== 'past_due') {
      await this.billing.updateStripeFields(userId, { status: 'past_due' });
      await this.billing.appendSubscriptionEvent({
        userId,
        fromStatus: prior.status,
        toStatus: 'past_due',
        reason: `invoice.payment_failed ${event.id}`,
        triggeredBy: 'stripe',
      });
    }
    await this.tryInsertNotification(userId, 'payment_failed', 'A payment to Divinr failed. Stripe will retry automatically — please update your card if needed.');
  }

  private async handlePaymentMethodAttached(event: Stripe.Event): Promise<void> {
    const pm = event.data.object as Stripe.PaymentMethod;
    const customerId = typeof pm.customer === 'string' ? pm.customer : pm.customer?.id;
    if (!customerId) return;
    const userId = await this.resolveUserId(customerId);
    if (!userId) return;
    if (pm.type !== 'card' || !pm.card) return;
    await this.billing.updateStripeFields(userId, {
      stripe_default_payment_method_id: pm.id,
      card_last4: pm.card.last4,
      card_exp_month: pm.card.exp_month,
      card_exp_year: pm.card.exp_year,
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────

  private async resolveUserId(stripeCustomerId: string, metadataUserId?: string): Promise<string | null> {
    if (metadataUserId) return metadataUserId;
    const sub = await this.billing.getSubscriptionByStripeCustomerId(stripeCustomerId);
    return sub?.user_id ?? null;
  }

  private async tryInsertNotification(userId: string, kind: string, message: string): Promise<void> {
    try {
      const result = await this.billingRawUpdate(
        `INSERT INTO notify.notifications (user_id, kind, message)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [userId, kind, message],
      );
      if (result.error) {
        this.logger.debug(`notify.notifications insert skipped: ${result.error.message}`);
      }
    } catch (err) {
      this.logger.debug(`notify.notifications unavailable: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async billingRawUpdate(sql: string, params: unknown[]): Promise<{ error: { message: string } | null }> {
    // The handful of side-effects that don't have a dedicated BillingService
    // method — subscription_events / notify.notifications inserts — go through
    // the DI'd DATABASE_SERVICE directly. Keeps BillingService's surface clean
    // and avoids reaching into its private fields.
    const result = await this.db.rawQuery(sql, params);
    return { error: result.error };
  }
}

function mapStripeStatus(stripeStatus: Stripe.Subscription.Status): SubscriptionStatus {
  switch (stripeStatus) {
    case 'trialing': return 'trial';
    case 'active': return 'active';
    case 'past_due': return 'past_due';
    case 'unpaid': return 'past_due';
    case 'canceled': return 'canceled';
    // 'incomplete' = subscription created, first invoice didn't get paid within
    // 23h. The user needs to take action (3DS confirm, fix card, etc) — that's
    // closer to past_due than trial. Maps to past_due so the local UI surfaces
    // a yellow chip immediately rather than waiting 23h for the
    // 'incomplete_expired' webhook to flip them to canceled.
    case 'incomplete': return 'past_due';
    case 'incomplete_expired': return 'canceled';
    case 'paused': return 'past_due';
    default: return 'active';
  }
}

function epochToIso(epoch: number | null | undefined): string | null {
  if (!epoch) return null;
  return new Date(epoch * 1000).toISOString();
}

function stripeSubscriptionPeriodEnd(sub: Stripe.Subscription): number | undefined {
  // The Stripe API surfaces current_period_end on the subscription items in
  // recent versions; older surface had it on the subscription itself. Look in
  // both spots for forwards/backwards compatibility.
  const subAny = sub as unknown as { current_period_end?: number; items?: { data?: Array<{ current_period_end?: number }> } };
  if (typeof subAny.current_period_end === 'number') return subAny.current_period_end;
  const item = subAny.items?.data?.[0];
  return item?.current_period_end;
}

function pickBasicPriceId(sub: Stripe.Subscription, basicPriceId: string | null): string | null {
  if (!basicPriceId) return null;
  for (const item of sub.items?.data ?? []) {
    if (item.price?.id === basicPriceId) return item.price.id;
  }
  return null;
}
