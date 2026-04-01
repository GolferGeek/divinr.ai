# Divinr AI High-Level PRD

## 1) Document purpose

This document defines the high-level product and platform requirements for Divinr AI. It captures the shared agreement needed before deeper phase PRDs and implementation work.

## 2) Problem statement

Most market-intelligence products provide platform-defined outputs with limited user control over analyst behavior and weak governance over how decisions are produced and improved. Serious users need:

- configurable analyst systems aligned to their own strategy,
- transparent decision lineage,
- measurable evaluation and learning loops,
- and secure multi-tenant operation.

## 3) Vision

Build a multi-tenant SaaS platform where each client can create, operate, and evolve their own analyst stack for risk analysis and prediction workflows on top of a governed shared data foundation.

## 3.1 Market positioning and differentiators

- **Compliance-first by design:** security/compliance depth is part of the value proposition, not only a legal requirement.
- **Complete client analyst control:** clients control analyst personalities, context, and behavior instead of consuming a fixed vendor model.
- **Platform stance, not oracle stance:** the product provides transparent workflows and governance, not a claim of guaranteed "right answers."
- **Continuous system improvement:** learning/evaluation/replay are built into core workflows so the system improves over time.

## 4) Goals

- Enable tenant-owned analyst packs with versioning and fork support.
- Provide explainable risk and prediction outputs with full lineage.
- Support centralized ingest with tenant-level source entitlements.
- Establish a compliance-forward architecture and operational baseline.
- Deliver reusable architecture for future domains beyond stocks.
- Prove enterprise seriousness through controls, tests, and auditable evidence.

## 5) Non-goals (initial window)

- Full billing and payment stack.
- Broad domain rollout (sports/elections in production).
- Public analyst marketplace.
- Finalized enterprise deployment variants (single-tenant/VPC/on-prem delivery can follow after foundation maturity).

## 6) Users and core jobs

- **Primary user:** serious market participant (or team) who wants custom analyst behavior and measurable outcomes.
- **Secondary user:** platform operator/admin managing entitlements, quality, and governance.

Core jobs to be done:

- configure analysts and context by tenant and instrument,
- run risk analysis and prediction workflows,
- review rationale and lineage,
- measure outcomes and compare against baseline,
- promote/rollback analyst changes safely.

## 7) Core requirements

### 7.1 Multi-tenant and isolation

- Tenant boundaries enforced at data model and service access layers.
- Isolation verified by automated cross-tenant failure tests.
- Auditable access events for critical data operations.

### 7.2 Shared data plane and rights

- Centralized source discovery/ingest/index where licensing permits.
- Tenant-private source support.
- Source/article-level entitlement checks and provenance metadata.

### 7.3 Analyst system

- Per-tenant analysts with scope hierarchy:
  - runner/domain/universe/target (or equivalent abstraction).
- Per-analyst context versioning and rollback.
- Support for user, ai, and arbitrator fork behavior.
- Explicit client authority to configure and maintain analyst personality behavior at each scope level.

### 7.4 Risk and prediction workflows

- Risk analysis per instrument with optional debate/arbitration.
- Prediction generation/upsert with confidence, direction, and horizon.
- Position/paper outcome support for evaluation use cases.
- Trace snapshots for explainability and audit.

### 7.5 Evaluation and learning

- Capture outcomes and compute quality metrics.
- Counterfactual/replay capability for testing alternate analyst settings.
- Learning queue/review flow for controlled adaptation.
- The platform must support continual system improvement rather than static model behavior.

## 8) Proposed architecture boundaries

- **Data plane:** ingest, normalization, indexing, entitlements, provenance.
- **Intelligence plane:** analyst orchestration, risk engine, prediction engine, learning/eval.
- **Control plane:** tenant/admin settings, policy, observability, audit, operations.

## 9) Quality gates (must pass)

- **Isolation gate:** no cross-tenant access paths.
- **Rights gate:** entitlement and provenance checks enforced.
- **Eval gate:** out-of-sample quality visibility against baseline.
- **Governance gate:** analyst versioning, promotion, and rollback operational.
- **Reliability gate:** instrumentation, error handling, replayability, and test coverage for critical paths.

## 10) Testing and compliance posture (explicit)

Testing is a first-class product requirement, not a cleanup task. The program must be heavy on automated testing for compliance-critical areas before UI polish.

- **Compliance-critical test priority:** tenant isolation, entitlements, access control, audit logging, and data lineage.
- **Negative-path focus:** unauthorized cross-tenant reads/writes must be tested as failure cases across API, workflow, and background job paths.
- **Layered strategy:** unit tests, integration tests, end-to-end workflow tests, and replay/counterfactual validation tests.
- **Regression enforcement:** no merge to protected branches without passing compliance-critical suites.
- **Evidence readiness:** test outputs and audit artifacts must be retained as evidence for security/compliance reviews.
- **Infrastructure flexibility:** deployment may use managed/shared cloud or stricter isolated infrastructure (for example dedicated cloud environments) as required to meet control targets.

## 11) Phase model

Detailed implementation requirements live in phase-specific PRDs.

- Phase 0: Platform foundation extraction and enforcement (Turbo monorepo setup, planes extraction, and no-bypass guardrails).
- Phase 1: Stocks foundation slice (tenant analyst packs + risk + prediction + eval/replay).
- Later phases: domain expansion and enterprise packaging.

### 11.1 Phase 0 explicit deliverables

- Turbo monorepo baseline with `apps/api` (NestJS), `apps/web` (Vite + Vue), `apps/ios` (deferred), and shared packages.
- Extracted planes foundations for database, llm, observability, config, auth, and rbac as reusable packages.
- Provider portability retained for Supabase, PostgreSQL, and SQL Server paths.
- Guardrails that disallow direct database/llm SDK usage in app code outside plane contracts.

## 12) Acceptance criteria for high-level agreement

This PRD is accepted when:

- goals and non-goals are agreed,
- architecture boundaries are agreed,
- quality gates are agreed,
- and phase decomposition is agreed.
