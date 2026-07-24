import assert from 'node:assert/strict';
import {
  AgentCommercePersistenceError,
  AgentCommerceRepository,
} from '../../src/agent-commerce/agent-commerce.repository';

function admissionInput() {
  return {
    internalTaskId: '10000000-0000-0000-0000-000000000001',
    protocolTaskId: 'task-1',
    contextId: 'context-1',
    requestId: 'request-1',
    userId: '20000000-0000-0000-0000-000000000001',
    installationId: '30000000-0000-0000-0000-000000000001',
    grantId: '40000000-0000-0000-0000-000000000001',
    skillId: 'analysis_request',
    productId: 'divinr.analysis.demo.v2' as const,
    productVersion: 2,
    idempotencyScopeHash: 'scope-hash',
    idempotencyKey: 'idempotency-key',
    businessInputHash: 'business-hash',
    baseIntentHash: 'intent-hash',
    currentIntentHash: 'intent-hash',
    expiresAt: '2026-07-24T13:00:00.000Z',
  };
}

async function main(): Promise<void> {
  const repository = new AgentCommerceRepository();
  const calls: string[] = [];
  const createTx = {
    rawQuery: async (sql: string) => {
      calls.push(sql);
      return { data: [{ id: 'row' }], error: null };
    },
  };
  const created = await repository.admitTask(createTx as never, admissionInput());
  assert.deepEqual(created, {
    created: true,
    taskId: '10000000-0000-0000-0000-000000000001',
  });
  assert.match(calls[0], /INSERT INTO agent_commerce\.a2a_idempotency/);
  assert.match(calls[1], /INSERT INTO agent_commerce\.a2a_tasks/);
  assert.match(calls[2], /UPDATE agent_commerce\.a2a_idempotency/);

  let idempotencyCall = 0;
  const conflictTx = {
    rawQuery: async () => {
      idempotencyCall += 1;
      if (idempotencyCall === 1) return { data: [], error: null };
      return {
        data: [{
          task_id: '10000000-0000-0000-0000-000000000099',
          immutable_base_intent_hash: 'different',
        }],
        error: null,
      };
    },
  };
  await assert.rejects(
    () => repository.admitTask(conflictTx as never, admissionInput()),
    (error: unknown) =>
      error instanceof AgentCommercePersistenceError
      && error.code === 'IDEMPOTENCY_CONFLICT',
  );

  const exhaustedTx = {
    rawQuery: async (sql: string) => {
      if (sql.includes('UPDATE agent_commerce.ap2_counters')) {
        return { data: [], error: null };
      }
      return { data: [{ id: 'row' }], error: null };
    },
  };
  await assert.rejects(
    () => repository.reserveCounter(exhaustedTx as never, {
      reservationId: 'reservation-1',
      userId: '20000000-0000-0000-0000-000000000001',
      counterId: '50000000-0000-0000-0000-000000000001',
      taskId: '10000000-0000-0000-0000-000000000001',
      quoteId: '60000000-0000-0000-0000-000000000001',
      mandateId: '70000000-0000-0000-0000-000000000001',
      amount: '50001',
      count: 1,
      expiresAt: '2026-07-24T13:00:00.000Z',
    }),
    (error: unknown) =>
      error instanceof AgentCommercePersistenceError
      && error.code === 'BUDGET_EXCEEDED',
  );

  const releaseTx = {
    rawQuery: async (sql: string) => ({
      data: sql.includes('UPDATE agent_commerce.result_artifacts') ? [] : [{ id: 'row' }],
      error: null,
    }),
  };
  await assert.rejects(
    () => repository.releaseArtifact(releaseTx as never, {
      taskId: '10000000-0000-0000-0000-000000000001',
      artifactId: '80000000-0000-0000-0000-000000000001',
      settlementId: '90000000-0000-0000-0000-000000000001',
      receiptId: 'a0000000-0000-0000-0000-000000000001',
      releasedAt: '2026-07-24T12:00:00.000Z',
    }),
    (error: unknown) =>
      error instanceof AgentCommercePersistenceError
      && error.code === 'PAYMENT_NOT_VERIFIED',
  );

  console.log('agent-commerce repository transaction tests passed');
}

void main();
