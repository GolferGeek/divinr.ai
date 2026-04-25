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

  async updateSubscriptionItemPrice(opts: {
    subscriptionItemId: string;
    newPriceId: string;
    idempotencyKey: string;
  }): Promise<void> {
    if (!this.client) return;
    await this.client.subscriptionItems.update(
      opts.subscriptionItemId,
      { price: opts.newPriceId, proration_behavior: 'create_prorations' },
      { idempotencyKey: opts.idempotencyKey },
    );
  }

  async createSubscriptionWithItem(opts: {
    customerId: string;
    priceId: string;
    idempotencyKey: string;
    metadata: Record<string, string>;
  }): Promise<{ subscriptionId: string } | null> {
    if (!this.client) return null;
    const sub = await this.client.subscriptions.create(
      {
        customer: opts.customerId,
        items: [{ price: opts.priceId, quantity: 1 }],
        metadata: opts.metadata,
      },
      { idempotencyKey: opts.idempotencyKey },
    );
    return { subscriptionId: sub.id };
  }

  /**
   * Issues a refund against a Stripe invoice. amountCents omitted = full refund.
   * The refund is keyed off the invoice's primary charge, which is how Stripe's
   * own dashboard refund flow works.
   */
  async createRefund(opts: {
    invoiceId: string;
    amountCents?: number;
    reason: string;
  }): Promise<{ refundId: string } | null> {
    if (!this.client) return null;
    const inv = await this.client.invoices.retrieve(opts.invoiceId);
    // Stripe SDK v18+ doesn't surface `inv.charge` in its TypeScript types
    // anymore (the relationship now goes through payment_intent on newer
    // invoices), but the API still returns it on older invoices that were
    // billed via charge directly. Fall back through both shapes via cast.
    const invAny = inv as unknown as { charge?: string | { id: string } | null; payment_intent?: string | { id: string; latest_charge?: string | { id: string } | null } | null };
    let chargeId: string | undefined;
    if (typeof invAny.charge === 'string') chargeId = invAny.charge;
    else if (invAny.charge && typeof invAny.charge === 'object') chargeId = invAny.charge.id;
    if (!chargeId && invAny.payment_intent) {
      const pi = typeof invAny.payment_intent === 'string'
        ? await this.client.paymentIntents.retrieve(invAny.payment_intent)
        : invAny.payment_intent as { latest_charge?: string | { id: string } | null };
      const latest = (pi as { latest_charge?: string | { id: string } | null }).latest_charge;
      if (typeof latest === 'string') chargeId = latest;
      else if (latest && typeof latest === 'object') chargeId = latest.id;
    }
    if (!chargeId) {
      throw new Error(`Invoice ${opts.invoiceId} has no associated charge to refund`);
    }
    const refund = await this.client.refunds.create({
      charge: chargeId,
      amount: opts.amountCents,
      metadata: { reason: opts.reason },
    });
    return { refundId: refund.id };
  }

  /**
   * Applies a one-time customer balance credit. Negative amount reduces the
   * customer's running balance, which Stripe applies to the next invoice.
   */
  async createBalanceCredit(opts: {
    customerId: string;
    amountCents: number;
    reason: string;
  }): Promise<void> {
    if (!this.client) return;
    await this.client.customers.createBalanceTransaction(opts.customerId, {
      amount: -Math.abs(opts.amountCents),
      currency: 'usd',
      description: opts.reason,
    });
  }

  /**
   * Applies a 100%-off coupon for `periodsCount` billing cycles. Finds-or-creates
   * a `divinr_comp_<n>_months` coupon (one per period count, reused across users)
   * then attaches it to the customer.
   */
  async applyCompCoupon(opts: {
    customerId: string;
    periodsCount: number;
    reason: string;
  }): Promise<void> {
    if (!this.client) return;
    const periods = Math.max(1, Math.floor(opts.periodsCount));
    const couponId = `divinr_comp_${periods}_months`;
    let coupon: Stripe.Coupon | null = null;
    try {
      coupon = await this.client.coupons.retrieve(couponId);
    } catch {
      // Not found — fall through to create
    }
    if (!coupon) {
      coupon = await this.client.coupons.create({
        id: couponId,
        percent_off: 100,
        duration: 'repeating',
        duration_in_months: periods,
        name: `Divinr ${periods}-month comp`,
      });
    }
    // Stripe SDK v18+ types removed direct `coupon` from CustomerUpdateParams,
    // but the underlying REST API still accepts it. Cast through `unknown` so
    // we keep using the documented one-liner for attaching a coupon to a
    // customer (vs. the multi-step Promotion-codes flow which would be
    // overkill for an internal comp).
    await this.client.customers.update(opts.customerId, {
      coupon: coupon.id,
      metadata: { last_comp_reason: opts.reason },
    } as unknown as Stripe.CustomerUpdateParams);
  }

  /**
   * Lists the customer's recent invoices for the admin billing view.
   */
  async listInvoices(customerId: string, limit = 10): Promise<Array<{
    invoiceId: string;
    amount: number;
    status: string;
    invoiceUrl: string | null;
    createdAt: string;
  }>> {
    if (!this.client) return [];
    const list = await this.client.invoices.list({ customer: customerId, limit });
    return list.data.map((inv) => ({
      invoiceId: inv.id ?? '',
      amount: inv.amount_due,
      status: inv.status ?? 'unknown',
      invoiceUrl: inv.hosted_invoice_url ?? null,
      createdAt: new Date((inv.created ?? 0) * 1000).toISOString(),
    }));
  }

  /**
   * Lists the customer's payment methods (cards) for the admin billing view.
   */
  async listPaymentMethods(customerId: string): Promise<Array<{
    id: string;
    last4: string;
    expMonth: number;
    expYear: number;
    brand: string;
    isDefault: boolean;
  }>> {
    if (!this.client) return [];
    const customer = await this.client.customers.retrieve(customerId) as Stripe.Customer;
    const defaultPmId = typeof customer.invoice_settings?.default_payment_method === 'string'
      ? customer.invoice_settings.default_payment_method
      : customer.invoice_settings?.default_payment_method?.id ?? null;
    const list = await this.client.paymentMethods.list({ customer: customerId, type: 'card' });
    return list.data.map((pm) => ({
      id: pm.id,
      last4: pm.card?.last4 ?? '',
      expMonth: pm.card?.exp_month ?? 0,
      expYear: pm.card?.exp_year ?? 0,
      brand: pm.card?.brand ?? '',
      isDefault: pm.id === defaultPmId,
    }));
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
