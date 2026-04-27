import { Controller, Get, Inject } from '@nestjs/common';
import { Public } from '@orchestratorai/planes/auth';
import { SchemaReadinessService } from './bootstrap/schema-readiness.service';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(SchemaReadinessService) private readonly readiness: SchemaReadinessService,
  ) {}

  @Public()
  @Get()
  async health() {
    const schema = await this.readiness.check();
    return {
      ok: schema.ok,
      service: 'divinr-api',
      schema,
      timestamp: new Date().toISOString(),
    };
  }
}
