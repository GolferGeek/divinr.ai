"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditAccess = exports.LlmUse = exports.AgentAdmin = exports.AgentManage = exports.AgentExecute = exports.RagAdmin = exports.RagWrite = exports.RagRead = exports.AdminOnly = exports.RequirePermission = exports.RESOURCE_PARAM_KEY = exports.PERMISSION_KEY = void 0;
const common_1 = require("@nestjs/common");
/**
 * Metadata key for storing required permission
 */
exports.PERMISSION_KEY = 'rbac:permission';
/**
 * Metadata key for storing resource parameter name
 */
exports.RESOURCE_PARAM_KEY = 'rbac:resourceParam';
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
const RequirePermission = (permission, resourceParam) => {
    return (0, common_1.applyDecorators)((0, common_1.SetMetadata)(exports.PERMISSION_KEY, permission), (0, common_1.SetMetadata)(exports.RESOURCE_PARAM_KEY, resourceParam));
};
exports.RequirePermission = RequirePermission;
/**
 * Decorator for admin-only endpoints
 * Shorthand for @RequirePermission('admin:*')
 */
const AdminOnly = () => (0, exports.RequirePermission)('admin:users');
exports.AdminOnly = AdminOnly;
/**
 * Decorator for RAG read access
 * Shorthand for @RequirePermission('rag:read')
 */
const RagRead = () => (0, exports.RequirePermission)('rag:read');
exports.RagRead = RagRead;
/**
 * Decorator for RAG write access
 * Shorthand for @RequirePermission('rag:write')
 */
const RagWrite = () => (0, exports.RequirePermission)('rag:write');
exports.RagWrite = RagWrite;
/**
 * Decorator for RAG admin access
 * Shorthand for @RequirePermission('rag:admin')
 */
const RagAdmin = () => (0, exports.RequirePermission)('rag:admin');
exports.RagAdmin = RagAdmin;
/**
 * Decorator for agent execution access
 * Shorthand for @RequirePermission('agents:execute')
 */
const AgentExecute = () => (0, exports.RequirePermission)('agents:execute');
exports.AgentExecute = AgentExecute;
/**
 * Decorator for agent management access
 * Shorthand for @RequirePermission('agents:manage')
 */
const AgentManage = () => (0, exports.RequirePermission)('agents:manage');
exports.AgentManage = AgentManage;
/**
 * Decorator for agent admin access
 * Shorthand for @RequirePermission('agents:admin')
 */
const AgentAdmin = () => (0, exports.RequirePermission)('agents:admin');
exports.AgentAdmin = AgentAdmin;
/**
 * Decorator for LLM usage access
 * Shorthand for @RequirePermission('llm:use')
 */
const LlmUse = () => (0, exports.RequirePermission)('llm:use');
exports.LlmUse = LlmUse;
/**
 * Decorator for audit log access
 * Shorthand for @RequirePermission('admin:audit')
 */
const AuditAccess = () => (0, exports.RequirePermission)('admin:audit');
exports.AuditAccess = AuditAccess;
