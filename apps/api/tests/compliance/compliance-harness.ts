import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { strict as assert } from 'node:assert';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { RbacService } from '@orchestratorai/planes/rbac';
import { ObservabilityEventsService } from '@orchestratorai/planes/observability';
import { LLM_SERVICE, type LLMServiceProvider } from '@orchestratorai/planes/llm';
import type { ExecutionContext } from '@orchestrator-ai/transport-types';

type EnvMap = Record<string, string | undefined>;

export interface ComplianceSeed {
  runId: string;
  orgA: string;
  orgB: string;
  adminUserId: string;
  analystAUserId: string;
  analystBUserId: string;
  adminRoleId: string;
  analystRoleId: string;
  readDocsPermissionId: string;
  writeDocsPermissionId: string;
  createdReadPermission: boolean;
  createdWritePermission: boolean;
  docAId: string;
  docBId: string;
}

interface AppServices {
  db: DatabaseService;
  rbac: RbacService;
  observabilityEvents: ObservabilityEventsService;
  llm: LLMServiceProvider;
  get: <TInput = unknown, TOutput = TInput>(token: TInput) => TOutput;
  close: () => Promise<void>;
}

const DEFAULT_ENV: EnvMap = {
  API_PORT: '3100',
  DATABASE_URL:
    process.env.DATABASE_URL ||
    process.env.SUPABASE_DB_URL ||
    'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  DB_PROVIDER: 'supabase',
  LLM_PROVIDER: 'simplified',
  COMMERCIAL_LLM_PROVIDER: 'none',
  OPENSOURCE_LLM_PROVIDER: 'none',
  OBSERVABILITY_PROVIDER: 'supabase',
  CONFIG_PROVIDER: 'local',
  // The compliance harness seeds real RBAC roles/permissions/user_org_roles
  // for orgA and orgB and explicitly tests cross-tenant denial. The
  // repo-root .env enables MARKETS_DEV_AUTH_BYPASS=true for dev convenience,
  // which would short-circuit requireRead/requireWrite in markets.service
  // and let every cross-tenant call through. Force it off for the scope of
  // this harness so the seeded RBAC is actually enforced.
  // Set explicitly to 'false' (not undefined) — deleting it would let
  // dotenv re-inject the .env value during NestFactory boot, since
  // dotenv only fills missing vars by default.
  MARKETS_DEV_AUTH_BYPASS: 'false',
};

function applyEnv(overrides: EnvMap): () => void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return () => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

async function execSql(db: DatabaseService, sql: string): Promise<void> {
  const result = await db.rawQuery(sql);
  if (result.error) {
    throw new Error(result.error.message);
  }
}

async function expectOk(promise: Promise<{ error: { message: string } | null }>, label: string): Promise<void> {
  const result = await promise;
  if (result.error) {
    throw new Error(`${label}: ${result.error.message}`);
  }
}

export async function bootstrapComplianceApp(
  overrides: EnvMap = {},
): Promise<AppServices> {
  const restore = applyEnv({ ...DEFAULT_ENV, ...overrides });
  try {
    const app = await NestFactory.createApplicationContext(AppModule, {
      logger: ['error', 'warn'],
    });
    const db = app.get<DatabaseService>(DATABASE_SERVICE);
    const rbac = app.get(RbacService);
    const observabilityEvents = app.get(ObservabilityEventsService);
    const llm = app.get<LLMServiceProvider>(LLM_SERVICE);
    return {
      db,
      rbac,
      observabilityEvents,
      llm,
      get: <TInput = unknown, TOutput = TInput>(token: TInput): TOutput =>
        app.get(token) as TOutput,
      close: async () => {
        await app.close();
        restore();
      },
    };
  } catch (error) {
    restore();
    throw error;
  }
}

export async function assertBootFails(overrides: EnvMap): Promise<void> {
  const restore = applyEnv({ ...DEFAULT_ENV, ...overrides });
  try {
    await assert.rejects(async () => {
      const app = await NestFactory.createApplicationContext(AppModule, {
        logger: false,
      });
      await app.close();
    });
  } finally {
    restore();
  }
}

export async function ensureComplianceSchema(db: DatabaseService): Promise<void> {
  const setupSql = [
    `
    create schema if not exists authz;
    `,
    `
    create table if not exists authz.organizations (
      slug text primary key,
      name text not null
    );
    `,
    `
    create table if not exists authz.users (
      id text primary key,
      email text not null,
      display_name text,
      organization_slug text references authz.organizations(slug),
      status text not null default 'active',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    `,
    `
    create table if not exists authz.rbac_roles (
      id text primary key,
      name text unique not null,
      display_name text not null,
      description text,
      is_system boolean not null default false
    );
    `,
    `
    create table if not exists authz.rbac_permissions (
      id text primary key,
      name text unique not null,
      display_name text not null,
      description text,
      category text
    );
    `,
    `
    create table if not exists authz.rbac_role_permissions (
      role_id text not null references authz.rbac_roles(id) on delete cascade,
      permission_id text not null references authz.rbac_permissions(id) on delete cascade,
      primary key (role_id, permission_id)
    );
    `,
    `
    create table if not exists authz.rbac_user_org_roles (
      user_id text not null references authz.users(id) on delete cascade,
      organization_slug text not null references authz.organizations(slug) on delete cascade,
      role_id text not null references authz.rbac_roles(id) on delete cascade,
      assigned_by text,
      assigned_at timestamptz not null default now(),
      expires_at timestamptz,
      primary key (user_id, organization_slug, role_id)
    );
    `,
    `
    create table if not exists authz.rbac_audit_log (
      id bigserial primary key,
      action text not null,
      actor_id text not null,
      target_user_id text,
      target_role_id text,
      organization_slug text,
      details jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );
    `,
    `
    create table if not exists authz.compliance_documents (
      id text primary key,
      organization_slug text not null references authz.organizations(slug) on delete cascade,
      title text not null,
      body text not null,
      created_at timestamptz not null default now()
    );
    `,
    `
    create table if not exists public.observability_events (
      id bigserial primary key,
      source_app text not null,
      session_id text,
      hook_event_type text not null,
      user_id text,
      username text,
      conversation_id text,
      task_id text,
      agent_slug text,
      organization_slug text,
      mode text,
      status text,
      message text,
      progress integer,
      step text,
      sequence integer,
      total_steps integer,
      payload jsonb not null default '{}'::jsonb,
      timestamp bigint not null,
      created_at timestamptz not null default now()
    );
    `,
    `
    create table if not exists public.llm_usage (
      id bigserial primary key,
      run_id text not null,
      provider text not null,
      model text not null,
      tier text not null,
      cost numeric(16, 8),
      duration integer,
      input_tokens integer,
      output_tokens integer,
      status text,
      timestamp timestamptz,
      created_at timestamptz,
      user_id text,
      caller_type text,
      caller_name text,
      conversation_id text,
      organization_slug text
    );
    `,
    `
    create or replace function authz.rbac_has_permission(
      p_user_id text,
      p_organization_slug varchar,
      p_permission varchar,
      p_resource_type varchar default null,
      p_resource_id text default null
    )
    returns boolean
    language sql
    stable
    as $$
      select exists (
        select 1
        from authz.rbac_user_org_roles uor
        join authz.rbac_role_permissions rp on rp.role_id = uor.role_id
        join authz.rbac_permissions p on p.id = rp.permission_id
        where uor.user_id = p_user_id
          and uor.organization_slug = p_organization_slug
          and p.name = p_permission
          and (uor.expires_at is null or uor.expires_at > now())
      );
    $$;
    `,
    `
    create or replace function authz.secure_upsert_document(
      p_user_id text,
      p_organization_slug varchar,
      p_document_id text,
      p_title text,
      p_body text
    )
    returns text
    language plpgsql
    as $$
    begin
      if not authz.rbac_has_permission(
        p_user_id,
        p_organization_slug,
        'compliance.documents.write',
        null,
        null
      ) then
        return null;
      end if;

      insert into authz.compliance_documents (id, organization_slug, title, body)
      values (p_document_id, p_organization_slug, p_title, p_body)
      on conflict (id) do update
      set title = excluded.title,
          body = excluded.body
      where authz.compliance_documents.organization_slug = excluded.organization_slug;

      if found then
        return p_document_id;
      end if;

      return null;
    end;
    $$;
    `,
  ];

  for (const sql of setupSql) {
    await execSql(db, sql);
  }
}

export async function seedComplianceData(
  db: DatabaseService,
): Promise<ComplianceSeed> {
  const runId = `run_${Date.now()}`;
  const orgA = `${runId}_tenant_a`;
  const orgB = `${runId}_tenant_b`;
  const existingUsers = await db.rawQuery(
    `
    select id::text as id, email
    from authz.users
    order by created_at asc
    limit 3
    `,
  );
  if (existingUsers.error) {
    throw new Error(`seed users lookup: ${existingUsers.error.message}`);
  }
  const baseUsers = (existingUsers.data as Array<{ id: string; email: string }> | null) || [];
  if (baseUsers.length < 3) {
    throw new Error(
      'At least 3 records are required in authz.users to run compliance integration tests.',
    );
  }
  const adminUserId = baseUsers[0].id;
  const analystAUserId = baseUsers[1].id;
  const analystBUserId = baseUsers[2].id;
  const adminRoleId = randomUUID();
  const analystRoleId = randomUUID();
  let readDocsPermissionId = randomUUID();
  let writeDocsPermissionId = randomUUID();
  let createdReadPermission = false;
  let createdWritePermission = false;
  const docAId = randomUUID();
  const docBId = randomUUID();

  await expectOk(
    db.from('authz', 'organizations').upsert(
      [
        { slug: orgA, name: 'Tenant A' },
        { slug: orgB, name: 'Tenant B' },
      ],
      { onConflict: 'slug' },
    ),
    'seed organizations',
  );

  await expectOk(
    db.from('authz', 'rbac_roles').insert(
      [
        {
          id: adminRoleId,
          name: `${runId}:admin`,
          display_name: 'Compliance Admin',
        },
        {
          id: analystRoleId,
          name: `${runId}:analyst`,
          display_name: 'Compliance Analyst',
        },
      ],
    ),
    'seed roles',
  );

  const existingPermission = await db
    .from('authz', 'rbac_permissions')
    .select('id')
    .eq('name', 'compliance.documents.read')
    .maybeSingle();
  if (existingPermission.error) {
    throw new Error(`lookup permissions: ${existingPermission.error.message}`);
  }
  const existingPermissionRow = existingPermission.data as { id?: string } | null;
  if (existingPermissionRow?.id) {
    readDocsPermissionId = existingPermissionRow.id;
  } else {
    await expectOk(
      db.from('authz', 'rbac_permissions').insert({
        id: readDocsPermissionId,
        name: 'compliance.documents.read',
        display_name: 'Read Compliance Documents',
        category: 'compliance',
      }),
      'seed permissions',
    );
    createdReadPermission = true;
  }

  const existingWritePermission = await db
    .from('authz', 'rbac_permissions')
    .select('id')
    .eq('name', 'compliance.documents.write')
    .maybeSingle();
  if (existingWritePermission.error) {
    throw new Error(
      `lookup write permissions: ${existingWritePermission.error.message}`,
    );
  }
  const existingWritePermissionRow = existingWritePermission.data as
    | { id?: string }
    | null;
  if (existingWritePermissionRow?.id) {
    writeDocsPermissionId = existingWritePermissionRow.id;
  } else {
    await expectOk(
      db.from('authz', 'rbac_permissions').insert({
        id: writeDocsPermissionId,
        name: 'compliance.documents.write',
        display_name: 'Write Compliance Documents',
        category: 'compliance',
      }),
      'seed write permissions',
    );
    createdWritePermission = true;
  }

  // Markets RBAC permissions — seeded with deterministic ids so re-runs are
  // idempotent. The compliance smoke tests exercise MarketsService directly,
  // which requires markets.instruments.{read,write} via requireRead/requireWrite.
  // Without these, every markets call from a non-bypassed test path 403s.
  const marketsReadPermissionId = 'markets-instruments-read';
  const marketsWritePermissionId = 'markets-instruments-write';
  await expectOk(
    db.from('authz', 'rbac_permissions').upsert(
      [
        {
          id: marketsReadPermissionId,
          name: 'markets.instruments.read',
          display_name: 'Read Market Instruments',
          category: 'markets',
        },
        {
          id: marketsWritePermissionId,
          name: 'markets.instruments.write',
          display_name: 'Write Market Instruments',
          category: 'markets',
        },
      ],
      { onConflict: 'id' },
    ),
    'seed markets permissions',
  );

  await expectOk(
    db.from('authz', 'rbac_role_permissions').insert(
      [
        {
          role_id: adminRoleId,
          permission_id: readDocsPermissionId,
        },
        {
          role_id: analystRoleId,
          permission_id: readDocsPermissionId,
        },
        {
          role_id: adminRoleId,
          permission_id: writeDocsPermissionId,
        },
        // Admin gets full markets access; analyst gets read-only so the
        // cross-tenant denial test (analyst trying to write to orgB) hits
        // the write check, not a missing read permission.
        {
          role_id: adminRoleId,
          permission_id: marketsReadPermissionId,
        },
        {
          role_id: adminRoleId,
          permission_id: marketsWritePermissionId,
        },
        {
          role_id: analystRoleId,
          permission_id: marketsReadPermissionId,
        },
      ],
    ),
    'seed role permissions',
  );

  await expectOk(
    db.from('authz', 'rbac_user_org_roles').insert(
      [
        {
          user_id: adminUserId,
          organization_slug: orgA,
          role_id: adminRoleId,
          assigned_by: adminUserId,
        },
        {
          user_id: analystAUserId,
          organization_slug: orgA,
          role_id: analystRoleId,
          assigned_by: adminUserId,
        },
        {
          user_id: analystBUserId,
          organization_slug: orgB,
          role_id: analystRoleId,
          assigned_by: adminUserId,
        },
      ],
    ),
    'seed user role assignments',
  );

  await expectOk(
    db.from('authz', 'compliance_documents').upsert(
      [
        {
          id: docAId,
          organization_slug: orgA,
          title: 'Tenant A Compliance Evidence',
          body: 'A-only policy body',
        },
        {
          id: docBId,
          organization_slug: orgB,
          title: 'Tenant B Compliance Evidence',
          body: 'B-only policy body',
        },
      ],
      { onConflict: 'id' },
    ),
    'seed compliance documents',
  );

  return {
    runId,
    orgA,
    orgB,
    adminUserId,
    analystAUserId,
    analystBUserId,
    adminRoleId,
    analystRoleId,
    readDocsPermissionId,
    writeDocsPermissionId,
    createdReadPermission,
    createdWritePermission,
    docAId,
    docBId,
  };
}

export async function cleanupComplianceData(
  db: DatabaseService,
  seed: ComplianceSeed,
): Promise<void> {
  await db.rawQuery('delete from public.llm_usage where run_id like $1', [
    `${seed.runId}%`,
  ]);
  await db.rawQuery(
    'delete from public.observability_events where organization_slug in ($1, $2) or source_app = $3',
    [seed.orgA, seed.orgB, 'compliance-test'],
  );
  await db.rawQuery(
    "delete from authz.rbac_audit_log where organization_slug in ($1, $2) and (details->>'role_name' like $3)",
    [seed.orgA, seed.orgB, `${seed.runId}%`],
  );
  await db
    .from('authz', 'compliance_documents')
    .delete()
    .in('id', [seed.docAId, seed.docBId]);
  await db
    .from('authz', 'rbac_user_org_roles')
    .delete()
    .in('user_id', [seed.adminUserId, seed.analystAUserId, seed.analystBUserId]);
  await db
    .from('authz', 'rbac_role_permissions')
    .delete()
    .in('role_id', [seed.adminRoleId, seed.analystRoleId]);
  if (seed.createdReadPermission) {
    await db
      .from('authz', 'rbac_permissions')
      .delete()
      .eq('id', seed.readDocsPermissionId);
  }
  if (seed.createdWritePermission) {
    await db
      .from('authz', 'rbac_permissions')
      .delete()
      .eq('id', seed.writeDocsPermissionId);
  }
  await db
    .from('authz', 'rbac_roles')
    .delete()
    .in('id', [seed.adminRoleId, seed.analystRoleId]);
  await db.from('authz', 'organizations').delete().in('slug', [seed.orgA, seed.orgB]);
}

export function buildExecutionContext(seed: ComplianceSeed): ExecutionContext {
  return {
    conversationId: randomUUID(),
    userId: randomUUID(),
    orgSlug: seed.orgA,
    agentSlug: 'compliance-agent',
    agentType: 'system',
    provider: 'openrouter',
    model: 'gpt-4o-mini',
    sovereignMode: false,
  };
}

