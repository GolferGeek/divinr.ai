/**
 * Unit tests for WiringService
 * Tests ownership validation, idempotent add/remove, and data listing.
 */
import { ForbiddenException } from '@nestjs/common';
import { WiringService } from '../../src/markets/services/wiring.service';

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

// ─── Mock DB ──────────────────────────────────────────────────

interface QueryCall {
  sql: string;
  params: any[];
}

function createMockDb(responses: Record<string, any>) {
  const calls: QueryCall[] = [];
  return {
    calls,
    rawQuery: async (sql: string, params: any[] = []) => {
      calls.push({ sql, params });
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
  return {
    ensureSchema: async () => {},
  };
}

function createService(dbResponses: Record<string, any> = {}) {
  const db = createMockDb(dbResponses);
  const schema = createMockSchema();
  const service = Object.create(WiringService.prototype);
  (service as any).db = db;
  (service as any).schema = schema;
  return { service: service as WiringService, db };
}

async function main(): Promise<void> {
  console.log('\n=== Wiring Service Tests ===\n');

  // ─── addWiring rejects when authored analyst belongs to a different user
  console.log('addWiring ownership validation:');
  {
    const { service } = createService({
      'SELECT user_id FROM prediction.market_analysts': [{ user_id: 'other-user-id' }],
    });

    let threw = false;
    let threwForbidden = false;
    try {
      await service.addWiring('my-user-id', 'analyst-1', 'instrument-1');
    } catch (err) {
      threw = true;
      threwForbidden = err instanceof ForbiddenException;
    }
    assert(threw, 'addWiring throws when analyst belongs to another user');
    assert(threwForbidden, 'addWiring throws ForbiddenException specifically');
  }

  // ─── addWiring accepts when analyst is base (user_id IS NULL)
  console.log('\naddWiring accepts base analyst:');
  {
    const { service, db } = createService({
      'SELECT user_id FROM prediction.market_analysts': [{ user_id: null }],
    });

    let threw = false;
    try {
      const result = await service.addWiring('my-user-id', 'analyst-base', 'instrument-1');
      assert(result.analystId === 'analyst-base', 'returns correct analystId');
      assert(result.instrumentId === 'instrument-1', 'returns correct instrumentId');
    } catch {
      threw = true;
    }
    assert(!threw, 'addWiring does not throw for base analyst (user_id IS NULL)');
    const insertCall = db.calls.find((c) => c.sql.includes('INSERT INTO'));
    assert(insertCall !== undefined, 'INSERT query was executed');
  }

  // ─── addWiring accepts when analyst belongs to same user
  console.log('\naddWiring accepts own authored analyst:');
  {
    const { service } = createService({
      'SELECT user_id FROM prediction.market_analysts': [{ user_id: 'my-user-id' }],
    });

    let threw = false;
    try {
      await service.addWiring('my-user-id', 'analyst-mine', 'instrument-1');
    } catch {
      threw = true;
    }
    assert(!threw, 'addWiring does not throw for own authored analyst');
  }

  // ─── addWiring is idempotent (ON CONFLICT DO NOTHING)
  console.log('\naddWiring is idempotent:');
  {
    const { service, db } = createService({
      'SELECT user_id FROM prediction.market_analysts': [{ user_id: null }],
    });

    let threw = false;
    try {
      await service.addWiring('my-user-id', 'analyst-1', 'instrument-1');
      await service.addWiring('my-user-id', 'analyst-1', 'instrument-1');
    } catch {
      threw = true;
    }
    assert(!threw, 'addWiring called twice does not throw');
    const insertCalls = db.calls.filter((c) => c.sql.includes('ON CONFLICT'));
    assert(insertCalls.length === 2, 'INSERT with ON CONFLICT was issued both times');
  }

  // ─── removeWiring is idempotent
  console.log('\nremoveWiring is idempotent:');
  {
    const { service, db } = createService();

    let threw = false;
    try {
      const result1 = await service.removeWiring('my-user-id', 'analyst-1', 'instrument-1');
      const result2 = await service.removeWiring('my-user-id', 'analyst-1', 'instrument-1');
      assert(result1.removed === true, 'first remove returns { removed: true }');
      assert(result2.removed === true, 'second remove also returns { removed: true }');
    } catch {
      threw = true;
    }
    assert(!threw, 'removeWiring called twice does not throw');
    const deleteCalls = db.calls.filter((c) => c.sql.includes('DELETE FROM'));
    assert(deleteCalls.length === 2, 'DELETE was issued both times');
  }

  // ─── listMyWirings returns structured result
  console.log('\nlistMyWirings returns structured result:');
  {
    const { service } = createService({
      'SELECT id, slug, display_name, user_id FROM prediction.market_analysts': [
        { id: 'a1', slug: 'analyst-1', display_name: 'Analyst One', user_id: null },
      ],
      'SELECT id, symbol, name, user_id FROM prediction.instruments': [
        { id: 'i1', symbol: 'AAPL', name: 'Apple Inc.', user_id: null },
      ],
      'SELECT analyst_id': [
        { analystId: 'a1', instrumentId: 'i1' },
      ],
    });

    const result = await service.listMyWirings('my-user-id');
    assert(Array.isArray(result.analysts), 'analysts is an array');
    assert(Array.isArray(result.instruments), 'instruments is an array');
    assert(Array.isArray(result.wirings), 'wirings is an array');
    assert(result.analysts.length === 1, 'returns 1 analyst');
    assert(result.instruments.length === 1, 'returns 1 instrument');
    assert(result.wirings.length === 1, 'returns 1 wiring');
  }

  // ─── Summary
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
