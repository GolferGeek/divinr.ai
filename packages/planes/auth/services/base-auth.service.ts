import {
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthServiceProvider } from '../interfaces/auth-service.interface';
import {
  IDENTITY_PROVIDER,
  IdentityProvider,
} from '../interfaces/identity-provider.interface';
import { AuthenticatedPrincipal } from '../interfaces/authenticated-principal.interface';
import {
  UserCreateDto,
  UserLoginDto,
  TokenResponseDto,
  AuthenticatedUserResponseDto,
  SupabaseAuthUserDto,
  UserProfileDto,
} from '../dto/auth.dto';
import {
  CreateUserDto,
  CreateUserResponseDto,
} from '../dto/admin-user-management.dto';
import {
  DATABASE_SERVICE,
  DatabaseService,
  QueryResult,
} from '../../database';

interface UserDbRecord {
  id: string;
  email: string;
  display_name: string;
  organization_slug?: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface UserOrgRpcResult {
  organization_slug: string;
  organization_name: string;
  role_name: string;
  is_global: boolean;
}

export abstract class BaseAuthService implements AuthServiceProvider {
  protected readonly logger = new Logger(this.constructor.name);

  constructor(
    @Inject(IDENTITY_PROVIDER)
    protected readonly identityProvider: IdentityProvider,
    @Inject(DATABASE_SERVICE)
    protected readonly db: DatabaseService,
  ) {}

  // --- Abstract methods (implemented per provider) ---

  abstract signup(dto: UserCreateDto): Promise<TokenResponseDto>;
  abstract login(dto: UserLoginDto): Promise<TokenResponseDto>;
  abstract logout(token: string): Promise<void>;
  abstract refreshToken(refreshToken: string): Promise<TokenResponseDto>;
  abstract initiatePasswordReset(
    email: string,
  ): Promise<{ success: boolean; message: string }>;
  abstract resolveInternalUserId(
    principal: AuthenticatedPrincipal,
  ): Promise<string>;
  abstract createUser(
    dto: CreateUserDto,
    adminId: string,
  ): Promise<CreateUserResponseDto>;
  abstract deleteUser(
    userId: string,
    adminId: string,
  ): Promise<{ success: boolean; message: string }>;
  abstract changeUserPassword(
    userId: string,
    pw: string,
    adminId: string,
  ): Promise<{ success: boolean; message: string }>;

  // --- Shared implementations (use DATABASE_SERVICE) ---

  async validateUser(token: string): Promise<SupabaseAuthUserDto> {
    try {
      const principal = await this.identityProvider.validateToken(token);

      return {
        id: principal.id,
        email: principal.email,
        aud: principal.aud,
        role: principal.role,
        appMetadata: principal.appMetadata,
        userMetadata: principal.userMetadata,
        emailConfirmedAt: principal.emailConfirmedAt,
        confirmedAt: principal.confirmedAt,
        lastSignInAt: principal.lastSignInAt,
        createdAt: principal.createdAt,
        updatedAt: principal.updatedAt,
        identities: principal.identities,
      };
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }

  async getCurrentUser(
    currentAuthUser: SupabaseAuthUserDto,
    _token: string,
  ): Promise<AuthenticatedUserResponseDto> {
    try {
      const { data: userData, error: userError } = (await this.db
        .from('authz', 'users')
        .select('id, email, display_name, organization_slug, created_at')
        .eq('id', currentAuthUser.id)
        .single()) as QueryResult<unknown>;

      if (userError || !userData) {
        throw new HttpException(
          'User profile not found.',
          HttpStatus.FORBIDDEN,
        );
      }

      const typedUser = userData as {
        display_name: string;
        organization_slug?: string;
      };

      const { data: userOrgs, error: orgsError } = (await this.db.rpc(
        'rbac_get_user_organizations',
        { p_user_id: currentAuthUser.id },
        'authz',
      )) as QueryResult<unknown>;

      if (orgsError) {
        this.logger.warn('Failed to get user organizations:', orgsError);
      }

      const typedOrgs = (userOrgs as UserOrgRpcResult[] | null) ?? [];

      const organizationAccess = [
        ...new Set(typedOrgs.map((o) => o.organization_slug)),
      ];

      if (organizationAccess.length === 0) {
        if (typedUser.organization_slug) {
          organizationAccess.push(typedUser.organization_slug);
        } else {
          organizationAccess.push('demo-org');
        }
      }

      const roles =
        typedOrgs.length > 0
          ? [...new Set(typedOrgs.map((o) => o.role_name))]
          : ['member'];

      return {
        id: currentAuthUser.id,
        email: currentAuthUser.email,
        displayName: typedUser.display_name,
        roles,
        organizationAccess,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error('Error fetching user profile:', error);
      throw new HttpException(
        'Could not fetch user profile.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getUserProfile(userId: string): Promise<UserProfileDto | null> {
    try {
      const { data: result, error } = (await this.db
        .from('authz', 'users')
        .select(
          'id, email, display_name, organization_slug, status, created_at, updated_at',
        )
        .eq('id', userId)
        .single()) as QueryResult<unknown>;

      if (error) {
        if (error.code === 'PGRST116') {
          return null;
        }
        throw new Error(`Database error: ${error.message}`);
      }

      const data = result as UserDbRecord | null;
      if (!data) {
        return null;
      }

      const { data: userOrgs } = (await this.db.rpc(
        'rbac_get_user_organizations',
        { p_user_id: userId },
        'authz',
      )) as QueryResult<unknown>;

      const typedOrgs =
        (userOrgs as Array<{
          organization_slug: string;
          role_name: string;
        }> | null) ?? [];

      const roles =
        typedOrgs.length > 0
          ? [...new Set(typedOrgs.map((o) => o.role_name))]
          : ['member'];

      const organizationAccess = [
        ...new Set(typedOrgs.map((o) => o.organization_slug)),
      ];

      return {
        id: data.id,
        email: data.email,
        displayName: data.display_name,
        roles,
        createdAt: new Date(data.created_at),
        updatedAt: new Date(data.updated_at),
        organizationAccess,
      };
    } catch {
      throw new HttpException(
        'Could not fetch user profile.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getOrganizationAccessForUser(userId: string): Promise<string[]> {
    const { data: userOrgs, error } = (await this.db.rpc(
      'rbac_get_user_organizations',
      { p_user_id: userId },
      'authz',
    )) as QueryResult<unknown>;

    if (error) {
      throw new HttpException(
        'Could not fetch user organizations.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const typedOrgs =
      (userOrgs as Array<{ organization_slug: string }> | null) ?? [];

    const organizations = [
      ...new Set(typedOrgs.map((o) => o.organization_slug)),
    ];

    if (organizations.length === 0) {
      throw new HttpException(
        'No organization access configured for this user.',
        HttpStatus.FORBIDDEN,
      );
    }

    return organizations;
  }

  async getAllUsers(_adminId: string): Promise<unknown[]> {
    try {
      const { data: users, error } = (await this.db
        .from('authz', 'users')
        .select(
          'id, email, display_name, organization_slug, status, created_at',
        )
        .order('created_at', { ascending: false })) as QueryResult<unknown>;

      if (error) {
        throw new Error(`Failed to fetch users: ${error.message}`);
      }

      return (users as unknown[]) || [];
    } catch (error) {
      throw new Error(
        `Failed to get all users: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  async getUserById(userId: string, _adminId: string): Promise<unknown> {
    try {
      const { data: user, error } = (await this.db
        .from('authz', 'users')
        .select(
          'id, email, display_name, organization_slug, status, created_at',
        )
        .eq('id', userId)
        .single()) as QueryResult<unknown>;

      if (error) {
        throw new Error(`Failed to fetch user: ${error.message}`);
      }

      if (!user) {
        throw new Error('User not found');
      }

      return user;
    } catch (error) {
      throw new Error(
        `Failed to get user by ID: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}
