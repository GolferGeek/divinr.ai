import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AUTH_SERVICE,
  type AuthServiceProvider,
} from '@orchestratorai/planes/auth';
import {
  IDENTITY_PROVIDER,
  type IdentityProvider,
} from '@orchestratorai/planes/auth';

interface LoginBody {
  email?: string;
  password?: string;
}

interface LogoutBody {
  // No fields required; logout uses the bearer token from the request.
}

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AUTH_SERVICE) private readonly authService: AuthServiceProvider,
    @Inject(IDENTITY_PROVIDER) private readonly identityProvider: IdentityProvider,
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
   * Return the current authenticated principal.
   * AuthMiddleware has already validated the bearer token and populated req.user.
   */
  @Get('me')
  async me(
    @Req() req: { user?: { id: string; email?: string; role?: string }; headers: Record<string, string | string[] | undefined> },
  ) {
    if (!req.user?.id) {
      throw new UnauthorizedException('Authentication required');
    }
    return {
      id: req.user.id,
      email: req.user.email,
      role: req.user.role,
    };
  }
}
