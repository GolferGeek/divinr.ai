import { Inject, Injectable } from '@nestjs/common';
import {
  DATABASE_SERVICE,
  runSerializableTransaction,
  type DatabaseService,
  type DatabaseTransaction,
  type QueryResult,
} from '@orchestratorai/planes/database';
import { canonicalSha256 } from '../agent-contracts/canonical-json';
import {
  AgentContractSchemaRegistry,
} from '../agent-contracts/contract-bundle';
import {
  loadAgentProductCatalog,
  type AgentProduct,
} from '../agent-contracts/catalog';
import {
  AGENT_COMMERCE_REQUIRED_RELATIONS,
  APPLE_ASSISTANT_OAUTH_CLIENT_ID,
  OAUTH_DEVICE_AUTHORIZATION_REQUIRED_COLUMNS,
} from './agent-commerce-schema.constants';

interface PublicKeySeed {
  keyId: string;
  ownerService: string;
  keyRole: 'agent_card' | 'oauth_signing' | 'ap2_merchant' | 'quote' | 'receipt' | 'push' | 'facade_mtls';
  algorithm: string;
  publicJwk?: Record<string, unknown>;
  certificateSha256?: string;
  externalCustodyRef: string;
  status: 'pending' | 'active' | 'retiring';
  validFrom: string;
  validUntil?: string;
}

interface SeededProductRow {
  product_id: string;
  product_version: number;
  skill_id: string;
  description: string;
  input_schema_uri: string;
  output_schema_uri: string;
  input_schema_hash: string;
  output_schema_hash: string;
  pricing_policy: Record<string, unknown>;
  pricing_policy_hash: string;
  ap2_required: boolean;
  payment_class: string;
  artifact_type: string;
  status: string;
}

function dataRows<T>(result: QueryResult, operation: string): T[] {
  if (result.error) {
    throw new Error(`${operation} failed: ${result.error.message}`);
  }
  return (result.data as T[] | null) ?? [];
}

function schemaDefinition(
  registry: AgentContractSchemaRegistry,
  uri: string,
): unknown {
  const marker = '#/$defs/';
  const offset = uri.indexOf(marker);
  if (offset < 0) throw new Error(`Unsupported contract schema URI: ${uri}`);
  const name = uri.slice(offset + marker.length);
  const definitions = registry.bundle.schemas.$defs as Record<string, unknown>;
  const definition = definitions[name];
  if (!definition) throw new Error(`Missing contract schema definition: ${name}`);
  return definition;
}

function productDescription(product: AgentProduct): string {
  const descriptions: Record<string, string> = {
    general_updates: 'User-independent Divinr updates.',
    personal_updates: 'Authenticated user-specific Divinr updates.',
    tournaments_list: 'Available Divinr tournament listing.',
    tournament_context: 'Current rules and context for one tournament.',
    analysis_request: 'A typed Divinr market analysis artifact.',
    tournament_join: 'Join one Divinr simulated tournament.',
    tournament_trade: 'Submit one simulated Divinr tournament trade.',
  };
  return descriptions[product.skillId] ?? product.skillId;
}

function artifactType(skillId: string): string {
  if (skillId.endsWith('updates')) return 'updates';
  if (skillId === 'tournaments_list') return 'tournament-list';
  if (skillId === 'tournament_context') return 'tournament-context';
  if (skillId === 'analysis_request') return 'analysis';
  return 'action-receipt';
}

function readPublicKeySeeds(): PublicKeySeed[] {
  const raw = process.env.AGENT_COMMERCE_PUBLIC_KEYS_JSON;
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('AGENT_COMMERCE_PUBLIC_KEYS_JSON must be a JSON array');
  }
  const forbidden = /private|secret|seed|macaroon/i;
  const assertPublicOnly = (value: unknown, path: string): void => {
    if (!value || typeof value !== 'object') return;
    for (const [key, member] of Object.entries(value)) {
      if (forbidden.test(key)) {
        throw new Error(`Forbidden private key metadata field: ${path}${key}`);
      }
      assertPublicOnly(member, `${path}${key}.`);
    }
  };
  for (const item of parsed) {
    if (!item || typeof item !== 'object') {
      throw new Error('Agent-commerce public key metadata must be objects');
    }
    assertPublicOnly(item, '');
  }
  return parsed as PublicKeySeed[];
}

@Injectable()
export class AgentCommerceSchemaService {
  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
  ) {}

  async bootstrap(): Promise<void> {
    await this.assertRelationsExist();
    await this.assertRequiredColumnsExist();
    const registry = new AgentContractSchemaRegistry();
    const catalog = loadAgentProductCatalog(registry);
    const keySeeds = readPublicKeySeeds();

    await runSerializableTransaction(this.db, async (transaction) => {
      await this.seedOAuthClient(transaction, catalog);
      for (const product of catalog.values()) {
        await this.seedProduct(transaction, registry, product);
      }
      for (const key of keySeeds) {
        await this.seedPublicKey(transaction, key);
      }
      await this.verifyImmutableSeeds(transaction, registry, catalog);
    });
  }

  private async assertRelationsExist(): Promise<void> {
    const rows = dataRows<{ key: string; present: boolean }>(
      await this.db.rawQuery(
        `SELECT key, to_regclass(key) IS NOT NULL AS present
           FROM unnest($1::text[]) AS key`,
        [AGENT_COMMERCE_REQUIRED_RELATIONS],
      ),
      'agent-commerce migration readiness',
    );
    const missing = rows.filter((row) => !row.present).map((row) => row.key);
    if (missing.length > 0) {
      throw new Error(
        `Agent-commerce migrations are required; missing relations: ${missing.join(', ')}`,
      );
    }
  }

  private async assertRequiredColumnsExist(): Promise<void> {
    const rows = dataRows<{ column_name: string }>(
      await this.db.rawQuery(
        `SELECT column_name
           FROM information_schema.columns
          WHERE table_schema = 'agent_commerce'
            AND table_name = 'oauth_device_authorizations'
            AND column_name = ANY($1::text[])`,
        [OAUTH_DEVICE_AUTHORIZATION_REQUIRED_COLUMNS],
      ),
      'agent-commerce column readiness',
    );
    const present = new Set(rows.map((row) => row.column_name));
    const missing = OAUTH_DEVICE_AUTHORIZATION_REQUIRED_COLUMNS.filter(
      (column) => !present.has(column),
    );
    if (missing.length > 0) {
      throw new Error(
        `Agent-commerce migrations are required; missing columns: ${missing
          .map((column) => `agent_commerce.oauth_device_authorizations.${column}`)
          .join(', ')}`,
      );
    }
  }

  private async seedOAuthClient(
    transaction: DatabaseTransaction,
    catalog: ReadonlyMap<string, Readonly<AgentProduct>>,
  ): Promise<void> {
    const scopes = [...new Set(
      [...catalog.values()].flatMap((product) => [...product.requiredScopes]),
    )].sort();
    dataRows(
      await transaction.rawQuery(
        `INSERT INTO agent_commerce.oauth_clients (
           client_id, client_type, display_name, software_id, software_version,
           allowed_grants, token_endpoint_auth_methods, allowed_scopes,
           allowed_audiences, status
         ) VALUES ($1,'public',$2,$3,'v0.2',$4,$5,$6,$7,'active')
         ON CONFLICT (client_id) DO NOTHING
         RETURNING id`,
        [
          APPLE_ASSISTANT_OAUTH_CLIENT_ID,
          'Apple Assistant',
          'golfergeek.apple-assistant',
          [
            'urn:ietf:params:oauth:grant-type:device_code',
            'refresh_token',
          ],
          ['none'],
          scopes,
          ['https://divinr.ai/a2a'],
        ],
      ),
      'seed Apple Assistant OAuth client',
    );
  }

  private async seedProduct(
    transaction: DatabaseTransaction,
    registry: AgentContractSchemaRegistry,
    product: Readonly<AgentProduct>,
  ): Promise<void> {
    const inputSchemaHash = canonicalSha256(
      schemaDefinition(registry, product.inputSchema),
    );
    const outputSchemaHash = canonicalSha256(
      schemaDefinition(registry, product.outputSchema),
    );
    const pricingPolicy = {
      currency: 'USD',
      priceMinorUnits: product.priceMinorUnits,
      atomicAmount: product.atomicAmount,
      asset: 'BTC-REGTEST',
      unit: 'msat',
      network: 'regtest',
      displayPrice: product.displayPrice,
      quoteLifetimeSeconds: product.quoteLifetimeSeconds,
    };
    dataRows(
      await transaction.rawQuery(
        `INSERT INTO agent_commerce.a2a_products (
           product_id, product_version, skill_id, status, description,
           input_schema_uri, output_schema_uri, input_schema_hash,
           output_schema_hash, pricing_policy, pricing_policy_hash,
           ap2_required, payment_class, artifact_type, effective_from
         ) VALUES (
           $1,2,$2,'active',$3,$4,$5,$6,$7,$8::jsonb,$9,true,'paid',$10,$11
         )
         ON CONFLICT (product_id, product_version) DO NOTHING
         RETURNING id`,
        [
          product.productId,
          product.skillId,
          productDescription(product),
          product.inputSchema,
          product.outputSchema,
          inputSchemaHash,
          outputSchemaHash,
          JSON.stringify(pricingPolicy),
          canonicalSha256(pricingPolicy),
          artifactType(product.skillId),
          '2026-07-22T00:00:00.000Z',
        ],
      ),
      `seed product ${product.productId}`,
    );
  }

  private async seedPublicKey(
    transaction: DatabaseTransaction,
    seed: PublicKeySeed,
  ): Promise<void> {
    if (!seed.publicJwk && !seed.certificateSha256) {
      throw new Error(`Public key seed ${seed.keyId} has no public material`);
    }
    dataRows(
      await transaction.rawQuery(
        `INSERT INTO agent_commerce.cryptographic_key_registry (
           key_id, owner_service, key_role, algorithm, public_jwk,
           certificate_sha256, external_custody_ref, status, valid_from,
           valid_until
         ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10)
         ON CONFLICT (owner_service, key_role, key_id) DO NOTHING
         RETURNING id`,
        [
          seed.keyId,
          seed.ownerService,
          seed.keyRole,
          seed.algorithm,
          seed.publicJwk ? JSON.stringify(seed.publicJwk) : null,
          seed.certificateSha256 ?? null,
          seed.externalCustodyRef,
          seed.status,
          seed.validFrom,
          seed.validUntil ?? null,
        ],
      ),
      `seed public key metadata ${seed.keyId}`,
    );
    const stored = dataRows<{
      algorithm: string;
      public_jwk: Record<string, unknown> | null;
      certificate_sha256: string | null;
      external_custody_ref: string;
      status: string;
      valid_from: string;
      valid_until: string | null;
    }>(
      await transaction.rawQuery(
        `SELECT algorithm, public_jwk, certificate_sha256, external_custody_ref,
                status, valid_from, valid_until
           FROM agent_commerce.cryptographic_key_registry
          WHERE owner_service = $1 AND key_role = $2 AND key_id = $3`,
        [seed.ownerService, seed.keyRole, seed.keyId],
      ),
      `verify public key metadata ${seed.keyId}`,
    )[0];
    if (
      !stored
      || stored.algorithm !== seed.algorithm
      || canonicalSha256(stored.public_jwk) !== canonicalSha256(seed.publicJwk ?? null)
      || stored.certificate_sha256 !== (seed.certificateSha256 ?? null)
      || stored.external_custody_ref !== seed.externalCustodyRef
      || stored.status !== seed.status
      || new Date(stored.valid_from).toISOString() !== new Date(seed.validFrom).toISOString()
      || (
        stored.valid_until
          ? new Date(stored.valid_until).toISOString()
          : null
      ) !== (
        seed.validUntil ? new Date(seed.validUntil).toISOString() : null
      )
    ) {
      throw new Error(`Immutable public key metadata drift detected for ${seed.keyId}`);
    }
  }

  private async verifyImmutableSeeds(
    transaction: DatabaseTransaction,
    registry: AgentContractSchemaRegistry,
    catalog: ReadonlyMap<string, Readonly<AgentProduct>>,
  ): Promise<void> {
    const clients = dataRows<{
      client_type: string;
      display_name: string;
      software_id: string;
      software_version: string;
      allowed_grants: string[];
      token_endpoint_auth_methods: string[];
      allowed_scopes: string[];
      allowed_audiences: string[];
      client_secret_hash: string | null;
      status: string;
    }>(
      await transaction.rawQuery(
        `SELECT client_type, display_name, software_id, software_version,
                allowed_grants, token_endpoint_auth_methods, allowed_scopes,
                allowed_audiences, client_secret_hash, status
           FROM agent_commerce.oauth_clients
          WHERE client_id = $1`,
        [APPLE_ASSISTANT_OAUTH_CLIENT_ID],
      ),
      'verify Apple Assistant OAuth client',
    );
    if (
      clients.length !== 1
      || clients[0].client_type !== 'public'
      || clients[0].display_name !== 'Apple Assistant'
      || clients[0].software_id !== 'golfergeek.apple-assistant'
      || clients[0].software_version !== 'v0.2'
      || canonicalSha256([...clients[0].allowed_grants].sort()) !== canonicalSha256([
        'refresh_token',
        'urn:ietf:params:oauth:grant-type:device_code',
      ])
      || canonicalSha256(clients[0].token_endpoint_auth_methods) !== canonicalSha256(['none'])
      || canonicalSha256([...clients[0].allowed_scopes].sort()) !== canonicalSha256(
        [...new Set(
          [...catalog.values()].flatMap((product) => [...product.requiredScopes]),
        )].sort(),
      )
      || canonicalSha256(clients[0].allowed_audiences) !== canonicalSha256([
        'https://divinr.ai/a2a',
      ])
      || clients[0].client_secret_hash !== null
      || clients[0].status !== 'active'
    ) {
      throw new Error('Immutable Apple Assistant OAuth client seed drift detected');
    }

    const products = dataRows<SeededProductRow>(
      await transaction.rawQuery(
        `SELECT product_id, product_version, skill_id, description,
                input_schema_uri, output_schema_uri, input_schema_hash,
                output_schema_hash, pricing_policy, pricing_policy_hash,
                ap2_required, payment_class, artifact_type, status
           FROM agent_commerce.a2a_products
          WHERE product_version = 2 AND product_id = ANY($1::text[])`,
        [[...catalog.keys()]],
      ),
      'verify immutable product catalog',
    );
    if (products.length !== catalog.size) {
      throw new Error(`Expected ${catalog.size} v0.2 products, found ${products.length}`);
    }
    for (const row of products) {
      const expected = catalog.get(row.product_id);
      if (!expected) throw new Error(`Unexpected seeded product ${row.product_id}`);
      const pricingPolicy = {
        currency: 'USD',
        priceMinorUnits: expected.priceMinorUnits,
        atomicAmount: expected.atomicAmount,
        asset: 'BTC-REGTEST',
        unit: 'msat',
        network: 'regtest',
        displayPrice: expected.displayPrice,
        quoteLifetimeSeconds: expected.quoteLifetimeSeconds,
      };
      if (
        row.product_version !== 2
        || row.skill_id !== expected.skillId
        || row.description !== productDescription(expected)
        || row.input_schema_uri !== expected.inputSchema
        || row.output_schema_uri !== expected.outputSchema
        || row.status !== 'active'
        || row.ap2_required !== true
        || row.payment_class !== 'paid'
        || row.artifact_type !== artifactType(expected.skillId)
        || row.input_schema_hash !== canonicalSha256(schemaDefinition(registry, expected.inputSchema))
        || row.output_schema_hash !== canonicalSha256(schemaDefinition(registry, expected.outputSchema))
        || canonicalSha256(row.pricing_policy) !== canonicalSha256(pricingPolicy)
        || row.pricing_policy_hash !== canonicalSha256(pricingPolicy)
      ) {
        throw new Error(`Immutable product seed drift detected for ${row.product_id}`);
      }
    }
  }
}
