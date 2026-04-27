# Mastery Levels and Learning Profile — Product Requirements Document

## 1. Overview

Divinr already has the feature depth to serve new users, competitive participants, builders, and operators, but the current app shell exposes too much of that depth at once. The result is that the core loop gets buried: read analyses/signals, understand risk, make trades, and compare the user's portfolio against analyst portfolios.

This effort introduces a mastery-level system and a persisted learning profile that control user-facing visibility, navigation complexity, first-touch guidance, and Learning Panel explanations. Authorization remains role-based. Mastery levels shape what the user sees, not what the backend permits.

The center of gravity is the left nav in `apps/web/src/layouts/DefaultLayout.vue`. Level 1 must aggressively simplify it. Higher levels progressively reveal clubs/tournaments, creation surfaces, builder surfaces, and operator surfaces.

## 2. Goals & Success Criteria

- New and casual users land in a Level 1 experience that keeps the left nav focused on the core trading loop plus the Learning Panel.
- Every existing user-facing route and shell nav entry is assigned to a mastery level or explicitly marked as always-visible or admin/operator-only.
- Each user has a persisted learning profile containing current level, milestone state, and next-step guidance inputs.
- The Learning Panel can explain the user's current level, what is hidden, and what to learn or do next.
- Advanced users can opt into more complexity without needing hidden URLs or admin intervention, subject to actual role authorization.
- Role-gated admin/operator surfaces remain inaccessible to non-admins regardless of mastery level.

Completion is successful when:
- the app shell renders different nav visibility for Level 1 vs later levels
- mastery level state survives refresh/login/logout
- the Learning Panel bootstrap/context payload includes mastery-level information
- browser coverage proves Level 1 nav hiding and at least one higher-level reveal path

## 3. User Stories / Use Cases

- As a brand-new user, I want the app to show me only the essential surfaces so I understand what Divinr is for before I see its more advanced systems.
- As a user who has made a few trades and compared portfolios, I want the app to tell me what to learn next and let me step into clubs/tournaments when I am ready.
- As an engaged community user, I want to create clubs or tournaments without needing to discover those features through hidden routes.
- As a builder, I want authoring and builder surfaces to appear once I intentionally opt into that complexity.
- As an operator/admin, I want mastery-level logic to leave true authorization untouched so admin tools remain role-gated.
- As a Learning Panel user, I want to ask why something is not visible and get a level-aware explanation.

## 4. Technical Requirements

### 4.1 Architecture

- Introduce a dedicated mastery/learning-profile module on the API side rather than scattering level logic across unrelated services.
- Treat mastery as a presentation-layer concern with a persisted backend profile:
  - backend stores the user's level and milestone state
  - frontend consumes a single profile/bootstrap payload
  - frontend filters shell navigation and other affordances from that payload
- Do not encode mastery as authorization:
  - existing guards (`JwtAuthGuard`, admin checks, read-only checks) remain the source of truth for access control
  - mastery-level filtering can hide links and redirect from shell entrypoints, but it must not replace backend permissions
- Reuse existing onboarding and first-touch systems:
  - `apps/web/src/onboarding/surface-content.ts`
  - `apps/web/src/stores/firstTouch.store.ts`
  - `apps/web/src/stores/onboarding.store.ts`
- Reuse the Learning Panel for level-aware explanation rather than inventing a second teaching surface.

### 4.2 Data Model Changes

Add a persisted learning-profile schema, likely under `authz` or `prediction` depending existing ownership conventions. The PRD requires the following persisted concepts:

- `user_id`
- `mastery_level` (`core_trading`, `competitive_participation`, `community_creation`, `builder`, `operator`)
- `preferred_level` or equivalent opt-in complexity override, if the final policy permits manual stepping up
- milestone booleans or timestamps for:
  - first trade
  - first portfolio comparison
  - first tournament joined
  - first club joined
  - first authored item
- next-step guidance payload or derivable fields
- created/updated timestamps

Also add a surface-level inventory representation in code for nav/routing decisions. This should likely be a typed frontend map plus a mirrored backend enum/list for Learning Panel explanations rather than a database table in v1.

Do not persist raw Learning Panel chat as the learning profile. Only explicit level/milestone/preference state belongs here.

### 4.3 API Changes

Add a mastery/learning-profile API surface, for example:

- `GET /api/mastery/profile`
  - returns current level, visible-surface groupings, milestone state, and next suggested steps
- `POST /api/mastery/level`
  - sets a user-confirmed preferred level or requests advancement, depending the final progression policy
- `POST /api/mastery/milestones/recompute` or equivalent internal hook
  - optional; if milestones are derived lazily, this can remain service-internal

Extend Learning Panel bootstrap/context endpoints so they receive mastery information:

- `GET /api/learning-panel/bootstrap`
  - include current mastery level, available next level, and visible-surface summary

Milestone derivation can initially be computed from existing data sources:
- tournament positions / trade records
- portfolio usage
- club membership
- authored-content records
- first-touch/onboarding state

### 4.4 Frontend Changes

- Refactor `apps/web/src/layouts/DefaultLayout.vue`:
  - add a mastery-aware nav inventory
  - filter nav groups/items by both admin role and mastery level
  - Level 1 should show only the core loop, Learning Panel, and unavoidable account/billing entries
- Define the route-to-level inventory for the existing shell routes in `apps/web/src/router/index.ts` and related view ownership.
- Add a mastery-profile store/composable to fetch and cache the user's profile.
- Ensure Level 1 core loop includes:
  - dashboard or a deliberate equivalent home
  - analyses/signals (`/predictions`)
  - risk (`/risk`)
  - portfolios (`/portfolios`)
  - trading/tournaments entrypoint if trades live there
  - Learning Panel
  - unavoidable billing/account/onboarding paths
- Level 2 reveals clubs and tournaments participation surfaces.
- Level 3 reveals creation flows such as `/clubs/create` and `/tournaments/create`.
- Level 4 reveals builder/authoring surfaces such as `/settings/authored-content`, contract editors, and related builder-facing surfaces.
- Level 5 does not reveal admin routes unless the user is already role-authorized.
- Add user-facing affordances:
  - a settings/home control for “show me more of the app” if manual opt-up is permitted
  - level-aware explanation copy in the Learning Panel

Every new or materially changed user-facing surface must preserve first-touch coverage and browser-skill coverage per `AGENTS.md`.

### 4.5 Infrastructure Requirements

- Add schema bootstrap coverage for the new learning-profile tables through the explicit bootstrap path, not request-time schema mutation.
- Add migration(s) for the persisted profile tables/columns.
- Ensure any scheduled or startup milestone backfill is idempotent.

## 5. Non-Functional Requirements

- No request-time DDL. This effort must follow the schema-bootstrap contract in `AGENTS.md`.
- Profile fetch must be cheap enough to participate in shell bootstrap without reintroducing the instability removed by `schema-bootstrap-hardening`.
- Level filtering must not produce broken navigation states or route loops.
- Hidden routes must fail coherently:
  - either redirect to an allowed home/surface
  - or render a level-aware explanation if the route is reachable but intentionally hidden from nav
- The system must remain backward-compatible for existing users; if no profile exists, bootstrap deterministically to a default level.
- Operator/admin role protections must remain intact.

## 6. Out of Scope

- Extending the Learning Panel into builder actions or instrument/analyst creation workflows.
- Changing backend authorization semantics or permissions.
- External web research, open-ended market research, or non-Divinr assistant capabilities.
- Large IA rewrite of the route tree beyond what is needed for mastery-level visibility.
- Reworking pricing, billing lifecycle, or social opt-out policy.

## 7. Dependencies & Risks

### Dependencies

- `platform-learning-panel` for the panel surface and bootstrap contract
- `onboarding-tour-extended` for first-touch inventory and content
- `schema-bootstrap-hardening` for the explicit migration/bootstrap contract
- existing authored-content, clubs, tournaments, and portfolio data for milestone derivation

### Risks

- Route/shell mismatch: hiding nav items without defining route behavior can leave users stranded on deep links.
  - Mitigation: define route-level mastery policy and explicit fallback behavior.
- Scope explosion: trying to make every surface perfectly level-aware in one pass could stall the effort.
  - Mitigation: phase the work around nav inventory, shell behavior, then deeper surface affordances.
- Product ambiguity about progression:
  - automatic vs user-confirmed vs manual opt-up
  - join-only vs create-at-Level-2
  - Mitigation: lock these in the implementation plan before changing shell behavior.
- Existing users may be surprised if their nav suddenly shrinks.
  - Mitigation: seed existing users conservatively and/or give them a visible complexity preference control.

## 8. Phasing

### Phase 1: Inventory and Policy Lock
Define the mastery ladder in code terms, assign every existing shell surface to a level, and lock the progression policy for Level 1–5. Deliver a static source-of-truth inventory and route/nav policy without changing live behavior yet.

### Phase 2: Learning Profile Persistence
Add migrations, bootstrap wiring, backend profile service, and a profile/bootstrap API. Seed default profiles for existing users and derive initial milestones from existing product activity.

### Phase 3: Level-Aware Shell Navigation
Refactor `DefaultLayout.vue` and related shell logic to filter nav groups/items by mastery level while preserving role-based admin visibility and must-reach billing/account paths. Level 1 nav hiding lands here.

### Phase 4: Route Behavior and Learning Panel Integration
Make route entry behavior coherent for hidden surfaces and extend Learning Panel bootstrap/context so it can explain the current level, hidden surfaces, and next steps.

### Phase 5: Progression UX and Coverage
Add progression affordances, level-up/settings controls, first-touch updates, and browser coverage for Level 1 vs higher-level experiences. Validate existing-user upgrade behavior and final PRD compliance.
