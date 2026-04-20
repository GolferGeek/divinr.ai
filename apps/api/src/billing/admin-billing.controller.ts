import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
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

interface AuthenticatedUser {
  id: string;
  email?: string;
}

@Controller('admin/users')
export class AdminBillingController {
  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(BillingService) private readonly billing: BillingService,
  ) {}

  private getUser(req: { user?: AuthenticatedUser }): AuthenticatedUser {
    if (!req.user?.id) throw new BadRequestException('Authentication required');
    return req.user;
  }

  private async requireAdmin(user: AuthenticatedUser): Promise<void> {
    const result = await this.db.rawQuery(
      `SELECT r.name FROM authz.rbac_user_roles ur
       JOIN authz.rbac_roles r ON r.id = ur.role_id
       WHERE ur.user_id = $1 AND r.name IN ('super-admin', 'admin', 'owner')
       LIMIT 1`,
      [user.id],
    );
    const rows = (result.data as Array<{ name: string }> | null) ?? [];
    if (rows.length === 0) throw new ForbiddenException('Admin access required');
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
    return {
      subscription,
      authored_items: authoredItems,
      events,
      preview,
    } satisfies {
      subscription: BillingSubscription | null;
      authored_items: BillingAuthoredItem[];
      events: SubscriptionEvent[];
      preview: Awaited<ReturnType<BillingService['getBillingPreview']>>;
    };
  }
}
