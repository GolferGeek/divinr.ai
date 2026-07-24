import { HttpException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

export class OAuthProtocolError extends HttpException {
  constructor(
    status: number,
    error: string,
    description: string,
    extra: Record<string, unknown> = {},
  ) {
    super({ error, error_description: description, ...extra }, status);
  }
}

export class OAuthDPoPNonceRequiredError extends OAuthProtocolError {
  constructor(readonly nonce: string) {
    super(
      401,
      'use_dpop_nonce',
      'Retry with the supplied one-use DPoP nonce',
    );
  }
}

export function connectedAgentError(
  status: number,
  code:
    | 'APPROVAL_INVALID'
    | 'APPROVAL_EXPIRED'
    | 'RESOURCE_NOT_FOUND'
    | 'SCHEMA_INVALID'
    | 'RATE_LIMIT_EXCEEDED',
  message: string,
): HttpException {
  return new HttpException({
    schemaVersion: 2,
    errorId: randomUUID(),
    code,
    message,
    retryable: false,
    occurredAt: new Date().toISOString(),
  }, status);
}
