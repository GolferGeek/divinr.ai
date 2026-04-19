import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BillingService } from './billing.service';
import { SKIP_READ_ONLY_KEY } from './skip-read-only.decorator';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global read-only gate. Blocks write requests (non-safe HTTP verbs) for users
 * whose subscription is canceled or dormant. Exempt routes are opted out via
 * @SkipReadOnly() and include auth, billing status/checkout, and self-serve
 * social opt-outs so an expired user can still reactivate or tidy their data.
 */
@Injectable()
export class ReadOnlyGuard implements CanActivate {
  constructor(
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      method?: string;
      originalUrl?: string;
      url?: string;
      user?: { id?: string };
    }>();

    const method = (request.method ?? 'GET').toUpperCase();
    if (SAFE_METHODS.has(method)) return true;

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_READ_ONLY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    if (this.isExemptByPath(request.originalUrl ?? request.url ?? '')) return true;

    const userId = request.user?.id;
    if (!userId) return true;

    const readOnly = await this.billing.isReadOnly(userId);
    if (readOnly) {
      throw new ForbiddenException({
        code: 'SUBSCRIPTION_EXPIRED',
        message: 'Your subscription has expired. Reactivate to continue making changes.',
      });
    }
    return true;
  }

  private isExemptByPath(path: string): boolean {
    if (!path) return false;
    const clean = path.split('?')[0];
    if (clean.startsWith('/auth/')) return true;
    if (clean === '/auth') return true;
    if (clean === '/billing/status') return true;
    if (clean === '/billing/checkout-session') return true;
    if (clean === '/billing/portal-session') return true;
    if (clean === '/billing/webhooks/stripe') return true;
    if (/^\/users\/[^/]+\/social-opt-outs$/.test(clean)) return true;
    return false;
  }
}
