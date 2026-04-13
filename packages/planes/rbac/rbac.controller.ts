import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RbacService } from './rbac.service';
import { RbacGuard } from './guards/rbac.guard';
import { RequirePermission } from './decorators/require-permission.decorator';

interface AuthenticatedUser {
  id: string;
  email?: string;
}

// DTOs
class AssignRoleDto {
  roleName!: string;
  expiresAt?: string;
}

/**
 * RBAC Controller
 * Manages roles, permissions, and user-role assignments
 */
@Controller('api/rbac')
@UseGuards(JwtAuthGuard, RbacGuard)
export class RbacController {
  constructor(@Inject(RbacService) private readonly rbacService: RbacService) {}

  // ==================== ROLES ====================

  /**
   * Get all available roles
   */
  @Get('roles')
  @RequirePermission('admin:roles')
  async getAllRoles() {
    const roles = await this.rbacService.getAllRoles();
    return { roles };
  }

  /**
   * Get all available permissions (grouped by category)
   */
  @Get('permissions')
  @RequirePermission('admin:roles')
  async getAllPermissions() {
    const permissions = await this.rbacService.getAllPermissions();

    // Group by category for easier frontend rendering
    const grouped = permissions.reduce(
      (acc, perm) => {
        const category = perm.category || 'other';
        if (!acc[category]) {
          acc[category] = [];
        }
        acc[category].push(perm);
        return acc;
      },
      {} as Record<string, typeof permissions>,
    );

    return { permissions, grouped };
  }

  /**
   * Get permissions for a specific role
   */
  @Get('roles/:roleId/permissions')
  async getRolePermissions(@Param('roleId') roleId: string) {
    const permissions = await this.rbacService.getRolePermissions(roleId);
    return { permissions };
  }

  /**
   * Add permission to a role
   */
  @Post('roles/:roleId/permissions/:permissionId')
  @RequirePermission('admin:roles')
  async addPermissionToRole(
    @Param('roleId') roleId: string,
    @Param('permissionId') permissionId: string,
  ) {
    await this.rbacService.addPermissionToRole(roleId, permissionId);
    return { success: true, message: 'Permission added to role' };
  }

  /**
   * Remove permission from a role
   */
  @Delete('roles/:roleId/permissions/:permissionId')
  @RequirePermission('admin:roles')
  async removePermissionFromRole(
    @Param('roleId') roleId: string,
    @Param('permissionId') permissionId: string,
  ) {
    await this.rbacService.removePermissionFromRole(roleId, permissionId);
    return { success: true, message: 'Permission removed from role' };
  }

  // ==================== CURRENT USER ====================

  /**
   * Get current user's roles
   */
  @Get('me/roles')
  async getMyRoles(
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const roles = await this.rbacService.getUserRoles(user.id);
    return { roles };
  }

  /**
   * Get current user's permissions
   */
  @Get('me/permissions')
  async getMyPermissions(
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const permissions = await this.rbacService.getUserPermissions(user.id);
    return { permissions };
  }

  /**
   * Check if current user is super-admin
   */
  @Get('me/is-super-admin')
  async checkSuperAdmin(@CurrentUser() user: AuthenticatedUser) {
    const isSuperAdmin = await this.rbacService.isSuperAdmin(user.id);
    return { isSuperAdmin };
  }

  /**
   * Check if current user has a specific permission
   */
  @Get('check')
  async checkPermission(
    @Query('permission') permission: string,
    @Query('resourceType') resourceType?: string,
    @Query('resourceId') resourceId?: string,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    if (!user) {
      return { hasPermission: false };
    }
    const hasAccess = await this.rbacService.hasPermission(
      user.id,
      permission,
      resourceType,
      resourceId,
    );
    return { hasPermission: hasAccess };
  }

  // ==================== USER ROLE MANAGEMENT ====================

  /**
   * Get a user's roles (admin only)
   */
  @Get('users/:userId/roles')
  @RequirePermission('admin:users')
  async getUserRoles(
    @Param('userId') userId: string,
  ) {
    const roles = await this.rbacService.getUserRoles(userId);
    return { roles };
  }

  /**
   * Get a user's permissions (admin only)
   */
  @Get('users/:userId/permissions')
  @RequirePermission('admin:users')
  async getUserPermissions(
    @Param('userId') userId: string,
  ) {
    const permissions = await this.rbacService.getUserPermissions(userId);
    return { permissions };
  }

  /**
   * Assign role to a user (admin only)
   */
  @Post('users/:userId/roles')
  @RequirePermission('admin:roles')
  @HttpCode(HttpStatus.OK)
  async assignRole(
    @Param('userId') userId: string,
    @Body() dto: AssignRoleDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    await this.rbacService.assignRole(
      userId,
      dto.roleName,
      currentUser.id,
      dto.expiresAt ? new Date(dto.expiresAt) : undefined,
    );
    return {
      success: true,
      message: `Role '${dto.roleName}' assigned to user`,
    };
  }

  /**
   * Revoke role from a user (admin only)
   */
  @Delete('users/:userId/roles/:roleName')
  @RequirePermission('admin:roles')
  async revokeRole(
    @Param('userId') userId: string,
    @Param('roleName') roleName: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    await this.rbacService.revokeRole(
      userId,
      roleName,
      currentUser.id,
    );
    return { success: true, message: `Role '${roleName}' revoked from user` };
  }

  // ==================== AUDIT LOG ====================

  /**
   * Get RBAC audit log (admin only)
   */
  @Get('audit')
  @RequirePermission('admin:audit')
  async getAuditLog(
    @Query('limit') limit = 100,
  ) {
    const entries = await this.rbacService.getAuditLog(limit);
    return { entries };
  }
}
