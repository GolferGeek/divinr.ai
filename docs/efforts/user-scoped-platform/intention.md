# Effort: User-Scoped Platform

## Problem

Every table, query, service, controller endpoint, and frontend call in divinr.ai is scoped by `organization_slug`. This was inherited from the Orchestrator AI multi-tenant architecture. But divinr.ai is a B2C product — individual users subscribe, pick instruments, build analysts, and get personalized experiences. There is no multi-org use case.

The org layer adds friction everywhere:
- **28 backend service files** reference `organization_slug` across ~400+ occurrences
- **~40 database tables** have an `organization_slug` column
- **7 frontend files** pass `organizationSlug` on every API call
- Every controller endpoint resolves org from query/body/header params
- RBAC checks are per-org (`hasPermission(userId, orgSlug, action)`)
- The frontend stores `divinr_org` in localStorage and sends it on every request

Meanwhile, the product direction is per-user: $20/mo per user, per-user instrument subscriptions, per-user analyst affinity, per-user notifications. Building user-facing features on top of the org abstraction means every new feature has to thread `organizationSlug` through for no reason.

## Intention

Remove the `organization_slug` scoping layer and replace it with `user_id`-based ownership. Shared platform resources (base analysts, base instruments, base sources) become system-owned. User-created resources are owned by the user who created them.

## Scope

### Database Layer
- **System-owned resources**: Base analysts, base instruments, base sources remain accessible to all users. Identified by a sentinel like `owner_type = 'system'` or a null `user_id`.
- **User-owned resources**: Custom instruments, custom analysts, custom sources belong to a user. Queries filter by `user_id` instead of `organization_slug`.
- **Shared result tables**: Predictions, risk debates, evaluations, trade recommendations — these reference instruments and analysts which are now either system or user-owned. Access control follows from ownership of the parent resource.
- **Migration strategy**: For each table, either drop `organization_slug` (if it's just a filter) or replace it with `user_id` (if it represents ownership). Additive first (add `user_id` columns), then remove `organization_slug` after cutover.

### Auth & RBAC Layer
- Replace org-based RBAC (`hasPermission(userId, orgSlug, action)`) with user-based access control.
- Roles simplify: `admin` (platform admin), `subscriber` (paying user), `beta_reader` (read-only invited user).
- JWT still carries `user_id`. Drop org resolution from the auth flow.
- `resolveIdentity()` in the controller simplifies to just extracting `userId` from the JWT.

### API Layer
- Remove `organizationSlug` query/body parameter from all endpoints.
- Remove `x-org-slug` header handling.
- Remove `resolveIdentity()` org resolution — just use `user.id` from the JWT.
- Service methods drop the `organizationSlug` parameter.

### Frontend Layer
- Remove `divinr_org` from localStorage and tenant store.
- Remove `organizationSlug` from `useApi()` appendOrg/payload injection.
- Remove org selection from login flow.

### Schema Service
- Update `ensureSchema()` DDL: remove `organization_slug` from table definitions where it's just a filter. Add `user_id` where it represents ownership.
- Update all indexes that include `organization_slug`.

## Success Criteria

- No reference to `organization_slug` in any service, controller, or frontend file.
- All queries scope by `user_id` for user-owned resources or are unscoped for system resources.
- Auth extracts `user_id` from JWT — no org resolution needed.
- Frontend makes API calls without passing `organizationSlug`.
- All existing tests pass after migration.
- Base analysts, instruments, and sources remain accessible to all users.
- User-created resources are private to the creating user.

## Out of Scope

- Team/group sharing (if needed later, add a group layer on top of users).
- Billing integration (that's power-user-expansion).
- New user-facing features (affinity, notifications) — those come after this cleanup.

## Phasing Strategy

This is a large effort. Suggested phasing to keep each phase independently validatable:

1. **Schema migration** — Add `user_id` columns alongside `organization_slug`. Backfill from existing data. Update `ensureSchema()`.
2. **Service layer** — Update all services to accept `userId` instead of `organizationSlug`. Dual-read period where both work.
3. **Controller & auth** — Simplify `resolveIdentity()`, drop org params from endpoints, update guards.
4. **Frontend** — Remove org from tenant store, useApi, localStorage, login flow.
5. **Cleanup** — Drop `organization_slug` columns, remove dual-read code, update all tests.

Each phase should leave the system functional. The dual-read period (phases 2-3) means we don't have to do a big-bang cutover.
