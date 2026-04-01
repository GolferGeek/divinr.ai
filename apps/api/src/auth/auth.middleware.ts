import {
  Injectable,
  NestMiddleware,
  UnauthorizedException,
  Logger,
  Inject,
  Optional,
} from '@nestjs/common';
import {
  IDENTITY_PROVIDER,
  type IdentityProvider,
} from '@orchestratorai/planes/auth';

/**
 * Extracts and validates JWT from Authorization header, populating request.user.
 *
 * Uses the auth plane's IdentityProvider for token validation — never touches
 * Supabase or any database SDK directly.
 *
 * When MARKETS_DEV_AUTH_BYPASS=true, falls back to x-user-id headers
 * without JWT validation (local dev only — logged as warning).
 */
@Injectable()
export class AuthMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AuthMiddleware.name);
  private readonly devBypass: boolean;

  constructor(
    @Optional() @Inject(IDENTITY_PROVIDER) private readonly identityProvider?: IdentityProvider,
  ) {
    this.devBypass = process.env.MARKETS_DEV_AUTH_BYPASS === 'true';
    if (this.devBypass) {
      this.logger.warn(
        'MARKETS_DEV_AUTH_BYPASS is enabled — JWT validation is skipped. This must not be used in production.',
      );
    }
    if (!identityProvider && !this.devBypass) {
      this.logger.warn(
        'No IdentityProvider registered — JWT validation will fail. Provide IDENTITY_PROVIDER or enable MARKETS_DEV_AUTH_BYPASS for dev.',
      );
    }
  }

  async use(
    req: Record<string, unknown> & {
      headers: Record<string, string | string[] | undefined>;
      user?: { id: string; email?: string; role?: string; appMetadata?: Record<string, unknown> };
    },
    _res: unknown,
    next: () => void,
  ) {
    const authHeader = req.headers['authorization'] as string | undefined;

    if (authHeader?.startsWith('Bearer ') && this.identityProvider) {
      const token = authHeader.slice(7);
      try {
        const principal = await this.identityProvider.validateToken(token);

        req.user = {
          id: principal.id,
          email: principal.email,
          role: principal.role ?? 'authenticated',
          appMetadata: principal.appMetadata || {},
        };
        return next();
      } catch (err) {
        if (err instanceof UnauthorizedException) throw err;
        throw new UnauthorizedException('Token validation failed');
      }
    }

    // Dev bypass: trust x-user-id header when no Bearer token and bypass is enabled
    if (this.devBypass) {
      const userId = req.headers['x-user-id'] as string | undefined;
      if (userId) {
        req.user = {
          id: userId,
          email: undefined,
          role: 'authenticated',
        };
        return next();
      }
    }

    // No token and no bypass — let the guard handle rejection
    return next();
  }
}
