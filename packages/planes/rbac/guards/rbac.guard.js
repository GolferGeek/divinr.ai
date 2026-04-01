"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var RbacGuard_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RbacGuard = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const rbac_service_1 = require("../rbac.service");
const require_permission_decorator_1 = require("../decorators/require-permission.decorator");
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
let RbacGuard = RbacGuard_1 = class RbacGuard {
    reflector;
    rbacService;
    logger = new common_1.Logger(RbacGuard_1.name);
    constructor(reflector, rbacService) {
        this.reflector = reflector;
        this.rbacService = rbacService;
    }
    async canActivate(context) {
        // Get required permission from route metadata
        const permission = this.reflector.getAllAndOverride(require_permission_decorator_1.PERMISSION_KEY, [context.getHandler(), context.getClass()]);
        // If no permission is specified, allow access
        if (!permission) {
            return true;
        }
        const request = context.switchToHttp().getRequest();
        const user = request.user;
        // Ensure user is authenticated (JwtAuthGuard should have run first)
        if (!user || !user.id) {
            this.logger.warn('[RbacGuard] No user found on request - JwtAuthGuard should run first');
            throw new common_1.ForbiddenException('Authentication required');
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
        }
        catch (error) {
            // Log error but continue with normal permission check
            // This prevents 500 errors if super admin check fails
            this.logger.warn(`[RbacGuard] Super admin check failed, continuing with normal permission check: ${error instanceof Error ? error.message : String(error)}`);
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
            }
            catch (error) {
                // Log error but continue with normal permission check
                this.logger.warn(`[RbacGuard] Admin check failed, continuing with normal permission check: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        // Check for resource-specific permission
        const resourceParam = this.reflector.get(require_permission_decorator_1.RESOURCE_PARAM_KEY, context.getHandler());
        const resourceId = resourceParam
            ? request.params[resourceParam]
            : undefined;
        // Check permission
        const hasAccess = await this.rbacService.hasPermission(user.id, orgSlug, permission, undefined, resourceId);
        if (!hasAccess) {
            this.logger.warn(`Permission denied: user=${user.id}, org=${orgSlug}, permission=${permission}`);
            throw new common_1.ForbiddenException(`Permission denied: ${permission}`);
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
    getOrganizationSlug(request) {
        return (request.headers?.['x-organization-slug'] ||
            request.query?.organizationSlug ||
            request.body?.organizationSlug ||
            undefined);
    }
};
exports.RbacGuard = RbacGuard;
exports.RbacGuard = RbacGuard = RbacGuard_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.Reflector,
        rbac_service_1.RbacService])
], RbacGuard);
