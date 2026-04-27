import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@orchestratorai/planes/auth';
import { SkipReadOnly } from '../billing/skip-read-only.decorator';
import { LearningPanelService } from './learning-panel.service';

interface AuthenticatedUser {
  id: string;
  email?: string;
  role?: string;
}

@SkipReadOnly()
@UseGuards(JwtAuthGuard)
@Controller('api/learning-panel')
export class LearningPanelController {
  constructor(
    @Inject(LearningPanelService) private readonly learningPanel: LearningPanelService,
  ) {}

  private getUser(req: { user?: AuthenticatedUser }): AuthenticatedUser {
    if (!req.user?.id) {
      throw new BadRequestException('Authentication required');
    }
    return req.user;
  }

  @Get('bootstrap')
  async getBootstrap(
    @Req() req: { user?: AuthenticatedUser },
    @Query('surfaceKey') surfaceKey?: string,
  ) {
    const user = this.getUser(req);
    return this.learningPanel.getBootstrap(user.id, surfaceKey, user.role);
  }

  @Get('threads')
  async listThreads(@Req() req: { user?: AuthenticatedUser }) {
    const user = this.getUser(req);
    return { threads: await this.learningPanel.listThreads(user.id) };
  }

  @Post('threads')
  async createThread(
    @Req() req: { user?: AuthenticatedUser },
    @Body()
    body: {
      originSurfaceKey?: string;
      initialMessage: string;
      instrumentId?: string;
      mode?: 'platform' | 'byo';
      credentialId?: string;
    },
  ) {
    const user = this.getUser(req);
    return this.learningPanel.createThread(user.id, user.role, body);
  }

  @Get('threads/:threadId')
  async getThread(
    @Req() req: { user?: AuthenticatedUser },
    @Param('threadId') threadId: string,
  ) {
    const user = this.getUser(req);
    return { thread: await this.learningPanel.getThread(user.id, threadId) };
  }

  @Post('threads/:threadId/messages')
  async appendMessage(
    @Req() req: { user?: AuthenticatedUser },
    @Param('threadId') threadId: string,
    @Body()
    body: {
      message: string;
      surfaceKey?: string;
      instrumentId?: string;
      mode?: 'platform' | 'byo';
      credentialId?: string;
    },
  ) {
    const user = this.getUser(req);
    return this.learningPanel.appendMessage(user.id, user.role, threadId, body);
  }

  @Post('messages/:messageId/feedback')
  async submitFeedback(
    @Req() req: { user?: AuthenticatedUser },
    @Param('messageId') messageId: string,
    @Body()
    body: {
      feedback: 'helpful' | 'unhelpful';
      note?: string;
    },
  ) {
    const user = this.getUser(req);
    return this.learningPanel.submitFeedback(user.id, messageId, body);
  }
}
