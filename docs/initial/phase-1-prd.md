# Phase 1 PRD - Stocks Multi-Tenant Foundation

## 1) Phase purpose

Deliver a production-minded vertical slice for stocks that proves tenant-owned analyst systems, explainable risk/prediction workflows, and measurable evaluation on a shared data foundation.

This phase must also demonstrate the three core differentiators:

- compliance-depth suitable for serious customers,
- client-controlled analysts/personalities,
- and a platform learning loop that improves the system over time.

## 2) Scope

### In scope

- Stocks domain only.
- Three demo tenants.
- Shared article ingest/index plus tenant-specific source overlays.
- Tenant-owned analyst packs with scoped assignment (general + instrument-specific).
- Risk workflow per instrument.
- Prediction workflow with per-analyst outputs and arbitrator handling.
- Outcome evaluation and counterfactual replay harness.
- Dashboard surfaces for analyst/risk/prediction visibility and comparison.

### Out of scope

- Production billing.
- Sports/election production feature set.
- Large-scale external customer onboarding automation.

## 3) Functional requirements

### FR-1 Tenant and entitlement model

- System must support at least three tenants with isolated data access.
- System must enforce source/article entitlements per tenant.
- System must support shared and tenant-private source classes.

### FR-2 Analyst configuration and governance

- Tenant can create/update analysts with scope level assignment.
- Analyst context versions must be recorded on changes.
- Fork modes (user/ai/arbitrator) must be supported in prediction flow.
- Analyst changes must support rollback.
- Client-level control over analyst personality behavior must be explicit in API and UI workflows.

### FR-3 Risk analysis workflow

- Risk analysis can run per instrument with configured dimensions.
- Risk analysis output includes score, confidence, and optional debate adjustment.
- Workflow must support instrument-specific analysts plus general analysts.
- Batch run should support concurrent processing with safe limits.

### FR-4 Prediction workflow

- Predictions can be generated/updated from active predictors.
- Per-analyst outputs include direction, confidence, rationale, and metadata.
- Snapshot lineage is recorded for explainability.
- Prediction views support filtering and comparison.

### FR-5 Evaluation and replay

- Evaluate resolved predictions with baseline comparison.
- Support counterfactual replay of alternate analyst settings.
- Record evaluation outputs for review and learning decisions.

### FR-6 Observability and audit

- Key workflow steps emit structured progress/events.
- Critical operations are traceable per tenant and per instrument.

### FR-7 Compliance-first test program

- Compliance-critical workflows must have broad automated test coverage before feature-complete UI work.
- Required coverage areas:
  - tenant isolation (read/write/background jobs),
  - entitlement enforcement (source/article/model-use),
  - analyst governance (versioning/promotion/rollback),
  - audit trail integrity (decision lineage and access events).
- Cross-tenant failure testing is mandatory and must include negative API and job execution scenarios.
- Replay/counterfactual harness tests must verify deterministic behavior within accepted tolerances.
- Compliance controls must be implemented at platform level, with infrastructure options that can be tightened (for example dedicated cloud resources) as required.

## 4) Non-functional requirements

- Security: tenant isolation and least privilege controls in all data paths.
- Reliability: workflow failure in one instrument does not halt the batch.
- Performance: bounded concurrency for batch runs; avoid unbounded fan-out.
- Testability: deterministic harnesses for replay/evaluation where possible.
- Environment handling: dev/test/prod compatible config and behavior.

### Test execution requirements

- CI must enforce compliance-critical suites as blocking checks.
- New platform-level features are not accepted without tests in critical-path areas.
- Test evidence artifacts (results/logs) must be retained for review.

## 5) Data requirements

- Core entities (minimum): tenant, source entitlement, instrument/target, analyst, analyst context version, predictor, prediction, risk score, evaluation result, replay run.
- Provenance fields required for ingested data and decision lineage artifacts.

## 6) UX requirements (initial)

- Tenant selector context is explicit.
- Analyst management view shows scope, version, and fork state.
- Risk dashboard shows score composition and debate metadata.
- Prediction dashboard shows analyst-level reasoning and outcomes.
- Comparison/replay views make differences in analyst behavior understandable.

## 7) Dependencies and reuse assumptions

- Phase 0 planes foundation is completed first (database, llm, observability, config, auth, rbac) and enforced as the only infrastructure access path.
- Reuse existing orchestration logic from `orchestratorai-enterprise` where stable.
- Reuse existing UI patterns from Forge where they shorten delivery.
- Refactor only where needed for tenant and entitlement correctness.

## 8) Quality gates for Phase 1 exit

- Gate A: no known cross-tenant access path in automated tests.
- Gate B: source/article entitlement checks verified in API and workflow paths.
- Gate C: risk and prediction workflows operate end-to-end for three tenants.
- Gate D: evaluation and replay outputs are visible and verifiable.
- Gate E: analyst versioning and rollback demonstrated.
- Gate F: compliance-critical test suites are green and evidence is retained.

## 9) Demo acceptance criteria

- Same instrument set, different tenant analyst packs, different resulting decisions.
- Decision lineage can be inspected for each prediction.
- At least one replay scenario demonstrates alternate outcome behavior.
- Outcome dashboard shows metric deltas across tenant configurations.
- Demo narrative clearly presents "platform + control + compliance" rather than "single model answer."

## 10) Open questions

- Final tenant data isolation strategy for phase 1 runtime (single schema + hard guardrails vs schema-per-tenant).
- Licensing boundaries for full-content reuse vs metadata-only reuse.
- Initial metric set thresholds required for analyst promotion decisions.
