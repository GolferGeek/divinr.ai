import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@orchestratorai/planes/auth';
import { FirstTouchService } from './first-touch.service';
import {
  isValidPrefix,
  isValidSurfaceKey,
  type MarkTouchedRequest,
  type MuteRequest,
  type ResetRequest,
} from './first-touch.types';

interface AuthenticatedUser {
  id: string;
  email?: string;
  role?: string;
}

@UseGuards(JwtAuthGuard)
@Controller('first-touch')
export class FirstTouchController {
  constructor(
    @Inject(FirstTouchService) private readonly firstTouch: FirstTouchService,
  ) {}

  private getUser(req: { user?: AuthenticatedUser }): AuthenticatedUser {
    if (!req.user?.id) throw new BadRequestException('Authentication required');
    return req.user;
  }

  @Get('state')
  async getState(@Req() req: { user?: AuthenticatedUser }) {
    const user = this.getUser(req);
    return this.firstTouch.getState(user.id);
  }

  @Post('touched')
  async markTouched(
    @Req() req: { user?: AuthenticatedUser },
    @Body() body: MarkTouchedRequest,
  ) {
    const user = this.getUser(req);
    if (!body || !isValidSurfaceKey(body.surface_key)) {
      throw new BadRequestException('surface_key is required and must match [a-z0-9][a-z0-9.-]*');
    }
    await this.firstTouch.markTouched(user.id, body.surface_key);
    return { ok: true };
  }

  @Post('mute')
  async setMute(
    @Req() req: { user?: AuthenticatedUser },
    @Body() body: MuteRequest,
  ) {
    const user = this.getUser(req);
    if (!body || typeof body.muted !== 'boolean') {
      throw new BadRequestException('muted (boolean) is required');
    }
    return this.firstTouch.setMute(user.id, body.muted);
  }

  @Post('reset')
  async reset(
    @Req() req: { user?: AuthenticatedUser },
    @Body() body: ResetRequest,
  ) {
    const user = this.getUser(req);
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Request body required');
    }
    if (body.scope === 'all') {
      return this.firstTouch.resetAll(user.id);
    }
    if (body.scope === 'prefix') {
      if (!isValidPrefix((body as { prefix?: unknown }).prefix)) {
        throw new BadRequestException('prefix is required and must match [a-z0-9][a-z0-9.-]*');
      }
      return this.firstTouch.resetByPrefix(user.id, body.prefix);
    }
    throw new BadRequestException(`Invalid scope; expected 'all' or 'prefix'`);
  }
}
