# Schema Bootstrap Hardening — Product Requirements Document

## 1. Overview

Divinr currently allows normal API request paths to perform schema mutation through dozens of `ensureSchema()` calls spread across modules such as markets, billing, onboarding, first-touch, learning-panel, messaging, tournaments, clubs, credentials, and auth. A single shell load can fan out into several of those modules at once, which creates request-time DDL lock contention, intermittent bootstrap `500`s, and observable Postgres deadlocks.

This effort removes request-time schema mutation as an application pattern. Schema ownership moves to explicit bootstrap execution and migrations; API startup validates readiness; request handlers assume the schema already exists. The immediate business goal is straightforward: opening the app should not mutate the database, should not depend on request ordering, and should not intermittently fail during normal shell bootstrap.

The effort also pauses `platform-learning-panel` after Phase 4 and before Phase 5. The Learning Panel work is functionally usable, but further feature work should not continue until shell/bootstrap stability is restored.

## 2. Goals & Success Criteria

### Goals

- Eliminate request-time schema mutation from hot API paths.
- Introduce one deterministic bootstrap path for schema creation and idempotent seed/default data.
- Add startup validation so the API fails clearly when required bootstrap work has not been run.
- Remove shell-load deadlock noise and bootstrap `500`s for markets, billing, first-touch, learning-panel, notifications, fear/greed, affinity, and related services.
- Decompose `MarketsSchemaService` enough that DDL, seed/init behavior, and validation are distinct concerns.

### Success Criteria

- No normal request handler calls schema mutation code before serving business logic.
- Opening the authenticated app shell no longer produces Postgres deadlock errors tied to schema/bootstrap work.
- Shell bootstrap requests such as Learning Panel bootstrap, first-touch reads, billing summary/status reads, unread counts, and affinity alerts return reliably without first-request DDL.
- The API has one explicit schema/bootstrap command or startup entrypoint documented in repo scripts and used by local dev.
- API startup performs readiness validation and fails clearly if required schema/bootstrap state is absent or incompatible.
- Existing migrations and seed/bootstrap logic remain idempotent in local development.
- Existing product behavior remains intact after removing request-time `ensureSchema()` calls.

## 3. User Stories / Use Cases

- As a logged-in user, I can open the app and navigate the shell without intermittent bootstrap failures caused by concurrent schema mutation.
- As a beta user opening the Learning Panel, I do not experience transient `500`s caused by other shell bootstrap requests racing on DDL.
- As an engineer running the API locally, I have a clear bootstrap command and startup contract instead of hidden “first request creates tables” behavior.
- As an engineer diagnosing startup issues, I see a clear readiness failure when required schema/bootstrap work is missing, instead of partially successful request-time recovery.
- As a product owner, I can continue feature work after this effort knowing the platform no longer depends on request ordering to initialize core tables.

## 4. Technical Requirements

### 4.1 Architecture

#### Current baseline

- The API starts in [apps/api/src/main.ts](/Users/golfergeek/projects/divinr.ai/divinr.ai-codex/apps/api/src/main.ts:1) with no centralized schema bootstrap or readiness validation.
- `AppModule` imports all feature modules directly in [apps/api/src/app.module.ts](/Users/golfergeek/projects/divinr.ai/divinr.ai-codex/apps/api/src/app.module.ts:1).
- Many services call `ensureSchema()` inside normal methods. The broadest instance is `MarketsService`, backed by [MarketsSchemaService](/Users/golfergeek/projects/divinr.ai/divinr.ai-codex/apps/api/src/markets/schema/markets-schema.service.ts:1). Similar patterns exist in billing, first-touch, onboarding, learning-panel, messaging, tournaments, clubs, curriculum, credentials, invites, and auth service API keys.
- Some migration files already exist under [apps/api/db/migrations](/Users/golfergeek/projects/divinr.ai/divinr.ai-codex/apps/api/db/migrations), but runtime schema services remain an additional mutable source of truth.
- A few startup hooks already exist in the codebase, such as [ServiceApiKeyService](/Users/golfergeek/projects/divinr.ai/divinr.ai-codex/apps/api/src/auth/service-api-key.service.ts:1), which provides a precedent for controlled boot-time work.

#### Target architecture

Adopt a three-part model:

1. **Migrations own DDL**
   - Tables, columns, indexes, triggers, views, and schema creation live in migration files or bootstrap-owned SQL assets.
   - Request handlers no longer execute DDL.

2. **Explicit bootstrap owns idempotent initialization**
   - Add a dedicated bootstrap path for idempotent seed/default data and transitional setup that cannot yet live entirely in migrations.
   - This bootstrap runs before normal app traffic in local development and deployment entrypoints.

3. **API startup owns readiness validation**
   - Startup checks for required schema/bootstrap state.
   - If readiness fails, startup exits clearly rather than relying on request-time recovery.

#### Required new platform pieces

- A dedicated bootstrap coordinator module/service, e.g. `SchemaBootstrapModule` with:
  - `SchemaBootstrapService`
  - `SchemaReadinessService`
  - per-domain bootstrap tasks or adapters
- An explicit command or script such as:
  - `pnpm --filter @divinr/api run bootstrap:schema`
  - or `tsx src/bootstrap-schema.ts`
- Updated local-dev startup script(s), including [apps/api/scripts/dev-up.sh](/Users/golfergeek/projects/divinr.ai/divinr.ai-codex/apps/api/scripts/dev-up.sh:1), to run bootstrap before launching the API.

#### Chosen operating model

This PRD resolves the intention’s open bootstrap question as follows:

- **Schema/bootstrap should run via an explicit command in dev/prod entrypoints, not opportunistically inside request handlers.**
- **API startup should validate readiness, not perform broad schema mutation.**

This is intentionally stricter than “do the bootstrap automatically on first app boot,” because the current failure mode comes from hidden runtime mutation. The app should either start in a ready state or fail clearly.

#### Transitional allowance

Because the current surface area is broad, the implementation may use a temporary global in-process bootstrap lock during the migration period if it materially reduces risk while hot paths are being cleaned up. That lock is a transition aid, not the final architecture. The final success condition remains: no request-time schema mutation on normal traffic.

### 4.2 Data Model Changes

This effort does not add user-facing product tables. It restructures how schema is created and validated.

Required data-layer changes:

- Add migration/bootstrap tracking if one does not already exist in the underlying DB tooling layer. The API needs a deterministic way to validate that required bootstrap/migration work has run.
- Move runtime DDL currently embedded in schema services into migration files and/or explicit bootstrap-owned SQL.
- Preserve existing table names and shapes for:
  - `prediction.*`
  - `billing.*`
  - runtime support tables in credentials, first-touch, onboarding, messaging, clubs, tournaments, and curriculum
- Keep seed/default data idempotent:
  - default domains
  - default sources
  - default risk dimensions
  - portfolio foundation seed
  - analyst name migrations or legacy cleanup that still matters
  - any other runtime seeding currently executed in `MarketsSchemaService`

The PRD intentionally does **not** require a broad schema redesign. The target is to keep the existing data model working while changing when and how it is initialized.

### 4.3 API Changes

#### Remove request-time schema calls from hot business methods

At minimum, remove request-time `ensureSchema()` from services hit during shell bootstrap:

- markets
- billing
- first-touch
- onboarding if part of shell bootstrap
- learning-panel
- notifications
- fear-greed alerts
- affinity
- messaging if pulled during shell initialization

The cleanup must also include any directly related dependency services used by those paths.

#### Add explicit bootstrap/readiness interfaces

Add API-side operational interfaces as needed:

- a bootstrap command callable from scripts/CI/deploy entrypoints
- a startup validation path invoked during API boot
- optionally, a read-only health/readiness endpoint that can report bootstrap readiness distinctly from generic process liveness

If a readiness endpoint is added or extended, it must differentiate:

- process is up
- schema/bootstrap is ready
- schema/bootstrap is missing or failed

#### No feature-surface API expansion

This effort does not add new user-facing product APIs. Any new endpoint must be strictly operational/readiness related.

### 4.4 Frontend Changes

No new product surface is required.

Frontend scope is limited to:

- preserving existing shell behavior after backend cleanup
- keeping current Learning Panel, billing, first-touch, notification, and related shell requests working against the hardened backend
- updating e2e/browser coverage where validation expectations change

Because no new user-facing surface is introduced, no new first-touch inventory entry is required. Existing browser coverage should be extended only as needed to prove shell bootstrap stability.

### 4.5 Infrastructure Requirements

#### Scripts and local development

- Update local startup scripts so developers do not need to remember a hidden manual step.
- `dev:up` should run bootstrap deterministically before the API is considered healthy.
- Startup documentation in repo guidance should explain:
  - bootstrap command
  - validation/failure behavior
  - recovery path when schema is missing or stale

#### Logging and observability

- Bootstrap logs must be explicit and separate from normal request logs.
- Readiness failures should name the failing bootstrap task or missing schema area.
- Deadlock and DDL errors tied to shell bootstrap should disappear from normal runtime logs after completion.

#### Testing infrastructure

- Unit/integration coverage should validate that services operate without calling schema mutation during normal methods.
- Browser/e2e coverage should exercise authenticated shell loads that previously triggered bootstrap races.

## 5. Non-Functional Requirements

- **Determinism:** normal request handling cannot depend on request ordering for schema readiness.
- **Performance:** authenticated shell bootstrap should no longer pay request-time DDL cost.
- **Reliability:** concurrent shell loads must not deadlock on schema creation.
- **Idempotence:** bootstrap commands may be rerun safely in local development and repeated deploys.
- **Security:** no relaxation of existing auth, billing, or role controls during bootstrap refactor.
- **Backward compatibility:** existing table names, route contracts, and user-facing behavior remain stable.
- **Operational clarity:** startup failures must be actionable, not partial or silent.

## 6. Out of Scope

- Learning Panel Phase 5 metering, limits, or feedback.
- Mastery levels / left-nav simplification.
- Cloud/infrastructure migration.
- Reworking unrelated product architecture outside schema/bootstrap responsibility.
- Large-scale data-model redesign beyond what is necessary to remove request-time schema work.

## 7. Dependencies & Risks

### Dependencies

- Existing migration files in [apps/api/db/migrations](/Users/golfergeek/projects/divinr.ai/divinr.ai-codex/apps/api/db/migrations)
- `MarketsSchemaService` and other schema services as the current runtime source of truth
- local startup scripts such as [apps/api/scripts/dev-up.sh](/Users/golfergeek/projects/divinr.ai/divinr.ai-codex/apps/api/scripts/dev-up.sh:1)
- e2e/browser validation for shell bootstrap paths

### Risks

- **Runtime behavior hidden in schema services:** `MarketsSchemaService` mixes DDL, cleanup, seeds, and validation; migrating it blindly risks breaking existing initialization side effects.
  - **Mitigation:** inventory and classify every step before moving it; separate DDL from seed/default data from warnings/verification.

- **Partial migration leaves dual sources of truth:** migrations and runtime schema code could diverge during the transition.
  - **Mitigation:** phase the work so migrated domains stop using runtime DDL as soon as their bootstrap path is in place; remove or stub obsolete runtime DDL code promptly.

- **Startup becomes fragile if readiness is too strict too early.**
  - **Mitigation:** introduce readiness validation with clear error messages and make the bootstrap command part of the normal local/dev path before removing request-time fallback.

- **Shell bootstrap still fails due to unrelated module fan-out after schema refactor.**
  - **Mitigation:** keep browser verification focused on the specific shell routes and monitor logs for residual non-schema failures separately.

## 8. Phasing

### Phase 1 — Inventory and Transitional Guardrail

Create the full inventory of request-time schema/bootstrap paths and categorize each call site:

- DDL only
- seed/default data
- verification/warnings
- true business logic

If needed, add a temporary global bootstrap coordinator/lock to stop concurrent runtime DDL races while the permanent cleanup is in progress. The outcome of this phase is a complete map of the work and a reduced deadlock surface during the transition.

### Phase 2 — Explicit Bootstrap and Readiness Path

Add the explicit bootstrap command/service and wire startup readiness validation into the API process. Update local startup scripts so bootstrap runs before the API is declared healthy. This phase establishes the new operational contract without yet removing every request-time call.

### Phase 3 — Hot-Path Cleanup

Remove request-time `ensureSchema()` from shell-triggered modules first:

- markets
- billing
- first-touch
- learning-panel
- notifications / fear-greed / affinity
- messaging / onboarding if part of shell bootstrap

This phase must prove that authenticated shell loads no longer trigger DDL or deadlock noise.

### Phase 4 — Markets Schema Decomposition and Broad Cleanup

Refactor `MarketsSchemaService` into understandable pieces:

- migration-owned DDL
- explicit bootstrap-owned seed/default data
- startup verification/warnings

Then remove remaining request-time schema calls across non-shell modules so the application no longer relies on runtime schema mutation anywhere on normal traffic.

### Phase 5 — Stabilization Verification and Documentation

Run the full validation pass:

- shell bootstrap browser tests
- direct API checks
- log review for deadlocks/bootstrap 500s
- local dev bootstrap workflow

Update docs/scripts so future efforts inherit the hardened contract instead of reintroducing request-time schema work.
