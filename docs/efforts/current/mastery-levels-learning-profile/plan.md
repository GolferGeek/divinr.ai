# Mastery Levels and Learning Profile — Implementation Plan

**PRD**: `docs/efforts/current/mastery-levels-learning-profile/prd.md`
**Created**: 2026-04-27
**Status**: In Progress

## Progress Tracker
- [x] Phase 1: Inventory and Policy Lock
- [x] Phase 2: Learning Profile Persistence
- [ ] Phase 3: Level-Aware Shell Navigation
- [ ] Phase 4: Route Behavior and Learning Panel Integration
- [ ] Phase 5: Progression UX and Coverage

---

## Phase 1: Inventory and Policy Lock
**Status**: Complete
**Objective**: Turn the product idea into a concrete source-of-truth inventory for routes, shell nav items, and mastery policy.

### Steps
- [x] 1.1 Inventory all app-shell nav groups/items from `apps/web/src/layouts/DefaultLayout.vue` and map each one to a mastery level or an explicit role-only exception.
- [x] 1.2 Inventory key routes in `apps/web/src/router/index.ts` and assign route-level mastery policy, including fallback behavior for hidden surfaces.
- [x] 1.3 Lock progression policy decisions in code-facing terms:
  - whether manual opt-up is allowed
  - whether Level 2 is join-only or includes creation
  - which billing/account/settings surfaces remain visible at every level
- [x] 1.4 Define the canonical level enum/string constants and a typed frontend inventory module that later phases will consume.

### Quality Gate
Before moving to Phase 2, ALL of the following must pass:

- [x] **Plan Review**: inventory and policy decisions are fully traceable to the PRD and intention
- [x] **Code Review**: no implementation yet beyond typed inventory/policy scaffolding
- [x] **Phase Review**:
  - [x] Did we accomplish what we said we would?
  - [x] Are progression ambiguities resolved enough to implement safely?

---

## Phase 2: Learning Profile Persistence
**Status**: Complete
**Objective**: Add persisted user learning-profile state and backend APIs without changing visible shell behavior yet.

### Steps
- [x] 2.1 Add migrations and explicit bootstrap wiring for the learning-profile schema under the existing no-request-DDL contract.
- [x] 2.2 Implement an API module/service for learning profiles with explicit `@Inject(...)` usage on all constructor params.
- [x] 2.3 Add `GET /api/mastery/profile` and any required update endpoint for level/preference changes.
- [x] 2.4 Seed default profiles for existing users and derive initial milestone state from existing trade, portfolio, club, tournament, authored-content, and onboarding/first-touch data.
- [x] 2.5 Add targeted unit tests for default profile behavior, milestone derivation, and update semantics.

### Quality Gate
Before moving to Phase 3, ALL of the following must pass:

- [x] **Lint**: `pnpm --filter @divinr/api run lint`
- [x] **Build**: `pnpm --filter @divinr/api run build`
- [x] **Unit Tests**: targeted mastery-profile tests plus full API unit suite
  `pnpm --filter @divinr/api run test:unit`
- [ ] **Curl Tests**:
  `curl -s -H "Authorization: Bearer $DIVINR_TOKEN" http://localhost:7100/api/mastery/profile | jq`
  - local validation environment did not provide `DIVINR_TOKEN`; endpoint contract was covered by unit tests instead
- [x] **Phase Review**:
  - [x] Did we accomplish what we said we would?
  - [x] Does schema/bootstrap follow the post-hardening contract?

---

## Phase 3: Level-Aware Shell Navigation
**Status**: Not Started
**Objective**: Make the left nav and shell reflect mastery levels, especially the aggressively simplified Level 1 experience.

### Steps
- [ ] 3.1 Refactor `apps/web/src/layouts/DefaultLayout.vue` to consume the canonical mastery inventory instead of hardcoded static visibility alone.
- [ ] 3.2 Add a frontend mastery-profile store/composable and load it during shell bootstrap alongside existing onboarding/first-touch/billing state.
- [ ] 3.3 Implement Level 1 nav hiding so only the core loop, Learning Panel, and unavoidable account/billing/onboarding entries remain.
- [ ] 3.4 Reveal Level 2+ groups/items according to the locked policy while preserving admin-only filtering.
- [ ] 3.5 Ensure mobile chrome, popovers, and panel launchers follow the same mastery visibility rules as desktop nav.

### Quality Gate
Before moving to Phase 4, ALL of the following must pass:

- [ ] **Lint**: `pnpm --filter @divinr/web run lint`
- [ ] **Build**: `pnpm --filter @divinr/web run build`
- [ ] **Unit/Type Checks**: any affected frontend tests plus app build
- [ ] **Browser Tests**: verify Level 1 vs higher-level nav visibility on desktop and mobile
- [ ] **Phase Review**:
  - [ ] Did we accomplish what we said we would?
  - [ ] Does Level 1 actually feel focused rather than merely shuffled?

---

## Phase 4: Route Behavior and Learning Panel Integration
**Status**: Not Started
**Objective**: Make hidden surfaces and the Learning Panel level-aware, coherent, and explainable.

### Steps
- [ ] 4.1 Implement route fallback behavior for hidden surfaces so deep links do not strand users or expose incoherent shell states.
- [ ] 4.2 Extend Learning Panel bootstrap/context payloads to include mastery level, visible-surface summary, and next-step guidance inputs.
- [ ] 4.3 Add panel responses or starter-prompt affordances for:
  - what to learn next
  - why a feature is hidden
  - what changes at the next level
- [ ] 4.4 Ensure mastery does not override actual authorization and does not leak admin/operator capability to non-admin users.

### Quality Gate
Before moving to Phase 5, ALL of the following must pass:

- [ ] **Lint**: `pnpm lint`
- [ ] **Build**: `pnpm build`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api run test:unit`
- [ ] **E2E Tests**:
  `BASE_URL=http://localhost:7101 pnpm --filter @divinr/e2e exec playwright test tests/learning-panel/smoke.spec.ts --project=learning-panel`
- [ ] **Curl Tests**:
  `curl -s -H "Authorization: Bearer $DIVINR_TOKEN" http://localhost:7100/api/learning-panel/bootstrap | jq`
- [ ] **Phase Review**:
  - [ ] Did we accomplish what we said we would?
  - [ ] Are hidden-surface behaviors coherent and explainable?

---

## Phase 5: Progression UX and Coverage
**Status**: Not Started
**Objective**: Finish the user-facing progression story and cover the new visibility model with first-touch and browser tests.

### Steps
- [ ] 5.1 Add any required settings/home affordance for manual complexity opt-up if the locked policy permits it.
- [ ] 5.2 Update first-touch inventory/content for any newly introduced or materially changed mastery/profile surfaces.
- [ ] 5.3 Extend or create browser-skill coverage for Level 1 core-loop visibility, Level 2/3 reveal paths, and route fallback behavior.
- [ ] 5.4 Validate existing-user seeding and upgrade behavior so current users do not lose access unexpectedly.
- [ ] 5.5 Update roadmap/current-effort docs and archive state on completion.

### Quality Gate
Before marking the effort complete, ALL of the following must pass:

- [ ] **Lint**: `pnpm lint`
- [ ] **Build**: `pnpm build`
- [ ] **Unit Tests**: `pnpm --filter @divinr/api run test:unit`
- [ ] **E2E Tests**:
  `BASE_URL=http://localhost:7101 pnpm --filter @divinr/e2e exec playwright test tests/learning-panel/smoke.spec.ts --project=learning-panel`
  `BASE_URL=http://localhost:7101 pnpm --filter @divinr/e2e exec playwright test tests/predictions --project=predictions`
  `BASE_URL=http://localhost:7101 pnpm --filter @divinr/e2e exec playwright test tests/clubs --project=clubs`
- [ ] **Chrome Tests**:
  - verify Level 1 hides most of the left nav
  - verify a higher-level user sees the intended additional surfaces
  - verify the Learning Panel can explain the next level
- [ ] **Phase Review**:
  - [ ] Did we accomplish what we said we would?
  - [ ] Does the implementation align with the PRD?
  - [ ] Are there any deviations? If so, document why.
