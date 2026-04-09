# Tier 2 Audit + Approval Loop — Product Requirements Document

## 1. Overview

Build the contract-vs-output audit system. A background loop spot-checks resolved predictions against the analyst's structured contract, identifies discrepancies, and writes structured findings to a queue. An admin inbox view surfaces the findings for human judgment (agree / disagree / note). Every judgment is logged for future use by the automated meta-loop.

This is the first *consumer* of the structured contracts shipped in `analyst-contracts`. It fills the `tier2_approved` slot in `analyst_config_versions.source` that has been empty since the schema was designed.

## 2. Discovery Findings That Shape The Design

1. **`learning_proposals` does not fit for findings.** Its status enum (`proposed`/`testing`/`passed`/`failed`/`approved`/`rejected`/`applied`/`reverted`) maps to a *proposal lifecycle*, not a *finding lifecycle*. It has `canonical_test_results`, `net_score`, `has_severity_regression` — all proposal-specific columns that don't apply to findings. A new `audit_findings` table is cleaner, with its own status enum (`pending_review`/`accepted`/`rejected`/`noted`) and review columns inline. Proposals remain in `learning_proposals` (for the stretch goal of generating Tier 2 proposals from accepted findings).

2. **`gemma4:26b` is NOT currently loaded in Ollama.** Only `gemma4:e4b` (9.6 GB) is available. The user indicated `gemma4:26b` should be used for complex tasks. **Prerequisite: `ollama pull gemma4:26b` must be run before Phase 3.** If it can't be pulled (disk/memory), fall back to the best available model with structured-output capability.

3. **The scheduler uses `@nestjs/schedule` with `@Cron` decorators.** Existing patterns: `crawler.service.ts` runs every 15m, `nightly-evaluation.service.ts` runs daily at midnight, `analyst-pipeline.service.ts` runs every 30m. Each also exposes a manual `POST /admin/run-*` endpoint. The audit loop follows this dual pattern.

4. **No admin-specific layout exists in the web app.** All views live under `DefaultLayout.vue`. The Learning Dashboard view at `/learning` already calls admin endpoints (`POST /admin/run-nightly-evaluation`, `POST /admin/run-learning-cycle`). The findings inbox can be a new view at `/findings` under the same layout, or a new route — no admin layout to integrate with.

5. **`source_context` on `market_predictions` is small** (155–319 bytes JSONB). The main content for audit is the `rationale` text field (several hundred chars of the analyst's actual reasoning) plus the `predicted_direction`, `confidence`, and the actual outcome data from `prediction_horizon_evaluations`. The source_context is supplementary — include it in the audit prompt if non-empty, but don't depend on it being rich.

6. **13 admin endpoints exist** at `POST /admin/run-*` in `markets.controller.ts`. The audit trigger fits at `POST /admin/run-tier2-audit`.

7. **`prediction_horizon_evaluations` has `config_version_id`** — but only predictions made *after* the analyst-contracts bootstrap have non-null values. The audit should gracefully handle null `config_version_id` by falling back to the analyst's current active contract (which is what was effectively in use before versioning existed).

## 3. Goals & Success Criteria

Goals:
- A background audit loop runs on a schedule, spot-checks resolved predictions against contracts, and writes findings.
- An admin inbox view at `/findings` shows pending findings with structured detail.
- The user can accept/reject/note findings and the response persists.
- The feedback is logged for future automated meta-loop consumption.

Success criteria:
- The audit loop produces at least one finding from the existing 37 resolved predictions in dev.
- The inbox renders findings with: analyst name, prediction summary, contract excerpt, output excerpt, discrepancy statement, hypothesis, severity.
- Each of the three action buttons works and updates the finding's status.
- `pnpm ci:markets`, `pnpm lint`, `pnpm build` all pass.
- Calibration-drilldown and all prior surfaces still render.
- The feedback log has at least one row after reviewing a finding.

## 4. User Stories

- **Founder (system builder):** "I open `/findings`, see 3 pending findings from overnight. One says 'The Macro Strategist's contract says to focus on yield curves and Fed policy, but this prediction's rationale focused entirely on a single analyst upgrade with no macro context.' I click 'Agree' because that's a real contract violation — the model was lazy."
- **Future automated meta-loop:** "I read the feedback log and see that 8/10 accepted findings were about analysts ignoring their stated data sources. I update the selection policy to weight those patterns higher."
- **Future Tier 2 proposal generator:** "An accepted finding links to prediction X and config version Y. I generate a prompt adjustment that addresses the specific contract violation and write it to `learning_proposals` with `tier=2`."

## 5. Technical Requirements

### 5.1 Architecture

One new NestJS service (`AuditService`), one new table (`audit_findings`), one new admin endpoint, one new frontend view. The service runs on a `@Cron` schedule and is also manually triggerable. The frontend view is a standalone Vue page under `DefaultLayout`.

### 5.2 Data Model Changes

**New table: `prediction.audit_findings`**

```sql
CREATE TABLE IF NOT EXISTS prediction.audit_findings (
  id                text PRIMARY KEY,
  organization_slug text NOT NULL,
  analyst_id        text NOT NULL,
  prediction_id     text NOT NULL,
  config_version_id text,
  -- Audit content
  contract_excerpt  text NOT NULL,
  output_excerpt    text NOT NULL,
  discrepancy       text NOT NULL,
  hypothesis        text NOT NULL,
  severity          text NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  -- Review
  status            text NOT NULL DEFAULT 'pending_review'
                    CHECK (status IN ('pending_review', 'accepted', 'rejected', 'noted')),
  review_text       text,
  reviewed_by       text,
  reviewed_at       timestamptz,
  -- Metadata
  llm_usage_id      uuid,
  audit_model       text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_findings_status_idx
  ON prediction.audit_findings (organization_slug, status);
CREATE INDEX IF NOT EXISTS audit_findings_analyst_idx
  ON prediction.audit_findings (analyst_id);
CREATE INDEX IF NOT EXISTS audit_findings_prediction_idx
  ON prediction.audit_findings (prediction_id);
```

Feedback is stored *inline* on the finding row (the `status`, `review_text`, `reviewed_by`, `reviewed_at` columns). A finding is created with `status='pending_review'` and updated once when the user acts. This is simpler than a separate feedback table and sufficient for v1. The moral append-only property holds: the application only transitions `pending_review` → one of `{accepted, rejected, noted}`, never backwards.

### 5.3 API Changes

**New endpoint: `POST /admin/run-tier2-audit`**

Triggers the audit cycle manually. Auth: `getUser(req)` (same pattern as other admin endpoints). No query params — runs the default N checks. Returns the cycle summary (predictions checked, findings created).

```typescript
@Post('admin/run-tier2-audit')
async triggerTier2Audit(@Req() req: { user?: AuthenticatedUser }) {
  this.getUser(req);
  return this.auditService.runAuditCycle();
}
```

**New endpoint: `GET /markets/audit/findings`**

Returns pending findings for the admin inbox. Auth: `getUser` + `resolveIdentity` + `requireRead`. Response shape:

```typescript
{
  findings: Array<{
    id: string;
    analystId: string;
    analystName: string;
    analystSlug: string;
    predictionId: string;
    symbol: string;
    predictedDirection: string;
    actualDirection: string;
    wasCorrect: boolean;
    confidence: number | null;
    changePercent: number | null;
    predictionDate: string;
    evaluationDate: string;
    contractExcerpt: string;
    outputExcerpt: string;
    discrepancy: string;
    hypothesis: string;
    severity: 'low' | 'medium' | 'high';
    status: 'pending_review' | 'accepted' | 'rejected' | 'noted';
    createdAt: string;
  }>;
}
```

**New endpoint: `POST /markets/audit/findings/:findingId/review`**

Body: `{ action: 'accepted' | 'rejected' | 'noted', reviewText?: string }`. Auth: same as above. Updates the finding's review columns. Returns the updated finding.

### 5.4 Frontend Changes

**New view: `apps/web/src/views/AuditFindingsView.vue`**

Route: `/findings` under `DefaultLayout`. Added to `apps/web/src/router/index.ts`.

Layout:
- Page title: "Audit Findings"
- If no pending findings: `<ion-note>` empty state
- List of finding cards, most recent first. Each card shows:
  - Header: analyst name + severity chip (color-coded: high=danger, medium=warning, low=primary)
  - Prediction summary line: `AAPL up → down [WRONG] conf 75% Δ −0.16% (Apr 6 → Apr 8)`
  - **Contract says:** blockquote with the contract excerpt
  - **Analyst said:** blockquote with the output excerpt
  - **Discrepancy:** bold one-line statement
  - **Hypothesis:** italic one-line explanation
  - Three action buttons:
    - `Agree` (success color) — sets status to `accepted`
    - `Disagree` (danger color) — shows a textarea for optional reason, then sets status to `rejected`
    - `Note` (medium color) — sets status to `noted`
  - After acting: card collapses or moves to a "reviewed" section below

Uses `useApi()` for data fetching, same pattern as all other views. No pinia store needed.

### 5.5 Audit Service

**New file: `apps/api/src/markets/services/audit.service.ts`**

Constructor injection (explicit `@Inject` per CLAUDE.md):
- `@Inject(DATABASE_SERVICE) private readonly db: DatabaseService`
- `@Inject(MarketsSchemaService) private readonly schema: MarketsSchemaService`
- `@Inject(MarketsService) private readonly markets: MarketsService` (for `getContextForConfigVersion`, `getActiveContextForAnalyst`)

Methods:

**`runAuditCycle(options?: { count?: number }): Promise<AuditCycleResult>`**

The main loop. Default count = 5.

1. Select N candidate predictions:
   ```sql
   SELECT e.prediction_id, e.analyst_id, e.was_correct,
          mp.rationale, mp.predicted_direction, mp.confidence,
          mp.config_version_id, mp.source_context,
          e.actual_direction, e.actual_outcome_data, e.evaluation_date,
          i.symbol, ma.display_name, ma.slug
   FROM prediction.prediction_horizon_evaluations e
   JOIN prediction.market_predictions mp ON mp.id = e.prediction_id
   JOIN prediction.instruments i ON i.id = e.instrument_id
   JOIN prediction.market_analysts ma ON ma.id = e.analyst_id
   WHERE e.organization_slug = '__base__'
     AND e.prediction_id NOT IN (
       SELECT prediction_id FROM prediction.audit_findings
       WHERE created_at > now() - interval '7 days'
     )
   ORDER BY
     CASE WHEN e.was_correct THEN 1 ELSE 0 END ASC,  -- wrong first
     random()
   LIMIT $1
   ```
   The `CASE` + `random()` gives wrong predictions ~3× more likely selection (all wrong rows sort before correct, then random within each bucket, and we take N).

2. For each candidate:
   a. Load the contract via `getContextForConfigVersion(configVersionId)`. If null (config_version_id was null or contract not yet written), fall back to `getActiveContextForAnalyst(analystId, '__base__')`. If still null, skip.
   b. Extract the role section from `contract.sections.roles` (pick the first one — each analyst has exactly one role today).
   c. Build the audit prompt (see §5.6).
   d. Call Ollama (`POST http://localhost:11434/api/generate`, model `gemma4:26b`, `stream: false`).
   e. Parse the response. If "consistent" → skip. If structured finding → validate and insert.

3. Return `{ predictionsChecked: N, findingsCreated: M }`.

**Cron schedule:** `@Cron('0 */2 * * *')` — every 2 hours. Checks 5 predictions per cycle. Adjustable via env var `AUDIT_PREDICTIONS_PER_CYCLE`.

### 5.6 Audit Prompt Template

```
You are auditing a financial market analyst's prediction against its operating contract.

ANALYST CONTRACT (Role Section):
"""
{roleSectionText}
"""

ANALYST CONTRACT (General Section):
"""
{generalSectionText}
"""

PREDICTION INPUT:
- Instrument: {symbol}
- Predicted direction: {predictedDirection}
- Confidence: {confidence}%
- Source context: {sourceContextSummary}

PREDICTION OUTPUT (Analyst's Rationale):
"""
{rationale}
"""

ACTUAL OUTCOME:
- Actual direction: {actualDirection}
- Was correct: {wasCorrect}
- Price change: {changePercent}% ({priceAtPrediction} → {priceAtHorizon})

TASK:
Compare the analyst's rationale against its contract. Is there a discrepancy where the output violates or ignores the contract's stated purpose, decision criteria, or failure modes?

If YES, respond in EXACTLY this JSON format:
{
  "finding": true,
  "contractExcerpt": "<quote the specific part of the contract that was violated>",
  "outputExcerpt": "<quote the specific part of the rationale that violates it>",
  "discrepancy": "<one sentence describing the discrepancy>",
  "hypothesis": "<one sentence explaining why the model may have drifted>",
  "severity": "<low|medium|high>"
}

If NO discrepancy, respond with exactly:
{"finding": false}

Respond ONLY with the JSON. No preamble, no explanation.
```

### 5.7 Response Parsing

The LLM response is parsed as JSON. If parsing fails or `finding` is not a boolean, the check is logged as an error and skipped (does not create a finding, does not crash). If `finding: true`, validate that all 5 fields (`contractExcerpt`, `outputExcerpt`, `discrepancy`, `hypothesis`, `severity`) are non-empty strings and `severity` is one of `low`/`medium`/`high`. If validation fails, log and skip.

Post-processing: apply the same legal-language replacements as the contract generation script (replace "advice" → "analysis", "recommendation" → "assessment") on `discrepancy` and `hypothesis` fields.

## 6. Non-Functional Requirements

- **Performance:** the audit cycle runs in the background with no latency budget. Each Ollama call to `gemma4:26b` may take 30–90 seconds. A 5-prediction cycle takes ~5 minutes. This is fine — it runs every 2 hours.
- **DI:** explicit `@Inject(...)` on every constructor parameter per CLAUDE.md.
- **Security:** all new endpoints use `getUser(req)` + `requireRead`. SQL is parameterized. No secrets in code.
- **Compatibility:** no changes to existing endpoints, views, or services. The `AuditService` is additive.
- **No regressions** in `pnpm ci:markets`, `pnpm lint`, `pnpm build`.
- **Ollama dependency:** the audit cycle silently skips if Ollama is unreachable (logs a warning, returns `{ predictionsChecked: 0, findingsCreated: 0 }`). Does not crash the API.

## 7. Out of Scope

Inherits all out-of-scope items from the intention. Additionally:
- **Proposal generation from accepted findings** (stretch goal — deferred unless the core loop ships clean).
- **Multiple audit types** (v1 is contract-vs-output only).
- **Automated meta-loop** (feedback log accumulates, no consumer).
- **Batch operations, filtering, search** in the inbox.
- **Contract editing from findings.**
- **Day trader auditing.**
- **Notifications/email.**
- **Changing Tier 1.**

## 8. Dependencies & Risks

Dependencies (all met unless noted):
- `analyst-contracts` merged ✅
- `getActiveContextForAnalyst`, `getContextForConfigVersion` exist ✅
- `@nestjs/schedule` is installed and active ✅
- Ollama running at localhost:11434 ✅
- **`gemma4:26b` must be pulled** before Phase 3 (`ollama pull gemma4:26b`). Currently only `gemma4:e4b` is loaded. If memory/disk constraints prevent pulling, fall back to `gemma4:e4b` with heavier post-processing.

Risks:
- **R1: Audit prompt slop.** The LLM may produce generic "something looks off" findings rather than specific contract violations. Mitigation: the prompt demands structured JSON with specific excerpts; validation rejects findings without all required fields. If quality is low, iterate on the prompt — the prompt template is isolated in one method.
- **R2: JSON parsing failures.** Local models sometimes emit non-JSON or partial JSON. Mitigation: graceful skip on parse failure, logged with the raw response for debugging. Does not crash.
- **R3: Small prediction pool.** Only 37 resolved predictions in dev. After a few audit cycles, all will have been checked and the 7-day skip window means the cycle goes quiet. This is expected and truthful — the pool grows as the nightly pipeline runs.
- **R4: `config_version_id` null on historical predictions.** Mitigation: fallback to `getActiveContextForAnalyst` when `config_version_id` is null. This is technically imprecise (the current contract may differ from what was active historically) but is the best available for pre-versioning predictions.

## 9. Phasing

**Phase 1 — Schema + Audit Service (no LLM, no UI)**
Add the `audit_findings` DDL to `markets-schema.service.ts`. Create `audit.service.ts` with `runAuditCycle` that selects candidates, loads contracts, but stubs the LLM call (returns a hardcoded finding for the first candidate, "consistent" for the rest). Wire the `POST /admin/run-tier2-audit` endpoint. Validate with curl that the endpoint creates a finding row in the DB.

**Phase 2 — Findings Read + Review Endpoints**
Add `GET /markets/audit/findings` and `POST /markets/audit/findings/:findingId/review`. Validate with curl: list returns the stub finding, review updates status.

**Phase 3 — LLM Integration**
Replace the stub with the real Ollama call to `gemma4:26b`. Build the audit prompt template (§5.6). Add JSON parsing + validation + post-processing. Run a real audit cycle against dev data. Validate: at least one real finding is created.

**Phase 4 — Frontend Inbox**
Create `AuditFindingsView.vue` at `/findings`. Wire to the two endpoints. Render finding cards with all fields. Wire the three action buttons. Validate in the browser.

**Phase 5 — Scheduler + Polish**
Add `@Cron('0 */2 * * *')` to `runAuditCycle`. Add env var `AUDIT_PREDICTIONS_PER_CYCLE`. Final gate run. Completion report.
