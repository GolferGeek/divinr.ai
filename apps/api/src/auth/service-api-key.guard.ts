import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ServiceApiKeyService } from './service-api-key.service';

const IS_PUBLIC_KEY = 'isPublic';

/**
 * Guard for service-to-service API key authentication.
 *
 * Validates:
 * 1. Authorization: Bearer div_sk_... (service API key)
 * 2. X-Machine-Identity header (must match allowed identities for the key)
 *
 * Skips validation for routes decorated with @Public().
 * Falls through to next guard if the token is not a service key (e.g., JWT).
 */
@Injectable()
export class ServiceApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ServiceApiKeyGuard.name);

  constructor(
    private readonly apiKeyService: ServiceApiKeyService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Skip for @Public() routes
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      user?: { id: string; email?: string; role?: string };
    }>();

    const authHeader = request.headers['authorization'] as string | undefined;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;

    // If not a service key, let other auth (JWT/dev bypass) handle it
    if (!token?.startsWith('div_sk_')) return true;

    const machineIdentity = request.headers['x-machine-identity'] as string | undefined;

    const keyRecord = await this.apiKeyService.validate(token, machineIdentity);
    if (!keyRecord) {
      this.logger.warn(
        `Service API key rejected — machine: ${machineIdentity ?? '(none)'}`,
      );
      throw new UnauthorizedException('Invalid service API key or machine identity');
    }

    // Set a synthetic user for downstream services
    request.user = {
      id: `service:${keyRecord.label}`,
      email: undefined,
      role: 'service',
    };

    this.logger.debug(`Service key authenticated: ${keyRecord.key_prefix} (${keyRecord.label})`);
    return true;
  }
}
