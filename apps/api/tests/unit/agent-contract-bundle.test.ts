import assert from 'node:assert/strict';
import {
  AgentContractSchemaRegistry,
  ContractValidationError,
  loadAndVerifyContractBundle,
} from '../../src/agent-contracts/contract-bundle';
import {
  AGENT_PRODUCT_IDS,
  loadAgentProductCatalog,
} from '../../src/agent-contracts/catalog';

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

test('shared v0.2 bundle matches its manifest and schemas', () => {
  const registry = new AgentContractSchemaRegistry();
  registry.validateBundleDocuments();
  assert.equal(
    registry.bundle.manifest.profileId,
    'urn:golfergeek:profile:apple-divinr-commerce:v0.2',
  );
  assert.equal(registry.bundle.manifest.files.length, 5);
});

test('frozen catalog contains exactly seven paid products', () => {
  const catalog = loadAgentProductCatalog();
  assert.deepEqual([...catalog.keys()], AGENT_PRODUCT_IDS);
  assert.deepEqual(
    [...catalog.values()].map((product) => product.priceMinorUnits),
    [1, 2, 1, 2, 5, 3, 4],
  );
  assert.deepEqual(
    [...catalog.values()].map((product) => product.atomicAmount),
    ['10000', '20000', '10000', '20000', '50000', '30000', '40000'],
  );
  assert([...catalog.values()].every((product) => product.ap2Required));
  assert([...catalog.values()].every((product) => product.classification === 'paid'));
});

test('unknown schema names fail closed', () => {
  const registry = new AgentContractSchemaRegistry();
  assert.throws(
    () => registry.validate('not-a-contract', {}),
    ContractValidationError,
  );
});

test('bundle can be loaded from the discovered workspace root', () => {
  assert.equal(loadAndVerifyContractBundle().manifest.schemaVersion, 2);
});
