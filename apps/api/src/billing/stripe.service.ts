import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import Stripe from 'stripe';
import { BillingConfigService } from './billing-config.service';

/**
 * Thin wrapper around the Stripe SDK. Knows nothing about Divinr's schema beyond
 * Stripe metadata it attaches (`userId`, `authoredItemId`).
 *
 * When `STRIPE_SECRET_KEY` is unset, the service is in "disabled" mode — every
 * method that would call Stripe returns null and the controller layer is expected
 * to fall back to the existing no-payment shape.
 */
@Injectable()
export class StripeService implements OnModuleInit {
  private readonly logger = new Logger(StripeService.name);
  private client: Stripe | null = null;

  constructor(
    @Inject(BillingConfigService) private readonly config: BillingConfigService,
  ) {
    if (this.config.isStripeEnabled()) {
      const secret = this.config.stripeSecretKey;
      if (secret) {
        this.client = new Stripe(secret, {
          apiVersion: this.config.stripeApiVersion as Stripe.StripeConfig['apiVersion'],
          timeout: 10_000,
        });
      }
    }
  }

  async onModuleInit(): Promise<void> {
    if (!this.client) {
      this.logger.log('Stripe disabled — STRIPE_SECRET_KEY not set');
      return;
    }
    await this.runPriceSanityCheck();
  }

  /**
   * Walks every (env USD value, Stripe Price id) pair and warns on drift.
   * Never throws — Stripe is authoritative for charging; an env-var mismatch
   * is operator information, not a startup blocker.
   *
   * Exposed for unit testing.
   */
  async runPriceSanityCheck(): Promise<void> {
    if (!this.client) return;
    for (const pair of this.config.pricingPairs()) {
      if (!pair.priceId) {
        this.logger.warn(`Stripe price sanity: ${pair.envName} not set; skipping`);
        continue;
      }
      try {
        const price = await this.client.prices.retrieve(pair.priceId);
        if (price.unit_amount !== pair.expectedCents) {
          this.logger.warn(
            `Stripe price drift: ${pair.envName}=${pair.priceId} ` +
            `Stripe.unit_amount=${price.unit_amount} env-derived=${pair.expectedCents}. ` +
            `Stripe is authoritative — adjust your env or re-run stripe-seed.ts.`
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Stripe price sanity: failed to retrieve ${pair.envName}=${pair.priceId}: ${msg}`);
      }
    }
  }

  /**
   * Internal accessor for tests — keeps the SDK client encapsulated otherwise.
   */
  getClient(): Stripe | null {
    return this.client;
  }

  isEnabled(): boolean {
    return this.client !== null;
  }

  // ---------------------------------------------------------------------------
  // Public surface — bodies arrive in later phases. Stub signatures land now so
  // that callers in BillingService / BillingController can be wired against the
  // real type even before the implementations exist.
  // ---------------------------------------------------------------------------

  async ensureCustomer(userId: string, email: string): Promise<{ customerId: string } | null> {
    if (!this.client) return null;
    // Idempotency keyed on userId so retried calls return the same customer
    // rather than creating duplicates.
    const customer = await this.client.customers.create(
      { email, metadata: { userId } },
      { idempotencyKey: `customer:${userId}` },
    );
    return { customerId: customer.id };
  }

  async createCheckoutSessionSubscription(opts: {
    userId: string;
    customerId: string;
    priceIdBasic: string;
    currentAuthoredItemPriceIds: string[];
    returnUrl: string;
    trialPeriodDays: number;
  }): Promise<{ url: string } | null> {
    if (!this.client) return null;
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      { price: opts.priceIdBasic, quantity: 1 },
      ...opts.currentAuthoredItemPriceIds.map((p) => ({ price: p, quantity: 1 })),
    ];
    const session = await this.client.checkout.sessions.create({
      mode: 'subscription',
      customer: opts.customerId,
      line_items: lineItems,
      subscription_data: {
        trial_period_days: opts.trialPeriodDays > 0 ? opts.trialPeriodDays : undefined,
        metadata: { userId: opts.userId },
      },
      success_url: opts.returnUrl,
      cancel_url: opts.returnUrl,
      metadata: { userId: opts.userId },
    });
    if (!session.url) return null;
    return { url: session.url };
  }

  async createCheckoutSessionSetup(opts: {
    customerId: string;
    returnUrl: string;
    metadata: Record<string, string>;
  }): Promise<{ url: string } | null> {
    if (!this.client) return null;
    const session = await this.client.checkout.sessions.create({
      mode: 'setup',
      customer: opts.customerId,
      success_url: opts.returnUrl,
      cancel_url: opts.returnUrl,
      metadata: opts.metadata,
    });
    if (!session.url) return null;
    return { url: session.url };
  }

  async createPortalSession(opts: {
    customerId: string;
    returnUrl: string;
  }): Promise<{ url: string } | null> {
    if (!this.client) return null;
    const session = await this.client.billingPortal.sessions.create({
      customer: opts.customerId,
      return_url: opts.returnUrl,
    });
    return { url: session.url };
  }

  async addSubscriptionItem(opts: {
    subscriptionId: string;
    priceId: string;
    idempotencyKey: string;
    metadata: Record<string, string>;
  }): Promise<{ subscriptionItemId: string } | null> {
    if (!this.client) return null;
    const item = await this.client.subscriptionItems.create(
      {
        subscription: opts.subscriptionId,
        price: opts.priceId,
        quantity: 1,
        proration_behavior: 'create_prorations',
        metadata: opts.metadata,
      },
      { idempotencyKey: opts.idempotencyKey },
    );
    return { subscriptionItemId: item.id };
  }

  async removeSubscriptionItem(opts: {
    subscriptionItemId: string;
    idempotencyKey: string;
  }): Promise<void> {
    if (!this.client) return;
    await this.client.subscriptionItems.del(
      opts.subscriptionItemId,
      { proration_behavior: 'create_prorations' },
      { idempotencyKey: opts.idempotencyKey },
    );
  }

  updateSubscriptionItemPrice(_opts: {
    subscriptionItemId: string;
    newPriceId: string;
    idempotencyKey: string;
  }): Promise<void> {
    if (!this.client) return Promise.resolve();
    throw new Error('StripeService.updateSubscriptionItemPrice not implemented yet (Phase 4)');
  }

  createSubscriptionWithItem(_opts: {
    customerId: string;
    priceId: string;
    idempotencyKey: string;
    metadata: Record<string, string>;
  }): Promise<{ subscriptionId: string } | null> {
    if (!this.client) return Promise.resolve(null);
    throw new Error('StripeService.createSubscriptionWithItem not implemented yet (Phase 4)');
  }

  createRefund(_opts: {
    invoiceId: string;
    amountCents?: number;
    reason: string;
  }): Promise<{ refundId: string } | null> {
    if (!this.client) return Promise.resolve(null);
    throw new Error('StripeService.createRefund not implemented yet (Phase 5)');
  }

  createBalanceCredit(_opts: {
    customerId: string;
    amountCents: number;
    reason: string;
  }): Promise<void> {
    if (!this.client) return Promise.resolve();
    throw new Error('StripeService.createBalanceCredit not implemented yet (Phase 5)');
  }

  applyCompCoupon(_opts: {
    customerId: string;
    periodsCount: number;
    reason: string;
  }): Promise<void> {
    if (!this.client) return Promise.resolve();
    throw new Error('StripeService.applyCompCoupon not implemented yet (Phase 5)');
  }

  /**
   * Returns a preview of the upcoming invoice for a subscription, mapped to the
   * shape BillingSummaryView expects. Never throws — preview is best-effort
   * cosmetics on top of the DB-computed bill.
   */
  async previewUpcomingInvoice(subscriptionId: string): Promise<{
    amountDue: number;
    currency: string;
    dueDate: string | null;
    lineItems: Array<{ description: string; amountCents: number; priceId: string | null }>;
  } | null> {
    if (!this.client) return null;
    try {
      // The SDK's invoices.createPreview takes options.subscription. Some older
      // versions exposed retrieveUpcoming; createPreview is the current name.
      const inv = await (this.client.invoices as unknown as {
        createPreview: (params: { subscription: string }) => Promise<{
          amount_due: number;
          currency: string;
          next_payment_attempt: number | null;
          due_date: number | null;
          lines: { data: Array<{ description: string | null; amount: number; price: { id: string } | null }> };
        }>;
      }).createPreview({ subscription: subscriptionId });
      const dueEpoch = inv.next_payment_attempt ?? inv.due_date;
      return {
        amountDue: inv.amount_due,
        currency: inv.currency,
        dueDate: dueEpoch ? new Date(dueEpoch * 1000).toISOString() : null,
        lineItems: inv.lines.data.map((l) => ({
          description: l.description ?? '',
          amountCents: l.amount,
          priceId: l.price?.id ?? null,
        })),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`previewUpcomingInvoice failed for ${subscriptionId}: ${msg}`);
      return null;
    }
  }

  /**
   * Verify a Stripe webhook signature against STRIPE_WEBHOOK_SECRET.
   * Returns the parsed event on success; returns null when Stripe is disabled.
   * Throws (caller turns into 400) when the signature is malformed or invalid —
   * Stripe constructs an error class that includes a useful message.
   */
  verifyWebhookSignature(rawBody: Buffer, signature: string): Stripe.Event | null {
    if (!this.client) return null;
    const secret = this.config.stripeWebhookSecret;
    if (!secret) {
      throw new Error('STRIPE_WEBHOOK_SECRET not configured');
    }
    return this.client.webhooks.constructEvent(rawBody, signature, secret);
  }

  /**
   * Retrieve a payment method by id and surface the card display fields we cache.
   * Used by the payment_method.attached webhook handler.
   */
  async getPaymentMethodCardFields(paymentMethodId: string): Promise<{
    last4: string;
    expMonth: number;
    expYear: number;
  } | null> {
    if (!this.client) return null;
    const pm = await this.client.paymentMethods.retrieve(paymentMethodId);
    if (pm.type !== 'card' || !pm.card) return null;
    return {
      last4: pm.card.last4,
      expMonth: pm.card.exp_month,
      expYear: pm.card.exp_year,
    };
  }
}
