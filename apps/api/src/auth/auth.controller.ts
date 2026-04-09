import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AUTH_SERVICE,
  type AuthServiceProvider,
} from '@orchestratorai/planes/auth';
import { InviteService } from './invite.service';

interface LoginBody {
  email?: string;
  password?: string;
}

interface LogoutBody {
  // No fields required; logout uses the bearer token from the request.
}

interface InviteBody {
  organizationSlug?: string;
  email?: string;
}

interface SignupWithInviteBody {
  token?: string;
  email?: string;
  password?: string;
  displayName?: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AUTH_SERVICE) private readonly authService: AuthServiceProvider,
    @Inject(InviteService) private readonly inviteService: InviteService,
  ) {}

  /**
   * Authenticate with email/password and return a Supabase access token.
   * Body: { email, password }
   * Returns: { accessToken, refreshToken, tokenType, expiresIn }
   */
  @Post('login')
  async login(@Body() body: LoginBody) {
    if (!body?.email || !body?.password) {
      throw new UnauthorizedException('email and password are required');
    }
    return this.authService.login({ email: body.email, password: body.password });
  }

  /**
   * Sign out the current user. Requires a valid bearer token.
   */
  @Post('logout')
  async logout(@Req() req: { headers: Record<string, string | string[] | undefined> }, @Body() _body: LogoutBody) {
    const authHeader = req.headers['authorization'];
    const headerStr = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    if (!headerStr?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Bearer token required for logout');
    }
    const token = headerStr.slice(7);
    await this.authService.logout(token);
    return { ok: true };
  }

  /**
   * Return the current authenticated principal with org role.
   * AuthMiddleware has already validated the bearer token and populated req.user.
   */
  @Get('me')
  async me(
    @Req() req: { user?: { id: string; email?: string; role?: string }; headers: Record<string, string | string[] | undefined> },
  ) {
    if (!req.user?.id) {
      throw new UnauthorizedException('Authentication required');
    }
    // Resolve org role from RBAC tables
    const orgSlugHeader = req.headers['x-org-slug'];
    const orgSlug = Array.isArray(orgSlugHeader) ? orgSlugHeader[0] : orgSlugHeader;
    let orgRole: string | null = null;
    if (orgSlug) {
      orgRole = await this.inviteService.getOrgRole(req.user.id, orgSlug);
    }
    return {
      id: req.user.id,
      email: req.user.email,
      role: req.user.role,
      orgRole,
    };
  }

  // ─── Invite Endpoints ──────────────────────────────────────────
  // Effort: beta-user-share-path

  /**
   * Create an invite link for a beta reader.
   * Requires admin or owner role.
   */
  @Post('invites')
  async createInvite(
    @Req() req: { user?: { id: string; role?: string } },
    @Body() body: InviteBody,
  ) {
    if (!req.user?.id) throw new UnauthorizedException('Authentication required');
    if (!body.organizationSlug) throw new UnauthorizedException('organizationSlug is required');
    // Only admin/owner can create invites
    await this.requireInviteAccess(req.user.id, body.organizationSlug);
    return this.inviteService.createInvite(body.organizationSlug, req.user.id, body.email);
  }

  /**
   * List invites for an organization.
   */
  @Get('invites')
  async listInvites(
    @Req() req: { user?: { id: string } },
    @Query('organizationSlug') orgSlug?: string,
  ) {
    if (!req.user?.id) throw new UnauthorizedException('Authentication required');
    if (!orgSlug) throw new UnauthorizedException('organizationSlug query param is required');
    await this.requireInviteAccess(req.user.id, orgSlug);
    return this.inviteService.listInvites(orgSlug);
  }

  /**
   * Revoke an invite.
   */
  @Delete('invites/:id')
  async revokeInvite(
    @Req() req: { user?: { id: string }; headers: Record<string, string | string[] | undefined> },
    @Param('id') id: string,
    @Query('organizationSlug') orgSlug?: string,
  ) {
    if (!req.user?.id) throw new UnauthorizedException('Authentication required');
    if (!orgSlug) throw new UnauthorizedException('organizationSlug query param is required');
    await this.requireInviteAccess(req.user.id, orgSlug);
    return this.inviteService.revokeInvite(id, orgSlug);
  }

  /**
   * Validate an invite token. Public — no auth required.
   * Used by the signup form to check if a token is valid before showing the form.
   */
  @Get('invites/:token/validate')
  async validateInvite(@Param('token') token: string) {
    return this.inviteService.validateInviteToken(token);
  }

  /**
   * Sign up using an invite token. Public — no auth required.
   * Creates a Supabase account, assigns beta_reader role, returns JWT.
   */
  @Post('signup-with-invite')
  async signupWithInvite(@Body() body: SignupWithInviteBody) {
    if (!body.token) throw new UnauthorizedException('token is required');
    if (!body.email) throw new UnauthorizedException('email is required');
    if (!body.password) throw new UnauthorizedException('password is required');
    return this.inviteService.acceptInvite(body.token, body.email, body.password, body.displayName);
  }

  // ─── Helpers ───────────────────────────────────────────────────

  private async requireInviteAccess(userId: string, organizationSlug: string): Promise<void> {
    const role = await this.inviteService.getOrgRole(userId, organizationSlug);
    if (!role || !['super-admin', 'owner', 'admin'].includes(role)) {
      throw new ForbiddenException('Only organization owners or admins can manage invites');
    }
  }
}
