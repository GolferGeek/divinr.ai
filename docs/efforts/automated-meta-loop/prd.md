# Automated Meta-Loop — Product Requirements Document

## 1. Overview

Add the feedback-to-behavior loop to the Tier 2 audit system. A background job reads accumulated accept/reject/note responses from the audit inbox, identifies patterns in the user's preferences, generates a natural-language selection policy via `gemma4:26b`, and feeds that policy back into the audit cycle's prompt so it surfaces findings the user actually cares about.

## 2. Discovery Findings

1. **`learning_reports.report_type` CHECK constraint** only allows `'nightly_evaluation'` and `'learning_cycle'`. Must be altered to include `'audit_policy'`. DDL change in `markets-schema.service.ts`.
2. **UNIQUE constraint on `(report_type, report_date)`** means one `audit_policy` row per day — perfect for daily policy updates.
3. **`buildAuditPrompt` in `audit.service.ts:310`** is where the selection policy needs to be injected — prepended as a preamble before the existing prompt.
4. **5 findings exist, 0 reviewed.** The meta-loop needs a graceful "not enough data" path for the first run.

## 3. Goals & Success Criteria

Goals:
- A background job generates a selection policy from reviewed findings.
- The audit cycle reads the policy and incorporates it into its prompt.
- The policy is human-readable and retrievable via an endpoint.

Success criteria:
- `updateAuditPolicy()` runs without error, reads reviewed findings, calls `gemma4:26b`, and writes an `audit_policy` row to `learning_reports`.
- With <5 reviewed findings, the method skips gracefully and logs "not enough feedback data."
- With 5+ reviewed findings, a policy is generated and stored.
- The audit prompt includes the policy text as a preamble when a policy exists.
- `GET /markets/audit/policy` returns the current policy text.
- `POST /admin/run-audit-policy-update` triggers the policy generation manually.
- `pnpm ci:markets`, `pnpm lint`, `pnpm build` all pass.

## 4. User Stories

- **Founder:** "I've reviewed 15 findings over a week. I rejected most of the 'analyst didn't cite enough macro data' ones because I don't care about that. Now when I open the inbox, the new findings are about cross-instrument blind spots and overconfidence — the things I actually accepted. The audit learned what I care about."
- **Founder (transparency):** "I visit `/findings` and see a 'Current Policy' section that says 'Prioritize findings about analysts ignoring their stated data sources. Skip low-severity findings about missing macro citations.' I can see what the system learned about my preferences."

## 5. Technical Requirements

### 5.1 Architecture

One new method on `AuditService` (`updateAuditPolicy`), one new `@Cron` schedule, one new admin trigger endpoint, one new GET endpoint for reading the policy, one DDL change to the `learning_reports` CHECK constraint. Small modifications to `buildAuditPrompt` to prepend the policy.

### 5.2 Data Model Changes

**Alter `learning_reports.report_type` CHECK constraint** to include `'audit_policy'`:

```sql
ALTER TABLE prediction.learning_reports
  DROP CONSTRAINT learning_reports_report_type_check;
ALTER TABLE prediction.learning_reports
  ADD CONSTRAINT learning_reports_report_type_check
  CHECK (report_type = ANY (ARRAY[
    'nightly_evaluation', 'learning_cycle', 'audit_policy'
  ]));
```

Added to the `learningSystemDdl()` method in `markets-schema.service.ts`.

No new tables. The policy is stored as a `learning_reports` row with:
- `report_type`: `'audit_policy'`
- `report_date`: current date
- `summary`: `{ policyText: string, reviewedCount: number, acceptedCount: number, rejectedCount: number, notedCount: number, generatedAt: string, confidenceLevel: 'tentative' | 'confident' }`

### 5.3 Policy Generation Method

**`updateAuditPolicy(): Promise<{ generated: boolean; reason?: string }>`**

Steps:
1. Query all reviewed findings: `SELECT af.*, ma.slug, ma.analyst_type FROM prediction.audit_findings af JOIN prediction.market_analysts ma ON ma.id = af.analyst_id WHERE af.status IN ('accepted', 'rejected', 'noted') ORDER BY af.reviewed_at DESC`.
2. If count < `AUDIT_POLICY_MIN_REVIEWS` (default 5, env var), return `{ generated: false, reason: 'Not enough reviewed findings (N < 5)' }`.
3. Build a summary of the feedback: count by status, group by discrepancy keywords, group by analyst, group by severity. Include the `review_text` from rejected findings (the user's "why" explanation).
4. Call `gemma4:26b` with a prompt:

```
You are analyzing a user's feedback on AI-generated audit findings to learn their preferences.

FEEDBACK SUMMARY:
- Total reviewed: {N}
- Accepted: {accepted} ({accepted_pct}%)
- Rejected: {rejected} ({rejected_pct}%)
- Noted: {noted} ({noted_pct}%)

ACCEPTED FINDINGS (the user agreed these were real problems):
{list of accepted findings with discrepancy + hypothesis}

REJECTED FINDINGS (the user said these were NOT problems):
{list of rejected findings with discrepancy + hypothesis + user's reason if provided}

NOTED FINDINGS (interesting but no action):
{list of noted findings with discrepancy + hypothesis}

TASK:
Based on this feedback, write a selection policy (200-400 words) that tells the audit system:
1. What kinds of discrepancies to PRIORITIZE (patterns the user consistently accepts)
2. What kinds of discrepancies to SKIP or de-prioritize (patterns the user consistently rejects)
3. Any analyst-specific preferences (e.g., "the user cares more about Fundamentals Analyst findings")
4. Severity preferences (does the user engage more with high, medium, or low severity?)

Write the policy as direct instructions to the audit system, in second person ("You should prioritize...", "Skip findings about...").

If the sample size is small (< 15 reviews), note that the policy is tentative and should not make strong skip/prioritize claims.
```

5. Store the result in `learning_reports` with `report_type = 'audit_policy'`, using `ON CONFLICT (report_type, report_date) DO UPDATE` so re-running on the same day updates rather than duplicates.
6. Return `{ generated: true }`.

### 5.4 Policy Consumption in Audit Prompt

Modify `buildAuditPrompt` in `audit.service.ts` to:
1. At the start of `runAuditCycle`, load the most recent `audit_policy` from `learning_reports`: `SELECT summary FROM prediction.learning_reports WHERE report_type = 'audit_policy' ORDER BY report_date DESC LIMIT 1`.
2. Extract `policyText` from the `summary` JSONB.
3. If a policy exists, prepend it to the audit prompt as:

```
SELECTION GUIDANCE (learned from user feedback):
"""
{policyText}
"""

Apply this guidance when evaluating the following prediction. If the guidance says to skip a certain type of finding, respond with {"finding": false} even if you notice a minor discrepancy of that type.

---

[existing audit prompt follows]
```

4. If no policy exists, the prompt is unchanged (current behavior).

### 5.5 API Changes

**New endpoint: `POST /admin/run-audit-policy-update`**
Manual trigger. Auth: `getUser(req)`. Returns `{ generated: boolean, reason?: string }`.

**New endpoint: `GET /markets/audit/policy`**
Returns the current policy. Auth: `getUser` + `resolveIdentity` + `requireRead`. Response:

```typescript
{
  policy: {
    policyText: string;
    reviewedCount: number;
    acceptedCount: number;
    rejectedCount: number;
    notedCount: number;
    confidenceLevel: 'tentative' | 'confident';
    generatedAt: string;
  } | null;  // null if no policy exists yet
}
```

### 5.6 Frontend Changes

Add a small "Current Policy" section to `AuditFindingsView.vue`, above the findings list:
- If no policy exists: nothing rendered (don't show an empty section).
- If a policy exists: a collapsible `<ion-card>` titled "Audit Selection Policy" with the `policyText` rendered, plus a small badge showing "tentative" or "confident" and the review count.

### 5.7 Cron Schedule

`@Cron('0 1 * * *')` — daily at 01:00 UTC, after the nightly evaluation (which runs at midnight). Also check: if the number of *new* reviews since the last policy generation is < 3, skip the update (no point regenerating from the same data).

## 6. Non-Functional Requirements

- **Graceful degradation:** if Ollama is down, `updateAuditPolicy` logs a warning and returns `{ generated: false, reason: 'LLM unavailable' }`. Does not crash.
- **Idempotent:** running twice on the same day updates the same row (UPSERT on `report_type, report_date`).
- **DI:** explicit `@Inject(...)` per CLAUDE.md.
- **No regressions** in existing gates.

## 7. Out of Scope

- Auto-approving or auto-rejecting findings.
- Changing analyst contracts or behavior.
- A UI for editing the policy (read-only display only).
- Multiple audit types.
- Real-time policy updates (schedule-driven only).

## 8. Dependencies & Risks

Dependencies (all met):
- `tier-2-audit` merged ✅
- `audit_findings` table with review columns ✅
- `learning_reports` table ✅
- `gemma4:26b` available ✅

Risks:
- **R1: Policy slop.** The LLM may produce generic policy text ("prioritize important findings") that doesn't actually change audit behavior. Mitigation: the prompt includes specific finding examples with discrepancies, and the policy format is structured as direct instructions. If quality is low, iterate on the prompt.
- **R2: Small sample bias.** With 5-10 reviews, the policy may over-fit to a small set of findings. Mitigation: the confidence level is `'tentative'` below 15 reviews, and the policy prompt explicitly notes the small sample.
- **R3: Policy drift.** Over time, the policy may lock into a narrow focus and miss new types of discrepancies. Mitigation: the audit still runs with random selection — the policy is guidance, not a hard filter. The `{"finding": false}` skip is a suggestion, not a guarantee.

## 9. Phasing

**Phase 1 — Policy Generation (no consumption)**
Alter the CHECK constraint. Implement `updateAuditPolicy()` with the LLM prompt. Wire `POST /admin/run-audit-policy-update`. Verify it generates a policy (or gracefully skips with <5 reviews). Wire `GET /markets/audit/policy` to read the current policy.

**Phase 2 — Policy Consumption + Frontend**
Modify `buildAuditPrompt` to prepend the policy. Add the "Current Policy" card to `AuditFindingsView.vue`. Wire the `@Cron` schedule. Final gate run + completion report.
