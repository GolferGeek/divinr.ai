import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { DATABASE_SERVICE } from '@orchestratorai/planes/database';
import { A2AAdmissionService } from '../../src/a2a/a2a-admission.service';
import { A2AInvokeController } from '../../src/a2a/a2a-invoke.controller';
import { A2APhaseGateGuard } from '../../src/a2a/a2a-phase-gate.guard';
import {
  canonicalSha256Base64Url,
} from '../../src/agent-contracts/canonical-json';
import {
  AgentCommercePersistenceError,
  AgentCommerceRepository,
} from '../../src/agent-commerce/agent-commerce.repository';
import {
  AGENT_MERCHANT_INVOICE_ISSUER,
  AgentQuoteService,
} from '../../src/agent-commerce/agent-quote.service';
import { AGENT_KEY_PROVIDER } from '../../src/agent-commerce/agent-key-provider';
import { DPoPResourceService } from '../../src/oauth/dpop-resource.service';

const principal = {
  userId: '10000000-0000-0000-0000-000000000001',
  installationInternalId: '20000000-0000-0000-0000-000000000001',
  installationId: 'apple-installation-curl-001',
  grantInternalId: '30000000-0000-0000-0000-000000000001',
  grantId: 'grant-curl-001',
  scopes: ['updates:read', 'commerce:purchase', 'receipts:read'],
  dpopJkt: 'A'.repeat(43),
  accessTokenJti: 'token-curl-001',
};

interface HarnessTask {
  input: Record<string, unknown>;
  quote?: Record<string, unknown>;
  quoteEvent?: Record<string, unknown>;
  canceled?: boolean;
}

const tasks = new Map<string, HarnessTask>();
const idempotency = new Map<string, {
  taskId: string;
  baseIntentHash: string;
}>();
const idempotencyByScopeKey = new Map<string, {
  taskId: string;
  baseIntentHash: string;
}>();

function fixture(
  skillId: 'general_updates' | 'personal_updates',
  suffix: string,
  pageSize = 10,
): Record<string, unknown> {
  const productId = skillId === 'general_updates'
    ? 'divinr.general-updates.demo.v2'
    : 'divinr.personal-updates.demo.v2';
  const input = {
    schemaVersion: 2,
    requestId: `request-${suffix}`,
    idempotencyKey: `idempotency-${suffix}`,
    pageSize,
  };
  const businessInputHash = canonicalSha256Base64Url(input);
  const intent = {
    schemaVersion: 2,
    intentPhase: 'base',
    installationId: principal.installationId,
    originClass: 'owner_private',
    profileId: 'urn:golfergeek:profile:apple-divinr-commerce:v0.2',
    destinationId: 'divinr',
    a2aUrl: 'https://divinr.ai/a2a',
    agentCardVersion: '1.0',
    agentCardHash: 'B'.repeat(43),
    skillId,
    productId,
    businessInputHash,
    openAuthorityId: 'authority-curl-001',
    openAuthorityVersion: 1,
    constraintHashes: ['C'.repeat(43)],
  };
  const intentHash = canonicalSha256Base64Url(intent);
  return {
    jsonrpc: '2.0',
    id: `rpc-${suffix}`,
    method: 'SendMessage',
    params: {
      message: {
        messageId: `message-${suffix}`,
        contextId: 'context-curl-001',
        role: 'ROLE_USER',
        parts: [{ data: input, mediaType: 'application/json' }],
        metadata: {
          'golfergeek.requestId': input.requestId,
          'golfergeek.idempotencyKey': input.idempotencyKey,
          'golfergeek.skillId': skillId,
          'golfergeek.inputSchema':
            'urn:golfergeek:schema:apple-divinr-integration:v0.2#/$defs/updatesRequest',
          'golfergeek.intent': intent,
          'golfergeek.baseIntentHash': intentHash,
          'golfergeek.currentIntentHash': intentHash,
        },
      },
    },
  };
}

const transaction = {
  rawQuery: async (sql: string, params: unknown[] = []) => {
    if (sql.includes('FROM agent_commerce.a2a_idempotency')) {
      const existing = idempotencyByScopeKey.get(`${params[0]}:${params[1]}`);
      return {
        data: existing ? [{
          task_id: existing.taskId,
          immutable_base_intent_hash: existing.baseIntentHash,
        }] : [],
        error: null,
      };
    }
    if (sql.includes('FROM agent_commerce.agent_installations')) {
      const productId = String(params[4]);
      const personal = productId === 'divinr.personal-updates.demo.v2';
      return {
        data: [{
          input_schema_uri:
            'urn:golfergeek:schema:apple-divinr-integration:v0.2#/$defs/updatesRequest',
          output_schema_uri:
            'urn:golfergeek:schema:apple-divinr-integration:v0.2#/$defs/updatesResult',
          pricing_policy: {
            currency: 'USD',
            priceMinorUnits: personal ? 2 : 1,
            atomicAmount: personal ? '20000' : '10000',
            asset: 'BTC-REGTEST',
            unit: 'msat',
            displayPrice: personal
              ? '$0.02 demo price'
              : '$0.01 demo price',
          },
          payment_class: 'paid',
          ap2_required: true,
        }],
        error: null,
      };
    }
    if (sql.includes('count(*) FILTER')) {
      const active = [...tasks.values()].filter((task) => !task.canceled).length;
      return {
        data: [{ concurrent_count: active, outstanding_count: active }],
        error: null,
      };
    }
    if (sql.includes('UPDATE agent_commerce.a2a_tasks')) {
      const task = tasks.get(String(params[0]));
      if (!task || task.canceled) return { data: [], error: null };
      task.canceled = true;
      return { data: [{ id: params[0] }], error: null };
    }
    if (
      sql.includes('UPDATE agent_commerce.checkout_quotes')
      || sql.includes('UPDATE agent_commerce.payment_requirements')
    ) {
      return { data: [{ id: params[0] }], error: null };
    }
    throw new Error(`Unexpected harness transaction query: ${sql}`);
  },
};

function taskRow(internalId: string, task: HarnessTask) {
  const input = task.input;
  const quote = task.quote ?? {};
  const event = task.quoteEvent ?? {};
  return {
    id: internalId,
    protocol_task_id: event.taskId,
    context_id: input.contextId,
    request_id: input.requestId,
    user_id: principal.userId,
    installation_id: principal.installationInternalId,
    grant_id: principal.grantInternalId,
    skill_id: input.skillId,
    product_id: input.productId,
    a2a_state: task.canceled ? 'canceled' : 'input_required',
    payment_state: 'payment_required',
    result_state: 'none',
    base_intent_hash: input.baseIntentHash,
    current_intent_hash: quote.currentIntentHash,
    updated_at: '2026-07-24T12:00:00.000Z',
    created_at: '2026-07-24T12:00:00.000Z',
    signed_quote: quote.signedQuote,
    canonical_quote_hash: quote.canonicalQuoteHash,
    canonical_requirement: quote.canonicalRequirement,
    canonical_requirement_hash: quote.canonicalRequirementHash,
    quote_event_data: event,
  };
}

const database = {
  withTransaction: async (
    work: (value: typeof transaction) => Promise<unknown>,
  ) => work(transaction),
  rawQuery: async (sql: string, params: unknown[] = []) => {
    if (!sql.includes('FROM agent_commerce.a2a_tasks')) {
      throw new Error(`Unexpected harness database query: ${sql}`);
    }
    const requested = String(params[0]);
    const found = sql.includes('ORDER BY task.created_at DESC')
      ? [...tasks.entries()]
      : [...tasks.entries()].filter(([internalId, task]) =>
          internalId === requested || task.quoteEvent?.taskId === requested);
    const allowed = params.includes(principal.userId);
    return {
      data: allowed
        ? found.map(([internalId, task]) => taskRow(internalId, task))
        : [],
      error: null,
    };
  },
};

const repository = {
  admitTask: async (_tx: unknown, input: Record<string, unknown>) => {
    const key = `${input.installationId}:${input.grantId}:${input.skillId}:${input.idempotencyKey}`;
    const existing = idempotency.get(key);
    if (existing) {
      if (existing.baseIntentHash !== input.baseIntentHash) {
        throw new AgentCommercePersistenceError(
          'Idempotency key is already bound to another intent',
          'IDEMPOTENCY_CONFLICT',
        );
      }
      return { created: false, taskId: existing.taskId };
    }
    const taskId = String(input.internalTaskId);
    tasks.set(taskId, { input });
    idempotency.set(key, {
      taskId,
      baseIntentHash: String(input.baseIntentHash),
    });
    idempotencyByScopeKey.set(
      `${input.idempotencyScopeHash}:${input.idempotencyKey}`,
      {
        taskId,
        baseIntentHash: String(input.baseIntentHash),
      },
    );
    return { created: true, taskId };
  },
  createQuoteAndRequirement: async (
    _tx: unknown,
    input: Record<string, unknown>,
  ) => { tasks.get(String(input.taskId))!.quote = input; },
  appendTaskEvent: async (
    _tx: unknown,
    input: Record<string, unknown>,
  ) => {
    const task = tasks.get(String(input.taskId));
    if (task && input.eventType === 'task.payment_required') {
      task.quoteEvent = input.safeEventData as Record<string, unknown>;
    }
  },
  enqueueOutbox: async () => undefined,
  appendAuditEvent: async () => undefined,
};

const keyPairs = {
  checkout: generateKeyPairSync('ec', { namedCurve: 'prime256v1' }),
  quote: generateKeyPairSync('ec', { namedCurve: 'prime256v1' }),
};

@Module({
  controllers: [A2AInvokeController],
  providers: [
    A2AAdmissionService,
    AgentQuoteService,
    A2APhaseGateGuard,
    {
      provide: DPoPResourceService,
      useValue: {
        authenticate: async (
          authorization: unknown,
          _proof: unknown,
          _method: unknown,
          _uri: unknown,
        ) => ({
          ...principal,
          ...(authorization === 'DPoP cross-user'
            ? { userId: '10000000-0000-0000-0000-000000000099' }
            : {}),
          ...(authorization === 'DPoP missing-scope'
            ? { scopes: ['updates:read'] }
            : {}),
        }),
      },
    },
    { provide: DATABASE_SERVICE, useValue: database },
    { provide: AgentCommerceRepository, useValue: repository },
    {
      provide: AGENT_KEY_PROVIDER,
      useValue: {
        getSigningKey: async (role: 'checkout' | 'quote') => ({
          keyId: `divinr-${role}-v1`,
          role,
          privateKey: keyPairs[role].privateKey,
          publicJwk: {},
          fallback: true,
        }),
      },
    },
    {
      provide: AGENT_MERCHANT_INVOICE_ISSUER,
      useValue: {
        createInvoice: async () => ({
          invoice: `lnbcrt1phase6curl${randomUUID().replaceAll('-', '')}`,
          paymentHash: randomUUID().replaceAll('-', '').repeat(2),
        }),
      },
    },
  ],
})
class A2APaidAdmissionHarnessModule {}

async function main(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(
    A2APaidAdmissionHarnessModule,
    { logger: ['error'] },
  );
  const express = app.getHttpAdapter().getInstance();
  express.get('/_test/status', (_request: unknown, response: {
    json(value: unknown): void;
  }) => response.json({ ok: true }));
  express.get('/_test/request/:skill/:suffix', (
    request: {
      params: { skill: string; suffix: string };
      query: { pageSize?: string };
    },
    response: { json(value: unknown): void },
  ) => response.json(fixture(
    request.params.skill as 'general_updates' | 'personal_updates',
    request.params.suffix,
    Number(request.query.pageSize ?? 10),
  )));
  const port = Number(process.env.A2A_ADMISSION_HARNESS_PORT ?? 7199);
  await app.listen(port, '127.0.0.1');
  console.log(`A2A paid-admission harness listening on ${port}`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
