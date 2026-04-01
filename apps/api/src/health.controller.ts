import { Controller, Get } from '@nestjs/common';
import { Public } from '@orchestratorai/planes/auth';

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  health() {
    return {
      ok: true,
      service: 'divinr-api',
      timestamp: new Date().toISOString(),
    };
  }
}
