-- Phase 9 G12 — seed minimum 3 rows in authz.users so the compliance integration
-- harness (apps/api/tests/compliance/compliance-harness.ts) can pick up base users
-- via `select id, email from authz.users order by created_at asc limit 3`.
-- Idempotent. Run with:
--   PGPASSWORD=postgres psql -h localhost -p 54322 -U postgres -d postgres \
--     -f apps/api/db/seed/2026-04-07-authz-users.sql

-- Grant Supabase API roles access to the authz schema so PostgREST
-- (used by the compliance harness via supabase-js .from('authz', ...))
-- can read/write. Idempotent.
grant usage on schema authz to anon, authenticated, service_role;
grant all privileges on all tables in schema authz to anon, authenticated, service_role;
grant all privileges on all sequences in schema authz to anon, authenticated, service_role;
grant execute on all functions in schema authz to anon, authenticated, service_role;
alter default privileges in schema authz grant all on tables to anon, authenticated, service_role;
alter default privileges in schema authz grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema authz grant execute on functions to anon, authenticated, service_role;

insert into authz.users (id, email, display_name)
values
  ('seed-user-alpha',     'admin@alpha-capital.demo',     'Alpha Capital Admin'),
  ('seed-user-steadfast', 'admin@steadfast-advisors.demo','Steadfast Advisors Admin'),
  ('seed-user-apex',      'admin@apex-quant.demo',        'Apex Quant Admin')
on conflict (id) do nothing;
