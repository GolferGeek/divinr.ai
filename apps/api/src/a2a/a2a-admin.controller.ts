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
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@orchestratorai/planes/auth';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
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
@UseGuards(JwtAuthGuard)
@Controller('a2a/admin/keys')
export class A2AAdminController {
  private readonly logger = new Logger(A2AAdminController.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(ServiceApiKeyService) private readonly apiKeyService: ServiceApiKeyService,
  ) {}

  private async requireAdmin(req: { user?: AuthenticatedUser }): Promise<void> {
    if (!req.user?.id) {
      throw new ForbiddenException('Authentication required');
    }
    const result = await this.db.rawQuery(
      `SELECT r.name FROM authz.rbac_user_roles ur
       JOIN authz.rbac_roles r ON r.id = ur.role_id
       WHERE ur.user_id = $1 AND r.name IN ('super-admin', 'admin', 'owner')
       LIMIT 1`,
      [req.user.id],
    );
    const rows = (result.data as Array<{ name: string }> | null) ?? [];
    if (rows.length === 0) throw new ForbiddenException('Admin access required');
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
    await this.requireAdmin(req);
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
    await this.requireAdmin(req);
    const keys = await this.apiKeyService.listKeys();
    return { keys };
  }

  @Delete(':id')
  async revokeKey(@Req() req: { user?: AuthenticatedUser }, @Param('id') id: string) {
    await this.requireAdmin(req);
    const revoked = await this.apiKeyService.revokeKey(id);
    if (!revoked) {
      throw new NotFoundException('Key not found');
    }
    this.logger.log(`Revoked service API key: ${id}`);
    return { revoked: true, id };
  }
}
