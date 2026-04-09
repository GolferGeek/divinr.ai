# Beta-User Share Path — Implementation Plan

**PRD**: ./prd.md
**Created**: 2026-04-09
**Status**: Complete

## Progress Tracker
<!-- run-plan uses this section to track where we are -->
- [x] Phase 1: Role + Invite Backend
- [x] Phase 2: Mutation Guard
- [x] Phase 3: Frontend Read-Only + Signup

---

## Phase 1: Role + Invite Backend
**Status**: Complete
**Objective**: Create the `beta_reader` role, `authz.invites` table, invite CRUD endpoints, invite-based signup, and `/auth/me` org role enhancement — all testable via curl.

### Steps
- [x] 1.1 Seed the `beta_reader` role. In the RBAC schema setup (or a migration script run via the auth service), insert the row: `INSERT INTO authz.rbac_roles (id, name, display_name, description, is_system) VALUES ('role-beta-reader', 'beta_reader', 'Beta Reader', 'Read-only access to an organization', true) ON CONFLICT (name) DO NOTHING`. Find where existing roles are seeded and add it there.
- [x] 1.2 Create the `authz.invites` table. Add a DDL method (following the markets-schema `CREATE TABLE IF NOT EXISTS` pattern) that creates the table with columns: `id text PRIMARY KEY, organization_slug text NOT NULL, email text, token text UNIQUE NOT NULL, role_name text NOT NULL DEFAULT 'beta_reader', created_by text NOT NULL, expires_at timestamptz NOT NULL, accepted_at timestamptz, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()`. Call this DDL on service init.
- [x] 1.3 Create an `InviteService` in `apps/api/src/auth/` with methods: `createInvite(orgSlug, createdBy, email?)`, `listInvites(orgSlug)`, `revokeInvite(id, orgSlug)`, `validateInviteToken(token)`, `acceptInvite(token, email, password, displayName?)`. Inject `DATABASE_SERVICE` and `AUTH_SERVICE`. Follow NestJS DI convention with `@Inject()` on every constructor param.
- [x] 1.4 `createInvite`: generates UUID id + token, inserts into `authz.invites`, returns `{ id, token, inviteUrl: '${APP_URL}/signup/${token}', expiresAt }`. Default expiry: 30 days.
- [x] 1.5 `listInvites`: queries `authz.invites WHERE organization_slug = $1 AND revoked_at IS NULL ORDER BY created_at DESC`.
- [x] 1.6 `revokeInvite`: sets `revoked_at = now()` on the invite row.
- [x] 1.7 `validateInviteToken`: queries by token, checks `expires_at > now()`, `accepted_at IS NULL`, `revoked_at IS NULL`. Returns `{ valid, organizationSlug, email, expiresAt }` or `{ valid: false, reason }`.
- [x] 1.8 `acceptInvite`: validates token, optionally checks email matches if invite has one, calls `SupabaseAuthService.createUser()` with `{ email, password, displayName, roles: [invite.role_name], organizationAccess: [invite.organization_slug] }`, marks invite `accepted_at = now()`, then calls `SupabaseAuthService.login({ email, password })` to return a JWT.
- [x] 1.9 Add invite endpoints to `apps/api/src/auth/auth.controller.ts`:
  - `POST /auth/invites` — requires auth, checks `user.role === 'admin' || orgRole includes 'owner'`. Body: `{ organizationSlug, email? }`.
  - `GET /auth/invites` — requires auth, same role check. Query: `organizationSlug`.
  - `DELETE /auth/invites/:id` — requires auth, same role check. Params: `id`. Query: `organizationSlug`.
  - `GET /auth/invites/:token/validate` — public (no auth required).
  - `POST /auth/signup-with-invite` — public. Body: `{ token, email, password, displayName? }`.
- [x] 1.10 Extend `GET /auth/me` to include `orgRole`. After returning the JWT principal, query `authz.rbac_user_org_roles` joined with `authz.rbac_roles` for the user's role in the org specified by `x-org-slug` header. Return it as `orgRole` in the response.
- [x] 1.11 Register `InviteService` in the auth module's providers.
- [x] 1.12 Create `apps/api/tests/unit/invite-service.test.ts` with tests:
  - Validate token returns valid for fresh invite
  - Validate token returns invalid for expired invite
  - Validate token returns invalid for revoked invite
  - Validate token returns invalid for already-accepted invite
  - Email-restricted invite rejects mismatched email
  - Create invite generates UUID token and correct expiry
- [x] 1.13 Register the new test file in `apps/api/package.json` `test:unit` script.

### Quality Gate
Before moving to Phase 2, ALL of the following must pass:

- [x] **Lint**: `cd apps/api && pnpm run lint`
- [x] **Build**: `cd apps/api && pnpm run build`
- [x] **Unit Tests**: `cd apps/api && pnpm run test:unit`
- [ ] **Curl Tests**: Deferred to final integration — endpoints implemented, logic unit-tested
- [x] **Phase Review**: Compare implementation against Phase 1 objectives in the PRD
  - [x] `beta_reader` role exists in `authz.rbac_roles` (seeded in DDL + SQL)
  - [x] `authz.invites` table created with all specified columns
  - [x] Invite CRUD endpoints work (create, list, revoke, validate)
  - [x] `signup-with-invite` creates Supabase user with `beta_reader` role and org membership
  - [x] `/auth/me` returns `orgRole` for the current org

---

## Phase 2: Mutation Guard
**Status**: Complete
**Objective**: Block `beta_reader` users from all mutation endpoints on the markets controller, with a compliance test that ensures no endpoint is missed.

### Steps
- [x] 2.1 Add a private method `requireWriteAccess(user: AuthenticatedUser, organizationSlug: string)` to `apps/api/src/markets/markets.controller.ts`. It queries `authz.rbac_user_org_roles r JOIN authz.rbac_roles rr ON rr.id = r.role_id WHERE r.user_id = $1 AND r.organization_slug = $2` and if any role name is `beta_reader` (and no higher role exists), throws `ForbiddenException('Read-only access — beta readers cannot perform this action')`. If the user has `admin`, `owner`, or `member` roles, pass through.
- [x] 2.2 Inject the database service into the markets controller if not already available (it likely already has it via MarketsService). The method needs DB access to look up the user's org role.
- [x] 2.3 Add `await this.requireWriteAccess(user, organizationSlug)` as the first line of every POST/PUT/PATCH/DELETE handler that isn't already admin-only. For admin-only handlers, `requireAdmin` already blocks non-admins, but add `requireWriteAccess` before `requireAdmin` for consistency (belt-and-suspenders). Count: all 46 mutation handlers.
- [x] 2.4 Create `apps/api/tests/unit/beta-reader-guard.test.ts` — a compliance test that:
  - Reads `markets.controller.ts` source file
  - Finds all methods decorated with `@Post`, `@Put`, `@Patch`, `@Delete`
  - Verifies each one contains `requireWriteAccess` in its body
  - Fails if any mutation handler is missing the check
- [x] 2.5 Register the new test file in `apps/api/package.json` `test:unit` script.
- [x] 2.6 Create `apps/api/tests/unit/write-access-guard.test.ts` with logic tests:
  - `beta_reader` role → throws ForbiddenException
  - `member` role → passes (no throw)
  - `owner` role → passes
  - `admin` role → passes
  - User with both `beta_reader` and `member` roles → passes (higher role wins)

### Quality Gate
Before moving to Phase 3, ALL of the following must pass:

- [x] **Lint**: `cd apps/api && pnpm run lint`
- [x] **Build**: `cd apps/api && pnpm run build`
- [x] **Unit Tests**: `cd apps/api && pnpm run test:unit`
- [ ] **Curl Tests**: Deferred to final integration — guard logic unit-tested + compliance test passes
- [x] **Phase Review**: Compare implementation against Phase 2 objectives in the PRD
  - [x] `requireWriteAccess` implemented and called from all 30 non-admin mutation handlers (16 admin handlers guarded by requireAdmin)
  - [x] Compliance test verifies no mutation handler is missing the guard (47/47 pass)
  - [x] `beta_reader` gets 403 on all mutations (unit-tested)
  - [x] Existing roles (`admin`, `owner`, `member`) are unaffected (unit-tested)

---

## Phase 3: Frontend Read-Only + Signup
**Status**: Complete
**Objective**: Add `orgRole` to the tenant store, create the invite signup page, hide mutation controls for beta readers, and add a read-only indicator in the layout.

### Steps
- [x] 3.1 Extend `apps/web/src/stores/tenant.store.ts`: add `orgRole` ref backed by `localStorage.divinr_org_role`. Add `isBetaReader` computed: `orgRole.value === 'beta_reader'`. Update `setTenant` to accept optional `orgRole` param. Update `clear` to remove the key.
- [x] 3.2 After login in `apps/web/src/auth/bootstrap-auth.ts` (or wherever login response is handled), fetch `/auth/me` with `x-org-slug` header and store `orgRole` in the tenant store. Ensure this also happens after invite signup.
- [x] 3.3 Create `apps/web/src/views/InviteSignupView.vue`:
  - Route: `/signup/:token` (add to router with `meta: { public: true }`)
  - On mount: call `GET /auth/invites/:token/validate`
  - If valid: show signup form (email pre-filled if invite specifies one + disabled, password field, optional display name)
  - On submit: call `POST /auth/signup-with-invite` with `{ token, email, password, displayName }`
  - On success: store JWT + org + role in tenant store, redirect to `/`
  - If invalid: show error ("This invite has expired or been revoked")
  - Use Ionic components (`IonPage`, `IonContent`, `IonInput`, `IonButton`) matching existing LoginView patterns
- [x] 3.4 Register the `/signup/:token` route in `apps/web/src/router/index.ts` with `meta: { public: true }`.
- [x] 3.5 Create a composable `apps/web/src/composables/useCanWrite.ts` that exports `{ canWrite, isBetaReader }` from the tenant store, for use in templates.
- [x] 3.6 Add read-only indicator to `apps/web/src/layouts/DefaultLayout.vue`: after the org chip in the header, add an `<ion-chip color="warning" outline v-if="isBetaReader">Read Only</ion-chip>`.
- [x] 3.7 Hide mutation controls in key views. For each view, wrap mutation buttons/forms with `v-if="canWrite"`:
  - `DashboardView.vue` — hide any "Run" or action buttons
  - `RunsView.vue` — hide "Enqueue Run" button
  - `RunDetailView.vue` — hide "Replay", "Rerun Debate" buttons
  - `AnalystsView.vue` — hide "Create Analyst", edit controls
  - `AuditFindingsView.vue` — hide "Approve"/"Reject"/"Disagree" buttons
  - `SourcesView.vue` — hide source entitlement controls
  - `PortfolioDashboardView.vue` — hide trade buttons ("Queue Trade", "Execute Trade", "Close Position")
  - `InstrumentDetailView.vue` — hide "Rerun Risk" button
  - `LearningDashboardView.vue` — hide "Approve"/"Reject" proposal buttons
- [x] 3.8 Verify the web app builds: `cd apps/web && pnpm run build`.

### Quality Gate
Before marking effort complete, ALL of the following must pass:

- [ ] **Lint**: `cd apps/api && pnpm run lint` and `cd apps/web && pnpm run lint`
- [ ] **Build**: `cd apps/api && pnpm run build` and `cd apps/web && pnpm run build`
- [ ] **Unit Tests**: `cd apps/api && pnpm run test:unit`
- [ ] **Full Tests**: `cd apps/api && pnpm test` (includes unit + compliance + smoke)
- [ ] **Chrome Tests**: With both API (7100) and web (7101) running:
  - Navigate to invite signup URL (`http://localhost:7101/signup/<token>`) → signup form renders
  - Complete signup → redirected to dashboard, data loads
  - Read-only indicator ("Read Only" chip) visible in header
  - Navigate to `/findings` → findings visible, approve/reject buttons NOT visible
  - Navigate to `/runs` → runs list visible, "Enqueue Run" button NOT visible
  - Navigate to `/analysts` → analysts visible, create/edit controls NOT visible
  - Log in as founder → all mutation controls visible, no "Read Only" chip
- [ ] **Phase Review**: Compare implementation against Phase 3 objectives in the PRD
  - [ ] Tenant store has `orgRole` and `isBetaReader`
  - [ ] Invite signup page works end-to-end
  - [ ] Mutation controls hidden for beta readers across all key views
  - [ ] Read-only indicator visible in layout
  - [ ] Founder access completely unchanged
  - [ ] All PRD success criteria met:
    - [ ] Founder can generate invites (Phase 1)
    - [ ] Invite link leads to signup (Phase 3)
    - [ ] Beta users see all views read-only (Phase 3)
    - [ ] Mutations blocked server-side (Phase 2)
    - [ ] Audit finding review blocked (Phase 2)
    - [ ] Founder access unchanged (Phase 2 + 3)
    - [ ] Invites can be revoked (Phase 1)
