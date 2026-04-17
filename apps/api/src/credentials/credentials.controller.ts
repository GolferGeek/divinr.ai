import {
  Controller, Get, Post, Delete, Body, Param, Req, UnauthorizedException, Inject, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@orchestratorai/planes/auth';
import { CredentialsService } from './credentials.service';

interface AuthenticatedUser {
  id: string;
  email?: string;
}

@UseGuards(JwtAuthGuard)
@Controller('api/credentials')
export class CredentialsController {
  constructor(
    @Inject(CredentialsService) private readonly credentials: CredentialsService,
  ) {}

  private getUser(req: { user?: AuthenticatedUser }): AuthenticatedUser {
    if (!req.user?.id) throw new UnauthorizedException();
    return req.user;
  }

  @Post('llm')
  async addCredential(
    @Req() req: { user?: AuthenticatedUser },
    @Body() body: { provider: string; label: string; secret: string },
  ) {
    const user = this.getUser(req);
    return this.credentials.addCredential(user.id, body);
  }

  @Get('llm')
  async listCredentials(@Req() req: { user?: AuthenticatedUser }) {
    const user = this.getUser(req);
    return this.credentials.listCredentials(user.id);
  }

  @Delete('llm/:id')
  async revokeCredential(
    @Req() req: { user?: AuthenticatedUser },
    @Param('id') id: string,
  ) {
    const user = this.getUser(req);
    await this.credentials.revokeCredential(user.id, id);
    return { revoked: true };
  }
}
