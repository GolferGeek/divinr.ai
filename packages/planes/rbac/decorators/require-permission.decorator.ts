import { SetMetadata, applyDecorators } from '@nestjs/common';

/**
 * Metadata key for storing required permission
 */
export const PERMISSION_KEY = 'rbac:permission';

/**
 * Metadata key for storing resource parameter name
 */
export const RESOURCE_PARAM_KEY = 'rbac:resourceParam';

/**
 * Decorator to specify required permission for accessing an endpoint
 *
 * @param permission - The permission required (e.g., 'rag:read', 'admin:users')
 * @param resourceParam - Optional route parameter name for resource-specific permissions
 *
 * @example
 * ```typescript
 * // Simple permission check
 * @RequirePermission('rag:read')
 * @Get('collections')
 * async getCollections() {
 *   // Only users with 'rag:read' permission can access this
 * }
 *
 * // Permission with resource parameter
 * @RequirePermission('rag:write', 'collectionId')
 * @Put('collections/:collectionId')
 * async updateCollection(@Param('collectionId') id: string) {
 *   // Check permission for specific collection
 * }
 * ```
 */
export const RequirePermission = (
  permission: string,
  resourceParam?: string,
) => {
  return applyDecorators(
    SetMetadata(PERMISSION_KEY, permission),
    SetMetadata(RESOURCE_PARAM_KEY, resourceParam),
    // Note: RbacGuard must be added separately via @UseGuards
  );
};

/**
 * Decorator for admin-only endpoints
 * Shorthand for @RequirePermission('admin:*')
 */
export const AdminOnly = () => RequirePermission('admin:users');

/**
 * Decorator for RAG read access
 * Shorthand for @RequirePermission('rag:read')
 */
export const RagRead = () => RequirePermission('rag:read');

/**
 * Decorator for RAG write access
 * Shorthand for @RequirePermission('rag:write')
 */
export const RagWrite = () => RequirePermission('rag:write');

/**
 * Decorator for RAG admin access
 * Shorthand for @RequirePermission('rag:admin')
 */
export const RagAdmin = () => RequirePermission('rag:admin');

/**
 * Decorator for agent execution access
 * Shorthand for @RequirePermission('agents:execute')
 */
export const AgentExecute = () => RequirePermission('agents:execute');

/**
 * Decorator for agent management access
 * Shorthand for @RequirePermission('agents:manage')
 */
export const AgentManage = () => RequirePermission('agents:manage');

/**
 * Decorator for agent admin access
 * Shorthand for @RequirePermission('agents:admin')
 */
export const AgentAdmin = () => RequirePermission('agents:admin');

/**
 * Decorator for LLM usage access
 * Shorthand for @RequirePermission('llm:use')
 */
export const LlmUse = () => RequirePermission('llm:use');

/**
 * Decorator for audit log access
 * Shorthand for @RequirePermission('admin:audit')
 */
export const AuditAccess = () => RequirePermission('admin:audit');
