import {
  Injectable,
  HttpException,
  HttpStatus,
  BadRequestException,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import { BaseAuthService } from './base-auth.service';
import { AuthServiceProvider } from '../interfaces/auth-service.interface';
import {
  IDENTITY_PROVIDER,
  IdentityProvider,
} from '../interfaces/identity-provider.interface';
import { AuthenticatedPrincipal } from '../interfaces/authenticated-principal.interface';
import { SupabaseService } from '../../database/supabase-client.service';
import { InternalIdentityLinkService } from './internal-identity-link.service';
import { DATABASE_SERVICE, DatabaseService } from '../../database';
import { getTableName } from '../../database/supabase-client.config';
import {
  UserCreateDto,
  UserLoginDto,
  TokenResponseDto,
} from '../dto/auth.dto';
import {
  CreateUserDto,
  CreateUserResponseDto,
} from '../dto/admin-user-management.dto';

@Injectable()
export class SupabaseAuthService
  extends BaseAuthService
  implements AuthServiceProvider
{
  constructor(
    @Inject(IDENTITY_PROVIDER) identityProvider: IdentityProvider,
    @Inject(DATABASE_SERVICE) db: DatabaseService,
    private readonly supabaseService: SupabaseService,
    private readonly identityLinkService: InternalIdentityLinkService,
  ) {
    super(identityProvider, db);
  }

  async signup(userCreateDto: UserCreateDto): Promise<TokenResponseDto> {
    try {
      const supabaseClient = this.supabaseService.getAnonClient();

      const { data: authResponse, error } = await supabaseClient.auth.signUp({
        email: userCreateDto.email,
        password: userCreateDto.password,
        options: {
          data: {
            display_name:
              userCreateDto.displayName || userCreateDto.email.split('@')[0],
          },
        },
      });

      if (error) {
        throw new BadRequestException(
          error.message ||
            'Error during signup. User might already exist or invalid input.',
        );
      }

      if (authResponse.user && authResponse.session?.access_token) {
        return {
          accessToken: authResponse.session.access_token,
          refreshToken: authResponse.session.refresh_token || undefined,
          tokenType: 'bearer',
          expiresIn: authResponse.session.expires_in || undefined,
        };
      }

      if (authResponse.user && !authResponse.session) {
        throw new HttpException(
          'User created successfully. Please check your email to confirm your account before logging in.',
          HttpStatus.ACCEPTED,
        );
      }

      throw new BadRequestException(
        'Could not create user or establish session.',
      );
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        'An unexpected error occurred during signup.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async login(userLoginDto: UserLoginDto): Promise<TokenResponseDto> {
    try {
      const supabaseClient = this.supabaseService.getAnonClient();

      const { data: authResponse, error } =
        await supabaseClient.auth.signInWithPassword({
          email: userLoginDto.email,
          password: userLoginDto.password,
        });

      if (error) {
        throw new UnauthorizedException(
          error.message || 'Invalid login credentials.',
        );
      }

      if (!authResponse.session?.access_token) {
        throw new BadRequestException(
          'Login succeeded but no session or token received.',
        );
      }

      return {
        accessToken: authResponse.session.access_token,
        refreshToken: authResponse.session.refresh_token || undefined,
        tokenType: 'bearer',
        expiresIn: authResponse.session.expires_in || undefined,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        'An unexpected error occurred during login.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async logout(token: string): Promise<void> {
    try {
      const authenticatedClient =
        this.supabaseService.createAuthenticatedClient(token);

      const { error } = await authenticatedClient.auth.signOut();

      if (error) {
        throw new BadRequestException(error.message || 'Error during logout.');
      }
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        'An unexpected error occurred during logout.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async refreshToken(refreshToken: string): Promise<TokenResponseDto> {
    try {
      const supabaseClient = this.supabaseService.getAnonClient();

      const { data: authResponse, error } =
        await supabaseClient.auth.refreshSession({
          refresh_token: refreshToken,
        });

      if (error) {
        throw new UnauthorizedException(
          error.message || 'Invalid or expired refresh token',
        );
      }

      if (!authResponse.session) {
        throw new UnauthorizedException('Invalid or expired refresh token');
      }

      return {
        accessToken: authResponse.session.access_token,
        refreshToken: authResponse.session.refresh_token || undefined,
        tokenType: 'bearer',
        expiresIn: authResponse.session.expires_in || undefined,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        'An unexpected error occurred during token refresh.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async resolveInternalUserId(
    principal: AuthenticatedPrincipal,
  ): Promise<string> {
    await this.identityLinkService.upsertIdentityLink(principal.id, principal);
    return principal.id;
  }

  async createUser(
    createUserDto: CreateUserDto,
    adminUserId: string,
  ): Promise<CreateUserResponseDto> {
    try {
      const serviceClient = this.supabaseService.getServiceClient();

      const { data: authUser, error: authError } =
        await serviceClient.auth.admin.createUser({
          email: createUserDto.email,
          password: createUserDto.password,
          email_confirm: createUserDto.emailConfirm !== false,
          user_metadata: {
            display_name: createUserDto.displayName || '',
          },
        });

      if (authError) {
        throw new Error(`Failed to create auth user: ${authError.message}`);
      }

      if (!authUser.user) {
        throw new Error('Auth user creation returned no user data');
      }

      const defaultOrg = createUserDto.organizationAccess?.[0] || 'demo-org';
      const { error: profileError } = await serviceClient
        .from(getTableName('users'))
        .insert({
          id: authUser.user.id,
          email: createUserDto.email,
          display_name: createUserDto.displayName || null,
          organization_slug: defaultOrg,
          status: 'active',
        })
        .select()
        .single();

      if (profileError) {
        await serviceClient.auth.admin.deleteUser(authUser.user.id);
        throw new Error(
          `Failed to create user profile: ${profileError.message}`,
        );
      }

      const roles = createUserDto.roles || ['member'];
      const orgs = createUserDto.organizationAccess?.length
        ? createUserDto.organizationAccess
        : ['demo-org'];

      const { data: roleData } = await serviceClient
        .from('rbac_roles')
        .select('id, name')
        .in('name', roles);

      if (roleData) {
        const typedRoleData = roleData as Array<{ id: string; name: string }>;
        for (const org of orgs) {
          for (const role of typedRoleData) {
            await serviceClient.from('rbac_user_org_roles').insert({
              user_id: authUser.user.id,
              organization_slug: org,
              role_id: role.id,
              assigned_by: adminUserId,
            });
          }
        }
      }

      return {
        id: authUser.user.id,
        email: createUserDto.email,
        displayName: createUserDto.displayName,
        roles,
        emailConfirmationRequired: !authUser.user.email_confirmed_at,
        message: 'User created successfully',
        organizationAccess: orgs,
      };
    } catch (error) {
      throw new Error(
        `Failed to create user: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  async deleteUser(
    userId: string,
    adminUserId: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const serviceClient = this.supabaseService.getServiceClient();

      if (userId === adminUserId) {
        throw new BadRequestException('You cannot delete your own account');
      }

      const { data: existingUser, error: checkError } = await serviceClient
        .from(getTableName('users'))
        .select('id, email')
        .eq('id', userId)
        .single();

      let userEmail = '';
      if (checkError || !existingUser) {
        const { data: authUser, error: authUserError } =
          await serviceClient.auth.admin.getUserById(userId);

        if (authUserError || !authUser?.user) {
          throw new BadRequestException(
            'User not found in auth.users or public.users',
          );
        }

        userEmail = authUser.user.email || userId;
        this.logger.warn(
          `User ${userId} exists in auth.users but not in public.users. Will delete from auth.users only.`,
        );
      } else {
        userEmail = (existingUser as { email: string }).email;
      }

      await serviceClient
        .from('rbac_audit_log')
        .delete()
        .or(`actor_id.eq.${userId},target_user_id.eq.${userId}`);

      await serviceClient
        .from('rbac_user_org_roles')
        .update({ assigned_by: null })
        .eq('assigned_by', userId);

      await serviceClient
        .from('rbac_user_org_roles')
        .delete()
        .eq('user_id', userId);

      const { error: authError } =
        await serviceClient.auth.admin.deleteUser(userId);

      if (authError) {
        this.logger.error(
          `Failed to delete auth user ${userId}: ${authError.message}`,
          authError,
        );

        const errorMessage = authError.message || 'Unknown error';
        if (
          errorMessage.includes('Database error') ||
          errorMessage.includes('constraint')
        ) {
          throw new Error(
            `Failed to delete auth user: ${errorMessage}. ` +
              `This may be due to foreign key constraints or active sessions. ` +
              `Try deleting through Supabase dashboard or ensure all user data is cleaned up first.`,
          );
        }

        throw new Error(
          `Failed to delete auth user: ${errorMessage}. User may still exist in auth.users.`,
        );
      }

      if (existingUser) {
        const { error: profileError } = await serviceClient
          .from(getTableName('users'))
          .delete()
          .eq('id', userId);

        if (profileError) {
          this.logger.debug(
            `User profile ${userId} may have been cascade-deleted: ${profileError.message}`,
          );
        }
      }

      return {
        success: true,
        message: `User ${userEmail} deleted successfully`,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        `Failed to delete user: ${error instanceof Error ? error.message : 'Unknown error'}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async changeUserPassword(
    userId: string,
    newPassword: string,
    _adminUserId: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const serviceClient = this.supabaseService.getServiceClient();

      const { error } = await serviceClient.auth.admin.updateUserById(userId, {
        password: newPassword,
      });

      if (error) {
        throw new Error(`Failed to update password: ${error.message}`);
      }

      return {
        success: true,
        message: 'Password updated successfully',
      };
    } catch (error) {
      throw new HttpException(
        `Failed to change password: ${error instanceof Error ? error.message : 'Unknown error'}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async initiatePasswordReset(
    email: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const supabaseClient = this.supabaseService.getAnonClient();

      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: `${process.env.FRONTEND_URL || 'http://localhost:8100'}/reset-password`,
      });

      if (error) {
        throw new Error(`Failed to send reset email: ${error.message}`);
      }

      return {
        success: true,
        message: 'Password reset email sent',
      };
    } catch {
      this.logger.warn(`Password reset attempted for: ${email}`);
      return {
        success: true,
        message: 'If the email exists, a password reset link has been sent',
      };
    }
  }
}
