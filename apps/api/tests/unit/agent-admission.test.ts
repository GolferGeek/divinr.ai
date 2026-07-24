import assert from 'node:assert/strict';
import {
  createHash,
  generateKeyPairSync,
  verify,
} from 'node:crypto';
import {
  A2AAdmissionError,
  A2AAdmissionService,
} from '../../src/a2a/a2a-admission.service';
import {
  canonicalJsonBytes,
  canonicalSha256Base64Url,
} from '../../src/agent-contracts/canonical-json';
import { AgentQuoteService } from '../../src/agent-commerce/agent-quote.service';

const principal = {
  userId: '20000000-0000-0000-0000-000000000001',
  installationInternalId: '30000000-0000-0000-0000-000000000001',
  installationId: 'apple-installation-001',
  grantInternalId: '40000000-0000-0000-0000-000000000001',
  grantId: 'grant-001',
  scopes: ['updates:read', 'commerce:purchase', 'receipts:read'],
  dpopJkt: 'A'.repeat(43),
  accessTokenJti: 'token-001',
};

function initialRequest(skillId: 'general_updates' | 'personal_updates') {
  const productId = skillId === 'general_updates'
    ? 'divinr.general-updates.demo.v2'
    : 'divinr.personal-updates.demo.v2';
  const input = {
    schemaVersion: 2,
    requestId: `request-${skillId}`,
    idempotencyKey: `idempotency-${skillId}`,
    pageSize: 10,
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
    openAuthorityId: 'authority-001',
    openAuthorityVersion: 1,
    constraintHashes: ['C'.repeat(43)],
  };
  const intentHash = canonicalSha256Base64Url(intent);
  return {
    id: `rpc-${skillId}`,
    method: 'SendMessage' as const,
    params: {
      message: {
        messageId: `message-${skillId}`,
        contextId: 'context-001',
        role: 'ROLE_USER',
        parts: [{ data: input }],
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

async function main(): Promise<void> {
  const keyPairs = {
    checkout: generateKeyPairSync('ec', { namedCurve: 'prime256v1' }),
    quote: generateKeyPairSync('ec', { namedCurve: 'prime256v1' }),
  };
  const keys = {
    getSigningKey: async (role: 'checkout' | 'quote') => ({
      keyId: `divinr-${role}-v1`,
      role,
      privateKey: keyPairs[role].privateKey,
      publicJwk: {},
      fallback: true,
    }),
  };
  const quoteService = new AgentQuoteService(keys as never, {
    createInvoice: async () => ({
      invoice: 'lnbcrt1phase6testinvoice000000000000000000000000000000000',
      paymentHash: 'a'.repeat(64),
    }),
  });
  let stored: Record<string, unknown> | undefined;
  let storedEvent: Record<string, unknown> | undefined;
  let storedAdmission: Record<string, unknown> | undefined;
  let admittedTaskId = '';
  const repository = {
    admitTask: async (_transaction: unknown, input: Record<string, unknown>) => {
      storedAdmission = input;
      admittedTaskId = String(input.internalTaskId);
      return { created: true, taskId: admittedTaskId };
    },
    createQuoteAndRequirement: async (
      _transaction: unknown,
      input: Record<string, unknown>,
    ) => { stored = input; },
    appendTaskEvent: async (
      _transaction: unknown,
      input: Record<string, unknown>,
    ) => { storedEvent = input; },
    enqueueOutbox: async () => undefined,
    appendAuditEvent: async () => undefined,
  };
  let storedPriceMinorUnits = 1;
  let bindingActive = true;
  let concurrentCount = 0;
  let outstandingCount = 0;
  const transaction = {
    rawQuery: async (sql: string) => {
      if (sql.includes('FROM agent_commerce.a2a_idempotency')) {
        return { data: [], error: null };
      }
      if (sql.includes('verify admission binding') || sql.includes('agent_installations')) {
        return {
          data: bindingActive ? [{
            input_schema_uri:
              'urn:golfergeek:schema:apple-divinr-integration:v0.2#/$defs/updatesRequest',
            output_schema_uri:
              'urn:golfergeek:schema:apple-divinr-integration:v0.2#/$defs/updatesResult',
            pricing_policy: {
              currency: 'USD',
              priceMinorUnits: storedPriceMinorUnits,
              atomicAmount: '10000',
              asset: 'BTC-REGTEST',
              unit: 'msat',
              displayPrice: '$0.01 demo price',
            },
            payment_class: 'paid',
            ap2_required: true,
          }] : [],
          error: null,
        };
      }
      if (sql.includes('count(*) FILTER')) {
        return {
          data: [{
            concurrent_count: concurrentCount,
            outstanding_count: outstandingCount,
          }],
          error: null,
        };
      }
      throw new Error(`Unexpected transaction query: ${sql}`);
    },
  };
  const db = {
    withTransaction: async (work: (tx: unknown) => Promise<unknown>) =>
      work(transaction),
    rawQuery: async (sql: string) => {
      if (!sql.includes('FROM agent_commerce.a2a_tasks')) {
        throw new Error(`Unexpected database query: ${sql}`);
      }
      const event = storedEvent?.safeEventData as Record<string, unknown>;
      const quote = stored as Record<string, unknown>;
      return {
        data: [{
          id: admittedTaskId,
          protocol_task_id:
            (event.taskId as string),
          context_id: 'context-001',
          request_id: 'request-general_updates',
          user_id: principal.userId,
          installation_id: principal.installationInternalId,
          grant_id: principal.grantInternalId,
          skill_id: 'general_updates',
          product_id: 'divinr.general-updates.demo.v2',
          a2a_state: 'input_required',
          payment_state: 'payment_required',
          result_state: 'none',
          base_intent_hash: initialRequest('general_updates').params.message
            .metadata['golfergeek.baseIntentHash'],
          current_intent_hash: quote.currentIntentHash,
          updated_at: '2026-07-24T12:00:00.000Z',
          created_at: '2026-07-24T12:00:00.000Z',
          signed_quote: quote.signedQuote,
          canonical_quote_hash: quote.canonicalQuoteHash,
          canonical_requirement: quote.canonicalRequirement,
          canonical_requirement_hash: quote.canonicalRequirementHash,
          quote_event_data: event,
        }],
        error: null,
      };
    },
  };
  const service = new A2AAdmissionService(
    db as never,
    repository as never,
    quoteService,
  );
  const result = await service.execute(
    initialRequest('general_updates'),
    principal,
  );
  assert.equal(result.status && (result.status as {
    state: string;
  }).state, 'TASK_STATE_INPUT_REQUIRED');
  const statusMetadata = (result.status as {
    message: { metadata: Record<string, unknown> };
  }).message.metadata;
  assert.equal(statusMetadata['x402.payment.status'], 'payment-required');
  const signedQuote = statusMetadata['golfergeek.quote'] as {
    price: { minorUnits: number };
    settlement: { amount: string };
  };
  assert.equal(signedQuote.price.minorUnits, 1);
  assert.equal(signedQuote.settlement.amount, '10000');
  const quoteWithSignature = statusMetadata['golfergeek.quote'] as Record<
    string,
    unknown
  >;
  const quoteSignature = String(quoteWithSignature.signature);
  const { signature: _signature, ...unsignedQuote } = quoteWithSignature;
  assert.equal(verify(
    'sha256',
    canonicalJsonBytes(unsignedQuote),
    {
      key: keyPairs.quote.publicKey,
      dsaEncoding: 'ieee-p1363',
    },
    Buffer.from(quoteSignature, 'base64url'),
  ), true);
  const checkoutJwt = String(quoteWithSignature.checkoutJwt);
  const [checkoutHeader, checkoutPayload, checkoutSignature] =
    checkoutJwt.split('.');
  assert.equal(verify(
    'sha256',
    new TextEncoder().encode(`${checkoutHeader}.${checkoutPayload}`),
    {
      key: keyPairs.checkout.publicKey,
      dsaEncoding: 'ieee-p1363',
    },
    Buffer.from(checkoutSignature, 'base64url'),
  ), true);
  const checkoutClaims = JSON.parse(
    Buffer.from(checkoutPayload, 'base64url').toString('utf8'),
  ) as Record<string, unknown>;
  assert.equal(checkoutClaims.aud, 'https://divinr.ai/a2a');
  const paymentRequired = statusMetadata['x402.payment.required'] as {
    accepts: Array<{ extra: { checkoutMandateHash: string } }>;
  };
  assert.equal(
    paymentRequired.accepts[0].extra.checkoutMandateHash,
    createHash('sha256').update(checkoutJwt).digest('base64url'),
  );
  assert.equal(result.artifacts && (result.artifacts as unknown[]).length, 0);
  assert.ok(storedEvent);
  const taskLifetime = new Date(String(storedAdmission?.expiresAt)).getTime()
    - Date.now();
  assert.ok(taskLifetime > 895_000 && taskLifetime <= 900_000);

  await assert.rejects(
    () => service.execute(initialRequest('personal_updates'), {
      ...principal,
      scopes: ['updates:read'],
    }),
    (error: unknown) =>
      error instanceof A2AAdmissionError && error.code === 'SCOPE_DENIED',
  );
  const mismatched = initialRequest('general_updates');
  mismatched.params.message.metadata['golfergeek.intent'] = {
    ...mismatched.params.message.metadata['golfergeek.intent'],
    installationId: 'somebody-elses-installation',
  };
  await assert.rejects(
    () => service.execute(mismatched, principal),
    (error: unknown) =>
      error instanceof A2AAdmissionError
      && ['SCHEMA_INVALID', 'INTENT_MISMATCH'].includes(error.code),
  );
  storedPriceMinorUnits = 2;
  await assert.rejects(
    () => service.execute(initialRequest('general_updates'), principal),
    (error: unknown) =>
      error instanceof A2AAdmissionError && error.code === 'PRODUCT_MISMATCH',
  );
  storedPriceMinorUnits = 1;
  bindingActive = false;
  await assert.rejects(
    () => service.execute(initialRequest('general_updates'), principal),
    (error: unknown) =>
      error instanceof A2AAdmissionError && error.code === 'GRANT_DENIED',
  );
  bindingActive = true;
  concurrentCount = 4;
  await assert.rejects(
    () => service.execute(initialRequest('general_updates'), principal),
    (error: unknown) =>
      error instanceof A2AAdmissionError
      && error.code === 'CONCURRENCY_LIMIT_EXCEEDED',
  );
  concurrentCount = 0;
  outstandingCount = 2;
  await assert.rejects(
    () => service.execute(initialRequest('general_updates'), principal),
    (error: unknown) =>
      error instanceof A2AAdmissionError
      && error.code === 'OUTSTANDING_PAYMENT_LIMIT_EXCEEDED',
  );

  console.log('agent admission and exact prepayment quote tests passed');
}

void main();
