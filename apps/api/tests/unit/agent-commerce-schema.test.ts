import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AGENT_COMMERCE_RELATIONS,
  AGENT_COMMERCE_REQUIRED_RELATIONS,
} from '../../src/agent-commerce/agent-commerce-schema.constants';
import { AgentCommerceSchemaService } from '../../src/agent-commerce/agent-commerce-schema.service';

const migrationNames = [
  '2026-07-24-agent-commerce-identities.sql',
  '2026-07-24-agent-commerce-tasks-ap2.sql',
  '2026-07-24-agent-commerce-payments-delivery.sql',
  '2026-07-24-agent-commerce-device-authorization-details.sql',
];

function migrationSql(): string {
  return migrationNames.map((name) =>
    readFileSync(join(process.cwd(), 'db', 'migrations', name), 'utf8'),
  ).join('\n');
}

async function main(): Promise<void> {
  const sql = migrationSql();

  const createdRelations = [...sql.matchAll(
    /CREATE TABLE agent_commerce\.([a-z0-9_]+)/g,
  )].map((match) => match[1]);
  assert.deepEqual(createdRelations.sort(), [...AGENT_COMMERCE_RELATIONS].sort());
  assert.equal(new Set(createdRelations).size, 30);
  assert.doesNotMatch(sql, /ON DELETE CASCADE/i);
  assert.match(sql, /numeric\(78,0\)/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE UPDATE, DELETE ON agent_commerce\.security_audit_events/);

  const missingDb = {
    rawQuery: async () => ({
      data: AGENT_COMMERCE_REQUIRED_RELATIONS.map((key, index) => ({
        key,
        present: index !== 0,
      })),
      error: null,
    }),
  };
  await assert.rejects(
    () => new AgentCommerceSchemaService(missingDb as never).bootstrap(),
    /migrations are required.*oauth_clients/,
  );

  let missingColumnCall = 0;
  const missingColumnDb = {
    rawQuery: async () => {
      missingColumnCall += 1;
      if (missingColumnCall === 1) {
        return {
          data: AGENT_COMMERCE_REQUIRED_RELATIONS.map((key) => ({
            key,
            present: true,
          })),
          error: null,
        };
      }
      return {
        data: [{ column_name: 'installation_name' }],
        error: null,
      };
    },
  };
  await assert.rejects(
    () => new AgentCommerceSchemaService(missingColumnDb as never).bootstrap(),
    /missing columns: agent_commerce\.oauth_device_authorizations\.requested_authority/,
  );

  const executed: Array<{ sql: string; params: unknown[] }> = [];
  const productRows: Array<Record<string, unknown>> = [];
  const transaction = {
    rawQuery: async (query: string, params: unknown[] = []) => {
      executed.push({ sql: query, params });
      if (query.includes('INSERT INTO agent_commerce.a2a_products')) {
        productRows.push({
          product_id: params[0],
          product_version: 2,
          skill_id: params[1],
          description: params[2],
          input_schema_uri: params[3],
          output_schema_uri: params[4],
          input_schema_hash: params[5],
          output_schema_hash: params[6],
          pricing_policy: JSON.parse(String(params[7])),
          pricing_policy_hash: params[8],
          ap2_required: true,
          payment_class: 'paid',
          artifact_type: params[9],
          status: 'active',
        });
      }
      if (query.includes('FROM agent_commerce.oauth_clients')) {
        return {
          data: [{
            client_type: 'public',
            display_name: 'Apple Assistant',
            software_id: 'golfergeek.apple-assistant',
            software_version: 'v0.2',
            allowed_grants: [
              'urn:ietf:params:oauth:grant-type:device_code',
              'refresh_token',
            ],
            token_endpoint_auth_methods: ['none'],
            allowed_scopes: [
              'analysis:purchase',
              'commerce:purchase',
              'receipts:read',
              'tournaments:join',
              'tournaments:read',
              'tournaments:trade',
              'updates:read',
            ],
            allowed_audiences: ['https://divinr.ai/a2a'],
            client_secret_hash: null,
            status: 'active',
          }],
          error: null,
        };
      }
      if (query.includes('FROM agent_commerce.a2a_products')) {
        return { data: productRows, error: null };
      }
      return { data: [{ id: 'seeded' }], error: null };
    },
  };
  let readinessCall = 0;
  const readyDb = {
    rawQuery: async () => {
      readinessCall += 1;
      if (readinessCall === 1) {
        return {
          data: AGENT_COMMERCE_REQUIRED_RELATIONS.map((key) => ({
            key,
            present: true,
          })),
          error: null,
        };
      }
      return {
        data: [
          { column_name: 'installation_name' },
          { column_name: 'requested_authority' },
        ],
        error: null,
      };
    },
    withTransaction: async (work: (tx: typeof transaction) => Promise<void>) => work(transaction),
  };
  await new AgentCommerceSchemaService(readyDb as never).bootstrap();

  const productInserts = executed.filter((entry) =>
    entry.sql.includes('INSERT INTO agent_commerce.a2a_products'));
  assert.equal(productInserts.length, 7);
  assert.deepEqual(
    productInserts.map((entry) => entry.params[0]).sort(),
    [
      'divinr.analysis.demo.v2',
      'divinr.general-updates.demo.v2',
      'divinr.personal-updates.demo.v2',
      'divinr.tournament-context.demo.v2',
      'divinr.tournament-join.demo.v2',
      'divinr.tournament-trade.demo.v2',
      'divinr.tournaments-list.demo.v2',
    ],
  );
  const oauthInsert = executed.find((entry) =>
    entry.sql.includes('INSERT INTO agent_commerce.oauth_clients'));
  assert(oauthInsert);
  assert.equal(oauthInsert.params[0], 'apple-assistant-native-v1');
  assert(!executed.some((entry) => /CREATE TABLE|ALTER TABLE/i.test(entry.sql)));

  console.log('agent-commerce schema contract tests passed');
}

void main();
