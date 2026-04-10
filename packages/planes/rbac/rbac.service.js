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
var RbacService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RbacService = void 0;
const common_1 = require("@nestjs/common");
const database_1 = require("../database");
let RbacService = RbacService_1 = class RbacService {
    db;
    logger = new common_1.Logger(RbacService_1.name);
    constructor(db) {
        this.db = db;
    }
    /**
     * Check if user has permission in organization
     */
    async hasPermission(userId, organizationSlug, permission, resourceType, resourceId) {
        const { data, error } = (await this.db.rpc('rbac_has_permission', {
            p_user_id: userId,
            p_organization_slug: organizationSlug,
            p_permission: permission,
            p_resource_type: resourceType || null,
            p_resource_id: resourceId || null,
        }, 'authz'));
        if (error) {
            this.logger.error(`Permission check failed: ${error.message}`, error);
            return false;
        }
        return data === true;
    }
    /**
     * Require permission - throws ForbiddenException if not authorized
     */
    async requirePermission(userId, organizationSlug, permission, resourceType, resourceId) {
        const hasAccess = await this.hasPermission(userId, organizationSlug, permission, resourceType, resourceId);
        if (!hasAccess) {
            throw new common_1.ForbiddenException(`Permission denied: ${permission}${resourceType ? ` on ${resourceType}` : ''}`);
        }
    }
    /**
     * Get all permissions for user in organization
     */
    async getUserPermissions(userId, organizationSlug) {
        const { data, error } = (await this.db.rpc('rbac_get_user_permissions', {
            p_user_id: userId,
            p_organization_slug: organizationSlug,
        }, 'authz'));
        if (error) {
            this.logger.error(`Failed to get user permissions: ${error.message}`, error);
            return [];
        }
        return (data || []).map((row) => ({
            permission: row.permission_name,
            resourceType: row.resource_type,
            resourceId: row.resource_id,
        }));
    }
    /**
     * Get user's roles in organization
     */
    async getUserRoles(userId, organizationSlug) {
        const { data, error } = (await this.db.rpc('rbac_get_user_roles', {
            p_user_id: userId,
            p_organization_slug: organizationSlug,
        }, 'authz'));
        if (error) {
            this.logger.error(`Failed to get user roles: ${error.message}`, error);
            return [];
        }
        return (data || []).map((row) => ({
            id: row.role_id,
            name: row.role_name,
            displayName: row.role_display_name,
            isGlobal: row.is_global,
            assignedAt: new Date(row.assigned_at),
            expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
        }));
    }
    /**
     * Get all organizations user has access to
     */
    async getUserOrganizations(userId) {
        const { data, error } = (await this.db.rpc('rbac_get_user_organizations', {
            p_user_id: userId,
        }, 'authz'));
        if (error) {
            this.logger.error(`Failed to get user organizations: ${error.message}`, error);
            return [];
        }
        return (data || []).map((row) => ({
            organizationSlug: row.organization_slug,
            organizationName: row.organization_name,
            roleName: row.role_name,
            isGlobal: row.is_global,
        }));
    }
    /**
     * Get all users in an organization with their roles
     */
    async getOrganizationUsers(organizationSlug) {
        const { data, error } = (await this.db.rpc('rbac_get_organization_users', {
            p_organization_slug: organizationSlug,
        }, 'authz'));
        if (error) {
            this.logger.error(`Failed to get organization users: ${error.message}`, error);
            return [];
        }
        // Group roles by user and deduplicate
        const userMap = new Map();
        (data || []).forEach((row) => {
            if (!userMap.has(row.user_id)) {
                userMap.set(row.user_id, {
                    userId: row.user_id,
                    email: row.email,
                    displayName: row.display_name,
                    roles: [],
                });
            }
            const user = userMap.get(row.user_id);
            // Check if this role already exists for this user
            // Prefer org-specific role over global role for this org
            const existingRoleIndex = user.roles.findIndex((r) => r.name === row.role_name);
            if (existingRoleIndex === -1) {
                // Role doesn't exist, add it
                user.roles.push({
                    id: row.role_id,
                    name: row.role_name,
                    displayName: row.role_display_name,
                    isGlobal: row.is_global,
                    assignedAt: new Date(row.assigned_at),
                    expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
                });
            }
            else if (!row.is_global) {
                // Role exists but this one is org-specific, prefer it over global
                user.roles[existingRoleIndex] = {
                    id: row.role_id,
                    name: row.role_name,
                    displayName: row.role_display_name,
                    isGlobal: row.is_global,
                    assignedAt: new Date(row.assigned_at),
                    expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
                };
            }
            // If role exists and new one is global, skip it (keep org-specific)
        });
        return Array.from(userMap.values());
    }
    /**
     * Get all available roles
     */
    async getAllRoles() {
        const { data, error } = (await this.db
            .from('authz', 'rbac_roles')
            .select('id, name, display_name, description, is_system')
            .order('name'));
        if (error) {
            this.logger.error(`Failed to get roles: ${error.message}`, error);
            return [];
        }
        const typedData = data;
        return (typedData || []).map((row) => ({
            id: row.id,
            name: row.name,
            displayName: row.display_name,
            description: row.description,
            isSystem: row.is_system,
        }));
    }
    /**
     * Get all available permissions
     */
    async getAllPermissions() {
        const { data, error } = (await this.db
            .from('authz', 'rbac_permissions')
            .select('id, name, display_name, description, category')
            .order('category')
            .order('name'));
        if (error) {
            this.logger.error(`Failed to get permissions: ${error.message}`, error);
            return [];
        }
        const typedData = data;
        return (typedData || []).map((row) => ({
            id: row.id,
            name: row.name,
            displayName: row.display_name,
            description: row.description,
            category: row.category,
        }));
    }
    /**
     * Get permissions for a specific role
     */
    async getRolePermissions(roleId) {
        // Get permission IDs for this role
        const { data: rpData, error: rpError } = (await this.db
            .from('authz', 'rbac_role_permissions')
            .select('permission_id')
            .eq('role_id', roleId));
        if (rpError) {
            this.logger.error(`Failed to get role permissions: ${rpError.message}`, rpError);
            return [];
        }
        if (!rpData || rpData.length === 0) {
            return [];
        }
        const permissionIds = rpData.map((row) => row.permission_id);
        // Get permission names
        const { data: permData, error: permError } = (await this.db
            .from('authz', 'rbac_permissions')
            .select('id, name')
            .in('id', permissionIds));
        if (permError || !permData) {
            return [];
        }
        return permData.map((row) => row.name);
    }
    /**
     * Add permission to a role
     */
    async addPermissionToRole(roleId, permissionId) {
        const { error } = (await this.db
            .from('authz', 'rbac_role_permissions')
            .insert({
            role_id: roleId,
            permission_id: permissionId,
        }));
        if (error) {
            this.logger.error(`Failed to add permission to role: ${error.message}`, error);
            throw new Error(`Failed to add permission to role: ${error.message}`);
        }
    }
    /**
     * Remove permission from a role
     */
    async removePermissionFromRole(roleId, permissionId) {
        const { error } = (await this.db
            .from('authz', 'rbac_role_permissions')
            .delete()
            .eq('role_id', roleId)
            .eq('permission_id', permissionId));
        if (error) {
            this.logger.error(`Failed to remove permission from role: ${error.message}`, error);
            throw new Error(`Failed to remove permission from role: ${error.message}`);
        }
    }
    /**
     * Assign role to user in organization
     */
    async assignRole(targetUserId, organizationSlug, roleName, assignedBy, expiresAt) {
        // Get role ID
        const { data: role, error: roleError } = (await this.db
            .from('authz', 'rbac_roles')
            .select('id')
            .eq('name', roleName)
            .single());
        if (roleError || !role) {
            throw new Error(`Role not found: ${roleName}`);
        }
        const typedRole = role;
        // Insert assignment
        const { error } = await this.db.from('authz', 'rbac_user_roles').upsert({
            user_id: targetUserId,
            organization_slug: organizationSlug,
            role_id: typedRole.id,
            assigned_by: assignedBy,
            expires_at: expiresAt?.toISOString() || null,
        }, {
            onConflict: 'user_id,organization_slug,role_id',
        });
        if (error) {
            throw new Error(`Failed to assign role: ${error.message}`);
        }
        // Audit log
        await this.logAudit('grant', assignedBy, targetUserId, typedRole.id, organizationSlug, {
            role_name: roleName,
            expires_at: expiresAt?.toISOString(),
        });
    }
    /**
     * Revoke role from user in organization
     */
    async revokeRole(targetUserId, organizationSlug, roleName, revokedBy) {
        // Get role ID
        const { data: role, error: roleError } = (await this.db
            .from('authz', 'rbac_roles')
            .select('id')
            .eq('name', roleName)
            .single());
        if (roleError || !role) {
            throw new Error(`Role not found: ${roleName}`);
        }
        const typedRole = role;
        // Delete assignment
        const { error } = (await this.db
            .from('authz', 'rbac_user_roles')
            .delete()
            .eq('user_id', targetUserId)
            .eq('organization_slug', organizationSlug)
            .eq('role_id', typedRole.id));
        if (error) {
            throw new Error(`Failed to revoke role: ${error.message}`);
        }
        // Audit log
        await this.logAudit('revoke', revokedBy, targetUserId, typedRole.id, organizationSlug, {
            role_name: roleName,
        });
    }
    /**
     * Check if user is super-admin
     * Super-admin is determined by having the 'super-admin' role
     * Can be assigned with organization_slug = '*' (global access) or to specific organizations
     * If user has super-admin role in ANY organization, they are considered super-admin
     */
    async isSuperAdmin(userId) {
        // Check if user has super-admin role by joining user_org_roles with roles
        const { data, error } = (await this.db
            .from('authz', 'rbac_user_roles')
            .select('id, role_id, organization_slug')
            .eq('user_id', userId)
            .limit(100));
        if (error) {
            this.logger.error(`[RbacService] Error checking super admin: ${error.message}`);
            return false;
        }
        if (!data || data.length === 0) {
            return false;
        }
        // Get the super-admin role ID
        const { data: superAdminRole, error: roleError } = (await this.db
            .from('authz', 'rbac_roles')
            .select('id')
            .eq('name', 'super-admin')
            .maybeSingle());
        if (roleError || !superAdminRole) {
            return false;
        }
        const saRoleId = superAdminRole.id;
        const typedData = data;
        return typedData.some((record) => record.role_id === saRoleId);
    }
    /**
     * Check if user is admin for a specific organization
     * Admin is determined by having the 'admin' role for the organization
     * Also returns true if user is super-admin (global access)
     * If organizationSlug is '*', checks if user is admin for any organization
     */
    async isAdmin(userId, organizationSlug) {
        // Super admins are admins everywhere
        const isSuperAdmin = await this.isSuperAdmin(userId);
        if (isSuperAdmin) {
            return true;
        }
        // Get the admin role ID
        const { data: adminRole, error: roleError } = (await this.db
            .from('authz', 'rbac_roles')
            .select('id')
            .eq('name', 'admin')
            .maybeSingle());
        if (roleError || !adminRole) {
            return false;
        }
        const adminRoleId = adminRole.id;
        // If organizationSlug is '*', check if user is admin for any organization
        if (organizationSlug === '*') {
            const { data, error } = (await this.db
                .from('authz', 'rbac_user_roles')
                .select('id, role_id')
                .eq('user_id', userId)
                .eq('role_id', adminRoleId)
                .limit(1));
            if (error) {
                this.logger.error(`[RbacService] Error checking admin (any org): ${error.message}`);
                return false;
            }
            return !!data && data.length > 0;
        }
        // Check if user has admin role for the specific organization
        const { data, error } = (await this.db
            .from('authz', 'rbac_user_roles')
            .select('id, role_id')
            .eq('user_id', userId)
            .eq('organization_slug', organizationSlug)
            .eq('role_id', adminRoleId)
            .limit(1));
        if (error) {
            this.logger.error(`[RbacService] Error checking admin: ${error.message}`);
            return false;
        }
        return !!data && data.length > 0;
    }
    /**
     * Get audit log entries
     */
    async getAuditLog(organizationSlug, limit = 100) {
        let query = this.db
            .from('authz', 'rbac_audit_log')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(limit);
        if (organizationSlug) {
            query = query.eq('organization_slug', organizationSlug);
        }
        const { data, error } = (await query);
        if (error) {
            this.logger.error(`Failed to get audit log: ${error.message}`, error);
            return [];
        }
        return (data || []).map((row) => ({
            id: row.id,
            action: row.action,
            actorId: row.actor_id,
            targetUserId: row.target_user_id,
            targetRoleId: row.target_role_id,
            organizationSlug: row.organization_slug,
            details: row.details,
            createdAt: new Date(row.created_at),
        }));
    }
    /**
     * Log an audit entry
     */
    async logAudit(action, actorId, targetUserId, targetRoleId, organizationSlug, details) {
        await this.db.from('authz', 'rbac_audit_log').insert({
            action,
            actor_id: actorId,
            target_user_id: targetUserId,
            target_role_id: targetRoleId,
            organization_slug: organizationSlug,
            details,
        });
    }
};
exports.RbacService = RbacService;
exports.RbacService = RbacService = RbacService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(database_1.DATABASE_SERVICE)),
    __metadata("design:paramtypes", [Object])
], RbacService);
