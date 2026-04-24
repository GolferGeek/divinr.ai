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

  ensureCustomer(_userId: string, _email: string): Promise<{ customerId: string } | null> {
    if (!this.client) return Promise.resolve(null);
    throw new Error('StripeService.ensureCustomer not implemented yet (lands in Phase 2)');
  }

  createCheckoutSessionSubscription(_opts: {
    userId: string;
    customerId: string;
    priceIdBasic: string;
    currentAuthoredItemPriceIds: string[];
    returnUrl: string;
    trialPeriodDays: number;
  }): Promise<{ url: string } | null> {
    if (!this.client) return Promise.resolve(null);
    throw new Error('StripeService.createCheckoutSessionSubscription not implemented yet (Phase 2)');
  }

  createCheckoutSessionSetup(_opts: {
    customerId: string;
    returnUrl: string;
    metadata: Record<string, string>;
  }): Promise<{ url: string } | null> {
    if (!this.client) return Promise.resolve(null);
    throw new Error('StripeService.createCheckoutSessionSetup not implemented yet (Phase 4)');
  }

  createPortalSession(_opts: {
    customerId: string;
    returnUrl: string;
  }): Promise<{ url: string } | null> {
    if (!this.client) return Promise.resolve(null);
    throw new Error('StripeService.createPortalSession not implemented yet (Phase 2)');
  }

  addSubscriptionItem(_opts: {
    subscriptionId: string;
    priceId: string;
    idempotencyKey: string;
    metadata: Record<string, string>;
  }): Promise<{ subscriptionItemId: string } | null> {
    if (!this.client) return Promise.resolve(null);
    throw new Error('StripeService.addSubscriptionItem not implemented yet (Phase 3)');
  }

  removeSubscriptionItem(_opts: {
    subscriptionItemId: string;
    idempotencyKey: string;
  }): Promise<void> {
    if (!this.client) return Promise.resolve();
    throw new Error('StripeService.removeSubscriptionItem not implemented yet (Phase 3)');
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

  previewUpcomingInvoice(_subscriptionId: string): Promise<unknown | null> {
    if (!this.client) return Promise.resolve(null);
    throw new Error('StripeService.previewUpcomingInvoice not implemented yet (Phase 3)');
  }

  verifyWebhookSignature(_rawBody: Buffer, _signature: string): Stripe.Event | null {
    if (!this.client) return null;
    throw new Error('StripeService.verifyWebhookSignature not implemented yet (Phase 2)');
  }
}
