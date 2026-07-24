import assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import { AgentCommerceRepository } from '../../src/agent-commerce/agent-commerce.repository';
import { ConnectedAgentsService } from '../../src/connected-agents/connected-agents.service';
import { DeviceAuthorizationService } from '../../src/oauth/device-authorization.service';

const USER_ID = '20000000-0000-0000-0000-000000000001';
const OTHER_USER_ID = '20000000-0000-0000-0000-000000000002';
const INSTALLATION_INTERNAL_ID = '30000000-0000-0000-0000-000000000001';
const AUTHORIZATION = {
  id: '10000000-0000-0000-0000-000000000001',
  authorization_id: 'authorization-demo-001',
  oauth_client_id: '40000000-0000-0000-0000-000000000001',
  installation_request_id: 'apple-installation-demo-001',
  installation_name: 'Test Apple Assistant',
  user_id: USER_ID,
  proposed_dpop_jkt: 'dpop-thumbprint-demo',
  requested_scopes: ['commerce:purchase', 'receipts:read', 'updates:read'],
  requested_audiences: ['https://divinr.ai/a2a'],
  requested_authority: { profileVersion: 2, network: 'regtest' },
  verification_uri: 'https://divinr.ai/connect/device',
  poll_interval_seconds: 5,
  status: 'pending',
  expires_at: new Date(Date.now() + 300_000).toISOString(),
  created_at: new Date().toISOString(),
  last_polled_at: null,
  approving_user_id: null,
  denied_at: null,
};

function errorCode(error: unknown, code: string): boolean {
  if (!(error instanceof HttpException)) return false;
  return (error.getResponse() as { code?: string }).code === code;
}

function serviceWith(
  rawQuery: (sql: string, params?: unknown[]) => Promise<{ data: unknown; error: null }>,
) {
  const transaction = { rawQuery };
  const db = {
    rawQuery,
    withTransaction: async <T>(
      work: (tx: typeof transaction) => Promise<T>,
    ) => work(transaction),
  };
  const device = new DeviceAuthorizationService(db as never);
  return new ConnectedAgentsService(
    db as never,
    device,
    new AgentCommerceRepository(),
  );
}

async function main(): Promise<void> {
  process.env.OAUTH_DEVICE_USER_CODE_HMAC_KEY = 'phase-4-test-hmac-key';

  const reviewCalls: string[] = [];
  const reviewService = serviceWith(async (sql) => {
    reviewCalls.push(sql);
    if (sql.includes('SELECT * FROM agent_commerce.oauth_device_authorizations')) {
      return { data: [AUTHORIZATION], error: null };
    }
    return { data: [], error: null };
  });
  const review = await reviewService.review(USER_ID, 'ABCD-EFGH');
  assert.equal(review.installationId, AUTHORIZATION.installation_request_id);
  assert.equal(review.dpopJkt, AUTHORIZATION.proposed_dpop_jkt);
  assert(!JSON.stringify(review).includes('device_code'));
  assert.match(reviewCalls[0], /user_id IS NULL/);
  assert.deepEqual(
    (review as { authority: Record<string, unknown> }).authority,
    AUTHORIZATION.requested_authority,
  );

  const hiddenService = serviceWith(async () => ({ data: [], error: null }));
  await assert.rejects(
    () => hiddenService.review(OTHER_USER_ID, 'ABCD-EFGH'),
    (error) => errorCode(error, 'RESOURCE_NOT_FOUND'),
  );

  const approvalSql: string[] = [];
  const approvalService = serviceWith(async (sql) => {
    approvalSql.push(sql);
    if (sql.includes('SELECT * FROM agent_commerce.oauth_device_authorizations')) {
      return { data: [AUTHORIZATION], error: null };
    }
    if (sql.includes('FROM agent_commerce.agent_installations')) {
      return { data: [], error: null };
    }
    if (sql.includes('FROM agent_commerce.security_audit_events')) {
      return { data: [], error: null };
    }
    return { data: [{ id: INSTALLATION_INTERNAL_ID }], error: null };
  });
  await assert.rejects(
    () => approvalService.approve(USER_ID, 'ABCD-EFGH', {
      confirmation: 'approve',
      schemaVersion: 2,
      installationId: AUTHORIZATION.installation_request_id,
      dpopJkt: AUTHORIZATION.proposed_dpop_jkt,
      scopes: AUTHORIZATION.requested_scopes,
      authorityProfileVersion: 2,
    }),
    (error) => errorCode(error, 'APPROVAL_INVALID'),
  );
  const approved = await approvalService.approve(USER_ID, 'ABCD-EFGH', {
    confirmation: 'APPROVE',
    schemaVersion: 2,
    installationId: AUTHORIZATION.installation_request_id,
    dpopJkt: AUTHORIZATION.proposed_dpop_jkt,
    scopes: AUTHORIZATION.requested_scopes,
    authorityProfileVersion: 2,
  });
  assert.equal(approved.status, 'approved');
  assert(approvalSql.some((sql) => sql.includes('INSERT INTO agent_commerce.agent_installations')));
  assert(approvalSql.some((sql) => sql.includes('INSERT INTO agent_commerce.agent_grants')));
  assert(approvalSql.some((sql) => sql.includes("SET status = 'approved'")));
  assert(approvalSql.some((sql) => sql.includes('INSERT INTO agent_commerce.security_audit_events')));

  const denialSql: string[] = [];
  const denialService = serviceWith(async (sql) => {
    denialSql.push(sql);
    if (sql.includes('SELECT * FROM agent_commerce.oauth_device_authorizations')) {
      return { data: [AUTHORIZATION], error: null };
    }
    if (sql.includes('FROM agent_commerce.security_audit_events')) {
      return { data: [], error: null };
    }
    return { data: [{ id: AUTHORIZATION.id }], error: null };
  });
  const denied = await denialService.deny(USER_ID, 'ABCD-EFGH', {
    confirmation: 'DENY',
    schemaVersion: 2,
    installationId: AUTHORIZATION.installation_request_id,
  });
  assert.equal(denied.status, 'denied');
  assert(denialSql.some((sql) => sql.includes("SET status = 'denied'")));

  const revokeSql: string[] = [];
  const revokeService = serviceWith(async (sql) => {
    revokeSql.push(sql);
    if (sql.includes('SELECT id, status FROM agent_commerce.agent_installations')) {
      return { data: [{ id: INSTALLATION_INTERNAL_ID, status: 'active' }], error: null };
    }
    if (sql.includes('SELECT id FROM agent_commerce.agent_grants')) {
      return { data: [{ id: '50000000-0000-0000-0000-000000000001' }], error: null };
    }
    if (sql.includes('FROM agent_commerce.security_audit_events')) {
      return { data: [], error: null };
    }
    return { data: [{ id: INSTALLATION_INTERNAL_ID }], error: null };
  });
  await assert.rejects(
    () => revokeService.revokeInstallation(USER_ID, AUTHORIZATION.installation_request_id, {
      confirmation: 'REVOKE',
      reason: 'Owner requested revocation',
    }),
    (error) => errorCode(error, 'APPROVAL_INVALID'),
  );
  const revoked = await revokeService.revokeInstallation(
    USER_ID,
    AUTHORIZATION.installation_request_id,
    {
      confirmation: 'REVOKE AGENT',
      reason: 'Owner requested revocation',
    },
  );
  assert.equal(revoked.status, 'revoked');
  assert(revokeSql.some((sql) => sql.includes('oauth_access_token_jtis')));
  assert(revokeSql.some((sql) => sql.includes('oauth_refresh_token_families')));
  assert(revokeSql.some((sql) => sql.includes('agent_commerce.agent_grants')));

  const listSql: Array<{ sql: string; params?: unknown[] }> = [];
  const ownershipService = serviceWith(async (sql, params) => {
    listSql.push({ sql, params });
    return { data: [], error: null };
  });
  await ownershipService.list(USER_ID);
  await assert.rejects(
    () => ownershipService.detail(OTHER_USER_ID, AUTHORIZATION.installation_request_id),
    (error) => errorCode(error, 'RESOURCE_NOT_FOUND'),
  );
  assert(listSql.every((entry) =>
    !entry.sql.includes('agent_commerce.agent_installations')
    || entry.params?.[0] === USER_ID
    || entry.params?.[0] === OTHER_USER_ID));

  console.log('Connected-agent owner boundary tests passed');
}

void main();
