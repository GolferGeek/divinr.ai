import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@orchestratorai/planes/auth';
import { BillingService } from './billing.service';
import { SkipReadOnly } from './skip-read-only.decorator';

@Controller('billing')
export class BillingController {
  constructor(
    @Inject(BillingService) private readonly billing: BillingService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get('preview')
  async getPreview(@Req() req: any) {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Authentication required');
    return this.billing.getBillingPreview(userId);
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
    };
  }

  // Stripe checkout/portal — require auth; webhook is unauthenticated (Stripe signature verified when wired)
  @UseGuards(JwtAuthGuard)
  @SkipReadOnly()
  @Post('checkout-session')
  async createCheckoutSession() {
    return { url: null, message: 'Stripe not configured — billing preview only' };
  }

  @UseGuards(JwtAuthGuard)
  @SkipReadOnly()
  @Post('portal-session')
  async createPortalSession() {
    return { url: null, message: 'Stripe not configured — billing preview only' };
  }

  @SkipReadOnly()
  @Post('webhooks/stripe')
  async handleStripeWebhook() {
    return { received: true };
  }
}
