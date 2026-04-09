import {
  BadRequestException,
  Controller,
  Post,
  Get,
  Delete,
  Body,
  ForbiddenException,
  Param,
  Logger,
  Inject,
  NotFoundException,
  Req,
} from '@nestjs/common';
import { ServiceApiKeyService } from '../auth/service-api-key.service';

interface AuthenticatedUser {
  id: string;
  email?: string;
  role?: string;
}

/**
 * Admin endpoints for managing service API keys.
 * These endpoints are protected by the existing auth middleware (JWT / dev bypass).
 */
@Controller('a2a/admin/keys')
export class A2AAdminController {
  private readonly logger = new Logger(A2AAdminController.name);

  constructor(@Inject(ServiceApiKeyService) private readonly apiKeyService: ServiceApiKeyService) {}

  private requireAdmin(req: { user?: AuthenticatedUser }): void {
    if (!req.user?.id) {
      throw new ForbiddenException('Authentication required');
    }
    if (req.user.role !== 'admin') {
      throw new ForbiddenException('Admin access required');
    }
  }

  @Post()
  async generateKey(
    @Req() req: { user?: AuthenticatedUser },
    @Body()
    body: {
      label: string;
      allowedMachineIdentities: string[];
      scopes?: string[];
    },
  ) {
    this.requireAdmin(req);
    if (!body.label) {
      throw new BadRequestException('label is required');
    }
    if (!body.allowedMachineIdentities?.length) {
      throw new BadRequestException('allowedMachineIdentities is required (at least one)');
    }

    const result = await this.apiKeyService.generateKey(
      body.label,
      body.allowedMachineIdentities,
      body.scopes ?? ['*'],
    );

    this.logger.log(
      `Generated service API key: ${result.prefix} for "${body.label}" ` +
        `(machines: ${body.allowedMachineIdentities.join(', ')})`,
    );

    return {
      id: result.id,
      key: result.key,
      prefix: result.prefix,
      label: body.label,
      allowedMachineIdentities: body.allowedMachineIdentities,
      warning: 'Store this key securely — it will not be shown again.',
    };
  }

  @Get()
  async listKeys(@Req() req: { user?: AuthenticatedUser }) {
    this.requireAdmin(req);
    const keys = await this.apiKeyService.listKeys();
    return { keys };
  }

  @Delete(':id')
  async revokeKey(@Req() req: { user?: AuthenticatedUser }, @Param('id') id: string) {
    this.requireAdmin(req);
    const revoked = await this.apiKeyService.revokeKey(id);
    if (!revoked) {
      throw new NotFoundException('Key not found');
    }
    this.logger.log(`Revoked service API key: ${id}`);
    return { revoked: true, id };
  }
}
