import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
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
  organizationSlug?: string;
}

/**
 * Guard to enforce permission-based access control
 *
 * This guard works in conjunction with the @RequirePermission() decorator
 * to ensure users have the required permissions to access protected endpoints.
 *
 * The organization slug is read from:
 * 1. x-organization-slug header
 * 2. organizationSlug query parameter
 * 3. organizationSlug in request body
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
    private readonly reflector: Reflector,
    private readonly rbacService: RbacService,
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
    // Wrap in try-catch to handle potential database errors gracefully
    try {
      const isSuperAdmin = await this.rbacService.isSuperAdmin(user.id);
      if (isSuperAdmin) {
        // Still set organization slug for use in controllers
        const orgSlug = this.getOrganizationSlug(request) || '*';
        request.organizationSlug = orgSlug;
        return true;
      }
    } catch (error) {
      // Log error but continue with normal permission check
      // This prevents 500 errors if super admin check fails
      this.logger.warn(
        `[RbacGuard] Super admin check failed, continuing with normal permission check: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Get organization slug from request (use '*' for global/admin endpoints)
    const orgSlug = this.getOrganizationSlug(request) || '*';

    // For admin permissions (admin:*), also check if user is admin for the organization
    // This allows org admins to access admin endpoints without needing explicit permission grants
    if (permission.startsWith('admin:')) {
      try {
        const isAdmin = await this.rbacService.isAdmin(user.id, orgSlug);
        if (isAdmin) {
          request.organizationSlug = orgSlug;
          return true;
        }
      } catch (error) {
        // Log error but continue with normal permission check
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
      orgSlug,
      permission,
      undefined,
      resourceId,
    );

    if (!hasAccess) {
      this.logger.warn(
        `Permission denied: user=${user.id}, org=${orgSlug}, permission=${permission}`,
      );
      throw new ForbiddenException(`Permission denied: ${permission}`);
    }

    // Add organization slug to request for use in controllers
    request.organizationSlug = orgSlug;

    return true;
  }

  /**
   * Extract organization slug from request
   * Priority: header > query > body
   * Safely handles SSE and other request types that may not have all properties
   */
  private getOrganizationSlug(request: TypedRequest): string | undefined {
    return (
      request.headers?.['x-organization-slug'] ||
      request.query?.organizationSlug ||
      request.body?.organizationSlug ||
      undefined
    );
  }
}
