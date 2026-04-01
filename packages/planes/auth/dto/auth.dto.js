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
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoleAuditLogDto = exports.SetRolesDto = exports.RemoveRoleDto = exports.AssignRoleDto = exports.UserProfileDto = exports.SupabaseAuthUserDto = exports.AuthenticatedUserResponseDto = exports.TokenResponseDto = exports.UserLoginDto = exports.UserCreateDto = void 0;
const class_validator_1 = require("class-validator");
const swagger_1 = require("@nestjs/swagger");
class UserCreateDto {
    email;
    password;
    displayName;
}
exports.UserCreateDto = UserCreateDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'user@example.com' }),
    (0, class_validator_1.IsEmail)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], UserCreateDto.prototype, "email", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'securePassword123' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], UserCreateDto.prototype, "password", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'John Doe' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], UserCreateDto.prototype, "displayName", void 0);
class UserLoginDto {
    email;
    password;
}
exports.UserLoginDto = UserLoginDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'user@example.com' }),
    (0, class_validator_1.IsEmail)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], UserLoginDto.prototype, "email", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'securePassword123' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], UserLoginDto.prototype, "password", void 0);
class TokenResponseDto {
    accessToken;
    refreshToken;
    tokenType = 'bearer';
    expiresIn;
}
exports.TokenResponseDto = TokenResponseDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' }),
    __metadata("design:type", String)
], TokenResponseDto.prototype, "accessToken", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' }),
    __metadata("design:type", String)
], TokenResponseDto.prototype, "refreshToken", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'bearer' }),
    __metadata("design:type", String)
], TokenResponseDto.prototype, "tokenType", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 3600 }),
    __metadata("design:type", Number)
], TokenResponseDto.prototype, "expiresIn", void 0);
class AuthenticatedUserResponseDto {
    id;
    email;
    displayName;
    roles;
    organizationAccess;
}
exports.AuthenticatedUserResponseDto = AuthenticatedUserResponseDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: '123e4567-e89b-12d3-a456-426614174000' }),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], AuthenticatedUserResponseDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'user@example.com' }),
    (0, class_validator_1.IsEmail)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], AuthenticatedUserResponseDto.prototype, "email", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'John Doe' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], AuthenticatedUserResponseDto.prototype, "displayName", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: ['user', 'admin'],
        description: 'Array of user roles (deprecated - use RBAC)',
        isArray: true,
    }),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsString)({ each: true }),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Array)
], AuthenticatedUserResponseDto.prototype, "roles", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: ['my-org'],
        description: 'Array of organization access',
        isArray: true,
    }),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Array)
], AuthenticatedUserResponseDto.prototype, "organizationAccess", void 0);
class SupabaseAuthUserDto {
    id;
    aud;
    role;
    email;
    emailConfirmedAt;
    phone;
    confirmedAt;
    lastSignInAt;
    appMetadata;
    userMetadata;
    identities;
    createdAt;
    updatedAt;
}
exports.SupabaseAuthUserDto = SupabaseAuthUserDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: '123e4567-e89b-12d3-a456-426614174000' }),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], SupabaseAuthUserDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'authenticated' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], SupabaseAuthUserDto.prototype, "aud", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'authenticated' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], SupabaseAuthUserDto.prototype, "role", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'user@example.com' }),
    (0, class_validator_1.IsEmail)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], SupabaseAuthUserDto.prototype, "email", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", Date)
], SupabaseAuthUserDto.prototype, "emailConfirmedAt", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: '+1234567890' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], SupabaseAuthUserDto.prototype, "phone", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", Date)
], SupabaseAuthUserDto.prototype, "confirmedAt", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", Date)
], SupabaseAuthUserDto.prototype, "lastSignInAt", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", Object)
], SupabaseAuthUserDto.prototype, "appMetadata", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", Object)
], SupabaseAuthUserDto.prototype, "userMetadata", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", Array)
], SupabaseAuthUserDto.prototype, "identities", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", Date)
], SupabaseAuthUserDto.prototype, "createdAt", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", Date)
], SupabaseAuthUserDto.prototype, "updatedAt", void 0);
class UserProfileDto {
    id;
    email;
    displayName;
    roles;
    organizationAccess;
    createdAt;
    updatedAt;
}
exports.UserProfileDto = UserProfileDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: '123e4567-e89b-12d3-a456-426614174000' }),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], UserProfileDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'user@example.com' }),
    (0, class_validator_1.IsEmail)(),
    __metadata("design:type", String)
], UserProfileDto.prototype, "email", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'John Doe' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], UserProfileDto.prototype, "displayName", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: ['user', 'admin'],
        description: 'Array of user roles (deprecated - use RBAC)',
        isArray: true,
    }),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], UserProfileDto.prototype, "roles", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: ['my-org'],
        description: 'Array of organization access',
        isArray: true,
    }),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Array)
], UserProfileDto.prototype, "organizationAccess", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Date)
], UserProfileDto.prototype, "createdAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Date)
], UserProfileDto.prototype, "updatedAt", void 0);
/**
 * @deprecated Use RBAC endpoints instead (/api/rbac/users/:userId/roles)
 */
class AssignRoleDto {
    role;
    reason;
}
exports.AssignRoleDto = AssignRoleDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'evaluation-monitor',
        description: 'Role to assign to user (deprecated - use RBAC)',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], AssignRoleDto.prototype, "role", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'Promoting user to evaluation monitor for Q4 review',
        description: 'Reason for role assignment (for audit log)',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], AssignRoleDto.prototype, "reason", void 0);
/**
 * @deprecated Use RBAC endpoints instead (/api/rbac/users/:userId/roles)
 */
class RemoveRoleDto {
    role;
    reason;
}
exports.RemoveRoleDto = RemoveRoleDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'evaluation-monitor',
        description: 'Role to remove from user (deprecated - use RBAC)',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], RemoveRoleDto.prototype, "role", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'End of evaluation monitoring period',
        description: 'Reason for role removal (for audit log)',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], RemoveRoleDto.prototype, "reason", void 0);
/**
 * @deprecated Use RBAC endpoints instead (/api/rbac/users/:userId/roles)
 */
class SetRolesDto {
    roles;
    reason;
}
exports.SetRolesDto = SetRolesDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        example: ['user', 'evaluation-monitor'],
        description: 'Complete array of roles to set for user (deprecated - use RBAC)',
        isArray: true,
    }),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsString)({ each: true }),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", Array)
], SetRolesDto.prototype, "roles", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'Updating roles for new position',
        description: 'Reason for role change (for audit log)',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], SetRolesDto.prototype, "reason", void 0);
class RoleAuditLogDto {
    id;
    userId;
    adminUserId;
    action;
    oldRoles;
    newRoles;
    roleChanged;
    reason;
    createdAt;
    // Nested user information
    user;
    admin;
}
exports.RoleAuditLogDto = RoleAuditLogDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: '123e4567-e89b-12d3-a456-426614174000' }),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], RoleAuditLogDto.prototype, "id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: '123e4567-e89b-12d3-a456-426614174000' }),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], RoleAuditLogDto.prototype, "userId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: '123e4567-e89b-12d3-a456-426614174000' }),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], RoleAuditLogDto.prototype, "adminUserId", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'add_role',
        description: 'Type of role change action',
    }),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], RoleAuditLogDto.prototype, "action", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: ['user'],
        description: 'User roles before the change',
    }),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Array)
], RoleAuditLogDto.prototype, "oldRoles", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: ['user', 'admin'],
        description: 'User roles after the change',
    }),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Array)
], RoleAuditLogDto.prototype, "newRoles", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'admin',
        description: 'The specific role that was changed',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], RoleAuditLogDto.prototype, "roleChanged", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        example: 'Promoting user to admin for system maintenance',
        description: 'Reason for the role change',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], RoleAuditLogDto.prototype, "reason", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Date)
], RoleAuditLogDto.prototype, "createdAt", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", Object)
], RoleAuditLogDto.prototype, "user", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    __metadata("design:type", Object)
], RoleAuditLogDto.prototype, "admin", void 0);
