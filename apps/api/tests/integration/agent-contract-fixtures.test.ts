import assert from 'node:assert/strict';
import { AgentContractSchemaRegistry } from '../../src/agent-contracts/contract-bundle';
import { canonicalSha256Base64Url } from '../../src/agent-contracts/canonical-json';

const registry = new AgentContractSchemaRegistry();
registry.validateBundleDocuments();

const fixtures = registry.bundle.fixtures as unknown as {
  positive: Array<{
    fixtureId: string;
    schemaRef: string;
    value: unknown;
    canonicalSha256: string;
  }>;
};
const schemaBase = `${String(registry.bundle.schemas.$id)}#/$defs/`;

for (const fixture of fixtures.positive) {
  registry.validate(fixture.schemaRef.slice(schemaBase.length), fixture.value);
  assert.equal(canonicalSha256Base64Url(fixture.value), fixture.canonicalSha256);
}

console.log(`PASS  ${fixtures.positive.length} positive v0.2 wire fixtures`);
