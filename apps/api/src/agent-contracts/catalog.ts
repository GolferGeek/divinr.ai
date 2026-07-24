import { AgentContractSchemaRegistry } from './contract-bundle';

export const AGENT_PRODUCT_IDS = [
  'divinr.general-updates.demo.v2',
  'divinr.personal-updates.demo.v2',
  'divinr.tournaments-list.demo.v2',
  'divinr.tournament-context.demo.v2',
  'divinr.analysis.demo.v2',
  'divinr.tournament-join.demo.v2',
  'divinr.tournament-trade.demo.v2',
] as const;

export type AgentProductId = (typeof AGENT_PRODUCT_IDS)[number];

const AGENT_AUDIT_FIELDS = Object.freeze([
  'requestId',
  'taskId',
  'effectiveUserId',
  'installationId',
  'grantId',
  'skillId',
  'productId',
  'outcome',
] as const);

export interface AgentProduct {
  productId: AgentProductId;
  skillId: string;
  requiredScopes: readonly string[];
  inputSchema: string;
  outputSchema: string;
  priceMinorUnits: number;
  atomicAmount: string;
  displayPrice: string;
  classification: 'paid';
  ap2Required: true;
  idempotencyRequired: true;
  quoteLifetimeSeconds: number;
  taskLifetimeSeconds: number;
  dataClassification: 'user-scoped';
  redactionPolicy: 'validate-shared-output-schema-and-minimize';
  errorContractSchema: string;
  auditFields: readonly [
    'requestId',
    'taskId',
    'effectiveUserId',
    'installationId',
    'grantId',
    'skillId',
    'productId',
    'outcome',
  ];
}

interface FrozenProfile {
  products: Record<string, {
    skillId: string;
    priceMinorUnits: number;
    atomicAmount: string;
    displayPrice: string;
  }>;
  oauth: { scopes: Record<string, string[]> };
  a2a: {
    agentCardExtensionParams: {
      skillSchemas: Record<string, { input: string; output: string }>;
    };
  };
  payment: { quoteLifetimeSeconds: number };
  taskPolicy: { maximumTaskRuntimeSeconds: number };
}

export function loadAgentProductCatalog(
  registry = new AgentContractSchemaRegistry(),
): ReadonlyMap<AgentProductId, Readonly<AgentProduct>> {
  registry.validateBundleDocuments();
  const profile = registry.bundle.profile as unknown as FrozenProfile;
  const profileIds = Object.keys(profile.products).sort();
  const expectedIds = [...AGENT_PRODUCT_IDS].sort();
  if (JSON.stringify(profileIds) !== JSON.stringify(expectedIds)) {
    throw new Error('Frozen profile product IDs do not match the v0.2 catalog');
  }

  const products = new Map<AgentProductId, Readonly<AgentProduct>>();
  for (const productId of AGENT_PRODUCT_IDS) {
    const frozen = profile.products[productId];
    const scopes = profile.oauth.scopes[frozen.skillId];
    const schemas = profile.a2a.agentCardExtensionParams.skillSchemas[frozen.skillId];
    if (!scopes || !schemas) {
      throw new Error(`Incomplete frozen catalog metadata for ${productId}`);
    }
    products.set(productId, Object.freeze({
      productId,
      skillId: frozen.skillId,
      requiredScopes: Object.freeze([...scopes]),
      inputSchema: schemas.input,
      outputSchema: schemas.output,
      priceMinorUnits: frozen.priceMinorUnits,
      atomicAmount: frozen.atomicAmount,
      displayPrice: frozen.displayPrice,
      classification: 'paid',
      ap2Required: true,
      idempotencyRequired: true,
      quoteLifetimeSeconds: profile.payment.quoteLifetimeSeconds,
      taskLifetimeSeconds: profile.taskPolicy.maximumTaskRuntimeSeconds,
      dataClassification: 'user-scoped',
      redactionPolicy: 'validate-shared-output-schema-and-minimize',
      errorContractSchema:
        'urn:golfergeek:schema:apple-divinr-integration:v0.2#/$defs/errorEnvelope',
      auditFields: AGENT_AUDIT_FIELDS,
    }));
  }
  return products;
}
