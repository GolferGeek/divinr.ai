import { Injectable, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { BaseAuthService } from './base-auth.service';
import { AuthServiceProvider } from '../interfaces/auth-service.interface';
import {
  IDENTITY_PROVIDER,
  IdentityProvider,
} from '../interfaces/identity-provider.interface';
import { AuthenticatedPrincipal } from '../interfaces/authenticated-principal.interface';
import { InternalIdentityLinkService } from './internal-identity-link.service';
import { DATABASE_SERVICE, DatabaseService } from '../../database';
import {
  UserCreateDto,
  UserLoginDto,
  TokenResponseDto,
  SupabaseAuthUserDto,
  AuthenticatedUserResponseDto,
} from '../dto/auth.dto';
import {
  CreateUserDto,
  CreateUserResponseDto,
} from '../dto/admin-user-management.dto';

@Injectable()
export class ExternalOidcAuthService
  extends BaseAuthService
  implements AuthServiceProvider
{
  constructor(
    @Inject(IDENTITY_PROVIDER) identityProvider: IdentityProvider,
    @Inject(DATABASE_SERVICE) db: DatabaseService,
    @Inject(InternalIdentityLinkService) private readonly identityLinkService: InternalIdentityLinkService,
  ) {
    super(identityProvider, db);
  }

  // --- Session lifecycle: not supported for external OIDC ---

  signup(_dto: UserCreateDto): Promise<TokenResponseDto> {
    throw new HttpException(
      'Signup is not supported for external OIDC providers. Users are provisioned in the identity provider portal.',
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  login(_dto: UserLoginDto): Promise<TokenResponseDto> {
    throw new HttpException(
      'Password login is not supported for external OIDC providers. Use the frontend identity SDK to sign in.',
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  logout(_token: string): Promise<void> {
    throw new HttpException(
      'Logout is handled by the frontend identity SDK for external OIDC providers.',
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  refreshToken(_refreshToken: string): Promise<TokenResponseDto> {
    throw new HttpException(
      'Token refresh is handled by the frontend identity SDK for external OIDC providers.',
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  initiatePasswordReset(
    _email: string,
  ): Promise<{ success: boolean; message: string }> {
    throw new HttpException(
      'Password reset is managed in the identity provider portal for external OIDC providers.',
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  // --- Identity resolution: auto-provision on first login ---

  async resolveInternalUserId(
    principal: AuthenticatedPrincipal,
  ): Promise<string> {
    // Check for existing identity link
    const existingUserId =
      await this.identityLinkService.findInternalUserId(principal);
    if (existingUserId) {
      return existingUserId;
    }

    // No identity link yet — check if a user with this email already exists
    if (principal.email) {
      const { data: existingUser } = (await this.db
        .from('authz', 'users')
        .select('id')
        .eq('email', principal.email)
        .maybeSingle()) as {
        data: { id: string } | null;
        error: { message: string } | null;
      };

      if (existingUser) {
        const userId = existingUser.id;
        this.logger.log(
          `Linking external identity to existing user: email=${principal.email} userId=${userId}`,
        );
        await this.identityLinkService.upsertIdentityLink(userId, principal);
        return userId;
      }
    }

    // First login with this external identity — auto-provision
    const newUserId = randomUUID();
    this.logger.log(
      `Auto-provisioning user for external identity: issuer=${principal.issuer} subject=${principal.subject} → userId=${newUserId}`,
    );

    // Insert user row into public.users
    // Client credentials tokens (service principals) may not have an email claim.
    const email =
      principal.email || `${principal.subject}@service-principal.local`;
    const displayName =
      (principal.userMetadata?.name as string) ||
      principal.email?.split('@')[0] ||
      'Service Principal';

    const { error: insertError } = await this.db.from('authz', 'users').insert({
      id: newUserId,
      email,
      display_name: displayName,
      organization_slug: 'demo-org',
      status: 'active',
    });

    if (insertError) {
      this.logger.error(
        `Failed to auto-provision user row: ${insertError.message}`,
      );
      throw new HttpException(
        'Failed to provision user account.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // Create identity link
    await this.identityLinkService.upsertIdentityLink(newUserId, principal);

    return newUserId;
  }

  // --- Override getCurrentUser to auto-provision if profile not found ---

  async getCurrentUser(
    currentAuthUser: SupabaseAuthUserDto,
    token: string,
  ): Promise<AuthenticatedUserResponseDto> {
    // Check if user profile exists
    const { data: userData } = (await this.db
      .from('authz', 'users')
      .select('id')
      .eq('id', currentAuthUser.id)
      .single()) as {
      data: { id: string } | null;
      error: { message: string } | null;
    };

    if (!userData) {
      // Auto-provision the user profile (the identity link already exists
      // from resolveInternalUserId, but the user row may be missing if
      // getCurrentUser is called before resolveInternalUserId completed)
      const email =
        currentAuthUser.email ||
        `${currentAuthUser.id}@service-principal.local`;
      const displayName =
        (currentAuthUser.userMetadata?.name as string) ||
        currentAuthUser.email?.split('@')[0] ||
        'Service Principal';

      const { error: insertError } = await this.db
        .from('authz', 'users')
        .insert({
          id: currentAuthUser.id,
          email,
          display_name: displayName,
          organization_slug: 'demo-org',
          status: 'active',
        });

      if (insertError) {
        this.logger.error(
          'Failed to auto-provision user profile:',
          insertError,
        );
        throw new HttpException(
          'User profile not found.',
          HttpStatus.FORBIDDEN,
        );
      }
    }

    // Delegate to base class for the standard profile + RBAC query
    return super.getCurrentUser(currentAuthUser, token);
  }

  // --- Admin methods: not supported for external OIDC ---

  createUser(
    _dto: CreateUserDto,
    _adminId: string,
  ): Promise<CreateUserResponseDto> {
    throw new HttpException(
      'User creation is managed in the identity provider portal for external OIDC providers.',
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  deleteUser(
    _userId: string,
    _adminId: string,
  ): Promise<{ success: boolean; message: string }> {
    throw new HttpException(
      'User deletion is managed in the identity provider portal for external OIDC providers.',
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  changeUserPassword(
    _userId: string,
    _pw: string,
    _adminId: string,
  ): Promise<{ success: boolean; message: string }> {
    throw new HttpException(
      'Password management is handled in the identity provider portal for external OIDC providers.',
      HttpStatus.NOT_IMPLEMENTED,
    );
  }
}
