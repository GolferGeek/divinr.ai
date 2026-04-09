# Tier 3 Strategic Overhauls — Product Requirements Document

## 1. Overview

Tier 3 closes the learning loop by converting accumulated Tier 2 audit evidence into strategic analyst redesign proposals. Where Tier 1 makes bounded micro-adjustments autonomously and Tier 2 flags contract-vs-output mismatches for human review, Tier 3 aggregates patterns across many findings, performance trends, and calibration degradation to propose significant contract rewrites. Every proposal requires human approval — no auto-apply.

## 2. Goals & Success Criteria

| Goal | Measurable Criterion |
|------|---------------------|
| Generate strategic proposals from accumulated Tier 2 evidence | Given ≥ N accepted findings for an analyst (configurable, default 8), the system produces a proposal with a concrete contract diff and rationale |
| Validate proposals against canonical tests before presenting | Every proposal includes `CanonicalTestResult` data; proposals with severity regressions are auto-blocked |
| Admin can review and act on proposals | `/proposals` page shows pending proposals with diff, rationale, and test results; admin can approve or reject |
| Approved proposals create versioned config | New `analyst_config_versions` row with `source='tier3_strategic'` and `parent_version_id` linking to the prior active version |
| Rejected proposals are recorded without side effects | Proposal status set to `rejected`, no config version created |
| Noise suppression | System only generates proposals when sufficient evidence exists (minimum accepted findings threshold + calibration degradation signal) |
| Weekly cadence | Tier 3 runs on a configurable weekly cron schedule |

## 3. User Stories / Use Cases

**Admin reviewing a strategic proposal:**
The admin navigates to `/proposals`, sees a card for analyst "Sector Sentinel" showing: 12 accepted findings about ignoring sector-rotation rules, 18% calibration degradation over 30 days, and a proposed contract rewrite that adds explicit sector-rotation guard-rails. The card shows the diff between the current and proposed `context_markdown`, the LLM's rationale, and canonical test results (net score +3, 0 severity regressions). The admin clicks "Approve" and the system creates a new active config version.

**Admin rejecting a noisy proposal:**
The admin sees a proposal for "Momentum Scout" where canonical tests show a net score of 0 (no improvement). The admin clicks "Reject" and adds a note. The proposal is archived — Tier 3 will not re-propose the same pattern until new evidence accumulates.

**System skipping an analyst with sparse data:**
Analyst "Macro Hawk" has only 3 accepted findings and stable calibration. Tier 3 evaluates this analyst, determines the evidence threshold is not met, and skips without generating a proposal.

## 4. Technical Requirements

### 4.1 Architecture

New service: `StrategicOverhaulService` in `apps/api/src/markets/services/strategic-overhaul.service.ts`.

Responsibilities:
1. **Evidence aggregation** — Query `prediction.audit_findings` (status=accepted, grouped by analyst_id and finding pattern), `prediction.calibration_tracking` (30-day trend), and `prediction.learning_proposals` (tier=2, status=applied) to build an evidence dossier per analyst.
2. **Threshold gating** — Only proceed if the analyst meets the minimum evidence threshold: ≥ N accepted findings (configurable, default 8) AND calibration degradation ≥ M% over 30 days (configurable, default 10%) OR arbitrator override frequency above a configurable threshold.
3. **Proposal generation** — Build an LLM prompt containing the current `context_markdown`, the evidence dossier, and instructions to produce a rewritten contract with specific sections modified. Call `MarketsLlmService` with `gemma4:26b`. Parse the LLM output into a proposed `context_markdown` and a human-readable rationale.
4. **Canonical testing** — Pass the proposed config to `CanonicalTestRunnerService.runCanonicalTests()`. Block proposals with severity regressions. Attach full `CanonicalTestResult` to the proposal.
5. **Persistence** — Write to `prediction.learning_proposals` with `tier=3`, storing evidence summary, proposed change, canonical test results, and rationale.
6. **Scheduling** — `@Cron` decorator, weekly (configurable via env var `TIER3_CRON`, default `0 2 * * 0` — Sunday 2 AM).

Dependencies (all existing, injected via `@Inject()`):
- `DATABASE_SERVICE` (DatabaseService)
- `MarketsSchemaService`
- `CanonicalTestRunnerService`
- `MarketsLlmService`

### 4.2 Data Model Changes

**No new tables.** The existing `prediction.learning_proposals` table already supports `tier=3` via its `tier integer not null check (tier in (1, 2, 3))` constraint.

**New columns on `prediction.learning_proposals`** (additive ALTER):

| Column | Type | Purpose |
|--------|------|---------|
| `evidence_summary` | `jsonb` | Structured evidence dossier: accepted findings count, patterns, calibration trend, override frequency |
| `proposed_context_markdown` | `text` | Full proposed `context_markdown` for diff rendering |
| `current_context_markdown` | `text` | Snapshot of the active `context_markdown` at proposal time (for stable diff even if config changes later) |

These columns are nullable to maintain backward compatibility with existing Tier 1/2 rows.

### 4.3 API Changes

All endpoints under the existing `MarketsController`. Auth: requires authenticated user with write access (`requireWriteAccess()`).

**New endpoints:**

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/learning/proposals?tier=3&status=proposed` | List Tier 3 proposals (extends existing `listLearningProposals` with `tier` filter) |
| `GET` | `/learning/proposals/:proposalId` | Get full proposal detail including evidence summary, diff texts, canonical results |
| `POST` | `/learning/proposals/:proposalId/approve` | Approve proposal → create new `analyst_config_versions` row (already exists, verify it handles Tier 3 source) |
| `POST` | `/learning/proposals/:proposalId/reject` | Reject proposal (already exists) |
| `POST` | `/admin/run-tier3-overhaul` | Manual trigger for Tier 3 cycle (admin convenience, mirrors existing `run-tier2-audit`) |

**Existing endpoint modifications:**

- `GET /learning/proposals` — Add optional `tier` query parameter to filter by tier (1, 2, or 3). Currently returns all tiers.
- `POST /learning/proposals/:proposalId/approve` — Extend approval logic: when `tier=3`, read `proposed_context_markdown` from the proposal, create `analyst_config_versions` with `source='tier3_strategic'` and `parent_version_id` pointing to the currently active version.

### 4.4 Frontend Changes

**New route:** `/proposals` → `ProposalsView.vue`

**ProposalsView.vue** — Admin page listing Tier 3 proposals:
- Filter by status: pending (default), approved, rejected
- Each proposal card shows:
  - Analyst name and slug
  - Evidence summary: N accepted findings, calibration degradation %, top patterns
  - Contract diff: side-by-side or inline diff of current vs. proposed `context_markdown`
  - LLM rationale (collapsible)
  - Canonical test results: net score, improvement/regression counts, pass/fail badge
  - Approve / Reject buttons (write-access gated via `useCanWrite`)
  - Reject includes an optional note field

**Navigation:** Add "Proposals" link to `DefaultLayout.vue` sidebar, after "Findings".

**Pinia store:** Extend `activity.store.ts` or create a lightweight `proposals.store.ts` with:
- `fetchProposals(tier, status)` → `GET /learning/proposals?tier=3&status=...`
- `fetchProposalDetail(id)` → `GET /learning/proposals/:id`
- `approveProposal(id)` → `POST /learning/proposals/:id/approve`
- `rejectProposal(id, note?)` → `POST /learning/proposals/:id/reject`

### 4.5 Infrastructure Requirements

- **LLM:** `gemma4:26b` (local, already available). Tier 3 prompts will be longer than Tier 2 (full contract + evidence dossier) but within context window limits.
- **Cron:** Single weekly cron job. No new infrastructure — uses existing `@nestjs/schedule`.
- **Database:** Additive migration only (ALTER TABLE ADD COLUMN). No destructive changes.

## 5. Non-Functional Requirements

- **Performance:** Tier 3 runs as a background weekly batch. No latency sensitivity. Each analyst evaluation involves one LLM call (proposal generation) + N canonical test LLM calls. Acceptable to run for 30+ minutes.
- **Security:** All endpoints gated behind `requireWriteAccess()`. No public exposure of proposals. Proposals stored with `organization_slug` scoping.
- **Reliability:** If the LLM call fails for one analyst, log the error and continue to the next analyst. Do not fail the entire cycle.
- **Idempotency:** If Tier 3 runs twice with no new evidence, the second run should produce no new proposals (evidence deduplication by tracking which findings have already been considered).

## 6. Out of Scope

- **Creating or deleting analysts** — Tier 3 modifies existing analyst contracts only.
- **Changing risk debate dimensions or weights** — Tier 3 proposes `context_markdown` rewrites, not structural changes to the debate system.
- **Multi-analyst coordination** (e.g., "these two analysts are too similar") — future effort.
- **Automated rollback of Tier 3 changes** — Admin can use the existing contract editor rollback UI.
- **Email/Slack notifications** for new proposals — future enhancement.

## 7. Dependencies & Risks

### Dependencies
| Dependency | Status | Risk |
|-----------|--------|------|
| `CanonicalTestRunnerService` | Shipped, tested | Low — stable API |
| `MarketsLlmService` + gemma4:26b | Shipped, in use by Tier 2 | Low — proven path |
| `learning_proposals` table | Exists, tier=3 already allowed | Low — additive columns only |
| `analyst_config_versions` with `source='tier3_strategic'` | Column supports this value | Low — verify constraint allows it |
| Accepted audit findings (Tier 2 output) | Shipped | Low — data accumulating |
| `calibration_tracking` table | Exists | Low — populated by nightly eval |

### Risks
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| LLM produces low-quality contract rewrites | Medium | Medium | Canonical testing gates bad rewrites. Admin reviews every proposal. Include few-shot examples in prompt. |
| Insufficient Tier 2 evidence for meaningful proposals | Low | Low | Threshold gating prevents noise. System silently skips analysts with sparse data. |
| Proposed contract diffs are hard to read in the UI | Medium | Low | Use inline diff rendering (similar to contract editor). Collapse unchanged sections. |
| `gemma4:26b` context window exceeded by large evidence dossiers | Low | Medium | Truncate evidence to most recent N findings + summary stats. Cap prompt length. |
| `source` column CHECK constraint on `analyst_config_versions` doesn't include `tier3_strategic` | Low | Low | Verify in Phase 1; add if missing via ALTER. |

## 8. Phasing

### Phase 1: Evidence Aggregation & Threshold Gating
**Goal:** Build the evidence collection pipeline and prove it correctly identifies analysts that need strategic intervention.

**Deliverables:**
- `StrategicOverhaulService` with `aggregateEvidence(analystId)` method
- Queries: accepted findings by analyst (grouped by pattern), calibration trend (30-day), arbitrator override frequency
- Threshold evaluation logic with configurable minimums
- Migration: add `evidence_summary`, `proposed_context_markdown`, `current_context_markdown` columns to `learning_proposals`
- Verify `analyst_config_versions.source` supports `tier3_strategic`
- Unit tests for evidence aggregation and threshold logic

**Quality gate:** Tests pass. Given a known analyst with sufficient evidence, the aggregator returns a structured dossier. Given an analyst with sparse data, the threshold rejects.

### Phase 2: Proposal Generation & Canonical Testing
**Goal:** Generate concrete contract rewrites from evidence and validate them.

**Deliverables:**
- LLM prompt template for strategic proposal generation (few-shot examples, evidence dossier injection, output format specification)
- `generateProposal(analystId, evidence)` method → calls `MarketsLlmService`, parses output into proposed `context_markdown` + rationale
- Integration with `CanonicalTestRunnerService` — test proposed config, attach results
- Write proposal to `learning_proposals` with `tier=3`, full evidence and test results
- Cron scheduling with `@Cron` decorator (configurable via `TIER3_CRON` env var)
- Manual trigger endpoint: `POST /admin/run-tier3-overhaul`

**Quality gate:** Tests pass. Given sufficient evidence, the service generates a proposal with a concrete diff and canonical test results stored in `learning_proposals`.

### Phase 3: API & Approval Flow
**Goal:** Admin can list, inspect, approve, and reject Tier 3 proposals via the API.

**Deliverables:**
- Add `tier` query param to `GET /learning/proposals`
- `GET /learning/proposals/:id` returns full detail (evidence, diff texts, canonical results)
- Extend `POST /learning/proposals/:id/approve`: for tier=3, read `proposed_context_markdown`, create `analyst_config_versions` row with `source='tier3_strategic'`, `parent_version_id`, activate it
- Rejection records note in proposal row

**Quality gate:** Tests pass. Approving a Tier 3 proposal creates a new active config version. Rejecting records the decision without side effects.

### Phase 4: Frontend — Proposals Page
**Goal:** Admin can review, approve, and reject Tier 3 proposals from the UI.

**Deliverables:**
- `ProposalsView.vue` with proposal cards: evidence summary, contract diff, rationale, canonical test results, approve/reject actions
- `proposals.store.ts` Pinia store
- Navigation link in `DefaultLayout.vue` sidebar
- Write-access gating via `useCanWrite`
- Status filter (pending/approved/rejected)

**Quality gate:** Lints clean, builds clean. Admin can navigate to `/proposals`, see pending proposals, view diffs and test results, and approve or reject.
