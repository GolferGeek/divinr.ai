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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RbacController = void 0;
const common_1 = require("@nestjs/common");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
const current_user_decorator_1 = require("../auth/decorators/current-user.decorator");
const rbac_service_1 = require("./rbac.service");
const require_permission_decorator_1 = require("./decorators/require-permission.decorator");
// DTOs
class AssignRoleDto {
    organizationSlug;
    roleName;
    expiresAt;
}
/**
 * RBAC Controller
 * Manages roles, permissions, and user-role assignments
 */
let RbacController = class RbacController {
    rbacService;
    constructor(rbacService) {
        this.rbacService = rbacService;
    }
    // ==================== ROLES ====================
    /**
     * Get all available roles
     */
    async getAllRoles() {
        const roles = await this.rbacService.getAllRoles();
        return { roles };
    }
    /**
     * Get all available permissions (grouped by category)
     */
    async getAllPermissions() {
        const permissions = await this.rbacService.getAllPermissions();
        // Group by category for easier frontend rendering
        const grouped = permissions.reduce((acc, perm) => {
            const category = perm.category || 'other';
            if (!acc[category]) {
                acc[category] = [];
            }
            acc[category].push(perm);
            return acc;
        }, {});
        return { permissions, grouped };
    }
    /**
     * Get permissions for a specific role
     */
    async getRolePermissions(roleId) {
        const permissions = await this.rbacService.getRolePermissions(roleId);
        return { permissions };
    }
    /**
     * Add permission to a role
     */
    async addPermissionToRole(roleId, permissionId) {
        await this.rbacService.addPermissionToRole(roleId, permissionId);
        return { success: true, message: 'Permission added to role' };
    }
    /**
     * Remove permission from a role
     */
    async removePermissionFromRole(roleId, permissionId) {
        await this.rbacService.removePermissionFromRole(roleId, permissionId);
        return { success: true, message: 'Permission removed from role' };
    }
    // ==================== CURRENT USER ====================
    /**
     * Get current user's roles in an organization
     */
    async getMyRoles(orgSlug, user) {
        const roles = await this.rbacService.getUserRoles(user.id, orgSlug);
        return { roles };
    }
    /**
     * Get current user's permissions in an organization
     */
    async getMyPermissions(orgSlug, user) {
        const permissions = await this.rbacService.getUserPermissions(user.id, orgSlug);
        return { permissions };
    }
    /**
     * Get current user's organizations
     */
    async getMyOrganizations(user) {
        const organizations = await this.rbacService.getUserOrganizations(user.id);
        return { organizations };
    }
    /**
     * Check if current user is super-admin
     */
    async checkSuperAdmin(user) {
        const isSuperAdmin = await this.rbacService.isSuperAdmin(user.id);
        return { isSuperAdmin };
    }
    /**
     * Check if current user has a specific permission
     */
    async checkPermission(permission, orgSlug, resourceType, resourceId, user) {
        if (!user) {
            return { hasPermission: false };
        }
        const hasAccess = await this.rbacService.hasPermission(user.id, orgSlug, permission, resourceType, resourceId);
        return { hasPermission: hasAccess };
    }
    // ==================== USER ROLE MANAGEMENT ====================
    /**
     * Get a user's roles in an organization (admin only)
     */
    async getUserRoles(userId, orgSlug) {
        const roles = await this.rbacService.getUserRoles(userId, orgSlug);
        return { roles };
    }
    /**
     * Get a user's permissions in an organization (admin only)
     */
    async getUserPermissions(userId, orgSlug) {
        const permissions = await this.rbacService.getUserPermissions(userId, orgSlug);
        return { permissions };
    }
    /**
     * Assign role to a user (admin only)
     */
    async assignRole(userId, dto, currentUser) {
        await this.rbacService.assignRole(userId, dto.organizationSlug, dto.roleName, currentUser.id, dto.expiresAt ? new Date(dto.expiresAt) : undefined);
        return {
            success: true,
            message: `Role '${dto.roleName}' assigned to user`,
        };
    }
    /**
     * Revoke role from a user (admin only)
     */
    async revokeRole(userId, roleName, orgSlug, currentUser) {
        await this.rbacService.revokeRole(userId, orgSlug, roleName, currentUser.id);
        return { success: true, message: `Role '${roleName}' revoked from user` };
    }
    // ==================== ORGANIZATION USER MANAGEMENT ====================
    /**
     * Get all users in an organization with their roles (admin only)
     */
    async getOrganizationUsers(orgSlug) {
        const users = await this.rbacService.getOrganizationUsers(orgSlug);
        return { users };
    }
    // ==================== AUDIT LOG ====================
    /**
     * Get RBAC audit log (admin only)
     */
    async getAuditLog(orgSlug, limit = 100) {
        const entries = await this.rbacService.getAuditLog(orgSlug, limit);
        return { entries };
    }
};
exports.RbacController = RbacController;
__decorate([
    (0, common_1.Get)('roles'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], RbacController.prototype, "getAllRoles", null);
__decorate([
    (0, common_1.Get)('permissions'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], RbacController.prototype, "getAllPermissions", null);
__decorate([
    (0, common_1.Get)('roles/:roleId/permissions'),
    __param(0, (0, common_1.Param)('roleId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], RbacController.prototype, "getRolePermissions", null);
__decorate([
    (0, common_1.Post)('roles/:roleId/permissions/:permissionId'),
    (0, require_permission_decorator_1.RequirePermission)('admin:roles'),
    __param(0, (0, common_1.Param)('roleId')),
    __param(1, (0, common_1.Param)('permissionId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], RbacController.prototype, "addPermissionToRole", null);
__decorate([
    (0, common_1.Delete)('roles/:roleId/permissions/:permissionId'),
    (0, require_permission_decorator_1.RequirePermission)('admin:roles'),
    __param(0, (0, common_1.Param)('roleId')),
    __param(1, (0, common_1.Param)('permissionId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], RbacController.prototype, "removePermissionFromRole", null);
__decorate([
    (0, common_1.Get)('me/roles'),
    __param(0, (0, common_1.Query)('organizationSlug')),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], RbacController.prototype, "getMyRoles", null);
__decorate([
    (0, common_1.Get)('me/permissions'),
    __param(0, (0, common_1.Query)('organizationSlug')),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], RbacController.prototype, "getMyPermissions", null);
__decorate([
    (0, common_1.Get)('me/organizations'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], RbacController.prototype, "getMyOrganizations", null);
__decorate([
    (0, common_1.Get)('me/is-super-admin'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], RbacController.prototype, "checkSuperAdmin", null);
__decorate([
    (0, common_1.Get)('check'),
    __param(0, (0, common_1.Query)('permission')),
    __param(1, (0, common_1.Query)('organizationSlug')),
    __param(2, (0, common_1.Query)('resourceType')),
    __param(3, (0, common_1.Query)('resourceId')),
    __param(4, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String, Object]),
    __metadata("design:returntype", Promise)
], RbacController.prototype, "checkPermission", null);
__decorate([
    (0, common_1.Get)('users/:userId/roles'),
    (0, require_permission_decorator_1.RequirePermission)('admin:users'),
    __param(0, (0, common_1.Param)('userId')),
    __param(1, (0, common_1.Query)('organizationSlug')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], RbacController.prototype, "getUserRoles", null);
__decorate([
    (0, common_1.Get)('users/:userId/permissions'),
    (0, require_permission_decorator_1.RequirePermission)('admin:users'),
    __param(0, (0, common_1.Param)('userId')),
    __param(1, (0, common_1.Query)('organizationSlug')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], RbacController.prototype, "getUserPermissions", null);
__decorate([
    (0, common_1.Post)('users/:userId/roles'),
    (0, require_permission_decorator_1.RequirePermission)('admin:roles'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Param)('userId')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, AssignRoleDto, Object]),
    __metadata("design:returntype", Promise)
], RbacController.prototype, "assignRole", null);
__decorate([
    (0, common_1.Delete)('users/:userId/roles/:roleName'),
    (0, require_permission_decorator_1.RequirePermission)('admin:roles'),
    __param(0, (0, common_1.Param)('userId')),
    __param(1, (0, common_1.Param)('roleName')),
    __param(2, (0, common_1.Query)('organizationSlug')),
    __param(3, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, Object]),
    __metadata("design:returntype", Promise)
], RbacController.prototype, "revokeRole", null);
__decorate([
    (0, common_1.Get)('organizations/:orgSlug/users'),
    (0, require_permission_decorator_1.RequirePermission)('admin:users'),
    __param(0, (0, common_1.Param)('orgSlug')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], RbacController.prototype, "getOrganizationUsers", null);
__decorate([
    (0, common_1.Get)('audit'),
    (0, require_permission_decorator_1.RequirePermission)('admin:audit'),
    __param(0, (0, common_1.Query)('organizationSlug')),
    __param(1, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], RbacController.prototype, "getAuditLog", null);
exports.RbacController = RbacController = __decorate([
    (0, common_1.Controller)('api/rbac'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [rbac_service_1.RbacService])
], RbacController);
