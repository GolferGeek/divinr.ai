import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  AUTH_SERVICE,
  type AuthServiceProvider,
  JwtAuthGuard,
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
   * Refresh an expired access token using a refresh token.
   * Body: { refreshToken }
   * Returns: { accessToken, refreshToken, tokenType, expiresIn }
   */
  @Post('refresh')
  async refresh(@Body() body: { refreshToken?: string }) {
    if (!body?.refreshToken) {
      throw new UnauthorizedException('refreshToken is required');
    }
    return this.authService.refreshToken(body.refreshToken);
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
   * Return the current authenticated principal with global role.
   * AuthMiddleware has already validated the bearer token and populated req.user.
   */
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(
    @Req() req: { user?: { id: string; email?: string; role?: string } },
  ) {
    if (!req.user?.id) {
      throw new UnauthorizedException('Authentication required');
    }
    // Resolve global role and profile from RBAC/authz tables
    const globalRole = await this.inviteService.getUserRole(req.user.id);
    const profile = await this.inviteService.getUserProfile(req.user.id);
    return {
      id: req.user.id,
      email: req.user.email,
      role: req.user.role,
      globalRole,
      displayName: profile?.display_name ?? undefined,
    };
  }

  // ─── Invite Endpoints ──────────────────────────────────────────
  // Effort: beta-user-share-path

  /**
   * Create an invite link for a beta reader.
   * Requires admin or owner role.
   */
  @UseGuards(JwtAuthGuard)
  @Post('invites')
  async createInvite(
    @Req() req: { user?: { id: string; role?: string } },
    @Body() body: InviteBody,
  ) {
    if (!req.user?.id) throw new UnauthorizedException('Authentication required');
    // Only admin/owner can create invites
    await this.requireInviteAccess(req.user.id);
    return this.inviteService.createInvite(req.user.id, body.email);
  }

  /**
   * List invites.
   */
  @UseGuards(JwtAuthGuard)
  @Get('invites')
  async listInvites(
    @Req() req: { user?: { id: string } },
  ) {
    if (!req.user?.id) throw new UnauthorizedException('Authentication required');
    await this.requireInviteAccess(req.user.id);
    return this.inviteService.listInvites();
  }

  /**
   * Revoke an invite.
   */
  @UseGuards(JwtAuthGuard)
  @Delete('invites/:id')
  async revokeInvite(
    @Req() req: { user?: { id: string } },
    @Param('id') id: string,
  ) {
    if (!req.user?.id) throw new UnauthorizedException('Authentication required');
    await this.requireInviteAccess(req.user.id);
    return this.inviteService.revokeInvite(id);
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

  private async requireInviteAccess(userId: string): Promise<void> {
    const role = await this.inviteService.getUserRole(userId);
    if (!role || !['super-admin', 'owner', 'admin'].includes(role)) {
      throw new ForbiddenException('Only organization owners or admins can manage invites');
    }
  }
}
