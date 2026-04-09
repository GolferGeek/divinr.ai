# Automated Meta-Loop — Implementation Plan

**PRD**: ./prd.md
**Created**: 2026-04-09
**Status**: Not Started

## Progress Tracker
- [x] Phase 1: Policy Generation (no consumption)
- [x] Phase 2: Policy Consumption + Frontend

---

## Phase 1: Policy Generation (no consumption)
**Status**: Not Started
**Objective**: Generate a selection policy from reviewed audit findings and store it in `learning_reports`. Wire the manual trigger and read endpoints.

### Steps
- [ ] 1.1 In `markets-schema.service.ts`, find the `learningSystemDdl()` method. Add an ALTER to update the `report_type` CHECK constraint to include `'audit_policy'`:
  ```sql
  ALTER TABLE prediction.learning_reports
    DROP CONSTRAINT IF EXISTS learning_reports_report_type_check;
  ALTER TABLE prediction.learning_reports
    ADD CONSTRAINT learning_reports_report_type_check
    CHECK (report_type = ANY (ARRAY['nightly_evaluation', 'learning_cycle', 'audit_policy']));
  ```
- [ ] 1.2 Rebuild API, restart, verify constraint allows `'audit_policy'`.
- [ ] 1.3 Add `updateAuditPolicy()` to `audit.service.ts`:
  a. Query reviewed findings (status IN accepted/rejected/noted), join to market_analysts for slug/type.
  b. If count < `AUDIT_POLICY_MIN_REVIEWS` (env var, default 5), return `{ generated: false, reason: 'Not enough...' }`.
  c. Build the policy prompt per PRD §5.3, including accepted/rejected/noted findings with discrepancy + hypothesis + review_text.
  d. Call `gemma4:26b` via Ollama.
  e. Determine confidence level: < 15 reviews → `'tentative'`, >= 15 → `'confident'`.
  f. UPSERT into `learning_reports` with `report_type = 'audit_policy'`, `ON CONFLICT (report_type, report_date) DO UPDATE`.
  g. Return `{ generated: true }`.
  h. Graceful Ollama-down: log warning, return `{ generated: false, reason: 'LLM unavailable' }`.
- [ ] 1.4 Add `getAuditPolicy()` to `audit.service.ts`: query `SELECT summary FROM prediction.learning_reports WHERE report_type = 'audit_policy' ORDER BY report_date DESC LIMIT 1`. Return parsed summary or null.
- [ ] 1.5 Wire `POST /admin/run-audit-policy-update` in controller (same pattern as other admin endpoints).
- [ ] 1.6 Wire `GET /markets/audit/policy` in controller with `getUser` + `resolveIdentity` + `requireRead`.
- [ ] 1.7 Restart API. Test with curl:
  - `POST /admin/run-audit-policy-update` → expect `{ generated: false, reason: 'Not enough...' }` (0 reviewed findings).
  - Review a few findings via curl to create seed data, then re-run.
  - `GET /markets/audit/policy` → returns the policy or null.

### Quality Gate
- [ ] **Lint**: `pnpm lint`
- [ ] **Build**: `pnpm build`
- [ ] **Markets CI**: `pnpm ci:markets`
- [ ] **Curl Tests**: admin trigger returns appropriate response. GET policy returns the policy.
- [ ] **Phase Review**: Compare against PRD §5.2, §5.3, §5.5.
  - [ ] CHECK constraint updated?
  - [ ] Policy generation handles < 5 reviews gracefully?
  - [ ] UPSERT works (re-running same day updates, doesn't duplicate)?
  - [ ] Ollama-down returns gracefully?

---

## Phase 2: Policy Consumption + Frontend
**Status**: Not Started
**Objective**: The audit prompt uses the policy, the findings view shows it, and the cron schedule is wired.

### Steps
- [ ] 2.1 Modify `runAuditCycle` in `audit.service.ts`: at the start, call `getAuditPolicy()`. If a policy exists, pass `policyText` to `buildAuditPrompt`.
- [ ] 2.2 Modify `buildAuditPrompt` to accept an optional `policyText` parameter. If provided, prepend the selection guidance preamble per PRD §5.4 before the existing prompt.
- [ ] 2.3 Add `@Cron('0 1 * * *')` decorator on a new `scheduledPolicyUpdate()` wrapper method (same pattern as `scheduledAuditCycle`). Gate on `MARKETS_ENABLE_LLM`. Also skip if fewer than 3 new reviews since last policy.
- [ ] 2.4 In `AuditFindingsView.vue`, add a fetch for `GET /markets/audit/policy` on mount. If a policy exists, render a collapsible `<ion-card>` titled "Audit Selection Policy" above the findings list, showing the `policyText` + a confidence badge + review count.
- [ ] 2.5 Build web: `pnpm --filter @divinr/web build`.
- [ ] 2.6 Write `docs/efforts/current/completion-report.md`.
- [ ] 2.7 Final gate run.

### Quality Gate
- [ ] **Lint**: `pnpm lint`
- [ ] **Build**: `pnpm build`
- [ ] **Markets CI**: `pnpm ci:markets`
- [ ] **Curl Tests**: both audit endpoints still work. Policy endpoint returns data.
- [ ] **Chrome Tests**: `/findings` shows policy card when policy exists, hides when it doesn't.
- [ ] **Phase Review**: Compare against PRD §5.4, §5.6, §5.7.
  - [ ] Audit prompt includes policy preamble when policy exists?
  - [ ] Audit prompt is unchanged when no policy exists?
  - [ ] Cron schedule configured?
  - [ ] Frontend renders policy card?
  - [ ] Completion report written?
