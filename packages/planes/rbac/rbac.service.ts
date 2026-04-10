import { Injectable, Inject, ForbiddenException, Logger } from '@nestjs/common';
import { DATABASE_SERVICE, DatabaseService } from '../database';

/**
 * Database row types for RPC and table queries
 */
interface RpcPermissionRow {
  permission_name: string;
  resource_type?: string;
  resource_id?: string;
}

interface RpcRoleRow {
  role_id: string;
  role_name: string;
  role_display_name: string;
  is_global: boolean;
  assigned_at: string;
  expires_at?: string;
}

interface RbacRoleDbRow {
  id: string;
  name: string;
  display_name: string;
  description?: string;
  is_system: boolean;
}

interface RbacPermissionDbRow {
  id: string;
  name: string;
  display_name: string;
  description?: string;
  category?: string;
}

interface RbacAuditLogDbRow {
  id: string;
  action: string;
  actor_id: string;
  target_user_id: string;
  target_role_id: string;
  organization_slug: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface PermissionCheck {
  permission: string;
  resourceType?: string;
  resourceId?: string;
}

export interface UserRole {
  id: string;
  name: string;
  displayName: string;
  isGlobal: boolean;
  assignedAt: Date;
  expiresAt?: Date;
}

export interface UserPermission {
  permission: string;
  resourceType?: string;
  resourceId?: string;
}

export interface RbacRole {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  isSystem: boolean;
}

export interface RbacPermission {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  category?: string;
}

@Injectable()
export class RbacService {
  private readonly logger = new Logger(RbacService.name);

  constructor(@Inject(DATABASE_SERVICE) private readonly db: DatabaseService) {}

  /**
   * Check if user has permission (global, no org scoping)
   */
  async hasPermission(
    userId: string,
    permission: string,
    resourceType?: string,
    resourceId?: string,
  ): Promise<boolean> {
    const { data, error } = (await this.db.rpc(
      'rbac_has_permission',
      {
        p_user_id: userId,
        p_permission: permission,
        p_resource_type: resourceType || null,
        p_resource_id: resourceId || null,
      },
      'authz',
    )) as { data: boolean | null; error: { message: string } | null };

    if (error) {
      this.logger.error(`Permission check failed: ${error.message}`, error);
      return false;
    }

    return data === true;
  }

  /**
   * Require permission - throws ForbiddenException if not authorized
   */
  async requirePermission(
    userId: string,
    permission: string,
    resourceType?: string,
    resourceId?: string,
  ): Promise<void> {
    const hasAccess = await this.hasPermission(
      userId,
      permission,
      resourceType,
      resourceId,
    );

    if (!hasAccess) {
      throw new ForbiddenException(
        `Permission denied: ${permission}${resourceType ? ` on ${resourceType}` : ''}`,
      );
    }
  }

  /**
   * Get all permissions for user
   */
  async getUserPermissions(
    userId: string,
  ): Promise<UserPermission[]> {
    const { data, error } = (await this.db.rpc(
      'rbac_get_user_permissions',
      {
        p_user_id: userId,
      },
      'authz',
    )) as {
      data: RpcPermissionRow[] | null;
      error: { message: string } | null;
    };

    if (error) {
      this.logger.error(
        `Failed to get user permissions: ${error.message}`,
        error,
      );
      return [];
    }

    return (data || []).map((row) => ({
      permission: row.permission_name,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
    }));
  }

  /**
   * Get user's roles
   */
  async getUserRoles(
    userId: string,
  ): Promise<UserRole[]> {
    const { data, error } = (await this.db.rpc(
      'rbac_get_user_roles',
      {
        p_user_id: userId,
      },
      'authz',
    )) as {
      data: RpcRoleRow[] | null;
      error: { message: string } | null;
    };

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
   * Get all available roles
   */
  async getAllRoles(): Promise<RbacRole[]> {
    const { data, error } = (await this.db
      .from('authz', 'rbac_roles')
      .select('id, name, display_name, description, is_system')
      .order('name')) as {
      data: Record<string, unknown> | Record<string, unknown>[] | null;
      error: { message: string; code?: string } | null;
    };

    if (error) {
      this.logger.error(`Failed to get roles: ${error.message}`, error);
      return [];
    }

    const typedData = data as RbacRoleDbRow[] | null;
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
  async getAllPermissions(): Promise<RbacPermission[]> {
    const { data, error } = (await this.db
      .from('authz', 'rbac_permissions')
      .select('id, name, display_name, description, category')
      .order('category')
      .order('name')) as {
      data: Record<string, unknown> | Record<string, unknown>[] | null;
      error: { message: string; code?: string } | null;
    };

    if (error) {
      this.logger.error(`Failed to get permissions: ${error.message}`, error);
      return [];
    }

    const typedData = data as RbacPermissionDbRow[] | null;
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
  async getRolePermissions(roleId: string): Promise<string[]> {
    // Get permission IDs for this role
    const { data: rpData, error: rpError } = (await this.db
      .from('authz', 'rbac_role_permissions')
      .select('permission_id')
      .eq('role_id', roleId)) as {
      data: Record<string, unknown> | Record<string, unknown>[] | null;
      error: { message: string; code?: string } | null;
    };

    if (rpError) {
      this.logger.error(
        `Failed to get role permissions: ${rpError.message}`,
        rpError,
      );
      return [];
    }

    if (!rpData || (rpData as unknown[]).length === 0) {
      return [];
    }

    const permissionIds = (rpData as Array<{ permission_id: string }>).map(
      (row) => row.permission_id,
    );

    // Get permission names
    const { data: permData, error: permError } = (await this.db
      .from('authz', 'rbac_permissions')
      .select('id, name')
      .in('id', permissionIds)) as {
      data: Record<string, unknown> | Record<string, unknown>[] | null;
      error: { message: string; code?: string } | null;
    };

    if (permError || !permData) {
      return [];
    }

    return (permData as Array<{ id: string; name: string }>).map(
      (row) => row.name,
    );
  }

  /**
   * Add permission to a role
   */
  async addPermissionToRole(
    roleId: string,
    permissionId: string,
  ): Promise<void> {
    const { error } = (await this.db
      .from('authz', 'rbac_role_permissions')
      .insert({
        role_id: roleId,
        permission_id: permissionId,
      })) as {
      data: Record<string, unknown> | Record<string, unknown>[] | null;
      error: { message: string; code?: string } | null;
    };

    if (error) {
      this.logger.error(
        `Failed to add permission to role: ${error.message}`,
        error,
      );
      throw new Error(`Failed to add permission to role: ${error.message}`);
    }
  }

  /**
   * Remove permission from a role
   */
  async removePermissionFromRole(
    roleId: string,
    permissionId: string,
  ): Promise<void> {
    const { error } = (await this.db
      .from('authz', 'rbac_role_permissions')
      .delete()
      .eq('role_id', roleId)
      .eq('permission_id', permissionId)) as {
      data: Record<string, unknown> | Record<string, unknown>[] | null;
      error: { message: string; code?: string } | null;
    };

    if (error) {
      this.logger.error(
        `Failed to remove permission from role: ${error.message}`,
        error,
      );
      throw new Error(
        `Failed to remove permission from role: ${error.message}`,
      );
    }
  }

  /**
   * Assign role to user
   */
  async assignRole(
    targetUserId: string,
    roleName: string,
    assignedBy: string,
    expiresAt?: Date,
  ): Promise<void> {
    // Get role ID
    const { data: role, error: roleError } = (await this.db
      .from('authz', 'rbac_roles')
      .select('id')
      .eq('name', roleName)
      .single()) as {
      data: Record<string, unknown> | Record<string, unknown>[] | null;
      error: { message: string; code?: string } | null;
    };

    if (roleError || !role) {
      throw new Error(`Role not found: ${roleName}`);
    }

    const typedRole = role as { id: string };

    // Insert assignment (table rename to rbac_user_roles happens in Phase 3)
    const { error } = await this.db.from('authz', 'rbac_user_roles').upsert(
      {
        user_id: targetUserId,
        role_id: typedRole.id,
        assigned_by: assignedBy,
        expires_at: expiresAt?.toISOString() || null,
      },
      {
        onConflict: 'user_id,role_id',
      },
    );

    if (error) {
      throw new Error(`Failed to assign role: ${error.message}`);
    }

    // Audit log
    await this.logAudit(
      'grant',
      assignedBy,
      targetUserId,
      typedRole.id,
      null,
      {
        role_name: roleName,
        expires_at: expiresAt?.toISOString(),
      },
    );
  }

  /**
   * Revoke role from user
   */
  async revokeRole(
    targetUserId: string,
    roleName: string,
    revokedBy: string,
  ): Promise<void> {
    // Get role ID
    const { data: role, error: roleError } = (await this.db
      .from('authz', 'rbac_roles')
      .select('id')
      .eq('name', roleName)
      .single()) as {
      data: Record<string, unknown> | Record<string, unknown>[] | null;
      error: { message: string; code?: string } | null;
    };

    if (roleError || !role) {
      throw new Error(`Role not found: ${roleName}`);
    }

    const typedRole = role as { id: string };

    // Delete assignment (table rename to rbac_user_roles happens in Phase 3)
    const { error } = (await this.db
      .from('authz', 'rbac_user_roles')
      .delete()
      .eq('user_id', targetUserId)
      .eq('role_id', typedRole.id)) as {
      data: Record<string, unknown> | Record<string, unknown>[] | null;
      error: { message: string; code?: string } | null;
    };

    if (error) {
      throw new Error(`Failed to revoke role: ${error.message}`);
    }

    // Audit log
    await this.logAudit(
      'revoke',
      revokedBy,
      targetUserId,
      typedRole.id,
      null,
      {
        role_name: roleName,
      },
    );
  }

  /**
   * Check if user is super-admin
   * Super-admin is determined by having the 'super-admin' role
   * Can be assigned with organization_slug = '*' (global access) or to specific organizations
   * If user has super-admin role in ANY organization, they are considered super-admin
   */
  async isSuperAdmin(userId: string): Promise<boolean> {
    // Check if user has super-admin role by joining user_org_roles with roles
    const { data, error } = (await this.db
      .from('authz', 'rbac_user_roles')
      .select('id, role_id, organization_slug')
      .eq('user_id', userId)
      .limit(100)) as {
      data: Record<string, unknown> | Record<string, unknown>[] | null;
      error: { message: string; code?: string } | null;
    };

    if (error) {
      this.logger.error(
        `[RbacService] Error checking super admin: ${error.message}`,
      );
      return false;
    }

    if (!data || (data as unknown[]).length === 0) {
      return false;
    }

    // Get the super-admin role ID
    const { data: superAdminRole, error: roleError } = (await this.db
      .from('authz', 'rbac_roles')
      .select('id')
      .eq('name', 'super-admin')
      .maybeSingle()) as {
      data: Record<string, unknown> | Record<string, unknown>[] | null;
      error: { message: string; code?: string } | null;
    };

    if (roleError || !superAdminRole) {
      return false;
    }

    const saRoleId = (superAdminRole as { id: string }).id;
    const typedData = data as Array<{
      id: string;
      role_id: string;
      organization_slug: string;
    }>;
    return typedData.some((record) => record.role_id === saRoleId);
  }

  /**
   * Check if user has admin role
   */
  async isAdmin(userId: string): Promise<boolean> {
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
      .maybeSingle()) as {
      data: Record<string, unknown> | Record<string, unknown>[] | null;
      error: { message: string; code?: string } | null;
    };

    if (roleError || !adminRole) {
      return false;
    }

    const adminRoleId = (adminRole as { id: string }).id;

    const { data, error } = (await this.db
      .from('authz', 'rbac_user_roles')
      .select('id, role_id')
      .eq('user_id', userId)
      .eq('role_id', adminRoleId)
      .limit(1)) as {
      data: Record<string, unknown> | Record<string, unknown>[] | null;
      error: { message: string; code?: string } | null;
    };

    if (error) {
      this.logger.error(`[RbacService] Error checking admin: ${error.message}`);
      return false;
    }

    return !!data && (data as unknown[]).length > 0;
  }

  /**
   * Get audit log entries
   */
  async getAuditLog(
    limit = 100,
  ): Promise<
    Array<{
      id: string;
      action: string;
      actorId: string;
      targetUserId: string;
      targetRoleId: string;
      details: Record<string, unknown>;
      createdAt: Date;
    }>
  > {
    const query = this.db
      .from('authz', 'rbac_audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    const { data, error } = (await query) as {
      data: RbacAuditLogDbRow[] | null;
      error: { message: string; code?: string } | null;
    };

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
      details: row.details,
      createdAt: new Date(row.created_at),
    }));
  }

  /**
   * Log an audit entry
   */
  private async logAudit(
    action: string,
    actorId: string,
    targetUserId: string | null,
    targetRoleId: string | null,
    organizationSlug: string | null,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.db.from('authz', 'rbac_audit_log').insert({
      action,
      actor_id: actorId,
      target_user_id: targetUserId,
      target_role_id: targetRoleId,
      organization_slug: organizationSlug,
      details,
    });
  }
}
