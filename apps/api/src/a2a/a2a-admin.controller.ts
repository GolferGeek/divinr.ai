import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Logger,
} from '@nestjs/common';
import { ServiceApiKeyService } from '../auth/service-api-key.service';

/**
 * Admin endpoints for managing service API keys.
 * These endpoints are protected by the existing auth middleware (JWT / dev bypass).
 */
@Controller('a2a/admin/keys')
export class A2AAdminController {
  private readonly logger = new Logger(A2AAdminController.name);

  constructor(private readonly apiKeyService: ServiceApiKeyService) {}

  @Post()
  async generateKey(
    @Body()
    body: {
      label: string;
      allowedMachineIdentities: string[];
      scopes?: string[];
    },
  ) {
    if (!body.label) {
      return { error: 'label is required' };
    }
    if (!body.allowedMachineIdentities?.length) {
      return { error: 'allowedMachineIdentities is required (at least one)' };
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
  async listKeys() {
    const keys = await this.apiKeyService.listKeys();
    return { keys };
  }

  @Delete(':id')
  async revokeKey(@Param('id') id: string) {
    const revoked = await this.apiKeyService.revokeKey(id);
    if (!revoked) {
      return { error: 'Key not found' };
    }
    this.logger.log(`Revoked service API key: ${id}`);
    return { revoked: true, id };
  }
}
