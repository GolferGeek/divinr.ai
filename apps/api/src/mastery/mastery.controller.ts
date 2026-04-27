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
import { MasteryService } from './mastery.service';
import type { MasteryLevel } from './mastery.types';

interface AuthenticatedUser {
  id: string;
  email?: string;
  role?: string;
}

@UseGuards(JwtAuthGuard)
@Controller('api/mastery')
export class MasteryController {
  constructor(
    @Inject(MasteryService) private readonly mastery: MasteryService,
  ) {}

  private getUser(req: { user?: AuthenticatedUser }): AuthenticatedUser {
    if (!req.user?.id) throw new BadRequestException('Authentication required');
    return req.user;
  }

  @Get('profile')
  async getProfile(@Req() req: { user?: AuthenticatedUser }) {
    const user = this.getUser(req);
    return this.mastery.getProfile(user.id);
  }

  @Post('profile')
  async updateProfile(
    @Req() req: { user?: AuthenticatedUser },
    @Body() body: { preferredLevel?: MasteryLevel | null },
  ) {
    const user = this.getUser(req);
    if (!body || !Object.prototype.hasOwnProperty.call(body, 'preferredLevel')) {
      throw new BadRequestException('preferredLevel is required');
    }
    return this.mastery.updatePreferredLevel(user.id, body.preferredLevel ?? null);
  }
}
