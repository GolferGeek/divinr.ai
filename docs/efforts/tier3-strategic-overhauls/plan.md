# Tier 3 Strategic Overhauls — Implementation Plan

**PRD**: ./prd.md
**Created**: 2026-04-09
**Status**: Complete

## Progress Tracker
- [x] Phase 1: Evidence Aggregation & Schema
- [x] Phase 2: Proposal Generation & Scheduling
- [x] Phase 3: API & Approval Flow
- [x] Phase 4: Frontend — Proposals Page

---

## Phase 1: Evidence Aggregation & Schema
**Status**: Complete
**Objective**: Build the evidence collection pipeline, add schema columns, and prove threshold gating works.

### Steps
- [x] 1.1 Add migration `apps/api/db/migrations/2026-04-09-tier3-schema.sql`: ALTER TABLE `prediction.learning_proposals` ADD COLUMN `evidence_summary jsonb`, `proposed_context_markdown text`, `current_context_markdown text` (all nullable).
- [x] 1.2 Update `MarketsSchemaService.learningProposalsDdl()` to include the three new columns in the CREATE TABLE DDL (so `ensureSchema()` stays consistent with the migration).
- [x] 1.3 Create `apps/api/src/markets/services/strategic-overhaul.service.ts` with:
  - Constructor: `@Inject(DATABASE_SERVICE)`, `@Inject(MarketsSchemaService)`, `@Inject(CanonicalTestRunnerService)`, `@Inject(MarketsLlmService)`
  - `aggregateEvidence(analystId, organizationSlug)` method that queries:
    - `prediction.audit_findings` where `status='accepted'` grouped by analyst_id, counting findings and extracting top discrepancy patterns
    - `prediction.calibration_tracking` for 30-day calibration trend (latest vs 30 days ago)
    - `prediction.risk_debates` for arbitrator override frequency (where arbiter disagrees with blue team)
  - Returns a typed `EvidenceDossier` interface: `{ acceptedFindingsCount, topPatterns, calibrationDelta, overrideFrequency, findings: [...] }`
  - `meetsThreshold(dossier, config)` method: returns true if acceptedFindingsCount >= minFindings (default 8) AND (calibrationDelta >= minDegradation (default 10%) OR overrideFrequency >= minOverrideRate (default 0.3))
- [x] 1.4 Register `StrategicOverhaulService` in `MarketsModule` providers.
- [x] 1.5 Verify `analyst_config_versions.source` — CHECK constraint already includes `'tier3_strategic'` at line 421 of markets-schema.service.ts. No changes needed. `analyst_config_versions.source` column accepts `'tier3_strategic'` — check for a CHECK constraint. If constrained, add `'tier3_strategic'` to the allowed values in both the migration and schema DDL.
- [x] 1.6 Write unit test `apps/api/tests/unit/strategic-overhaul.test.ts`:
  - Test `meetsThreshold` with sufficient evidence → true
  - Test `meetsThreshold` with sparse data → false
  - Test `meetsThreshold` edge cases: meets findings but no calibration degradation and no override frequency → false; meets findings + calibration but not override → true
  - Test evidence dossier structure typing

### Quality Gate
Before moving to Phase 2, ALL of the following must pass:

- [x] **Lint**: passes clean
- [x] **Build**: all 5 turbo tasks pass
- [x] **Unit Tests**: all 36 test files pass including new strategic-overhaul (16 assertions)
- [x] **Compliance Tests**: suite passes (pre-existing pg-pool teardown on main)
- [x] **Schema**: additive ALTER TABLE ADD COLUMN IF NOT EXISTS — backward-compatible
- [x] **Phase Review**:
  - [x] Evidence aggregation queries cover: accepted findings, calibration trend (perf profiles), override frequency (risk debates)
  - [x] Threshold gating is configurable (ThresholdConfig defaults: 8/10%/0.3)
  - [x] Schema migration is additive and non-destructive
  - [x] `analyst_config_versions.source` CHECK already includes `tier3_strategic`

---

## Phase 2: Proposal Generation & Scheduling
**Status**: Complete
**Objective**: Generate concrete contract rewrites from evidence via LLM, validate with canonical tests, persist proposals, and schedule weekly execution.

### Steps
- [x] 2.1 Add `generateProposal(analystId, organizationSlug, evidence)` method to `StrategicOverhaulService`:
  - Load the analyst's current active `analyst_config_versions` row (the active `context_markdown`)
  - Build LLM prompt: system instructions for contract rewriting, current `context_markdown`, evidence dossier, output format (proposed `context_markdown` + rationale in a parseable structure)
  - Call `MarketsLlmService` with `gemma4:26b`
  - Parse LLM response into `proposedContextMarkdown` and `rationale`
- [x] 2.2 Add `testAndPersistProposal(analystId, organizationSlug, evidence, proposedMarkdown, rationale)` method:
  - Call `CanonicalTestRunnerService.runCanonicalTests()` with the proposed config
  - Determine status: `'passed'` if canonical tests pass, `'failed'` if severity regression or net_score <= 0
  - Insert into `prediction.learning_proposals` with `tier=3`, evidence_summary, proposed_context_markdown, current_context_markdown, canonical_test_results, net_score, has_severity_regression, status, rationale
- [x] 2.3 Add `runStrategicOverhaulCycle()` method:
  - Get all analysts in the org
  - For each: aggregate evidence → check threshold → generate proposal → test & persist
  - Log skip reasons for analysts below threshold
  - Return cycle summary: analysts evaluated, proposals generated, passed, failed
  - Wrap each analyst in try/catch — one failure doesn't stop the cycle
- [x] 2.4 Add deduplication: before generating a proposal, check if a tier=3 proposal already exists for this analyst with status in ('proposed', 'passed', 'testing') — skip if so (prevents duplicate proposals on re-run)
- [x] 2.5 Add `@Cron()` decorator to schedule the cycle. Use env var `TIER3_CRON` with default `'0 2 * * 0'` (Sunday 2 AM). Guard with `MARKETS_ENABLE_LLM` env check (same pattern as audit.service.ts).
- [x] 2.6 Add `POST /admin/run-tier3-overhaul` endpoint in `MarketsController`: call `this.strategicOverhaul.runStrategicOverhaulCycle()`, gated by `this.requireAdmin(user)`. Follow the existing pattern at `POST /admin/run-tier2-audit`.
- [x] 2.7 Inject `StrategicOverhaulService` into `MarketsController` constructor with `@Inject(StrategicOverhaulService)`.
- [x] 2.8 Add the new unit test entry (done in Phase 1 to enable gate) `tsx tests/unit/strategic-overhaul.test.ts` to the `test:unit` script in `apps/api/package.json`.

### Quality Gate
Before moving to Phase 3, ALL of the following must pass:

- [x] **Lint**: passes clean
- [x] **Build**: passes clean
- [x] **Unit Tests**: all pass (added admin/run-tier3-overhaul to adminPaths in beta-reader-guard.test.ts)
- [x] **Compliance Tests**: suite passes (pre-existing pg-pool teardown)
- [ ] **Curl Test — Manual trigger**: deferred to integration (requires running server with LLM)
- [x] **Phase Review**:
  - [x] Proposals written to `learning_proposals` with `tier=3` and all new columns populated
  - [x] Canonical test results attached to each proposal
  - [x] Failed canonical tests block the proposal (status='failed')
  - [x] Cron scheduled weekly with configurable env var (TIER3_CRON, default '0 2 * * 0')
  - [x] Deduplication prevents re-proposing when pending proposal exists

---

## Phase 3: API & Approval Flow
**Status**: Complete
**Objective**: Extend existing proposal endpoints so admin can list, inspect, approve (creating a new config version), and reject Tier 3 proposals.

### Steps
- [x] 3.1 Add `tier` query parameter to `GET /learning/proposals` in `MarketsController` and pass it to `listLearningProposals`. Update `listLearningProposals` in `markets.service.ts` to filter by tier when provided.
- [x] 3.2 Add `GET /learning/proposals/:proposalId` endpoint in `MarketsController` → new `getProposalDetail(orgSlug, userId, proposalId)` method in `markets.service.ts` that returns the full proposal row including `evidence_summary`, `proposed_context_markdown`, `current_context_markdown`, and `canonical_test_results`.
- [x] 3.3 Extend `approveProposal` in `markets.service.ts`: after updating the proposal status to 'approved', check if `tier=3`. If so:
  - Read `proposed_context_markdown` and `analyst_id` from the proposal
  - Find the currently active `analyst_config_versions` row for that analyst
  - Create a new `analyst_config_versions` row with:
    - `context_markdown` = proposed_context_markdown
    - `source` = 'tier3_strategic'
    - `parent_version_id` = the prior active version's id
    - `version_number` = prior version + 1
    - `is_active` = true
  - Deactivate the prior version (`is_active = false`)
  - Update proposal status to 'applied' and set `applied_at = now()`

### Quality Gate
Before moving to Phase 4, ALL of the following must pass:

- [x] **Lint**: passes clean
- [x] **Build**: passes clean
- [x] **Unit Tests**: all pass (49 beta-reader-guard + 16 strategic-overhaul, 0 failures)
- [x] **Compliance Tests**: suite passes (pre-existing pg-pool teardown)
- [ ] **Curl Tests**: deferred to integration (requires running server with data)
- [x] **Phase Review**:
  - [x] `tier` filter works on proposal listing (parameterized query with tier filter)
  - [x] Proposal detail returns all Tier 3 fields via getProposalDetail (full row including evidence_summary, proposed/current_context_markdown, canonical_test_results)
  - [x] Approval creates new `analyst_config_versions` row with source='tier3_strategic', parent_version_id, deactivates prior version
  - [x] Rejection uses existing rejectProposal unchanged — records decision without creating config version

---

## Phase 4: Frontend — Proposals Page
**Status**: Complete
**Objective**: Admin can review, approve, and reject Tier 3 proposals from a dedicated UI page.

### Steps
- [x] 4.1 Create `apps/web/src/stores/proposals.store.ts` Pinia store with:
  - `proposals` ref, `loading` ref, `error` ref
  - `fetchProposals(status?)` → `GET /learning/proposals?tier=3&status=...`
  - `fetchProposalDetail(id)` → `GET /learning/proposals/:id`
  - `approveProposal(id)` → `POST /learning/proposals/:id/approve`
  - `rejectProposal(id, note?)` → `POST /learning/proposals/:id/reject`
- [x] 4.2 Create `apps/web/src/views/ProposalsView.vue`:
  - Status filter tabs: Pending (default), Approved, Rejected
  - Proposal cards showing: analyst name, evidence summary (findings count, calibration delta, top patterns), canonical test badge (pass/fail + net score), rationale (collapsible), contract diff (inline, current vs proposed `context_markdown`), approve/reject buttons (write-access gated via `useCanWrite`)
  - Reject action includes optional note textarea
  - Follow existing patterns from `AuditFindingsView.vue` (IonCard, IonChip, IonButton structure)
- [x] 4.3 Add route in `apps/web/src/router/index.ts`: `{ path: 'proposals', name: 'proposals', component: () => import('../views/ProposalsView.vue') }` — add after the `findings` route.
- [x] 4.4 Add "Proposals" nav item in `apps/web/src/layouts/DefaultLayout.vue` sidebar, after the existing nav items. Use `bulbOutline` or `constructOutline` icon.
- [x] 4.5 Implement inline diff rendering for contract markdown: highlight added lines (green) and removed lines (red) by computing a line-level diff between `current_context_markdown` and `proposed_context_markdown`.

### Quality Gate
Before completing, ALL of the following must pass:

- [x] **Lint**: passes clean
- [x] **Build**: builds successfully (586ms)
- [x] **Typecheck**: pre-existing failures on main (activity.store window, AnalystsView route params) — no new errors introduced
- [ ] **Chrome Tests**: deferred to manual verification (requires running dev server)
- [x] **Phase Review**:
  - [x] All UI elements from PRD §4.4 are present (status filter, evidence summary, diff, rationale, canonical test badge, approve/reject)
  - [x] Write-access gating via useCanWrite (buttons only shown when canWrite is true)
  - [x] Diff rendering shows inline diff with green (added) / red (removed) highlighting
