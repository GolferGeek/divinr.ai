import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@orchestratorai/planes/auth';
import type { Request } from 'express';
import { OAuthRateLimiter } from '../oauth/oauth-rate-limiter';
import { ConnectedAgentsService } from './connected-agents.service';
import type {
  ApprovalBody,
  DenialBody,
  RevocationBody,
} from './connected-agents.types';

type AuthenticatedRequest = Request & { user?: { id: string } };

@Controller('connected-agents')
@UseGuards(JwtAuthGuard)
export class ConnectedAgentsController {
  constructor(
    @Inject(ConnectedAgentsService)
    private readonly connectedAgents: ConnectedAgentsService,
    @Inject(OAuthRateLimiter)
    private readonly rateLimiter: OAuthRateLimiter,
  ) {}

  @Get('device/:userCode')
  review(
    @Req() request: AuthenticatedRequest,
    @Param('userCode') userCode: string,
  ) {
    this.limitCodeEntry(request);
    return this.connectedAgents.review(this.userId(request), userCode);
  }

  @Post('device/:userCode/approve')
  approve(
    @Req() request: AuthenticatedRequest,
    @Param('userCode') userCode: string,
    @Body() body: ApprovalBody,
  ) {
    this.limitCodeEntry(request);
    return this.connectedAgents.approve(this.userId(request), userCode, body);
  }

  @Post('device/:userCode/deny')
  deny(
    @Req() request: AuthenticatedRequest,
    @Param('userCode') userCode: string,
    @Body() body: DenialBody,
  ) {
    this.limitCodeEntry(request);
    return this.connectedAgents.deny(this.userId(request), userCode, body);
  }

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.connectedAgents.list(this.userId(request));
  }

  @Get(':installationId')
  detail(
    @Req() request: AuthenticatedRequest,
    @Param('installationId') installationId: string,
  ) {
    return this.connectedAgents.detail(this.userId(request), installationId);
  }

  @Post(':installationId/revoke')
  revokeInstallation(
    @Req() request: AuthenticatedRequest,
    @Param('installationId') installationId: string,
    @Body() body: RevocationBody,
  ) {
    return this.connectedAgents.revokeInstallation(
      this.userId(request),
      installationId,
      body,
    );
  }

  @Post(':installationId/grants/:grantId/revoke')
  revokeGrant(
    @Req() request: AuthenticatedRequest,
    @Param('installationId') installationId: string,
    @Param('grantId') grantId: string,
    @Body() body: RevocationBody,
  ) {
    return this.connectedAgents.revokeGrant(
      this.userId(request),
      installationId,
      grantId,
      body,
    );
  }

  private userId(request: AuthenticatedRequest): string {
    if (!request.user?.id) throw new UnauthorizedException('Authentication required');
    return request.user.id;
  }

  private limitCodeEntry(request: AuthenticatedRequest): void {
    const source = request.ip || request.socket.remoteAddress || 'unknown';
    const userId = this.userId(request);
    this.rateLimiter.assert(`device-entry:${userId}:${source}`, 20);
  }
}
