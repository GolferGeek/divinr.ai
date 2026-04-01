import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsOptional,
  IsString,
  IsEmail,
  MinLength,
} from 'class-validator';

/**
 * @deprecated Use RBAC endpoints instead (/api/rbac/*)
 */
export class UserListResponseDto {
  @ApiProperty({ description: 'User ID' })
  id!: string;

  @ApiProperty({ description: 'User email address' })
  email!: string;

  @ApiProperty({ description: 'User display name', required: false })
  displayName?: string;

  @ApiProperty({
    description: 'Array of user roles (deprecated - use RBAC)',
    isArray: true,
    example: ['user', 'admin'],
  })
  roles!: string[];

  @ApiProperty({ description: 'User creation timestamp' })
  createdAt!: string;

  @ApiProperty({ description: 'User status' })
  status!: string;
}

/**
 * @deprecated Use RBAC endpoints instead (/api/rbac/users/:userId/roles)
 */
export class UpdateUserRolesDto {
  @ApiProperty({
    description: 'Array of roles to assign to the user (deprecated - use RBAC)',
    isArray: true,
    example: ['user', 'admin'],
  })
  @IsArray()
  @IsString({ each: true })
  roles!: string[];

  @ApiProperty({
    description: 'Organization slug for role assignment',
    required: false,
    example: 'demo-org',
  })
  @IsOptional()
  @IsString()
  organizationSlug?: string;

  @ApiProperty({
    description: 'Optional reason for role change',
    required: false,
    example: 'Promoting user to admin for system maintenance',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}

/**
 * @deprecated Use RBAC endpoints instead (/api/rbac/users/:userId/roles)
 */
export class AddUserRoleDto {
  @ApiProperty({
    description: 'Role to add to the user (deprecated - use RBAC)',
    example: 'admin',
  })
  @IsString()
  role!: string;

  @ApiProperty({
    description: 'Organization slug for role assignment',
    required: false,
    example: 'demo-org',
  })
  @IsOptional()
  @IsString()
  organizationSlug?: string;

  @ApiProperty({
    description: 'Optional reason for adding role',
    required: false,
    example: 'Granting admin access for project management',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}

/**
 * @deprecated Use RBAC endpoints instead (/api/rbac/users/:userId/roles)
 */
export class RemoveUserRoleDto {
  @ApiProperty({
    description: 'Organization slug for role removal',
    required: false,
    example: 'demo-org',
  })
  @IsOptional()
  @IsString()
  organizationSlug?: string;

  @ApiProperty({
    description: 'Optional reason for removing role',
    required: false,
    example: 'User no longer needs admin access',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class CreateUserDto {
  @ApiProperty({
    description: 'User email address',
    example: 'newuser@example.com',
  })
  @IsEmail()
  email!: string;

  @ApiProperty({
    description: 'Temporary password (user should change on first login)',
    example: 'TempPass123!',
    minLength: 8,
  })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({
    description: 'User display name',
    required: false,
    example: 'John Doe',
  })
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiProperty({
    description: 'Initial roles to assign to the user (deprecated - use RBAC)',
    isArray: true,
    example: ['user'],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  roles?: string[];

  @ApiProperty({
    description: 'Force user to change password on first login',
    example: true,
    required: false,
  })
  @IsOptional()
  emailConfirm?: boolean;

  @ApiProperty({
    description: 'Organization access for the user',
    example: ['my-org'],
    required: false,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  organizationAccess?: string[];
}

export class CreateUserResponseDto {
  @ApiProperty({ description: 'Created user ID' })
  id!: string;

  @ApiProperty({ description: 'User email address' })
  email!: string;

  @ApiProperty({ description: 'User display name', required: false })
  displayName?: string;

  @ApiProperty({
    description: 'Assigned roles (deprecated - use RBAC)',
    isArray: true,
  })
  roles!: string[];

  @ApiProperty({ description: 'Whether email confirmation is required' })
  emailConfirmationRequired!: boolean;

  @ApiProperty({ description: 'Success message' })
  message!: string;

  @ApiProperty({
    description: 'Organization access for the user',
    example: ['my-org'],
    required: false,
    isArray: true,
  })
  organizationAccess?: string[];
}
