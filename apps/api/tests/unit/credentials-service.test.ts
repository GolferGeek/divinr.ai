/**
 * Unit tests for CredentialsService
 * Tests add, list, revoke, and analyst-reference conflict.
 */
import { CredentialsService } from '../../src/credentials/credentials.service';
import { CredentialEncryptionService } from '../../src/credentials/credential-encryption.service';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++;
    console.log(`  \u2713 ${label}`);
  } else {
    failed++;
    console.error(`  \u2717 ${label}`);
  }
}

interface MockRow {
  [key: string]: unknown;
}

function createMockDb(responses: Record<string, MockRow[]> = {}) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  return {
    queries,
    rawQuery: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      for (const [key, value] of Object.entries(responses)) {
        if (sql.includes(key)) {
          return { data: value };
        }
      }
      return { data: [] };
    },
  };
}

function createMockSchema() {
  return { ensureSchema: async () => {} };
}

function createMockBilling() {
  const items: Array<{ userId: string; kind: string; itemId: string | null }> = [];
  const canceledItems: Array<{ userId: string; kind: string; itemId: string | null }> = [];
  return {
    items,
    canceledItems,
    addAuthoredItem: async (userId: string, kind: any, itemId: string | null) => {
      items.push({ userId, kind, itemId });
      return { id: 'bill-1', user_id: userId, item_kind: kind, item_id: itemId, monthly_usd_cents: 1000, status: 'active', activated_at: '', canceled_at: null };
    },
    cancelAuthoredItem: async (userId: string, kind: any, itemId: string | null) => {
      canceledItems.push({ userId, kind, itemId });
    },
    ensureSubscription: async () => ({}),
  };
}

// Use dev key
delete process.env.CREDENTIAL_ENCRYPTION_KEY;
const realEncryption = new CredentialEncryptionService();

function createService(dbResponses: Record<string, MockRow[]> = {}): {
  service: CredentialsService;
  db: ReturnType<typeof createMockDb>;
  billing: ReturnType<typeof createMockBilling>;
} {
  const db = createMockDb(dbResponses);
  const schema = createMockSchema();
  const billing = createMockBilling();
  const service = Object.create(CredentialsService.prototype);
  (service as any).db = db;
  (service as any).schema = schema;
  (service as any).encryption = realEncryption;
  (service as any).billing = billing;
  (service as any).logger = { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  return { service: service as CredentialsService, db, billing };
}

async function main(): Promise<void> {
  console.log('\n=== CredentialsService Tests ===\n');

  // ─── addCredential encrypts and stores ────────────────────
  {
    const { service, db, billing } = createService({
      'INSERT INTO credentials.user_llm_credentials': [
        { id: 'cred-1', provider: 'openrouter', label: 'My Key', last_used_at: null },
      ],
      'count(*)': [{ cnt: 1 }],
    });

    const result = await service.addCredential('user-1', {
      provider: 'openrouter',
      label: 'My Key',
      secret: 'sk-secret',
    });

    assert(result.id === 'cred-1', 'addCredential returns credential id');
    assert(result.provider === 'openrouter', 'addCredential returns provider');
    assert(result.label === 'My Key', 'addCredential returns label');

    // Verify the INSERT query was called with encrypted data (Buffer params)
    const insertQuery = db.queries.find(q => q.sql.includes('INSERT INTO credentials.user_llm_credentials'));
    assert(insertQuery !== undefined, 'addCredential issues INSERT query');
    // Params: userId, provider, label, ciphertext (Buffer), iv (Buffer), tag (Buffer)
    assert(Buffer.isBuffer(insertQuery!.params[3]), 'ciphertext param is a Buffer');
    assert(Buffer.isBuffer(insertQuery!.params[4]), 'iv param is a Buffer');
    assert(Buffer.isBuffer(insertQuery!.params[5]), 'tag param is a Buffer');
    // The raw secret must NOT appear in any param
    const allParamStrings = insertQuery!.params.map(p => String(p));
    assert(!allParamStrings.includes('sk-secret'), 'raw secret is not stored as plaintext');

    // First credential → billing item added
    assert(billing.items.length === 1, 'addCredential adds byo_platform_fee billing item on first credential');
    assert(billing.items[0].kind === 'byo_platform_fee', 'billing item kind is byo_platform_fee');
  }

  // ─── listCredentials never returns ciphertext ─────────────
  {
    const { service } = createService({
      'SELECT id, provider, label, last_used_at': [
        { id: 'cred-1', provider: 'openrouter', label: 'Key 1', last_used_at: null },
        { id: 'cred-2', provider: 'anthropic', label: 'Key 2', last_used_at: '2026-01-01T00:00:00Z' },
      ],
    });

    const list = await service.listCredentials('user-1');
    assert(list.length === 2, 'listCredentials returns all credentials');
    // Ensure no ciphertext fields
    for (const cred of list) {
      const keys = Object.keys(cred);
      assert(!keys.includes('encrypted_secret'), 'listCredentials does not include encrypted_secret');
      assert(!keys.includes('encryption_iv'), 'listCredentials does not include encryption_iv');
      assert(!keys.includes('encryption_tag'), 'listCredentials does not include encryption_tag');
    }
  }

  // ─── revokeCredential returns 409 when analyst references it ──
  {
    const { service } = createService({
      'SELECT id FROM prediction.market_analysts': [{ id: 'analyst-1' }],
    });

    let threw = false;
    let statusCode: number | undefined;
    try {
      await service.revokeCredential('user-1', 'cred-1');
    } catch (err: any) {
      threw = true;
      statusCode = err.status ?? err.getStatus?.();
    }
    assert(threw, 'revokeCredential throws when analyst references credential');
    assert(statusCode === 409, 'revokeCredential throws 409 ConflictException');
  }

  // ─── revokeCredential cancels billing when last credential ──
  {
    const { service, billing } = createService({
      'SELECT id FROM prediction.market_analysts': [],
      'count(*)': [{ cnt: 0 }],
    });

    await service.revokeCredential('user-1', 'cred-1');
    assert(billing.canceledItems.length === 1, 'revokeCredential cancels byo_platform_fee when last credential');
    assert(billing.canceledItems[0].kind === 'byo_platform_fee', 'canceled item kind is byo_platform_fee');
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
