import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  DATABASE_SERVICE,
  runSerializableTransaction,
  type DatabaseService,
  type DatabaseTransaction,
  type QueryResult,
} from '@orchestratorai/planes/database';
import {
  canonicalSha256Base64Url,
} from '../agent-contracts/canonical-json';
import {
  AgentContractSchemaRegistry,
  ContractValidationError,
} from '../agent-contracts/contract-bundle';
import {
  loadAgentProductCatalog,
  type AgentProduct,
} from '../agent-contracts/catalog';
import {
  AgentCommercePersistenceError,
  AgentCommerceRepository,
} from '../agent-commerce/agent-commerce.repository';
import { AgentQuoteService } from '../agent-commerce/agent-quote.service';
import type { VerifiedAgentPrincipal } from '../oauth/dpop-resource.service';
import type { ValidatedA2ARequest } from './a2a-protocol-validator';
import {
  deepFreezeJson,
  immutablePrincipal,
  type ImmutableVerifiedAgentPrincipal,
  type ValidatedInitialAgentCommand,
} from './a2a-admission.types';

const PROFILE_ID = 'urn:golfergeek:profile:apple-divinr-commerce:v0.2';
const EXTENSION_URI = 'urn:golfergeek:a2a:x402-lightning-regtest:v0.2';
const MAX_CONCURRENT_TASKS = 4;
const MAX_OUTSTANDING_PAID_TASKS = 2;
const MAX_RESPONSE_BYTES = 1024 * 1024;

interface TaskRow {
  id: string;
  protocol_task_id: string;
  context_id: string;
  request_id: string;
  user_id: string;
  installation_id: string;
  grant_id: string;
  skill_id: string;
  product_id: string;
  a2a_state: string;
  payment_state: string;
  result_state: string;
  base_intent_hash: string;
  current_intent_hash: string;
  updated_at: string;
  created_at: string;
  signed_quote: Record<string, unknown> | null;
  canonical_quote_hash: string | null;
  canonical_requirement: Record<string, unknown> | null;
  canonical_requirement_hash: string | null;
  quote_event_data: Record<string, unknown> | null;
}

export class A2AAdmissionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'A2AAdmissionError';
  }
}

function rows<T>(result: QueryResult, operation: string): T[] {
  if (result.error) {
    throw new A2AAdmissionError(
      'INTERNAL_ERROR',
      `${operation} failed: ${result.error.message}`,
      true,
    );
  }
  return (result.data as T[] | null) ?? [];
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringMember(value: Record<string, unknown>, key: string): string {
  const member = value[key];
  if (typeof member !== 'string') {
    throw new A2AAdmissionError('SCHEMA_INVALID', `${key} must be a string`);
  }
  return member;
}

@Injectable()
export class A2AAdmissionService {
  private readonly schemas = new AgentContractSchemaRegistry();
  private readonly catalog = loadAgentProductCatalog(this.schemas);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(AgentCommerceRepository)
    private readonly repository: AgentCommerceRepository,
    @Inject(AgentQuoteService) private readonly quotes: AgentQuoteService,
  ) {}

  async execute(
    request: ValidatedA2ARequest,
    verified: VerifiedAgentPrincipal,
  ): Promise<Record<string, unknown>> {
    const principal = immutablePrincipal(verified);
    try {
      let result: Record<string, unknown>;
      if (request.method === 'SendMessage') {
        result = await this.sendMessage(request, principal);
      } else if (request.method === 'GetTask') {
        result = await this.getTask(request.params, principal);
      } else if (request.method === 'ListTasks') {
        result = await this.listTasks(request.params, principal);
      } else {
        result = await this.cancelTask(request.params, principal);
      }
      if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_RESPONSE_BYTES) {
        throw new A2AAdmissionError(
          'RESPONSE_TOO_LARGE',
          'A2A response exceeds 1 MiB',
        );
      }
      return result;
    } catch (error) {
      if (error instanceof A2AAdmissionError) {
        await this.auditDenial(request, principal, error);
      }
      throw error;
    }
  }

  private async auditDenial(
    request: ValidatedA2ARequest,
    principal: ImmutableVerifiedAgentPrincipal,
    error: A2AAdmissionError,
  ): Promise<void> {
    await runSerializableTransaction(this.db, async (transaction) => {
      await this.repository.appendAuditEvent(transaction, {
        eventId: `audit-${randomUUID()}`,
        orderingKey: `installation:${principal.installationInternalId}`,
        actorPrincipal: `agent-installation:${principal.installationId}`,
        userId: principal.userId,
        installationId: principal.installationInternalId,
        action: `a2a.${request.method}.deny`,
        outcome: 'denied',
        reason: error.code,
        redactedDetail: {
          method: request.method,
          requestId: request.id,
          code: error.code,
        },
      });
    });
  }

  private async sendMessage(
    request: ValidatedA2ARequest,
    principal: ImmutableVerifiedAgentPrincipal,
  ): Promise<Record<string, unknown>> {
    const message = request.params.message as Record<string, unknown>;
    if (typeof message.taskId === 'string') {
      await this.loadBoundTask(message.taskId, principal);
      throw new A2AAdmissionError(
        'AP2_NOT_ENABLED',
        'The task is valid and bound to this grant, but AP2 continuations begin in Phase 8.',
      );
    }
    const command = this.validateInitialCommand(message, principal);
    const protocolTaskId = `task-${randomUUID()}`;
    const internalTaskId = randomUUID();
    const idempotencyScopeHash = canonicalSha256Base64Url({
      userId: principal.userId,
      installationId: principal.installationId,
      grantId: principal.grantId,
      skillId: command.skillId,
    });
    const expiresAt = new Date(
      Date.now() + command.product.taskLifetimeSeconds * 1000,
    ).toISOString();
    let taskId: string;
    try {
      taskId = await runSerializableTransaction(
        this.db,
        async (transaction) => {
        const existing = rows<{
          task_id: string | null;
          immutable_base_intent_hash: string;
        }>(
          await transaction.rawQuery(
            `SELECT task_id, immutable_base_intent_hash
               FROM agent_commerce.a2a_idempotency
              WHERE scope_hash = $1 AND idempotency_key = $2
              FOR UPDATE`,
            [idempotencyScopeHash, command.idempotencyKey],
          ),
          'check existing task idempotency',
        )[0];
        if (existing) {
          await this.assertAdmissionState(
            transaction,
            principal,
            command.product,
            false,
          );
          if (existing.immutable_base_intent_hash !== command.baseIntentHash) {
            throw new A2AAdmissionError(
              'IDEMPOTENCY_CONFLICT',
              'Idempotency key is already bound to a different base intent',
            );
          }
          if (!existing.task_id) {
            throw new A2AAdmissionError(
              'IDEMPOTENCY_IN_PROGRESS',
              'Idempotent task admission is still in progress',
              true,
            );
          }
          return existing.task_id;
        }
        await this.assertAdmissionState(
          transaction,
          principal,
          command.product,
          true,
        );
        let quote;
        try {
          quote = await this.quotes.create({
            taskId: protocolTaskId,
            businessInputHash: command.businessInputHash,
            baseIntent: command.baseIntent as Record<string, unknown>,
            product: command.product,
          });
        } catch {
          throw new A2AAdmissionError(
            'PAYMENT_AUTHORITY_UNAVAILABLE',
            'The demo payment authority is temporarily unavailable.',
            true,
          );
        }
        const admission = await this.repository.admitTask(transaction, {
          internalTaskId,
          protocolTaskId,
          contextId: command.contextId,
          requestId: command.requestId,
          userId: principal.userId,
          installationId: principal.installationInternalId,
          grantId: principal.grantInternalId,
          skillId: command.skillId,
          productId: command.product.productId,
          productVersion: 2,
          idempotencyScopeHash,
          idempotencyKey: command.idempotencyKey,
          businessInputHash: command.businessInputHash,
          baseIntentHash: command.baseIntentHash,
          currentIntentHash: command.currentIntentHash,
          expiresAt,
        });
        if (!admission.created) return admission.taskId;
        await this.repository.createQuoteAndRequirement(transaction, {
          internalQuoteId: quote.internalQuoteId,
          quoteId: quote.quoteId,
          taskId: internalTaskId,
          userId: principal.userId,
          installationId: principal.installationInternalId,
          productId: command.product.productId,
          productVersion: 2,
          merchantId: 'divinr',
          amount: command.product.atomicAmount,
          asset: 'BTC-REGTEST',
          unit: 'msat',
          network: 'urn:golfergeek:x402:lightning-regtest:v0.2',
          paymentMethod: 'exact',
          checkoutJwtHash: quote.checkoutJwtHash,
          checkoutNonceHash: quote.checkoutNonceHash,
          paymentNonceHash: quote.paymentNonceHash,
          signedQuote: quote.signedQuote,
          canonicalQuoteHash: quote.canonicalQuoteHash,
          requirementId: quote.requirementId,
          canonicalRequirement: quote.paymentRequirement,
          canonicalRequirementHash: quote.canonicalRequirementHash,
          currentIntentHash: quote.currentIntentHash,
          compatibilityProfile: PROFILE_ID,
          extensionUri: EXTENSION_URI,
          invoiceReferenceHash: quote.invoiceReferenceHash,
          expiresAt: quote.expiresAt,
        });
        const safeEventData = {
          taskId: protocolTaskId,
          skillId: command.skillId,
          productId: command.product.productId,
          paymentState: 'payment_required',
          quotedIntent: quote.quotedIntent,
          validatedInput: command.businessInput,
        };
        await this.repository.appendTaskEvent(transaction, {
          userId: principal.userId,
          taskId: internalTaskId,
          sequence: 1,
          eventType: 'task.payment_required',
          a2aState: 'input_required',
          canonicalEventHash: canonicalSha256Base64Url(safeEventData),
          safeEventData,
        });
        await this.repository.enqueueOutbox(transaction, {
          outboxId: `outbox-${randomUUID()}`,
          userId: principal.userId,
          aggregateType: 'a2a_task',
          aggregateId: internalTaskId,
          aggregateVersion: 1,
          eventType: 'task.payment_required',
          payloadHash: canonicalSha256Base64Url(safeEventData),
          payloadRef: `agent-commerce://tasks/${protocolTaskId}/events/1`,
        });
        await this.repository.appendAuditEvent(transaction, {
          eventId: `audit-${randomUUID()}`,
          orderingKey: `installation:${principal.installationInternalId}`,
          actorPrincipal: `agent-installation:${principal.installationId}`,
          userId: principal.userId,
          installationId: principal.installationInternalId,
          taskId: internalTaskId,
          action: 'a2a.task.admit',
          outcome: 'allowed',
          redactedDetail: safeEventData,
        });
        return internalTaskId;
        },
      );
    } catch (error) {
      if (error instanceof AgentCommercePersistenceError) {
        throw new A2AAdmissionError(
          error.code ?? 'ADMISSION_FAILED',
          error.message,
          error.code === 'IDEMPOTENCY_IN_PROGRESS',
        );
      }
      throw error;
    }
    return this.serializeTask(await this.loadTaskByInternalId(taskId, principal));
  }

  private validateInitialCommand(
    message: Record<string, unknown>,
    principal: ImmutableVerifiedAgentPrincipal,
  ): ValidatedInitialAgentCommand {
    const metadata = message.metadata as Record<string, unknown>;
    const parts = message.parts as Array<Record<string, unknown>>;
    const businessInput = parts[0]?.data;
    if (!record(metadata) || !record(businessInput)) {
      throw new A2AAdmissionError('SCHEMA_INVALID', 'A2A metadata and data are required');
    }
    const skillId = stringMember(metadata, 'golfergeek.skillId');
    if (skillId !== 'general_updates' && skillId !== 'personal_updates') {
      throw new A2AAdmissionError(
        'SKILL_NOT_ENABLED',
        'Only general_updates and personal_updates are enabled in Phase 6.',
      );
    }
    const product = [...this.catalog.values()].find(
      (candidate) => candidate.skillId === skillId,
    );
    if (!product) {
      throw new A2AAdmissionError('PRODUCT_MISMATCH', 'No product matches the skill');
    }
    const inputSchema = stringMember(metadata, 'golfergeek.inputSchema');
    if (inputSchema !== product.inputSchema) {
      throw new A2AAdmissionError('PRODUCT_MISMATCH', 'Input schema does not match product');
    }
    const intent = metadata['golfergeek.intent'];
    if (!record(intent)) {
      throw new A2AAdmissionError('SCHEMA_INVALID', 'Canonical intent is required');
    }
    try {
      this.schemas.validate(product.inputSchema.split('/').at(-1)!, businessInput);
      this.schemas.validate('baseCanonicalIntent', intent);
    } catch (error) {
      if (error instanceof ContractValidationError) {
        throw new A2AAdmissionError('SCHEMA_INVALID', error.message);
      }
      throw error;
    }
    const requestId = stringMember(metadata, 'golfergeek.requestId');
    const idempotencyKey = stringMember(metadata, 'golfergeek.idempotencyKey');
    const businessInputHash = canonicalSha256Base64Url(businessInput);
    const baseIntentHash = canonicalSha256Base64Url(intent);
    if (
      businessInput.requestId !== requestId
      || businessInput.idempotencyKey !== idempotencyKey
      || intent.installationId !== principal.installationId
      || intent.skillId !== skillId
      || intent.productId !== product.productId
      || intent.businessInputHash !== businessInputHash
      || metadata['golfergeek.baseIntentHash'] !== baseIntentHash
      || metadata['golfergeek.currentIntentHash'] !== baseIntentHash
    ) {
      throw new A2AAdmissionError(
        'INTENT_MISMATCH',
        'Request metadata, input, credential, and canonical intent do not match',
      );
    }
    const missingScope = product.requiredScopes.find(
      (scope) => !principal.scopes.includes(scope),
    );
    if (missingScope) {
      throw new A2AAdmissionError(
        'SCOPE_DENIED',
        `The connected-agent grant is missing ${missingScope}`,
      );
    }
    return Object.freeze({
      requestId,
      idempotencyKey,
      contextId: typeof message.contextId === 'string'
        ? message.contextId
        : `context-${randomUUID()}`,
      messageId: String(message.messageId),
      skillId,
      product,
      businessInput: deepFreezeJson(structuredClone(businessInput)),
      businessInputHash,
      baseIntent: deepFreezeJson(structuredClone(intent)),
      baseIntentHash,
      currentIntentHash: baseIntentHash,
    });
  }

  private async assertAdmissionState(
    transaction: DatabaseTransaction,
    principal: ImmutableVerifiedAgentPrincipal,
    product: Readonly<AgentProduct>,
    enforceCapacity: boolean,
  ): Promise<void> {
    const binding = rows<{
      input_schema_uri: string;
      output_schema_uri: string;
      pricing_policy: Record<string, unknown>;
      payment_class: string;
      ap2_required: boolean;
    }>(
      await transaction.rawQuery(
        `SELECT product.input_schema_uri, product.output_schema_uri,
                product.pricing_policy, product.payment_class,
                product.ap2_required
           FROM agent_commerce.agent_installations installation
           JOIN agent_commerce.agent_grants grant
             ON grant.id = $2
            AND grant.installation_id = installation.id
            AND grant.user_id = installation.user_id
           JOIN agent_commerce.a2a_products product
             ON product.product_id = $5
            AND product.product_version = 2
          WHERE installation.id = $1
            AND installation.user_id = $3
            AND installation.installation_id = $4
            AND installation.status = 'active'
            AND installation.approved_scopes @> $7::text[]
            AND grant.status = 'active'
            AND grant.valid_from <= now()
            AND grant.valid_until > now()
            AND grant.granted_scopes @> $7::text[]
            AND product.skill_id = $6
            AND product.status = 'active'
            AND product.effective_from <= now()
            AND (product.effective_until IS NULL OR product.effective_until > now())
          FOR UPDATE OF installation, grant`,
        [
          principal.installationInternalId,
          principal.grantInternalId,
          principal.userId,
          principal.installationId,
          product.productId,
          product.skillId,
          [...product.requiredScopes],
        ],
      ),
      'verify admission binding',
    )[0];
    if (!binding) {
      throw new A2AAdmissionError(
        'GRANT_DENIED',
        'Installation, grant, ownership, or product entitlement is no longer active',
      );
    }
    const pricing = binding.pricing_policy;
    if (
      binding.input_schema_uri !== product.inputSchema
      || binding.output_schema_uri !== product.outputSchema
      || binding.payment_class !== 'paid'
      || binding.ap2_required !== true
      || pricing.currency !== 'USD'
      || pricing.priceMinorUnits !== product.priceMinorUnits
      || pricing.atomicAmount !== product.atomicAmount
      || pricing.asset !== 'BTC-REGTEST'
      || pricing.unit !== 'msat'
      || pricing.displayPrice !== product.displayPrice
    ) {
      throw new A2AAdmissionError(
        'PRODUCT_MISMATCH',
        'The active product record does not match the frozen catalog',
      );
    }
    if (!enforceCapacity) return;
    const counts = rows<{ concurrent_count: number; outstanding_count: number }>(
      await transaction.rawQuery(
        `SELECT
           count(*) FILTER (
             WHERE a2a_state IN ('submitted','working','input_required','auth_required')
               AND expires_at > now()
           )::integer AS concurrent_count,
           count(*) FILTER (
             WHERE payment_state IN ('quote_required','payment_required','submitted','unknown')
               AND expires_at > now()
           )::integer AS outstanding_count
         FROM agent_commerce.a2a_tasks
        WHERE installation_id = $1`,
        [principal.installationInternalId],
      ),
      'count active agent tasks',
    )[0] ?? { concurrent_count: 0, outstanding_count: 0 };
    if (counts.concurrent_count >= MAX_CONCURRENT_TASKS) {
      throw new A2AAdmissionError(
        'CONCURRENCY_LIMIT_EXCEEDED',
        'This installation already has four concurrent tasks',
        true,
      );
    }
    if (counts.outstanding_count >= MAX_OUTSTANDING_PAID_TASKS) {
      throw new A2AAdmissionError(
        'OUTSTANDING_PAYMENT_LIMIT_EXCEEDED',
        'This installation already has two outstanding paid tasks',
        true,
      );
    }
  }

  private async getTask(
    params: Record<string, unknown>,
    principal: ImmutableVerifiedAgentPrincipal,
  ): Promise<Record<string, unknown>> {
    return this.serializeTask(await this.loadBoundTask(String(params.id), principal));
  }

  private async listTasks(
    params: Record<string, unknown>,
    principal: ImmutableVerifiedAgentPrincipal,
  ): Promise<Record<string, unknown>> {
    const pageSize = Number(params.pageSize ?? 20);
    let cursor: { createdAt: string; id: string } | undefined;
    if (typeof params.pageToken === 'string') {
      try {
        const parsed = JSON.parse(
          Buffer.from(params.pageToken, 'base64url').toString('utf8'),
        ) as Record<string, unknown>;
        if (
          typeof parsed.createdAt !== 'string'
          || typeof parsed.id !== 'string'
          || Number.isNaN(Date.parse(parsed.createdAt))
        ) throw new Error('invalid cursor');
        cursor = { createdAt: parsed.createdAt, id: parsed.id };
      } catch {
        throw new A2AAdmissionError('SCHEMA_INVALID', 'Invalid task page token');
      }
    }
    const requestedState = typeof params.status === 'string'
      ? params.status.replace('TASK_STATE_', '').toLowerCase()
      : null;
    const result = await this.db.rawQuery(
      `${this.taskSelect()}
        WHERE task.user_id = $1
          AND task.installation_id = $2
          AND task.grant_id = $3
          AND ($4::text IS NULL OR task.context_id = $4)
          AND ($5::timestamptz IS NULL OR task.updated_at > $5)
          AND ($6::text IS NULL OR task.a2a_state = $6)
          AND (
            $7::timestamptz IS NULL
            OR (task.created_at, task.id) < ($7::timestamptz, $8::uuid)
          )
        ORDER BY task.created_at DESC
        LIMIT $9`,
      [
        principal.userId,
        principal.installationInternalId,
        principal.grantInternalId,
        typeof params.contextId === 'string' ? params.contextId : null,
        typeof params.statusTimestampAfter === 'string'
          ? params.statusTimestampAfter
          : null,
        requestedState,
        cursor?.createdAt ?? null,
        cursor?.id ?? null,
        pageSize + 1,
      ],
    );
    const taskRows = rows<TaskRow>(result, 'list bound tasks').filter((task) =>
      this.hasTaskScope(task, principal));
    const selected = taskRows.slice(0, pageSize);
    const last = selected.at(-1);
    return {
      tasks: selected.map((task) => this.serializeTask(task)),
      ...(taskRows.length > pageSize && last
        ? {
            nextPageToken: Buffer.from(JSON.stringify({
              createdAt: last.created_at,
              id: last.id,
            })).toString('base64url'),
          }
        : {}),
    };
  }

  private async cancelTask(
    params: Record<string, unknown>,
    principal: ImmutableVerifiedAgentPrincipal,
  ): Promise<Record<string, unknown>> {
    const task = await this.loadBoundTask(String(params.id), principal);
    if (task.payment_state === 'settled' || task.result_state === 'released') {
      throw new A2AAdmissionError(
        'TASK_NOT_CANCELABLE',
        'A settled or released task cannot be canceled',
      );
    }
    await runSerializableTransaction(this.db, async (transaction) => {
      const updated = rows<{ id: string }>(
        await transaction.rawQuery(
          `UPDATE agent_commerce.a2a_tasks
              SET a2a_state = 'canceled', terminal_reason = 'agent_requested',
                  terminal_at = now(), updated_at = now(),
                  lock_version = lock_version + 1
            WHERE id = $1 AND user_id = $2 AND installation_id = $3
              AND grant_id = $4
              AND payment_state <> 'settled'
              AND result_state <> 'released'
              AND a2a_state NOT IN ('completed','canceled','failed','rejected')
            RETURNING id`,
          [
            task.id,
            principal.userId,
            principal.installationInternalId,
            principal.grantInternalId,
          ],
        ),
        'cancel bound task',
      )[0];
      if (!updated) {
        throw new A2AAdmissionError('TASK_NOT_CANCELABLE', 'Task cannot be canceled');
      }
      rows(
        await transaction.rawQuery(
          `UPDATE agent_commerce.checkout_quotes
              SET status = 'canceled', lock_version = lock_version + 1
            WHERE task_id = $1 AND status = 'active'
            RETURNING id`,
          [task.id],
        ),
        'cancel active task quote',
      );
      rows(
        await transaction.rawQuery(
          `UPDATE agent_commerce.payment_requirements
              SET status = 'canceled', lock_version = lock_version + 1
            WHERE task_id = $1 AND status = 'active'
            RETURNING id`,
          [task.id],
        ),
        'cancel active task payment requirement',
      );
      const safe = { taskId: task.protocol_task_id, reason: 'agent_requested' };
      await this.repository.appendTaskEvent(transaction, {
        userId: principal.userId,
        taskId: task.id,
        eventType: 'task.canceled',
        a2aState: 'canceled',
        canonicalEventHash: canonicalSha256Base64Url(safe),
        safeEventData: safe,
      });
      await this.repository.appendAuditEvent(transaction, {
        eventId: `audit-${randomUUID()}`,
        orderingKey: `installation:${principal.installationInternalId}`,
        actorPrincipal: `agent-installation:${principal.installationId}`,
        userId: principal.userId,
        installationId: principal.installationInternalId,
        taskId: task.id,
        action: 'a2a.task.cancel',
        outcome: 'allowed',
        redactedDetail: safe,
      });
    });
    return this.getTask({ id: task.protocol_task_id }, principal);
  }

  private async loadBoundTask(
    protocolTaskId: string,
    principal: ImmutableVerifiedAgentPrincipal,
  ): Promise<TaskRow> {
    const result = await this.db.rawQuery(
      `${this.taskSelect()}
        WHERE task.protocol_task_id = $1
          AND task.user_id = $2
          AND task.installation_id = $3
          AND task.grant_id = $4
        LIMIT 1`,
      [
        protocolTaskId,
        principal.userId,
        principal.installationInternalId,
        principal.grantInternalId,
      ],
    );
    const task = rows<TaskRow>(result, 'load bound task')[0];
    if (!task) {
      throw new A2AAdmissionError(
        'TASK_NOT_FOUND',
        'No task is accessible to this connected-agent grant',
      );
    }
    if (!this.hasTaskScope(task, principal)) {
      throw new A2AAdmissionError('SCOPE_DENIED', 'Task scope is no longer granted');
    }
    return task;
  }

  private hasTaskScope(
    task: TaskRow,
    principal: ImmutableVerifiedAgentPrincipal,
  ): boolean {
    const product = [...this.catalog.values()].find(
      (candidate) => candidate.skillId === task.skill_id,
    );
    return Boolean(product?.requiredScopes.every(
      (scope) => principal.scopes.includes(scope),
    ));
  }

  private async loadTaskByInternalId(
    taskId: string,
    principal: ImmutableVerifiedAgentPrincipal,
  ): Promise<TaskRow> {
    const result = await this.db.rawQuery(
      `${this.taskSelect()}
        WHERE task.id = $1
          AND task.user_id = $2
          AND task.installation_id = $3
          AND task.grant_id = $4
        LIMIT 1`,
      [
        taskId,
        principal.userId,
        principal.installationInternalId,
        principal.grantInternalId,
      ],
    );
    const task = rows<TaskRow>(result, 'load admitted task')[0];
    if (!task) {
      throw new A2AAdmissionError('TASK_NOT_FOUND', 'Admitted task was not found');
    }
    return task;
  }

  private taskSelect(): string {
    return `SELECT task.*, quote.signed_quote, quote.canonical_quote_hash,
                   requirement.canonical_requirement,
                   requirement.canonical_requirement_hash,
                   quote_event.safe_event_data AS quote_event_data
              FROM agent_commerce.a2a_tasks task
              LEFT JOIN agent_commerce.checkout_quotes quote
                ON quote.id = task.quote_id
              LEFT JOIN agent_commerce.payment_requirements requirement
                ON requirement.task_id = task.id
              LEFT JOIN LATERAL (
                SELECT event.safe_event_data
                  FROM agent_commerce.a2a_task_events event
                 WHERE event.task_id = task.id
                   AND event.event_type = 'task.payment_required'
                 ORDER BY event.sequence DESC
                 LIMIT 1
              ) quote_event ON true`;
  }

  private serializeTask(task: TaskRow): Record<string, unknown> {
    const state = task.a2a_state === 'input_required'
      ? 'TASK_STATE_INPUT_REQUIRED'
      : task.a2a_state === 'canceled'
        ? 'TASK_STATE_CANCELED'
        : `TASK_STATE_${task.a2a_state.toUpperCase()}`;
    const metadata =
      task.payment_state === 'payment_required' && task.a2a_state !== 'canceled'
      ? {
          'x402.payment.status': 'payment-required',
          'x402.payment.required': task.canonical_requirement,
          'golfergeek.quote': task.signed_quote,
          'golfergeek.intent': task.quote_event_data?.quotedIntent ?? null,
          'golfergeek.baseIntentHash': task.base_intent_hash,
          'golfergeek.currentIntentHash': task.current_intent_hash,
        }
      : {
          'golfergeek.paymentState': task.payment_state,
          'golfergeek.resultState': task.result_state,
        };
    if (
      task.payment_state === 'payment_required'
      && task.a2a_state !== 'canceled'
    ) {
      try {
        this.schemas.validate('paymentRequiredMetadata', metadata);
      } catch (error) {
        throw new A2AAdmissionError(
          'INTERNAL_ERROR',
          error instanceof Error
            ? `Stored payment-required task is invalid: ${error.message}`
            : 'Stored payment-required task is invalid',
        );
      }
    }
    const result = {
      id: task.protocol_task_id,
      contextId: task.context_id,
      status: {
        state,
        timestamp: task.updated_at,
        message: {
          messageId: `status-${task.protocol_task_id}`,
          role: 'ROLE_AGENT',
          parts: [{
            data: {
              schemaVersion: 2,
              taskId: task.protocol_task_id,
              skillId: task.skill_id,
              productId: task.product_id,
            },
            mediaType: 'application/json',
          }],
          metadata,
        },
      },
      artifacts: [],
      metadata: {
        'golfergeek.requestId': task.request_id,
        'golfergeek.paymentState': task.payment_state,
        'golfergeek.resultState': task.result_state,
      },
    };
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_RESPONSE_BYTES) {
      throw new A2AAdmissionError('RESPONSE_TOO_LARGE', 'A2A response exceeds 1 MiB');
    }
    return result;
  }
}
