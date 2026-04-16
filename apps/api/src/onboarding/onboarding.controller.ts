import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@orchestratorai/planes/auth';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { OnboardingService } from './onboarding.service';
import type { OnboardingPatch } from './onboarding.types';

interface AuthenticatedUser {
  id: string;
  email?: string;
  role?: string;
}

@UseGuards(JwtAuthGuard)
@Controller('onboarding')
export class OnboardingController {
  constructor(
    @Inject(OnboardingService) private readonly onboarding: OnboardingService,
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
  ) {}

  private getUser(req: { user?: AuthenticatedUser }): AuthenticatedUser {
    if (!req.user?.id) throw new BadRequestException('Authentication required');
    return req.user;
  }

  @Get('state')
  async getState(@Req() req: { user?: AuthenticatedUser }) {
    const user = this.getUser(req);
    return this.onboarding.getState(user.id);
  }

  @Patch('state')
  async patchState(
    @Req() req: { user?: AuthenticatedUser },
    @Body() body: OnboardingPatch,
  ) {
    const user = this.getUser(req);
    return this.onboarding.applyPatch(user.id, body);
  }

  @Post('reset/:userId')
  async resetUser(
    @Req() req: { user?: AuthenticatedUser },
    @Param('userId') targetUserId: string,
  ) {
    const caller = this.getUser(req);
    await this.requireSuperAdmin(caller);
    return this.onboarding.resetUser(targetUserId);
  }

  private async requireSuperAdmin(user: AuthenticatedUser): Promise<void> {
    // Mirror the role lookup pattern from ClubController — highest role wins.
    const result = await this.db.rawQuery(
      `SELECT rr.name FROM authz.rbac_user_roles r
       JOIN authz.rbac_roles rr ON rr.id = r.role_id
       WHERE r.user_id = $1
       ORDER BY CASE rr.name
         WHEN 'super-admin' THEN 1 WHEN 'owner' THEN 2 WHEN 'admin' THEN 3
         WHEN 'member' THEN 4 WHEN 'beta_reader' THEN 5 ELSE 6 END
       LIMIT 1`,
      [user.id],
    );
    if (result.error) {
      throw new ForbiddenException('Unable to verify role');
    }
    const rows = (result.data as Array<{ name: string }> | null) ?? [];
    const role = rows.length > 0 ? rows[0]!.name : null;
    if (role !== 'super-admin') {
      throw new ForbiddenException('Super-admin access required');
    }
  }
}
