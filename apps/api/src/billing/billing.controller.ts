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

@UseGuards(JwtAuthGuard)
@Controller('billing')
export class BillingController {
  constructor(
    @Inject(BillingService) private readonly billing: BillingService,
  ) {}

  @Get('preview')
  async getPreview(@Req() req: any) {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Authentication required');
    return this.billing.getBillingPreview(userId);
  }

  @Get('subscription')
  async getSubscription(@Req() req: any) {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Authentication required');
    return this.billing.getSubscription(userId);
  }

  // Stripe checkout/portal/webhook endpoints — stubs until Stripe SDK is integrated
  @Post('checkout-session')
  async createCheckoutSession() {
    return { url: null, message: 'Stripe not configured — billing preview only' };
  }

  @Post('portal-session')
  async createPortalSession() {
    return { url: null, message: 'Stripe not configured — billing preview only' };
  }

  @Post('webhooks/stripe')
  async handleStripeWebhook() {
    return { received: true };
  }
}
