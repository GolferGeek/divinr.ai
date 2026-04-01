import { AuthenticatedPrincipal } from './authenticated-principal.interface';

export const AUTH_SERVICE = Symbol('AUTH_SERVICE');

// ---------------------------------------------------------------------------
// Input DTOs
// ---------------------------------------------------------------------------

export interface UserCreateDto {
  email: string;
  password: string;
  displayName?: string;
}

export interface UserLoginDto {
  email: string;
  password: string;
}

export interface CreateUserDto {
  email: string;
  password: string;
  displayName?: string;
  roles?: string[];
  emailConfirm?: boolean;
  organizationAccess?: string[];
}

// ---------------------------------------------------------------------------
// Response DTOs
// ---------------------------------------------------------------------------

export interface TokenResponseDto {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresIn?: number;
}

export interface AuthenticatedUserResponseDto {
  id: string;
  email?: string;
  displayName?: string;
  roles?: string[];
  organizationAccess?: string[];
}

export interface SupabaseAuthUserDto {
  id: string;
  aud?: string;
  role?: string;
  email?: string;
  emailConfirmedAt?: Date;
  phone?: string;
  confirmedAt?: Date;
  lastSignInAt?: Date;
  appMetadata?: Record<string, unknown>;
  userMetadata?: Record<string, unknown>;
  identities?: unknown[];
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UserProfileDto {
  id: string;
  email: string;
  displayName?: string;
  roles: string[];
  organizationAccess?: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserResponseDto {
  id: string;
  email: string;
  displayName?: string;
  roles: string[];
  emailConfirmationRequired: boolean;
  message: string;
  organizationAccess?: string[];
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface AuthServiceProvider {
  // Session lifecycle (Supabase-only; external throws NOT_IMPLEMENTED)
  signup(dto: UserCreateDto): Promise<TokenResponseDto>;
  login(dto: UserLoginDto): Promise<TokenResponseDto>;
  logout(token: string): Promise<void>;
  refreshToken(refreshToken: string): Promise<TokenResponseDto>;
  initiatePasswordReset(
    email: string,
  ): Promise<{ success: boolean; message: string }>;

  // Token validation
  validateUser(token: string): Promise<SupabaseAuthUserDto>;

  // Identity resolution (called by JwtAuthGuard)
  resolveInternalUserId(principal: AuthenticatedPrincipal): Promise<string>;

  // User profile / RBAC
  getCurrentUser(
    authUser: SupabaseAuthUserDto,
    token: string,
  ): Promise<AuthenticatedUserResponseDto>;
  getUserProfile(userId: string): Promise<UserProfileDto | null>;
  getOrganizationAccessForUser(userId: string): Promise<string[]>;

  // Admin (Supabase-only; external throws NOT_IMPLEMENTED)
  createUser(
    dto: CreateUserDto,
    adminId: string,
  ): Promise<CreateUserResponseDto>;
  getAllUsers(adminId: string): Promise<unknown[]>;
  getUserById(userId: string, adminId: string): Promise<unknown>;
  deleteUser(
    userId: string,
    adminId: string,
  ): Promise<{ success: boolean; message: string }>;
  changeUserPassword(
    userId: string,
    pw: string,
    adminId: string,
  ): Promise<{ success: boolean; message: string }>;
}
