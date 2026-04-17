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

  // Stripe checkout/portal — require auth; webhook is unauthenticated (Stripe signature verified when wired)
  @UseGuards(JwtAuthGuard)
  @Post('checkout-session')
  async createCheckoutSession() {
    return { url: null, message: 'Stripe not configured — billing preview only' };
  }

  @UseGuards(JwtAuthGuard)
  @Post('portal-session')
  async createPortalSession() {
    return { url: null, message: 'Stripe not configured — billing preview only' };
  }

  @Post('webhooks/stripe')
  async handleStripeWebhook() {
    return { received: true };
  }
}
