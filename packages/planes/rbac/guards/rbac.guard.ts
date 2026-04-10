import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RbacService } from '../rbac.service';
import {
  PERMISSION_KEY,
  RESOURCE_PARAM_KEY,
} from '../decorators/require-permission.decorator';
import { SupabaseAuthUserDto } from '../../auth/dto/auth.dto';

/**
 * Request user type from JWT authentication
 */
interface RequestUser extends Partial<SupabaseAuthUserDto> {
  id: string;
}

/**
 * Typed request interface for HTTP requests with auth
 */
interface TypedRequest {
  user?: RequestUser;
  headers: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
  body: Record<string, string | undefined>;
  params: Record<string, string | undefined>;
}

/**
 * Guard to enforce permission-based access control
 *
 * This guard works in conjunction with the @RequirePermission() decorator
 * to ensure users have the required permissions to access protected endpoints.
 *
 * @example
 * ```typescript
 * @RequirePermission('rag:write')
 * @Post('documents')
 * async uploadDocument() {
 *   // Only users with 'rag:write' permission can access this
 * }
 * ```
 */
@Injectable()
export class RbacGuard implements CanActivate {
  private readonly logger = new Logger(RbacGuard.name);

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(RbacService) private readonly rbacService: RbacService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Get required permission from route metadata
    const permission = this.reflector.getAllAndOverride<string>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    // If no permission is specified, allow access
    if (!permission) {
      return true;
    }

    const request = context.switchToHttp().getRequest<TypedRequest>();
    const user = request.user;

    // Ensure user is authenticated (JwtAuthGuard should have run first)
    if (!user || !user.id) {
      this.logger.warn(
        '[RbacGuard] No user found on request - JwtAuthGuard should run first',
      );
      throw new ForbiddenException('Authentication required');
    }

    // Check if user is super admin via RBAC service
    // Super admins bypass all permission checks
    try {
      const isSuperAdmin = await this.rbacService.isSuperAdmin(user.id);
      if (isSuperAdmin) {
        return true;
      }
    } catch (error) {
      this.logger.warn(
        `[RbacGuard] Super admin check failed, continuing with normal permission check: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // For admin permissions (admin:*), also check if user is admin
    if (permission.startsWith('admin:')) {
      try {
        const isAdmin = await this.rbacService.isAdmin(user.id);
        if (isAdmin) {
          return true;
        }
      } catch (error) {
        this.logger.warn(
          `[RbacGuard] Admin check failed, continuing with normal permission check: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Check for resource-specific permission
    const resourceParam = this.reflector.get<string>(
      RESOURCE_PARAM_KEY,
      context.getHandler(),
    );
    const resourceId = resourceParam
      ? request.params[resourceParam]
      : undefined;

    // Check permission
    const hasAccess = await this.rbacService.hasPermission(
      user.id,
      permission,
      undefined,
      resourceId,
    );

    if (!hasAccess) {
      this.logger.warn(
        `Permission denied: user=${user.id}, permission=${permission}`,
      );
      throw new ForbiddenException(`Permission denied: ${permission}`);
    }

    return true;
  }
}
