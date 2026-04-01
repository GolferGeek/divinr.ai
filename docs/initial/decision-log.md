# Decision Log - Initial

This file tracks major architectural and product decisions for the initial effort.

---

## DL-001 - Delivery approach

- **Status:** Accepted
- **Decision:** Build a production-minded foundation with phased capability rollout, not a throwaway MVP.
- **Why:** Avoid expensive rewrites in tenant isolation, governance, and evaluation systems.
- **Implication:** Front-load quality in hard-to-change platform layers.

## DL-002 - Primary domain

- **Status:** Accepted
- **Decision:** Execute Phase 1 on stocks.
- **Why:** Existing implementation maturity and lowest immediate scope risk.
- **Implication:** Additional domains are architecture targets, not immediate production scope.

## DL-003 - Platform model

- **Status:** Accepted (directional)
- **Decision:** SaaS-first with shared data plane and tenant-specific intelligence plane.
- **Why:** Best velocity for ingestion, model/workflow updates, and operational learning.
- **Implication:** Design now for future dedicated/private deployment options.

## DL-004 - Data plane strategy

- **Status:** Accepted (guardrailed)
- **Decision:** Centralize crawl/discovery/index by default; enforce source entitlements and provenance.
- **Why:** Efficiency and consistency for shared infrastructure.
- **Implication:** Content reuse must obey licensing rights per source.

## DL-005 - Analyst model

- **Status:** Accepted
- **Decision:** Tenant-owned analyst packs with scoped analysts (general + instrument-specific), plus fork support.
- **Why:** Core product differentiator and user control requirement.
- **Implication:** Must support versioning, rollback, and measurable fork comparison.

## DL-006 - Explainability requirement

- **Status:** Accepted
- **Decision:** Prediction and risk outputs must include inspectable lineage and rationale.
- **Why:** User trust, debugging, governance, and compliance posture.
- **Implication:** Snapshot/event artifacts are first-class data, not optional logs.

## DL-007 - Learning and evaluation

- **Status:** Accepted
- **Decision:** Include evaluation and counterfactual replay in Phase 1.
- **Why:** Need objective quality signal and safe way to test analyst changes.
- **Implication:** Promotion/rollback workflows depend on measurable outcomes.

## DL-008 - Phase 1 tenant count

- **Status:** Accepted
- **Decision:** Build and validate against three demo tenants.
- **Why:** Sufficient differentiation test without heavy onboarding complexity.
- **Implication:** Use this as the minimum acceptance baseline.

## DL-009 - Billing scope

- **Status:** Accepted
- **Decision:** Defer full billing implementation.
- **Why:** Not required to validate core product value and architecture.
- **Implication:** Use configuration/entitlement flags for initial gating.

## DL-010 - Open design decisions

- **Status:** Open
- **Decision needed:** Final phase-1 isolation strategy details (for example strict tenant_id with guardrails vs schema-per-tenant).
- **Decision needed:** Final baseline metric thresholds for analyst promotion.
- **Decision needed:** Explicit source licensing matrix for initial provider set.

## DL-011 - Test intensity for compliance work

- **Status:** Accepted
- **Decision:** Run a heavy automated testing program focused on compliance-critical foundations before UI completeness.
- **Why:** Security/compliance defects in isolation, entitlements, and auditability are high-cost and must be caught early.
- **Implication:** Compliance-critical test suites are blocking gates for phase exit.

## DL-012 - Differentiator framing

- **Status:** Accepted
- **Decision:** Keep differentiator messaging explicit in product and technical docs:
  - compliance-depth,
  - client-controlled analysts/personalities,
  - and system learning over time.
- **Why:** Positioning as a serious platform requires clear contrast with casual single-answer tools.
- **Implication:** PRDs, demos, and implementation acceptance criteria must reinforce this framing.

## DL-013 - Infrastructure flexibility for compliance targets

- **Status:** Accepted
- **Decision:** Keep infrastructure adaptable so stricter deployment/isolation options can be used when required (for example dedicated cloud resources).
- **Why:** Control objectives may exceed what shared defaults can comfortably satisfy for some customers.
- **Implication:** Architecture should avoid assumptions that block stronger isolation later.

## DL-014 - Monorepo structure

- **Status:** Accepted
- **Decision:** Use a Turbo monorepo with NestJS API and Vite + Vue web app; iOS native app is deferred and API-first for now.
- **Why:** Shared contracts and planes are easier to enforce across services; phase delivery and testing gates are cleaner in one repo.
- **Implication:** Shared package boundaries and import rules become part of platform governance.

## DL-015 - Phase 0 requirement

- **Status:** Accepted
- **Decision:** Introduce a formal Phase 0 focused on extracting and enforcing planes before business workflow implementation.
- **Why:** Avoid bypass patterns and preserve portability across Supabase, PostgreSQL (GCP), and SQL Server from day one.
- **Implication:** Phase 1+ features must consume database/llm/observability/auth/rbac through plane interfaces only.

---

## Change protocol

For each new decision:

1. Add a new `DL-###` entry.
2. Record status (`Proposed`, `Accepted`, `Rejected`, `Superseded`).
3. State decision, rationale, and implications.
4. Reference superseded decisions when applicable.
