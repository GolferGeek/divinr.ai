import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AgentContractSchemaRegistry } from '../agent-contracts/contract-bundle';
import type { VerifiedAgentPrincipal } from '../oauth/dpop-resource.service';
import {
  A2AAdmissionError,
  A2AAdmissionService,
} from './a2a-admission.service';
import { A2APhaseGateGuard } from './a2a-phase-gate.guard';
import {
  A2AProtocolValidationError,
  A2AProtocolValidator,
} from './a2a-protocol-validator';

@Controller('a2a')
@UseGuards(A2APhaseGateGuard)
export class A2AInvokeController {
  private readonly validator = new A2AProtocolValidator();
  private readonly schemas = new AgentContractSchemaRegistry();

  constructor(
    @Inject(A2AAdmissionService)
    private readonly admission: A2AAdmissionService,
  ) {}

  @Post()
  @HttpCode(200)
  async invoke(
    @Body() body: unknown,
    @Headers('a2a-version') version: string | undefined,
    @Headers('a2a-extensions') extensions: string | undefined,
    @Req() httpRequest: { agentPrincipal?: VerifiedAgentPrincipal },
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

    if (!httpRequest.agentPrincipal) {
      return this.agentError(
        request.id,
        'AUTH_REQUIRED',
        'Complete connected-agent authorization before invoking A2A work.',
      );
    }
    try {
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: await this.admission.execute(request, httpRequest.agentPrincipal),
      };
    } catch (error) {
      if (error instanceof A2AAdmissionError) {
        return this.agentError(
          request.id,
          this.frozenErrorCode(error.code),
          error.message,
          error.retryable,
        );
      }
      throw error;
    }
  }

  private agentError(
    id: unknown,
    code: string,
    message: string,
    retryable = false,
  ) {
    const safeMessage = message.slice(0, 500);
    const data = {
      schemaVersion: 2,
      errorId: randomUUID(),
      code,
      message: safeMessage,
      retryable,
      ...(retryable
        ? { doNotRetryBefore: new Date(Date.now() + 5_000).toISOString() }
        : {}),
      occurredAt: new Date().toISOString(),
    };
    this.schemas.validate('errorEnvelope', data);
    return this.error(id, -32050, safeMessage, data);
  }

  private frozenErrorCode(code: string): string {
    const mappings: Readonly<Record<string, string>> = Object.freeze({
      AP2_NOT_ENABLED: 'PAYMENT_AUTHORITY_UNAVAILABLE',
      TASK_NOT_FOUND: 'RESOURCE_NOT_FOUND',
      TASK_NOT_CANCELABLE: 'RESOURCE_NOT_ALLOWED',
      SCOPE_DENIED: 'SCOPE_INSUFFICIENT',
      GRANT_DENIED: 'CREDENTIAL_REVOKED',
      CONCURRENCY_LIMIT_EXCEEDED: 'CALL_LIMIT_EXCEEDED',
      OUTSTANDING_PAYMENT_LIMIT_EXCEEDED: 'COUNT_LIMIT_EXCEEDED',
      RESPONSE_TOO_LARGE: 'SERVICE_NOT_DELIVERED',
      SKILL_NOT_ENABLED: 'SKILL_NOT_ALLOWED',
      INTENT_MISMATCH: 'ACTION_CONSTRAINT_VIOLATION',
      IDEMPOTENCY_IN_PROGRESS: 'RETRY_SUPPRESSED',
      INTERNAL_ERROR: 'SERVICE_NOT_DELIVERED',
      ADMISSION_FAILED: 'SERVICE_NOT_DELIVERED',
    });
    return mappings[code] ?? code;
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
