/**
 * Phase 4 shape test for the StubLlmService test double.
 *
 * Verifies that:
 *   - The fake loads its canned responses without exceptions.
 *   - Each of the 16 canned keys (4 symbols × 3 analysts × 1 arbitrator)
 *     is reachable via the prompt-extraction logic.
 *   - The MSFT|Macro Strategist key correctly throws (partial-failure scenario).
 *   - An unknown (symbol, analyst) combination throws a clear error.
 *   - Every other LLMServiceProvider method throws (so future drift is loud).
 */

import { StubLlmService } from '../markets/integration/stubs/stub-llm-service';

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string): void {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}`);
  }
}

function makeAnalystPrompts(symbol: string, analystName: string): { sys: string; user: string } {
  return {
    sys: `You are ${analystName}. You analyze markets.\n\nRespond with valid JSON.`,
    user: `Assess ${symbol} (${symbol} Inc.) for prediction.\nYour weight in the ensemble: 1.0`,
  };
}

function makeArbitratorPrompts(symbol: string): { sys: string; user: string } {
  return {
    sys: `You are the chief arbitrator synthesizing multiple analyst assessments for ${symbol}.\n\nRespond with valid JSON.`,
    user: `Synthesize these analyst assessments for ${symbol} (${symbol} Inc.):\n\n...`,
  };
}

async function main(): Promise<void> {
  const stub = new StubLlmService();

  console.log('\nAnalyst keys (4 symbols × 3 analysts):');
  for (const symbol of ['AAPL', 'TSLA', 'NVDA']) {
    for (const analyst of ['Macro Strategist', 'Technical Analyst', 'Sentiment Analyst']) {
      const { sys, user } = makeAnalystPrompts(symbol, analyst);
      const out = await stub.generateResponse(sys, user);
      assert(typeof out === 'string' && out.length > 0, `${symbol}|${analyst} returns a non-empty string`);
      const parsed = JSON.parse(out);
      assert(['up', 'down', 'flat'].includes(parsed.direction), `${symbol}|${analyst} parses with valid direction`);
      assert(typeof parsed.confidence === 'number', `${symbol}|${analyst} has numeric confidence`);
    }
  }

  console.log('\nMSFT analyst keys (partial-failure scenario):');
  // Macro Strategist throws
  let threw = false;
  try {
    const { sys, user } = makeAnalystPrompts('MSFT', 'Macro Strategist');
    await stub.generateResponse(sys, user);
  } catch (err) {
    threw = true;
    assert(err instanceof Error && err.message.includes('partial-failure'), 'MSFT|Macro Strategist throws partial-failure error');
  }
  assert(threw, 'MSFT|Macro Strategist throws');
  // The other two MSFT analysts return normally
  for (const analyst of ['Technical Analyst', 'Sentiment Analyst']) {
    const { sys, user } = makeAnalystPrompts('MSFT', analyst);
    const out = await stub.generateResponse(sys, user);
    assert(typeof out === 'string' && out.length > 0, `MSFT|${analyst} still returns a string`);
  }

  console.log('\nArbitrator keys (4 symbols):');
  for (const symbol of ['AAPL', 'TSLA', 'NVDA', 'MSFT']) {
    const { sys, user } = makeArbitratorPrompts(symbol);
    const out = await stub.generateResponse(sys, user);
    const parsed = JSON.parse(out);
    assert(['up', 'down', 'flat'].includes(parsed.direction), `${symbol}|_arbitrator parses with valid direction`);
  }

  console.log('\nUnknown key error path:');
  let unknownThrew = false;
  try {
    const { sys, user } = makeAnalystPrompts('GOOG', 'Macro Strategist');
    await stub.generateResponse(sys, user);
  } catch (err) {
    unknownThrew = true;
    assert(
      err instanceof Error && err.message.includes('GOOG|Macro Strategist'),
      'unknown key error mentions the missing key',
    );
  }
  assert(unknownThrew, 'unknown key throws');

  console.log('\nUnimplemented interface methods:');
  const unimplemented = ['listModels', 'listProviders', 'generateUnifiedResponse', 'generateImage', 'generateVideo', 'pollVideoStatus'] as const;
  for (const method of unimplemented) {
    let methodThrew = false;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (stub as any)[method]();
    } catch {
      methodThrew = true;
    }
    assert(methodThrew, `${method}() throws`);
  }
  // emitLlmObservabilityEvent is a no-op, not a thrower
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (stub as any).emitLlmObservabilityEvent('test', {});
  assert(true, 'emitLlmObservabilityEvent is a silent no-op');

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
