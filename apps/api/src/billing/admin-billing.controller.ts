import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@orchestratorai/planes/auth';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import {
  BillingService,
  type BillingAuthoredItem,
  type BillingSubscription,
  type SubscriptionEvent,
} from './billing.service';
import { StripeService } from './stripe.service';
import { BillingLifecycleCron } from './cron/billing-lifecycle.cron';

interface AuthenticatedUser {
  id: string;
  email?: string;
}

interface StripeWebhookEventRow {
  event_id: string;
  event_type: string;
  received_at: string;
  processed_at: string | null;
  handler_error: string | null;
}

async function fetchUserPermissions(db: DatabaseService, userId: string): Promise<Set<string>> {
  const result = await db.rawQuery(
    `SELECT p.name FROM authz.rbac_user_roles ur
     JOIN authz.rbac_role_permissions rp ON rp.role_id = ur.role_id
     JOIN authz.rbac_permissions p ON p.id = rp.permission_id
     WHERE ur.user_id = $1`,
    [userId],
  );
  const rows = (result.data as Array<{ name: string }> | null) ?? [];
  return new Set(rows.map((r) => r.name));
}

async function fetchAdminRoleNames(db: DatabaseService, userId: string): Promise<Set<string>> {
  const result = await db.rawQuery(
    `SELECT r.name FROM authz.rbac_user_roles ur
     JOIN authz.rbac_roles r ON r.id = ur.role_id
     WHERE ur.user_id = $1`,
    [userId],
  );
  const rows = (result.data as Array<{ name: string }> | null) ?? [];
  return new Set(rows.map((r) => r.name));
}

@Controller('admin/users')
export class AdminBillingController {
  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(StripeService) private readonly stripeSvc: StripeService,
  ) {}

  private getUser(req: { user?: AuthenticatedUser }): AuthenticatedUser {
    if (!req.user?.id) throw new BadRequestException('Authentication required');
    return req.user;
  }

  private async requireAdmin(user: AuthenticatedUser): Promise<void> {
    const roles = await fetchAdminRoleNames(this.db, user.id);
    const hasAdmin = roles.has('super-admin') || roles.has('admin') || roles.has('owner');
    if (!hasAdmin) throw new ForbiddenException('Admin access required');
  }

  private async requirePermission(user: AuthenticatedUser, permission: string): Promise<void> {
    const perms = await fetchUserPermissions(this.db, user.id);
    if (!perms.has(permission)) throw new ForbiddenException(`Missing permission: ${permission}`);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/billing')
  async getUserBilling(
    @Req() req: { user?: AuthenticatedUser },
    @Param('id') userId: string,
  ) {
    await this.requireAdmin(this.getUser(req));
    const subscription = await this.billing.getSubscription(userId);
    const itemsResult = await this.db.rawQuery(
      `SELECT * FROM billing.authored_items WHERE user_id = $1 ORDER BY activated_at DESC`,
      [userId],
    );
    const authoredItems = (itemsResult.data as BillingAuthoredItem[] | null) ?? [];
    const eventsResult = await this.db.rawQuery(
      `SELECT * FROM billing.subscription_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [userId],
    );
    const events = (eventsResult.data as SubscriptionEvent[] | null) ?? [];
    const preview = await this.billing.getBillingPreview(userId);

    // Phase 5: Stripe-side panels. All best-effort — if Stripe is disabled or
    // the user has no customer yet, the arrays come back empty/null without
    // breaking the whole admin view.
    const customerId = subscription?.stripe_customer_id ?? null;
    const stripeEnabled = this.stripeSvc.isEnabled();

    let paymentMethods: Awaited<ReturnType<StripeService['listPaymentMethods']>> = [];
    let invoiceHistory: Awaited<ReturnType<StripeService['listInvoices']>> = [];
    let upcomingInvoicePreview: Awaited<ReturnType<StripeService['previewUpcomingInvoice']>> | null = null;

    if (stripeEnabled && customerId) {
      try { paymentMethods = await this.stripeSvc.listPaymentMethods(customerId); } catch { /* swallow — best effort */ }
      try { invoiceHistory = await this.stripeSvc.listInvoices(customerId, 10); } catch { /* swallow */ }
    }
    if (stripeEnabled && subscription?.stripe_subscription_id) {
      try { upcomingInvoicePreview = await this.stripeSvc.previewUpcomingInvoice(subscription.stripe_subscription_id); } catch { /* swallow */ }
    }

    const stripeEventsResult = await this.db.rawQuery(
      `SELECT event_id, event_type, received_at, processed_at, handler_error
       FROM billing.stripe_webhook_events
       WHERE user_id = $1
       ORDER BY received_at DESC
       LIMIT 50`,
      [userId],
    );
    const stripeEvents = (stripeEventsResult.data as StripeWebhookEventRow[] | null) ?? [];

    return {
      subscription,
      authored_items: authoredItems,
      events,
      preview,
      paymentMethods,
      invoiceHistory,
      upcomingInvoicePreview,
      stripeEvents,
    };
  }

  // ─── Refund / Credit / Comp ──────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Post(':id/billing/refund')
  async refundUser(
    @Req() req: { user?: AuthenticatedUser },
    @Param('id') userId: string,
    @Body() body: { invoiceId?: unknown; amountCents?: unknown; reason?: unknown },
  ): Promise<{ refundId: string }> {
    const adminUser = this.getUser(req);
    await this.requirePermission(adminUser, 'admin.billing.refund');
    if (typeof body.invoiceId !== 'string' || !body.invoiceId) throw new BadRequestException('invoiceId is required');
    if (typeof body.reason !== 'string' || !body.reason) throw new BadRequestException('reason is required');
    const amountCents = typeof body.amountCents === 'number' ? Math.floor(body.amountCents) : undefined;

    if (!this.stripeSvc.isEnabled()) {
      throw new BadRequestException('Stripe not configured');
    }
    const result = await this.stripeSvc.createRefund({
      invoiceId: body.invoiceId,
      amountCents,
      reason: body.reason,
    });
    if (!result) throw new BadRequestException('Refund creation returned null');

    const sub = await this.billing.getSubscription(userId);
    await this.billing.appendSubscriptionEvent({
      userId,
      fromStatus: sub?.status ?? null,
      toStatus: sub?.status ?? 'active',
      reason: `support_refund: ${body.reason} (refund=${result.refundId}, invoice=${body.invoiceId}, amountCents=${amountCents ?? 'full'}, by=${adminUser.id})`,
      triggeredBy: 'admin',
    });
    return result;
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/billing/credit')
  async creditUser(
    @Req() req: { user?: AuthenticatedUser },
    @Param('id') userId: string,
    @Body() body: { amountCents?: unknown; reason?: unknown },
  ): Promise<{ ok: true }> {
    const adminUser = this.getUser(req);
    await this.requirePermission(adminUser, 'admin.billing.credit');
    if (typeof body.amountCents !== 'number' || body.amountCents <= 0) throw new BadRequestException('amountCents (positive number) is required');
    if (typeof body.reason !== 'string' || !body.reason) throw new BadRequestException('reason is required');

    if (!this.stripeSvc.isEnabled()) throw new BadRequestException('Stripe not configured');
    const sub = await this.billing.getSubscription(userId);
    if (!sub?.stripe_customer_id) throw new BadRequestException('User has no Stripe customer');

    await this.stripeSvc.createBalanceCredit({
      customerId: sub.stripe_customer_id,
      amountCents: Math.floor(body.amountCents),
      reason: body.reason,
    });
    await this.billing.appendSubscriptionEvent({
      userId,
      fromStatus: sub.status,
      toStatus: sub.status,
      reason: `customer_credit: ${body.reason} (amountCents=${body.amountCents}, by=${adminUser.id})`,
      triggeredBy: 'admin',
    });
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/billing/comp')
  async compUser(
    @Req() req: { user?: AuthenticatedUser },
    @Param('id') userId: string,
    @Body() body: { periodsCount?: unknown; reason?: unknown },
  ): Promise<{ ok: true }> {
    const adminUser = this.getUser(req);
    await this.requirePermission(adminUser, 'admin.billing.comp');
    if (typeof body.reason !== 'string' || !body.reason) throw new BadRequestException('reason is required');
    const periodsCount = typeof body.periodsCount === 'number' && body.periodsCount > 0
      ? Math.floor(body.periodsCount)
      : 1;

    if (!this.stripeSvc.isEnabled()) throw new BadRequestException('Stripe not configured');
    const sub = await this.billing.getSubscription(userId);
    if (!sub?.stripe_customer_id) throw new BadRequestException('User has no Stripe customer');

    await this.stripeSvc.applyCompCoupon({
      customerId: sub.stripe_customer_id,
      periodsCount,
      reason: body.reason,
    });
    await this.billing.appendSubscriptionEvent({
      userId,
      fromStatus: sub.status,
      toStatus: sub.status,
      reason: `comp: ${body.reason} (periods=${periodsCount}, by=${adminUser.id})`,
      triggeredBy: 'admin',
    });
    return { ok: true };
  }
}

/**
 * Operator-facing routes for cron triggers + webhook health.
 * Lives in a second controller so the path prefix stays /admin/billing while
 * the per-user view above stays /admin/users/:id/billing.
 */
@Controller('admin/billing')
export class AdminBillingOpsController {
  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(BillingLifecycleCron) private readonly cron: BillingLifecycleCron,
  ) {}

  private getUser(req: { user?: AuthenticatedUser }): AuthenticatedUser {
    if (!req.user?.id) throw new BadRequestException('Authentication required');
    return req.user;
  }

  private async requireAdmin(user: AuthenticatedUser): Promise<void> {
    const roles = await fetchAdminRoleNames(this.db, user.id);
    const hasAdmin = roles.has('super-admin') || roles.has('admin') || roles.has('owner');
    if (!hasAdmin) throw new ForbiddenException('Admin access required');
  }

  /**
   * Triggers the .edu re-verification cron on demand. Used by Phase 4
   * student-lapse spec + ad-hoc ops use.
   */
  @UseGuards(JwtAuthGuard)
  @Post('run-cron/edu-reverify')
  async runEduReverify(@Req() req: { user?: AuthenticatedUser }) {
    await this.requireAdmin(this.getUser(req));
    return this.cron.reverifyStudents();
  }

  /**
   * Webhook-health rollup for the last 7 days, grouped by date. Surfaces
   * processed / failed / pending counts so operators can spot stuck handlers
   * without paging through individual events.
   */
  @UseGuards(JwtAuthGuard)
  @Get('webhook-health')
  async getWebhookHealth(@Req() req: { user?: AuthenticatedUser }) {
    await this.requireAdmin(this.getUser(req));
    const result = await this.db.rawQuery(
      `SELECT date_trunc('day', received_at)::date::text AS day,
              COUNT(*) FILTER (WHERE processed_at IS NOT NULL AND handler_error IS NULL)::int AS processed,
              COUNT(*) FILTER (WHERE handler_error IS NOT NULL)::int AS failed,
              COUNT(*) FILTER (WHERE processed_at IS NULL AND handler_error IS NULL)::int AS pending
       FROM billing.stripe_webhook_events
       WHERE received_at > now() - interval '7 days'
       GROUP BY 1
       ORDER BY 1 DESC`,
      [],
    );
    if (result.error) throw new BadRequestException(`webhook-health query failed: ${result.error.message}`);
    const days = (result.data as Array<{ day: string; processed: number; failed: number; pending: number }> | null) ?? [];
    return { days };
  }
}
