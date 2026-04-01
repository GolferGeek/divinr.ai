# API Compliance Integration Tests

These tests run against a real Supabase/Postgres database through the `DATABASE_SERVICE` abstraction.

## What is verified

- tenant isolation for compliance documents
- RBAC allow/deny behavior and role assignment lifecycle
- RBAC audit evidence persistence
- observability event persistence with tenant context
- LLM routing event evidence persistence
- fail-closed provider configuration for DB, LLM, and config planes
- cross-tenant regression matrix and high-volume parallel boundary checks
- repeated entitlement grant/revoke stability and audit capture
- mutation safety for cross-tenant write attempts and row integrity

## Required environment

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY`
- `DATABASE_URL` (for raw SQL setup/teardown)

## Run

From repo root:

`pnpm -w run test:compliance`

From API package only:

- `pnpm run test:compliance:core`
- `pnpm run test:compliance:boundary`
- `pnpm run test:compliance:mutation`
