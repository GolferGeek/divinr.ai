import {
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@orchestratorai/planes/auth';
import { BillingService } from './billing.service';
import { BillingConfigService } from './billing-config.service';
import { StripeService } from './stripe.service';
import { BillingStripeSyncService } from './billing-stripe-sync.service';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { SkipReadOnly } from './skip-read-only.decorator';

interface BillingSubscriptionRow {
  user_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  trial_ends_at: string | null;
  card_last4: string | null;
}

@Controller('billing')
export class BillingController {
  private readonly logger = new Logger(BillingController.name);

  constructor(
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(BillingConfigService) private readonly config: BillingConfigService,
    @Inject(StripeService) private readonly stripeSvc: StripeService,
    @Inject(BillingStripeSyncService) private readonly syncSvc: BillingStripeSyncService,
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get('preview')
  async getPreview(@Req() req: any) {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Authentication required');
    const preview = await this.billing.getBillingPreview(userId);
    // Additive Stripe-side upcoming-invoice preview (Phase 3). Backward-compatible:
    // existing consumers that don't read upcomingInvoice see the same shape they did
    // before. Falls back to null when Stripe is disabled, the user has no
    // subscription yet, or Stripe rejects the createPreview call.
    let upcomingInvoice: Awaited<ReturnType<StripeService['previewUpcomingInvoice']>> | null = null;
    if (this.stripeSvc.isEnabled()) {
      const sub = await this.subscriptionRow(userId);
      if (sub?.stripe_subscription_id) {
        upcomingInvoice = await this.stripeSvc.previewUpcomingInvoice(sub.stripe_subscription_id);
      }
    }
    return { ...preview, upcomingInvoice };
  }

  @UseGuards(JwtAuthGuard)
  @Get('subscription')
  async getSubscription(@Req() req: any) {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Authentication required');
    return this.billing.getSubscription(userId);
  }

  /**
   * Lifecycle status for the web shell (trial countdown + read-only banner).
   * Safe for an expired user to poll — explicitly exempt from ReadOnlyGuard.
   */
  @UseGuards(JwtAuthGuard)
  @SkipReadOnly()
  @Get('status')
  async getStatus(@Req() req: any) {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Authentication required');
    const sub = await this.billing.getSubscription(userId);
    const isStudent = await this.isStudentUser(userId);
    const nowMs = Date.now();
    const daysUntilPurge = sub?.purge_scheduled_at
      ? Math.max(0, Math.ceil((new Date(sub.purge_scheduled_at).getTime() - nowMs) / (24 * 60 * 60 * 1000)))
      : null;
    const isReadOnly = sub ? (sub.status === 'canceled' || sub.status === 'dormant') : false;
    return {
      status: sub?.status ?? null,
      trial_ends_at: sub?.trial_ends_at ?? null,
      expired_at: sub?.expired_at ?? null,
      purge_scheduled_at: sub?.purge_scheduled_at ?? null,
      is_read_only: isReadOnly,
      days_until_purge: daysUntilPurge,
      // Phase 2: surfaced so TrialCountdown can render the "setup_needed" variant
      // when status==='trial' but no card has been attached yet. Driven by the
      // payment_method.attached webhook caching card_last4 on the subscription row.
      has_card_on_file: !!(sub as unknown as { card_last4?: string | null } | null)?.card_last4,
      // Phase 4: students need to add a card BEFORE authoring (lazy subscription
      // creation needs a payment method to attach). Regular trial users can
      // author freely during trial without a card. The frontend gate uses this.
      is_student: isStudent,
    };
  }

  // ─── Stripe Checkout ─────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @SkipReadOnly()
  @Post('checkout-session')
  async createCheckoutSession(@Req() req: any) {
    const userId = req.user?.id as string | undefined;
    const email = req.user?.email as string | undefined;
    if (!userId) throw new BadRequestException('Authentication required');

    const body = (req.body ?? {}) as { returnUrl?: unknown };
    if (typeof body.returnUrl !== 'string' || body.returnUrl.length === 0) {
      throw new BadRequestException('returnUrl is required');
    }
    const returnUrl = body.returnUrl;

    if (!this.stripeSvc.isEnabled()) {
      return { url: null, message: 'Stripe not configured — billing preview only' };
    }

    const sub = await this.subscriptionRow(userId);
    if (sub?.stripe_subscription_id) {
      throw new ConflictException({
        url: null,
        useEndpoint: '/billing/portal-session',
        message: 'User already has a subscription; use portal session instead.',
      });
    }

    let customerId = sub?.stripe_customer_id ?? null;
    if (!customerId) {
      const created = await this.stripeSvc.ensureCustomer(userId, email ?? `${userId}@unknown`);
      if (!created) {
        return { url: null, message: 'Stripe customer creation failed' };
      }
      customerId = created.customerId;
      await this.billing.updateStripeFields(userId, { stripe_customer_id: customerId });
    }

    // Phase 4: students go through setup-mode Checkout (card-only, no
    // subscription) — their subscription is lazily created on first authored
    // item via createSubscriptionWithItem with the student Price.
    const isStudent = await this.isStudentUser(userId);
    if (isStudent) {
      const session = await this.stripeSvc.createCheckoutSessionSetup({
        customerId,
        returnUrl,
        metadata: { userId },
      });
      if (!session) return { url: null, message: 'Stripe Checkout session unavailable' };
      return { url: session.url };
    }

    const basicPriceId = this.config.stripePriceBasicMonthly;
    if (!basicPriceId) {
      throw new BadRequestException('STRIPE_PRICE_BASIC_MONTHLY is not configured');
    }
    const trialDays = remainingTrialDays(sub?.trial_ends_at ?? null);
    const session = await this.stripeSvc.createCheckoutSessionSubscription({
      userId,
      customerId,
      priceIdBasic: basicPriceId,
      currentAuthoredItemPriceIds: [],
      returnUrl,
      trialPeriodDays: trialDays,
    });
    if (!session) return { url: null, message: 'Stripe Checkout session unavailable' };
    return { url: session.url };
  }

  private async isStudentUser(userId: string): Promise<boolean> {
    const result = await this.db.rawQuery(
      `SELECT is_student FROM authz.users WHERE id = $1`,
      [userId],
    );
    if (result.error) return false;
    const rows = (result.data as Array<{ is_student: boolean }> | null) ?? [];
    return rows[0]?.is_student === true;
  }

  @UseGuards(JwtAuthGuard)
  @SkipReadOnly()
  @Post('portal-session')
  async createPortalSession(@Req() req: any) {
    const userId = req.user?.id as string | undefined;
    if (!userId) throw new BadRequestException('Authentication required');

    const body = (req.body ?? {}) as { returnUrl?: unknown };
    if (typeof body.returnUrl !== 'string' || body.returnUrl.length === 0) {
      throw new BadRequestException('returnUrl is required');
    }
    const returnUrl = body.returnUrl;

    if (!this.stripeSvc.isEnabled()) {
      return { url: null, message: 'Stripe not configured — billing preview only' };
    }

    const sub = await this.subscriptionRow(userId);
    if (!sub?.stripe_customer_id) {
      throw new ConflictException({ url: null, error: 'no_customer', message: 'User has no Stripe customer yet.' });
    }
    const session = await this.stripeSvc.createPortalSession({
      customerId: sub.stripe_customer_id,
      returnUrl,
    });
    if (!session) return { url: null, message: 'Stripe Portal session unavailable' };
    return { url: session.url };
  }

  // ─── Stripe webhooks ─────────────────────────────────────────

  @SkipReadOnly()
  @HttpCode(200)
  @Post('webhooks/stripe')
  async handleStripeWebhook(@Req() req: any) {
    if (!this.stripeSvc.isEnabled()) {
      return { received: true };
    }

    const signature = req.headers?.['stripe-signature'] as string | undefined;
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }
    const rawBody = (req as { rawBody?: Buffer }).rawBody;
    if (!rawBody) {
      throw new BadRequestException('Raw body unavailable — main.ts must enable rawBody');
    }

    let event;
    try {
      event = this.stripeSvc.verifyWebhookSignature(rawBody, signature);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(`Stripe signature verification failed: ${msg}`);
    }
    if (!event) return { received: true };

    // Idempotency: ON CONFLICT DO NOTHING. If we don't insert a fresh row,
    // we've seen this event already and short-circuit with a 200.
    const userMetaId = (event.data.object as { metadata?: { userId?: string } })?.metadata?.userId ?? null;
    const insertResult = await this.db.rawQuery(
      `INSERT INTO billing.stripe_webhook_events (event_id, event_type, stripe_created_at, user_id, payload)
       VALUES ($1, $2, to_timestamp($3), $4, $5::jsonb)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [event.id, event.type, event.created, userMetaId, JSON.stringify(event)],
    );
    if (insertResult.error) {
      this.logger.error(`webhook insert failed: ${insertResult.error.message}`);
      throw new BadRequestException('Webhook persistence failed');
    }
    const inserted = (insertResult.data as Array<{ event_id: string }> | null) ?? [];
    if (inserted.length === 0) {
      return { received: true, duplicate: true };
    }

    try {
      await this.syncSvc.handle(event);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`webhook handler failed for ${event.type} (${event.id}): ${msg}`);
      await this.db.rawQuery(
        `UPDATE billing.stripe_webhook_events SET handler_error = $2 WHERE event_id = $1`,
        [event.id, msg],
      );
      // Return 500 so Stripe retries.
      throw new Error(`Webhook handler failed: ${msg}`);
    }

    await this.db.rawQuery(
      `UPDATE billing.stripe_webhook_events SET processed_at = now() WHERE event_id = $1`,
      [event.id],
    );
    return { received: true };
  }

  // ─── Helpers ─────────────────────────────────────────────────

  private async subscriptionRow(userId: string): Promise<BillingSubscriptionRow | null> {
    const result = await this.db.rawQuery(
      `SELECT user_id, stripe_customer_id, stripe_subscription_id, trial_ends_at, card_last4
       FROM billing.subscriptions WHERE user_id = $1`,
      [userId],
    );
    if (result.error) throw new Error(`subscriptionRow failed: ${result.error.message}`);
    const rows = (result.data as BillingSubscriptionRow[] | null) ?? [];
    return rows[0] ?? null;
  }
}

function remainingTrialDays(trialEndsAt: string | null): number {
  if (!trialEndsAt) return 0;
  const ms = new Date(trialEndsAt).getTime() - Date.now();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}
