# Beta-User Share Path — Product Requirements Document

## 1. Overview

The explainability loop is complete — analysts predict, evaluations score, reasoning surfaces, contracts are audited, the meta-loop learns — but only the founder has ever seen it. This effort opens the system to external beta users via a lightweight invite flow. The founder generates invite links; recipients create accounts and get read-only access to all views, scoped to the founder's organization. No anonymous access, no self-service signup, no UI redesign.

## 2. Goals & Success Criteria

| Goal | Measurable Criterion |
|------|---------------------|
| Founder can generate invites | `POST /api/auth/invites` creates an invite record and returns a URL |
| Invite link leads to signup | Visiting the link opens a signup form; completing it creates a Supabase account with `beta_reader` role and org membership |
| Beta users see all views read-only | All GET endpoints return data for beta_reader users scoped to the invited org; all frontend views render normally |
| Mutations are blocked | All POST/PUT/PATCH/DELETE endpoints on `/markets/*` reject `beta_reader` users with 403 |
| Audit finding review is blocked | `POST /markets/audit/findings/:id/review` rejects `beta_reader` — findings are view-only |
| Founder access unchanged | `admin`/`owner`/`member` roles continue to work exactly as before |
| Invites can be revoked | Founder can remove a user from the org, revoking all access |

## 3. User Stories / Use Cases

**Founder:**
- I want to send a link to a beta tester so they can see what Divinr produces and give me feedback.
- I want to revoke access if someone shouldn't have it anymore.
- I don't want beta users to trigger runs, modify analysts, trade, or accept/reject audit findings.

**Beta user:**
- I receive a link, create an account with email/password, and immediately see the dashboard.
- I can browse predictions, drill into reasoning, view calibration, read audit findings.
- I understand I'm in read-only mode — mutation controls are hidden or disabled.

## 4. Technical Requirements

### 4.1 Data Model Changes

**New table: `authz.invites`**

| Column | Type | Purpose |
|--------|------|---------|
| `id` | text (UUID) | Primary key |
| `organization_slug` | text | Which org the invite grants access to |
| `email` | text (nullable) | Optional: restrict invite to a specific email |
| `token` | text (UUID) | Unique token embedded in the invite URL |
| `role_name` | text | Role to assign on signup (default: `beta_reader`) |
| `created_by` | text | User ID of the founder who created it |
| `expires_at` | timestamptz | Expiry (default: 30 days from creation) |
| `accepted_at` | timestamptz (nullable) | When the invite was used |
| `revoked_at` | timestamptz (nullable) | When the invite was revoked |
| `created_at` | timestamptz | Timestamp |

**New role row in `authz.rbac_roles`:**

```sql
INSERT INTO authz.rbac_roles (id, name, display_name, description, is_system)
VALUES ('role-beta-reader', 'beta_reader', 'Beta Reader', 'Read-only access to an organization', true);
```

### 4.2 API Changes

#### Invite Management (new endpoints on auth controller)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/auth/invites` | admin/owner | Create invite. Body: `{ organizationSlug, email? }`. Returns: `{ id, token, inviteUrl, expiresAt }` |
| GET | `/auth/invites` | admin/owner | List invites for the org. Query: `organizationSlug`. Returns array of invite records |
| DELETE | `/auth/invites/:id` | admin/owner | Revoke an invite (sets `revoked_at`) |
| GET | `/auth/invites/:token/validate` | public | Validate invite token. Returns `{ valid, organizationSlug, email?, expiresAt }` — used by the signup form |

#### Invite Signup (new endpoint)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/auth/signup-with-invite` | public | Body: `{ token, email, password, displayName? }`. Creates Supabase user, assigns `beta_reader` role + org, marks invite accepted. Returns `TokenResponseDto` (auto-login) |

#### User Removal (uses existing RBAC endpoint)

- `DELETE /api/rbac/users/:userId/roles/beta_reader?organizationSlug=...` — removes org access (already exists in RBAC controller)

#### Mutation Guard on Markets Controller

Add a `requireWriteAccess(user)` check to all POST/PUT/PATCH/DELETE handlers in `markets.controller.ts`. This method:
1. Resolves the user's role for the current org (via the JWT claims or a lightweight DB lookup)
2. If role is `beta_reader`, throws `ForbiddenException('Read-only access')`
3. All other roles pass through (backward compatible)

Implementation: a private method on the controller, called at the top of each mutation handler — same pattern as `requireAdmin()`. This avoids a new guard/interceptor and keeps the change localized.

#### `/auth/me` Enhancement

Extend the `/auth/me` response to include the user's role for the current org:

```typescript
{
  id: string;
  email: string;
  role: string;           // existing JWT role
  orgRole: string | null; // 'admin' | 'owner' | 'member' | 'beta_reader' — from rbac_user_org_roles
}
```

The frontend uses `orgRole` to determine read-only state.

### 4.3 Frontend Changes

#### Tenant Store Extension

Add `orgRole` to `tenant.store.ts`:
- Fetched from `/auth/me` after login (or invite signup)
- Stored in `localStorage.divinr_org_role`
- Exposed as `isBetaReader` computed: `orgRole === 'beta_reader'`

#### Read-Only UI Enforcement

When `isBetaReader` is true:
- **Hide** mutation buttons/controls across all views (e.g., "Enqueue Run", "Create Analyst", "Accept/Reject" on findings, trade buttons)
- **Show** a subtle read-only indicator in the layout (e.g., "Beta Reader — Read Only" in the header or sidebar)
- **Do NOT** hide navigation — beta users can access all routes and all views

Implementation: use a `v-if="!isBetaReader"` (or a shared composable `useCanWrite()`) on mutation controls. This is a view-layer change — no new components needed.

#### Invite Signup Page

New route: `/signup/:token`
- Validates the token via `GET /auth/invites/:token/validate`
- If valid: shows signup form (email pre-filled if invite has one, password, display name)
- On submit: calls `POST /auth/signup-with-invite` → auto-login → redirect to dashboard
- If invalid/expired/revoked: shows error message with link to contact the founder

### 4.4 Infrastructure Requirements

None. Supabase is already running. No new services, no new external dependencies.

## 5. Non-Functional Requirements

- **Security**: Invite tokens are UUIDs (128-bit random). Expired and revoked invites cannot be used. `beta_reader` enforcement is server-side — frontend hiding is UX, not security.
- **Backward compatibility**: No changes to existing auth flows. Existing users keep their roles. The `requireWriteAccess` check only blocks `beta_reader` — all other roles pass.
- **Performance**: Role lookup on mutation endpoints adds one DB query per request. For read endpoints (the majority of beta user traffic), no additional queries.
- **Invite limits**: No hard limit on invites. The founder manages this manually. Can add limits later if needed.

## 6. Out of Scope

- **Anonymous/public share links** — beta users must have accounts
- **Full RBAC overhaul** — two functional roles only: write-capable (admin/owner/member) and read-only (beta_reader)
- **Self-service registration** — no open signup page; invite required
- **UI redesign** — beta users see the exact same views
- **Email notifications** — the founder shares the invite link manually (email integration is future)
- **Magic link auth** — email/password only for now; magic link can be added later
- **Per-view permission granularity** — beta_reader sees everything; no view-level restrictions

## 7. Dependencies & Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Missing a mutation endpoint in `requireWriteAccess` | Beta user can trigger a mutation | Systematic audit: grep all POST/PUT/PATCH/DELETE handlers; add test that verifies every mutation handler calls `requireWriteAccess` |
| Supabase user creation fails silently | Invite accepted but no account created | `signup-with-invite` is transactional: if Supabase user creation fails, invite stays unaccepted |
| JWT doesn't contain org role | Frontend can't determine read-only state | `/auth/me` returns `orgRole` from DB; frontend always fetches on login |
| Beta user bookmarks a mutation API endpoint and calls it directly | 403 from server | Server-side enforcement is the real gate; frontend hiding is cosmetic |

**Dependencies:** Supabase auth service (exists), RBAC tables (exist), markets controller (exists). No new external dependencies.

## 8. Phasing

### Phase 1: Role + Invite Backend
- Seed `beta_reader` role in `authz.rbac_roles`
- Create `authz.invites` table
- Implement invite CRUD endpoints (`POST /auth/invites`, `GET /auth/invites`, `DELETE /auth/invites/:id`, `GET /auth/invites/:token/validate`)
- Implement `POST /auth/signup-with-invite` — creates user, assigns role + org, marks invite accepted, returns JWT
- Extend `/auth/me` to return `orgRole`
- **Gate:** Invite creation, validation, signup, and role assignment all work via curl. Beta user JWT has correct claims. `/auth/me` returns `orgRole`.

### Phase 2: Mutation Guard
- Add `requireWriteAccess(user, organizationSlug)` to `markets.controller.ts`
- Call it from every POST/PUT/PATCH/DELETE handler (30 data mutation + already-guarded admin endpoints)
- Add a compliance test: enumerate all mutation handlers and verify each calls `requireWriteAccess`
- **Gate:** `beta_reader` user gets 403 on all mutation endpoints. `admin`/`owner`/`member` users are unaffected. Compliance test passes.

### Phase 3: Frontend Read-Only + Signup
- Add `orgRole` and `isBetaReader` to tenant store
- Fetch `orgRole` from `/auth/me` on login and invite signup
- Create `/signup/:token` route and view
- Add `v-if="!isBetaReader"` to mutation controls across views (dashboard, runs, analysts, findings, portfolios, sources)
- Add read-only indicator to layout
- **Gate:** Beta user can sign up via invite link, sees all views read-only, mutation controls hidden. Founder sees no changes.
