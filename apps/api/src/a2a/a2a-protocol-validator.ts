import {
  AgentContractSchemaRegistry,
  ContractValidationError,
} from '../agent-contracts/contract-bundle';

export const A2A_METHODS = [
  'SendMessage',
  'GetTask',
  'ListTasks',
  'CancelTask',
] as const;
export type A2AMethod = (typeof A2A_METHODS)[number];

const METHODS = new Set<string>(A2A_METHODS);
const PAID_EXTENSION =
  'urn:golfergeek:a2a:x402-lightning-regtest:v0.2';
const TASK_STATES = new Set([
  'TASK_STATE_SUBMITTED',
  'TASK_STATE_WORKING',
  'TASK_STATE_COMPLETED',
  'TASK_STATE_FAILED',
  'TASK_STATE_CANCELED',
  'TASK_STATE_INPUT_REQUIRED',
  'TASK_STATE_REJECTED',
  'TASK_STATE_AUTH_REQUIRED',
]);

export class A2AProtocolValidationError extends Error {
  constructor(
    readonly jsonRpcCode: -32600 | -32601 | -32602,
    message: string,
    readonly id: string | number | null,
  ) {
    super(message);
    this.name = 'A2AProtocolValidationError';
  }
}

export interface ValidatedA2ARequest {
  id: string | number | null;
  method: A2AMethod;
  params: Record<string, unknown>;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return keys.every((key) => allowed.includes(key));
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 256;
}

function optionalNonNegativeInteger(value: unknown, maximum = 50): boolean {
  return value === undefined
    || (Number.isInteger(value) && Number(value) >= 0 && Number(value) <= maximum);
}

export class A2AProtocolValidator {
  constructor(
    private readonly schemas = new AgentContractSchemaRegistry(),
  ) {}

  validate(
    body: unknown,
    version: string | undefined,
    extensions: string | undefined,
  ): ValidatedA2ARequest {
    const candidateId = record(body) && (
      typeof body.id === 'string'
      || typeof body.id === 'number'
      || body.id === null
    ) ? body.id : null;
    if (
      !record(body)
      || !exactKeys(body, ['jsonrpc', 'id', 'method', 'params'])
      || body.jsonrpc !== '2.0'
      || !('id' in body)
      || (
        typeof body.id !== 'string'
        && typeof body.id !== 'number'
        && body.id !== null
      )
      || typeof body.method !== 'string'
    ) {
      throw new A2AProtocolValidationError(
        -32600,
        'Invalid Request',
        candidateId,
      );
    }
    if (!METHODS.has(body.method)) {
      throw new A2AProtocolValidationError(
        -32601,
        'Method not found',
        candidateId,
      );
    }
    if (version !== '1.0') {
      throw new A2AProtocolValidationError(
        -32600,
        'A2A-Version must be 1.0',
        candidateId,
      );
    }
    if (!record(body.params)) {
      throw new A2AProtocolValidationError(
        -32602,
        'Invalid params',
        candidateId,
      );
    }
    const method = body.method as A2AMethod;
    const selectedExtensions = (extensions ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (method === 'SendMessage' && !selectedExtensions.includes(PAID_EXTENSION)) {
      throw new A2AProtocolValidationError(
        -32602,
        `SendMessage requires A2A-Extensions: ${PAID_EXTENSION}`,
        candidateId,
      );
    }

    const valid = method === 'SendMessage'
      ? this.validateSendMessage(body.params)
      : method === 'GetTask'
        ? this.validateGetTask(body.params)
        : method === 'ListTasks'
          ? this.validateListTasks(body.params)
          : this.validateCancelTask(body.params);
    if (!valid) {
      throw new A2AProtocolValidationError(
        -32602,
        `Invalid params for ${method}`,
        candidateId,
      );
    }
    return { id: candidateId, method, params: body.params };
  }

  private validateSendMessage(params: Record<string, unknown>): boolean {
    if (
      !exactKeys(params, ['message', 'configuration', 'metadata'])
      || !record(params.message)
    ) return false;
    const message = params.message;
    if (
      !exactKeys(message, [
        'messageId',
        'contextId',
        'taskId',
        'role',
        'parts',
        'metadata',
        'extensions',
        'referenceTaskIds',
      ])
      || !identifier(message.messageId)
      || message.role !== 'ROLE_USER'
      || !Array.isArray(message.parts)
      || message.parts.length !== 1
      || !record(message.parts[0])
      || !exactKeys(message.parts[0], ['data', 'metadata', 'filename', 'mediaType'])
      || !('data' in message.parts[0])
      || !record(message.parts[0].data)
      || !record(message.metadata)
      || (
        message.extensions !== undefined
        && (
          !Array.isArray(message.extensions)
          || !message.extensions.every((extension) => typeof extension === 'string')
        )
      )
      || (message.contextId !== undefined && !identifier(message.contextId))
      || (message.taskId !== undefined && !identifier(message.taskId))
      || (
        message.referenceTaskIds !== undefined
        && (
          !Array.isArray(message.referenceTaskIds)
          || !message.referenceTaskIds.every(identifier)
        )
      )
    ) return false;

    try {
      if (message.taskId === undefined) {
        this.schemas.validate('a2aRequestMetadata', message.metadata);
      } else {
        const continuationSchemas = [
          'checkoutSubmittedMetadata',
          'paymentSubmittedMetadata',
          'refundSubmittedMetadata',
        ];
        if (!continuationSchemas.some((name) => {
          try {
            this.schemas.validate(name, message.metadata);
            return true;
          } catch (error) {
            if (error instanceof ContractValidationError) return false;
            throw error;
          }
        })) return false;
      }
    } catch (error) {
      if (error instanceof ContractValidationError) return false;
      throw error;
    }

    if (params.configuration !== undefined) {
      if (
        !record(params.configuration)
        || !exactKeys(params.configuration, [
          'acceptedOutputModes',
          'historyLength',
          'returnImmediately',
        ])
        || (
          params.configuration.acceptedOutputModes !== undefined
          && (
            !Array.isArray(params.configuration.acceptedOutputModes)
            || params.configuration.acceptedOutputModes.length !== 1
            || params.configuration.acceptedOutputModes[0] !== 'application/json'
          )
        )
        || !optionalNonNegativeInteger(params.configuration.historyLength)
        || (
          params.configuration.returnImmediately !== undefined
          && typeof params.configuration.returnImmediately !== 'boolean'
        )
      ) return false;
    }
    return params.metadata === undefined || record(params.metadata);
  }

  private validateGetTask(params: Record<string, unknown>): boolean {
    return exactKeys(params, ['id', 'historyLength'])
      && identifier(params.id)
      && optionalNonNegativeInteger(params.historyLength);
  }

  private validateCancelTask(params: Record<string, unknown>): boolean {
    return exactKeys(params, ['id']) && identifier(params.id);
  }

  private validateListTasks(params: Record<string, unknown>): boolean {
    return exactKeys(params, [
      'contextId',
      'status',
      'pageSize',
      'pageToken',
      'historyLength',
      'statusTimestampAfter',
      'includeArtifacts',
    ])
      && (params.contextId === undefined || identifier(params.contextId))
      && (params.status === undefined || TASK_STATES.has(String(params.status)))
      && (
        params.pageSize === undefined
        || (
          Number.isInteger(params.pageSize)
          && Number(params.pageSize) >= 1
          && Number(params.pageSize) <= 50
        )
      )
      && (params.pageToken === undefined || identifier(params.pageToken))
      && optionalNonNegativeInteger(params.historyLength)
      && (
        params.statusTimestampAfter === undefined
        || (
          typeof params.statusTimestampAfter === 'string'
          && !Number.isNaN(Date.parse(params.statusTimestampAfter))
        )
      )
      && (
        params.includeArtifacts === undefined
        || typeof params.includeArtifacts === 'boolean'
      );
  }
}
