import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  IsArray,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UserCreateDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({ example: 'securePassword123' })
  @IsString()
  @IsNotEmpty()
  password!: string;

  @ApiPropertyOptional({ example: 'John Doe' })
  @IsString()
  @IsOptional()
  displayName?: string;
}

export class UserLoginDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({ example: 'securePassword123' })
  @IsString()
  @IsNotEmpty()
  password!: string;
}

export class TokenResponseDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  accessToken!: string;

  @ApiPropertyOptional({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  refreshToken?: string;

  @ApiProperty({ example: 'bearer' })
  tokenType: string = 'bearer';

  @ApiPropertyOptional({ example: 3600 })
  expiresIn?: number;
}

export class AuthenticatedUserResponseDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsUUID()
  id!: string;

  @ApiPropertyOptional({ example: 'user@example.com' })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ example: 'John Doe' })
  @IsString()
  @IsOptional()
  displayName?: string;

  @ApiPropertyOptional({
    example: ['user', 'admin'],
    description: 'Array of user roles (deprecated - use RBAC)',
    isArray: true,
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  roles?: string[];

  @ApiPropertyOptional({
    example: ['my-org'],
    description: 'Array of organization access',
    isArray: true,
  })
  @IsArray()
  @IsOptional()
  organizationAccess?: string[];
}

export class SupabaseAuthUserDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsUUID()
  id!: string;

  @ApiPropertyOptional({ example: 'authenticated' })
  @IsString()
  @IsOptional()
  aud?: string;

  @ApiPropertyOptional({ example: 'authenticated' })
  @IsString()
  @IsOptional()
  role?: string;

  @ApiPropertyOptional({ example: 'user@example.com' })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional()
  emailConfirmedAt?: Date;

  @ApiPropertyOptional({ example: '+1234567890' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional()
  confirmedAt?: Date;

  @ApiPropertyOptional()
  lastSignInAt?: Date;

  @ApiPropertyOptional()
  appMetadata?: Record<string, unknown>;

  @ApiPropertyOptional()
  userMetadata?: Record<string, unknown>;

  @ApiPropertyOptional()
  identities?: unknown[];

  @ApiPropertyOptional()
  createdAt?: Date;

  @ApiPropertyOptional()
  updatedAt?: Date;
}

export class UserProfileDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsUUID()
  id!: string;

  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email!: string;

  @ApiPropertyOptional({ example: 'John Doe' })
  @IsString()
  @IsOptional()
  displayName?: string;

  @ApiProperty({
    example: ['user', 'admin'],
    description: 'Array of user roles (deprecated - use RBAC)',
    isArray: true,
  })
  @IsArray()
  @IsString({ each: true })
  roles!: string[];

  @ApiPropertyOptional({
    example: ['my-org'],
    description: 'Array of organization access',
    isArray: true,
  })
  @IsArray()
  @IsOptional()
  organizationAccess?: string[];

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

/**
 * @deprecated Use RBAC endpoints instead (/api/rbac/users/:userId/roles)
 */
export class AssignRoleDto {
  @ApiProperty({
    example: 'evaluation-monitor',
    description: 'Role to assign to user (deprecated - use RBAC)',
  })
  @IsString()
  @IsNotEmpty()
  role!: string;

  @ApiPropertyOptional({
    example: 'Promoting user to evaluation monitor for Q4 review',
    description: 'Reason for role assignment (for audit log)',
  })
  @IsString()
  @IsOptional()
  reason?: string;
}

/**
 * @deprecated Use RBAC endpoints instead (/api/rbac/users/:userId/roles)
 */
export class RemoveRoleDto {
  @ApiProperty({
    example: 'evaluation-monitor',
    description: 'Role to remove from user (deprecated - use RBAC)',
  })
  @IsString()
  @IsNotEmpty()
  role!: string;

  @ApiPropertyOptional({
    example: 'End of evaluation monitoring period',
    description: 'Reason for role removal (for audit log)',
  })
  @IsString()
  @IsOptional()
  reason?: string;
}

/**
 * @deprecated Use RBAC endpoints instead (/api/rbac/users/:userId/roles)
 */
export class SetRolesDto {
  @ApiProperty({
    example: ['user', 'evaluation-monitor'],
    description:
      'Complete array of roles to set for user (deprecated - use RBAC)',
    isArray: true,
  })
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty()
  roles!: string[];

  @ApiPropertyOptional({
    example: 'Updating roles for new position',
    description: 'Reason for role change (for audit log)',
  })
  @IsString()
  @IsOptional()
  reason?: string;
}

export class RoleAuditLogDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsUUID()
  id!: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsUUID()
  userId!: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsUUID()
  adminUserId!: string;

  @ApiProperty({
    example: 'add_role',
    description: 'Type of role change action',
  })
  @IsString()
  action!: string;

  @ApiPropertyOptional({
    example: ['user'],
    description: 'User roles before the change',
  })
  @IsArray()
  @IsOptional()
  oldRoles?: string[];

  @ApiPropertyOptional({
    example: ['user', 'admin'],
    description: 'User roles after the change',
  })
  @IsArray()
  @IsOptional()
  newRoles?: string[];

  @ApiPropertyOptional({
    example: 'admin',
    description: 'The specific role that was changed',
  })
  @IsString()
  @IsOptional()
  roleChanged?: string;

  @ApiPropertyOptional({
    example: 'Promoting user to admin for system maintenance',
    description: 'Reason for the role change',
  })
  @IsString()
  @IsOptional()
  reason?: string;

  @ApiProperty()
  createdAt!: Date;

  // Nested user information
  @ApiPropertyOptional()
  user?: Partial<UserProfileDto>;

  @ApiPropertyOptional()
  admin?: Partial<UserProfileDto>;
}
