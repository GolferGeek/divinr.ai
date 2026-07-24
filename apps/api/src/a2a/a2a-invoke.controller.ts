import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { A2APhaseGateGuard } from './a2a-phase-gate.guard';
import {
  A2AProtocolValidationError,
  A2AProtocolValidator,
} from './a2a-protocol-validator';

@Controller('a2a')
@UseGuards(A2APhaseGateGuard)
export class A2AInvokeController {
  private readonly validator = new A2AProtocolValidator();

  @Post()
  @HttpCode(200)
  invoke(
    @Body() body: unknown,
    @Headers('a2a-version') version: string | undefined,
    @Headers('a2a-extensions') extensions: string | undefined,
  ) {
    let request;
    try {
      request = this.validator.validate(body, version, extensions);
    } catch (error) {
      if (error instanceof A2AProtocolValidationError) {
        return this.error(error.id, error.jsonRpcCode, error.message);
      }
      throw error;
    }

    // HTTP authentication is deliberately denied by A2APhaseGateGuard until
    // sender-constrained DPoP is implemented in Phase 5. This return remains
    // fail-closed if the controller is invoked directly in a unit test or a
    // future guard is misconfigured.
    return this.error(request.id, -32050, 'Protected A2A business methods are not enabled', {
      schemaVersion: 2,
      errorId: randomUUID(),
      code: 'AUTH_REQUIRED',
      message: 'Complete connected-agent authorization before invoking A2A work.',
      retryable: false,
      occurredAt: new Date().toISOString(),
    });
  }

  private error(
    id: unknown,
    code: number,
    message: string,
    data?: Record<string, unknown>,
  ) {
    return {
      jsonrpc: '2.0',
      id: id ?? null,
      error: { code, message, ...(data ? { data } : {}) },
    };
  }
}
