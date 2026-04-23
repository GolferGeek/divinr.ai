import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@orchestratorai/planes/auth';
import { SkipReadOnly } from '../billing/skip-read-only.decorator';
import {
  SocialOptOutService,
  type SocialOptOuts,
  type SocialOptOutFlag,
} from './social-opt-out.service';

/**
 * Self-serve management of the five social opt-out flags. Even a read-only
 * user must be able to tidy these, so every route is @SkipReadOnly. Both
 * endpoints enforce `req.user.id === :id` (PRD §4.3 — users manage their
 * own opt-outs, no admin escape hatch).
 */
@Controller('users')
export class UsersController {
  constructor(
    @Inject(SocialOptOutService) private readonly optOuts: SocialOptOutService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @SkipReadOnly()
  @Get(':id/social-opt-outs')
  async getSocialOptOuts(
    @Req() req: { user?: { id?: string } },
    @Param('id') id: string,
  ): Promise<SocialOptOuts> {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Authentication required');
    if (userId !== id) throw new ForbiddenException('You can only manage your own opt-outs');
    return this.optOuts.getOptOuts(id);
  }

  @UseGuards(JwtAuthGuard)
  @SkipReadOnly()
  @Patch(':id/social-opt-outs')
  async setSocialOptOuts(
    @Req() req: { user?: { id?: string } },
    @Param('id') id: string,
    @Body() body: Partial<SocialOptOuts>,
  ): Promise<SocialOptOuts> {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Authentication required');
    if (userId !== id) throw new ForbiddenException('You can only manage your own opt-outs');

    const allowed = new Set<SocialOptOutFlag>(SocialOptOutService.flags);
    const partial: Partial<SocialOptOuts> = {};
    for (const [k, v] of Object.entries(body ?? {})) {
      if (allowed.has(k as SocialOptOutFlag) && typeof v === 'boolean') {
        partial[k as SocialOptOutFlag] = v;
      }
    }
    return this.optOuts.setOptOuts(id, partial);
  }
}
