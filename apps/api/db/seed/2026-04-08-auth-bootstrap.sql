-- Effort: auth-bootstrap (2026-04-08)
--
-- Bootstraps the authz schema so MARKETS_DEV_AUTH_BYPASS can be turned off.
-- Idempotent; safe to re-run.
--
-- Creates:
--   * 3 RBAC roles: super-admin, owner, member
--     (note hyphen — RbacService.isSuperAdmin() hard-codes name='super-admin')
--   * Both existing markets permissions granted to all 3 roles
--   * '*' sentinel organization for global super-admin grants
--   * personal-golfergeek and personal-demo-user organizations
--   * authz.users rows linking the 2 real Supabase auth uuids to email
--   * Role grants:
--       golfergeek: owner of personal-golfergeek + super-admin globally ('*')
--       demo-user: owner of personal-demo-user
--
-- Apply with:
--   PGPASSWORD=postgres psql -h localhost -p 54322 -U postgres -d postgres \
--     -f apps/api/db/seed/2026-04-08-auth-bootstrap.sql

-- 1. Roles
insert into authz.rbac_roles (id, name, display_name, description, is_system) values
  ('role-super-admin', 'super-admin', 'Super Admin', 'Full access across all organizations',           true),
  ('role-owner',       'owner',       'Owner',       'Owns and manages an organization',               true),
  ('role-member',      'member',      'Member',      'Standard member of an organization',             true)
on conflict (id) do nothing;

-- 2. Grant the two existing markets permissions to all three roles.
--    (Once more permissions exist, super-admin/owner/member will diverge meaningfully.)
insert into authz.rbac_role_permissions (role_id, permission_id) values
  ('role-super-admin', 'markets-instruments-read'),
  ('role-super-admin', 'markets-instruments-write'),
  ('role-owner',       'markets-instruments-read'),
  ('role-owner',       'markets-instruments-write'),
  ('role-member',      'markets-instruments-read'),
  ('role-member',      'markets-instruments-write')
on conflict (role_id, permission_id) do nothing;

-- 3. Sentinel organization for global super-admin grants.
--    rbac_user_org_roles.organization_slug has an FK to authz.organizations(slug),
--    so the wildcard '*' must exist as an actual row.
insert into authz.organizations (slug, name) values
  ('*',                   'Global'),
  ('personal-golfergeek', 'GolferGeek (Personal)'),
  ('personal-demo-user',  'Demo User (Personal)')
on conflict (slug) do nothing;

-- 4. Insert authz.users rows whose id is the Supabase auth.users uuid.
--    This is the FK target for rbac_user_org_roles.user_id.
insert into authz.users (id, email, display_name, organization_slug)
select id::text, email, split_part(email, '@', 1), null
from auth.users
where email in ('golfergeek@orchestratorai.io', 'demo-user@orchestratorai.io')
on conflict (id) do nothing;

-- 5. Role grants — golfergeek
--
-- Notes on super-admin:
--   * The '*' grant is forward-prep. The current authz.rbac_has_permission()
--     function joins strictly on organization_slug, so it does not honor the
--     wildcard. isSuperAdmin() does, but markets does not call it.
--   * To actually have super-admin access on a concrete org, you must grant
--     the role on that org explicitly. New orgs need the grant added manually.
with gg as (
  select id::text as user_id from auth.users where email = 'golfergeek@orchestratorai.io'
)
insert into authz.rbac_user_org_roles (user_id, organization_slug, role_id, assigned_by)
select gg.user_id, 'personal-golfergeek', 'role-owner',       'bootstrap' from gg
union all
select gg.user_id, 'personal-golfergeek', 'role-super-admin', 'bootstrap' from gg
union all
select gg.user_id, 'personal-demo-user',  'role-super-admin', 'bootstrap' from gg
union all
select gg.user_id, '*',                   'role-super-admin', 'bootstrap' from gg
on conflict (user_id, organization_slug, role_id) do nothing;

-- 6. Role grants — demo user
with du as (
  select id::text as user_id from auth.users where email = 'demo-user@orchestratorai.io'
)
insert into authz.rbac_user_org_roles (user_id, organization_slug, role_id, assigned_by)
select du.user_id, 'personal-demo-user', 'role-owner', 'bootstrap' from du
on conflict (user_id, organization_slug, role_id) do nothing;
