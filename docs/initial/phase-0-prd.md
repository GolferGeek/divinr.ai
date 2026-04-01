# Phase 0 PRD - Platform Foundation Extraction

## 1) Phase purpose

Establish the platform foundation before workflow implementation by setting up the monorepo and extracting the core plane implementations required for portability and governance.

This phase is implementation work, not documentation-only planning.

## 2) Scope

### In scope

- Turbo monorepo baseline:
  - `apps/api` (NestJS placeholder)
  - `apps/web` (Vite + Vue placeholder)
  - `apps/ios` (native iOS deferred, API-first path)
- Shared package setup:
  - `packages/transport-types` extracted from orchestrator
  - `packages/planes` extraction snapshot including:
    - `database`
    - `llm`
    - `observability`
    - `config`
    - `auth`
    - `rbac`
- Phase-0 enforcement guardrails:
  - app-layer lint restrictions that block direct DB/LLM SDK imports
  - app-layer requirement to use plane contracts/tokens only

### Out of scope

- Risk and prediction business workflow implementation.
- Complete UI implementation.
- Full compile/runtime validation of every extracted plane submodule.

## 3) Functional requirements

### FR-0.1 Monorepo baseline

- Workspace must support `apps/*` and `packages/*`.
- Root scripts must support build/lint/test/typecheck orchestration.

### FR-0.2 Planes extraction snapshot

- Plane code must be present locally as extracted source from orchestrator.
- Database provider strategy must retain Supabase, PostgreSQL, and SQL Server code paths.
- LLM and observability provider-routing logic must be preserved in extracted source.

### FR-0.3 No-bypass baseline guardrails

- App code must not directly import:
  - `@supabase/supabase-js`, `pg`, `mssql`
  - provider SDKs like `openai`, `@anthropic-ai/sdk`, `@google-cloud/vertexai`, `@azure-rest/ai-inference`
- Guardrail violations must fail lint.

## 4) Exit criteria

- Gate A: monorepo tooling runs (`build`, `lint`, `typecheck`) for baseline scaffolds.
- Gate B: extracted plane source directories are present and structured for progressive integration.
- Gate C: no-bypass lint guardrails are active for `apps/*`.
- Gate D: high-level and phase docs reflect Phase 0 as explicit implementation phase.

## 5) Follow-on work (Phase 0.1 hardening)

- Restore full compile/test execution for extracted planes modules.
- Add missing dependency closure for planes package.
- Prune nonessential subpaths (image/video, legacy sinks) where not needed for current phase goals.
- Add contract tests for database provider parity and LLM context routing behavior.
