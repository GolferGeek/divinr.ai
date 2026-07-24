import assert from 'node:assert/strict';
import {
  canonicalJson,
  canonicalSha256Base64Url,
} from '../../src/agent-contracts/canonical-json';
import {
  AgentContractSchemaRegistry,
} from '../../src/agent-contracts/contract-bundle';

interface PositiveFixture {
  fixtureId: string;
  schemaRef: string;
  value: unknown;
  canonicalSha256: string;
}

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

test('RFC 8785 canonicalization is property-order stable', () => {
  const first = { z: 1, a: { y: '✓', x: [3, 2, 1] } };
  const second = { a: { x: [3, 2, 1], y: '✓' }, z: 1 };
  assert.equal(canonicalJson(first), canonicalJson(second));
  assert.equal(canonicalSha256Base64Url(first), canonicalSha256Base64Url(second));
});

test('RFC 8785 canonicalization normalizes JSON numbers', () => {
  assert.equal(
    canonicalJson({ negativeZero: -0, fractional: 0.000001, integer: 1.0 }),
    '{"fractional":0.000001,"integer":1,"negativeZero":0}',
  );
  assert.throws(() => canonicalJson({ invalid: Number.NaN }));
  assert.throws(() => canonicalJson({ invalid: Number.POSITIVE_INFINITY }));
});

test('all positive fixture values validate and match canonical hashes', () => {
  const registry = new AgentContractSchemaRegistry();
  const fixtures = registry.bundle.fixtures as unknown as {
    positive: PositiveFixture[];
  };
  const schemaBase = `${String(registry.bundle.schemas.$id)}#/$defs/`;
  for (const fixture of fixtures.positive) {
    assert(
      fixture.schemaRef.startsWith(schemaBase),
      `${fixture.fixtureId} uses an unexpected schema URI`,
    );
    registry.validate(fixture.schemaRef.slice(schemaBase.length), fixture.value);
    assert.equal(
      canonicalSha256Base64Url(fixture.value),
      fixture.canonicalSha256,
      fixture.fixtureId,
    );
  }
});

test('unsupported JSON values fail canonicalization', () => {
  assert.throws(() => canonicalJson(undefined));
});
