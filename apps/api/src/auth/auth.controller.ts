import {
  Body,
  BadRequestException,
  Controller,
  Delete,
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
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { InviteService } from './invite.service';
import { BillingService } from '../billing/billing.service';

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

interface SignupBody {
  email?: string;
  password?: string;
  displayName?: string;
}

interface ClubSignupBody {
  clubCode?: string;
  email?: string;
  password?: string;
  displayName?: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AUTH_SERVICE) private readonly authService: AuthServiceProvider,
    @Inject(InviteService) private readonly inviteService: InviteService,
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(BillingService) private readonly billing: BillingService,
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
   * Create an invite link for a new member.
   */
  @UseGuards(JwtAuthGuard)
  @Post('invites')
  async createInvite(
    @Req() req: { user?: { id: string; role?: string } },
    @Body() body: InviteBody,
  ) {
    if (!req.user?.id) throw new UnauthorizedException('Authentication required');
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
    return this.inviteService.listInvites(req.user.id);
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
    return this.inviteService.revokeInvite(id, req.user.id);
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
   * Creates a Supabase account, assigns the invite role, returns JWT.
   */
  @Post('signup-with-invite')
  async signupWithInvite(@Body() body: SignupWithInviteBody) {
    if (!body.token) throw new UnauthorizedException('token is required');
    if (!body.email) throw new UnauthorizedException('email is required');
    if (!body.password) throw new UnauthorizedException('password is required');
    return this.inviteService.acceptInvite(body.token, body.email, body.password, body.displayName);
  }

  /**
   * Public organic signup. Creates a normal member account and starts the
   * standard trial/subscription bootstrap. Organic signups cannot author custom
   * analysts or instruments unless a founder later grants builder access.
   */
  @Post('signup')
  async signup(@Body() body: SignupBody) {
    if (!body.email) throw new BadRequestException('email is required');
    if (!body.password) throw new BadRequestException('password is required');
    return this.inviteService.signupPublic(body.email, body.password, body.displayName);
  }

  /**
   * Sign up using a club invite code. Public — no auth required.
   * Creates a Supabase account with member role and joins the club in one step.
   * Ethan's friends just need: divinr.ai/join + club code.
   */
  @Post('signup-with-club-code')
  async signupWithClubCode(@Body() body: ClubSignupBody) {
    if (!body.clubCode) throw new UnauthorizedException('clubCode is required');
    if (!body.email) throw new UnauthorizedException('email is required');
    if (!body.password) throw new UnauthorizedException('password is required');

    // 1. Verify the club code exists
    const clubResult = await this.db.rawQuery(
      `SELECT id, name FROM prediction.clubs WHERE invite_code = $1`,
      [body.clubCode.toUpperCase()],
    );
    const clubs = (clubResult.data as Array<{ id: string; name: string }>) ?? [];
    if (clubs.length === 0) {
      throw new UnauthorizedException('Invalid club code');
    }
    const club = clubs[0];

    // 2. Create the user with member role
    const createResult = await this.authService.createUser(
      {
        email: body.email,
        password: body.password,
        displayName: body.displayName ?? body.email.split('@')[0],
        roles: ['member'],
        emailConfirm: true,
      },
      club.id, // created_by = club
    );
    const userId = (createResult as unknown as Record<string, unknown>)?.id as string | undefined;

    // 3. Join the club
    if (userId) {
      await this.db.rawQuery(
        `INSERT INTO prediction.club_members (id, club_id, user_id, role, joined_at)
         VALUES (gen_random_uuid()::text, $1, $2, 'member', now())
         ON CONFLICT DO NOTHING`,
        [club.id, userId],
      );

      // 4. Seed a 30-day trial subscription. Non-fatal: missing subscription rows
      // are swept up by the Phase 6 migration backfill cron.
      try {
        await this.billing.ensureSubscription(userId);
      } catch {
        // Log but do not block signup — billing backfill will catch this.
      }
    }

    // 5. Auto-login to get tokens
    return this.authService.login({
      email: body.email,
      password: body.password,
    });
  }
}
