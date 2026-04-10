-- Effort: auth-bootstrap (2026-04-08)
--
-- Bootstraps the authz schema so MARKETS_DEV_AUTH_BYPASS can be turned off.
-- Idempotent; safe to re-run.
--
-- Creates:
--   * 3 RBAC roles: super-admin, owner, member
--     (note hyphen — RbacService.isSuperAdmin() hard-codes name='super-admin')
--   * Both existing markets permissions granted to all 3 roles
--   * authz.users rows linking the 2 real Supabase auth uuids to email
--   * Role grants:
--       golfergeek: owner of personal-golfergeek + super-admin globally ('*')
--       demo-user: owner of personal-demo-user
--
-- Apply with:
--   PGPASSWORD=postgres psql -h localhost -p 54322 -U postgres -d postgres \
--     -f apps/api/db/seed/2026-04-08-auth-bootstrap.sql

-- 1. Roles (legacy org-scoped + new user-scoped)
insert into authz.rbac_roles (id, name, display_name, description, is_system) values
  ('role-super-admin', 'super-admin', 'Super Admin', 'Full access across all organizations',           true),
  ('role-owner',       'owner',       'Owner',       'Owns and manages an organization',               true),
  ('role-member',      'member',      'Member',      'Standard member of an organization',             true),
  ('role-beta-reader', 'beta_reader', 'Beta Reader', 'Read-only invited user',                        true),
  ('role-admin',       'admin',       'Admin',       'Platform admin — full access',                   true),
  ('role-subscriber',  'subscriber',  'Subscriber',  'Paying user — read + write own resources',       true)
on conflict (id) do nothing;

-- 2. Grant the two existing markets permissions to all roles.
insert into authz.rbac_role_permissions (role_id, permission_id) values
  ('role-super-admin', 'markets-instruments-read'),
  ('role-super-admin', 'markets-instruments-write'),
  ('role-owner',       'markets-instruments-read'),
  ('role-owner',       'markets-instruments-write'),
  ('role-member',      'markets-instruments-read'),
  ('role-member',      'markets-instruments-write'),
  ('role-beta-reader', 'markets-instruments-read'),
  ('role-admin',       'markets-instruments-read'),
  ('role-admin',       'markets-instruments-write'),
  ('role-subscriber',  'markets-instruments-read'),
  ('role-subscriber',  'markets-instruments-write')
on conflict (role_id, permission_id) do nothing;

-- 3. (organizations table dropped — no longer needed)

-- 4. Insert authz.users rows whose id is the Supabase auth.users uuid.
insert into authz.users (id, email, display_name)
select id::text, email, split_part(email, '@', 1)
from auth.users
where email in ('golfergeek@orchestratorai.io', 'demo-user@orchestratorai.io')
on conflict (id) do nothing;

-- 5. Role grants — golfergeek
--
-- Notes on super-admin:
--   * Org-scoping removed in Phase 5 of user-scoped-platform effort.
--     rbac_has_permission() now checks (user_id, role_id) only.
with gg as (
  select id::text as user_id from auth.users where email = 'golfergeek@orchestratorai.io'
)
insert into authz.rbac_user_roles (user_id, role_id, assigned_by)
select gg.user_id, 'role-owner',       'bootstrap' from gg
union all
select gg.user_id, 'role-super-admin', 'bootstrap' from gg
on conflict (user_id, role_id) do nothing;

-- 6. rbac_has_permission RPC — user-scoped only (no org_slug parameter).
CREATE OR REPLACE FUNCTION authz.rbac_has_permission(
  p_user_id text,
  p_permission text,
  p_resource_type text DEFAULT NULL,
  p_resource_id text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM authz.rbac_user_roles ur
    JOIN authz.rbac_role_permissions rp ON rp.role_id = ur.role_id
    JOIN authz.rbac_permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = p_user_id
      AND p.name = p_permission
      AND (ur.expires_at IS NULL OR ur.expires_at > now())
  );
END;
$$;

-- 7. Role grants — demo user
with du as (
  select id::text as user_id from auth.users where email = 'demo-user@orchestratorai.io'
)
insert into authz.rbac_user_roles (user_id, role_id, assigned_by)
select du.user_id, 'role-owner', 'bootstrap' from du
on conflict (user_id, role_id) do nothing;
