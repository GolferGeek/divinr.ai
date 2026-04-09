# Tier 2 Audit + Approval Loop — Implementation Plan

**PRD**: ./prd.md
**Created**: 2026-04-09
**Status**: Not Started

## Progress Tracker
<!-- run-plan uses this section to track where we are -->
- [x] Phase 1: Schema + Audit Service (stub LLM)
- [x] Phase 2: Findings Read + Review Endpoints
- [x] Phase 3: LLM Integration
- [x] Phase 4: Frontend Inbox
- [x] Phase 5: Scheduler + Polish

---

## Phase 1: Schema + Audit Service (stub LLM)
**Status**: Not Started
**Objective**: Create the `audit_findings` table and the `AuditService` with a stubbed LLM call that produces one hardcoded finding, plus the manual trigger endpoint.

### Steps
- [ ] 1.1 Add the `audit_findings` DDL to `apps/api/src/markets/schema/markets-schema.service.ts`. Create a new private method `auditFindingsDdl()` and call it from `ensureSchema()`. Table definition per PRD §5.2 (id, organization_slug, analyst_id, prediction_id, config_version_id, contract_excerpt, output_excerpt, discrepancy, hypothesis, severity, status, review_text, reviewed_by, reviewed_at, llm_usage_id, audit_model, created_at). Include indexes.
- [ ] 1.2 Rebuild the API (`pnpm --filter @divinr/api build`), restart, and verify the table exists: `SELECT column_name FROM information_schema.columns WHERE table_schema='prediction' AND table_name='audit_findings' ORDER BY ordinal_position;`
- [ ] 1.3 Create `apps/api/src/markets/services/audit.service.ts`. Constructor injection per CLAUDE.md: `@Inject(DATABASE_SERVICE) db`, `@Inject(MarketsSchemaService) schema`. Import `MarketsService` via a forward-ref or direct import for contract reading (check how other services in the same directory access it — may need to inject or call the DB directly).
- [ ] 1.4 Implement `runAuditCycle(options?: { count?: number }): Promise<{ predictionsChecked: number; findingsCreated: number }>`. Steps:
  a. `await this.schema.ensureSchema();`
  b. Select N candidate predictions using the SQL from PRD §5.5 (wrong-first random selection, skip predictions audited in last 7 days).
  c. For the first candidate: load the contract (via direct SQL — `SELECT context_markdown FROM prediction.analyst_config_versions WHERE id = $1`; parse with the same regex as `parseContractMarkdown`). Extract the role section.
  d. **Stub the LLM call**: instead of calling Ollama, return a hardcoded finding JSON for the first candidate and `{"finding": false}` for the rest.
  e. Insert the finding row into `prediction.audit_findings`.
  f. Return the cycle summary.
- [ ] 1.5 Register `AuditService` in the NestJS module. Check `apps/api/src/markets/markets.module.ts` for the provider registration pattern.
- [ ] 1.6 Add `POST /admin/run-tier2-audit` to `markets.controller.ts` following the existing admin endpoint pattern (near line ~1290, after `run-learning-cycle`). Inject `AuditService` into the controller constructor (with `@Inject(AuditService)`).
- [ ] 1.7 Restart the API. Curl-test the endpoint:
  ```
  TOKEN=$(curl -s http://localhost:7100/auth/login -H 'content-type: application/json' -d '{"email":"demo-user@orchestratorai.io","password":"DemoUser123!"}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["accessToken"])')
  curl -s -X POST "http://localhost:7100/markets/admin/run-tier2-audit" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
  ```
  Expect: `{ "predictionsChecked": 5, "findingsCreated": 1 }` (or similar).
- [ ] 1.8 Verify finding row exists: `SELECT id, analyst_id, prediction_id, discrepancy, severity, status FROM prediction.audit_findings LIMIT 5;`

### Quality Gate
- [ ] **Lint**: `pnpm lint`
- [ ] **Build**: `pnpm build`
- [ ] **Markets CI**: `pnpm ci:markets`
- [ ] **Curl Tests**: `POST /admin/run-tier2-audit` returns 200 with cycle summary. DB has at least one finding row with status `pending_review`.
- [ ] **Chrome Tests**: N/A.
- [ ] **Phase Review**: Compare against PRD §5.2 and §5.5.
  - [ ] `audit_findings` table exists with all columns from PRD?
  - [ ] `AuditService.runAuditCycle` selects candidates, loads contracts, produces findings?
  - [ ] Admin endpoint follows the existing `POST /admin/run-*` pattern?
  - [ ] Stub finding has all required fields (contract_excerpt, output_excerpt, discrepancy, hypothesis, severity)?

---

## Phase 2: Findings Read + Review Endpoints
**Status**: Not Started
**Objective**: Add `GET /markets/audit/findings` and `POST /markets/audit/findings/:findingId/review` so the frontend can read and act on findings.

### Steps
- [ ] 2.1 Add `getAuditFindings(orgSlug, userId)` to `AuditService` (or `MarketsService` — follow the existing pattern for where read endpoints live). SQL joins `audit_findings` to `market_analysts` (for display_name, slug) and to `prediction_horizon_evaluations` + `market_predictions` + `instruments` (for symbol, predicted_direction, actual_direction, was_correct, confidence, change_percent, dates). Filter on `organization_slug` (IDOR-safe) and `status = 'pending_review'` by default.
- [ ] 2.2 Add `reviewAuditFinding(orgSlug, userId, findingId, action, reviewText?)` to the service. Updates the finding's `status`, `review_text`, `reviewed_by`, `reviewed_at`. Validates action is one of `accepted`/`rejected`/`noted`. Returns the updated finding. Rejects if finding is not `pending_review` (idempotent — already reviewed is a no-op or 400).
- [ ] 2.3 Wire `GET /markets/audit/findings` in `markets.controller.ts`. Auth: `getUser` + `resolveIdentity` + service call with org/user. Response shape per PRD §5.3.
- [ ] 2.4 Wire `POST /markets/audit/findings/:findingId/review` in `markets.controller.ts`. Auth: same. Body: `{ action, reviewText? }`.
- [ ] 2.5 Restart API. Curl-test both endpoints:
  ```
  # List findings
  curl -s "http://localhost:7100/markets/audit/findings?organizationSlug=__base__" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool | head -30

  # Review a finding (get the id from the list above)
  curl -s -X POST "http://localhost:7100/markets/audit/findings/<finding-id>/review" -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" -d '{"organizationSlug":"__base__","action":"accepted"}' | python3 -m json.tool
  ```
- [ ] 2.6 Verify the reviewed finding no longer appears in the pending list (re-run GET).

### Quality Gate
- [ ] **Lint**: `pnpm lint`
- [ ] **Build**: `pnpm build`
- [ ] **Markets CI**: `pnpm ci:markets`
- [ ] **Curl Tests**: GET returns findings with all fields from PRD §5.3. POST review updates status. Re-GET confirms reviewed finding is gone from pending.
- [ ] **Chrome Tests**: N/A.
- [ ] **Phase Review**: Compare against PRD §5.3.
  - [ ] Response shape matches PRD?
  - [ ] IDOR-safe (org-slug filter)?
  - [ ] Review is idempotent (double-review doesn't crash)?
  - [ ] All three actions work (accepted/rejected/noted)?

---

## Phase 3: LLM Integration
**Status**: Not Started
**Objective**: Replace the stub with real Ollama calls to `gemma4:26b`, producing actual findings from the dev data.

### Steps
- [ ] 3.1 Ensure `gemma4:26b` is available: `ollama pull gemma4:26b` (may take several minutes; ~16 GB). If it can't be pulled due to memory/disk, fall back to `gemma4:e4b` and note the deviation.
- [ ] 3.2 In `audit.service.ts`, implement the real LLM call. Use `fetch('http://localhost:11434/api/generate', { method: 'POST', body: JSON.stringify({ model, prompt, stream: false }) })`. Extract `response` from the JSON body.
- [ ] 3.3 Implement the audit prompt builder per PRD §5.6. Inputs: general section, role section, symbol, predicted direction, confidence, source_context summary, rationale, actual direction, was_correct, change percent, prices. Output: the prompt string.
- [ ] 3.4 Implement response parsing per PRD §5.7: parse JSON, validate all required fields, handle parse failures gracefully (log + skip). Apply legal-language post-processing on `discrepancy` and `hypothesis` fields.
- [ ] 3.5 Wire the prompt builder + LLM call + response parser into `runAuditCycle`, replacing the stub.
- [ ] 3.6 Add graceful Ollama-down handling: if the fetch throws or returns non-200, log a warning and return `{ predictionsChecked: 0, findingsCreated: 0 }`.
- [ ] 3.7 Clear out stub findings from Phase 1: `DELETE FROM prediction.audit_findings WHERE discrepancy LIKE '%stub%' OR discrepancy LIKE '%hardcoded%';` (or whatever the stub text was).
- [ ] 3.8 Run a real audit cycle: `curl -s -X POST "http://localhost:7100/markets/admin/run-tier2-audit" -H "Authorization: Bearer $TOKEN"`. This will take several minutes (5 Ollama calls). Check the result.
- [ ] 3.9 Verify at least one real finding was created: `SELECT id, discrepancy, hypothesis, severity FROM prediction.audit_findings WHERE status = 'pending_review' LIMIT 5;`
- [ ] 3.10 Read the findings via the GET endpoint and confirm they have coherent content (not gibberish, not generic slop, specific contract excerpts).

### Quality Gate
- [ ] **Lint**: `pnpm lint`
- [ ] **Build**: `pnpm build`
- [ ] **Markets CI**: `pnpm ci:markets`
- [ ] **Curl Tests**: `POST /admin/run-tier2-audit` completes without error. `GET /markets/audit/findings` returns at least one real finding with specific contract/output excerpts.
- [ ] **Chrome Tests**: N/A.
- [ ] **Phase Review**: Compare against PRD §5.5, §5.6, §5.7.
  - [ ] Prompt template matches PRD §5.6?
  - [ ] JSON parsing handles malformed responses gracefully?
  - [ ] Legal-language post-processing applied?
  - [ ] Ollama-down returns gracefully (doesn't crash)?
  - [ ] At least one real finding from dev data?

---

## Phase 4: Frontend Inbox
**Status**: Not Started
**Objective**: Create `AuditFindingsView.vue` at `/findings` with finding cards and three action buttons.

### Steps
- [ ] 4.1 Add the route to `apps/web/src/router/index.ts`: `{ path: 'findings', name: 'findings', component: () => import('../views/AuditFindingsView.vue') }` under `DefaultLayout` children, same pattern as `learning`.
- [ ] 4.2 Create `apps/web/src/views/AuditFindingsView.vue`. Script setup with `useApi()`. On mount, fetch `GET /markets/audit/findings`. Define a local interface for the finding shape.
- [ ] 4.3 Render finding cards per PRD §5.4:
  - Header: analyst name + severity chip (ion-chip with color: high=danger, medium=warning, low=primary)
  - Prediction summary line: symbol, predicted → actual, was_correct chip, confidence, Δ%, dates
  - Contract excerpt in a blockquote (styled like the reasoning `<pre>` blocks)
  - Output excerpt in a blockquote
  - Discrepancy in bold
  - Hypothesis in italic
  - Three action buttons: Agree (success), Disagree (danger), Note (medium)
- [ ] 4.4 Wire the action buttons. On click:
  - Agree/Note: immediately POST review with `action: 'accepted'` / `action: 'noted'`.
  - Disagree: show an inline textarea for optional reason, then POST with `action: 'rejected'` + `reviewText`.
  - On success: remove the card from the list (or move to a "reviewed" section).
  - On error: show an inline error message.
- [ ] 4.5 Empty state: when findings list is empty, render `<ion-note>` with "No pending findings. The audit loop will surface discrepancies as it runs."
- [ ] 4.6 Loading state: `<ion-progress-bar>` while fetching.
- [ ] 4.7 Build the web app: `pnpm --filter @divinr/web build`.

### Quality Gate
- [ ] **Lint**: `pnpm lint`
- [ ] **Build**: `pnpm build`
- [ ] **Markets CI**: `pnpm ci:markets`
- [ ] **Curl Tests**: both endpoints still return 200.
- [ ] **Chrome Tests** (port 7101):
  - Navigate to `/findings` — finding cards render with all fields (analyst name, severity chip, prediction summary, contract excerpt, output excerpt, discrepancy, hypothesis, action buttons).
  - Click "Agree" on a finding — card disappears, re-fetch confirms it's gone from pending.
  - Navigate to `/findings` with no pending findings — empty state renders.
- [ ] **Phase Review**: Compare against PRD §5.4.
  - [ ] Route is `/findings` under DefaultLayout?
  - [ ] All fields from PRD rendered on each card?
  - [ ] All three action buttons work?
  - [ ] Disagree shows textarea?
  - [ ] Empty state present?

---

## Phase 5: Scheduler + Polish
**Status**: Not Started
**Objective**: Add the `@Cron` schedule, env var for cycle count, and write the completion report.

### Steps
- [ ] 5.1 Add `@Cron('0 */2 * * *')` decorator to `runAuditCycle` in `audit.service.ts` (every 2 hours). Import from `@nestjs/schedule`.
- [ ] 5.2 Add env var `AUDIT_PREDICTIONS_PER_CYCLE` (default 5). Read it in `runAuditCycle` as the default count.
- [ ] 5.3 Add a guard: if `MARKETS_ENABLE_LLM !== 'true'`, skip the audit cycle silently (matches how other LLM-dependent features gate themselves).
- [ ] 5.4 Verify the full end-to-end flow:
  a. Run `POST /admin/run-tier2-audit` — findings created.
  b. Open `/findings` — cards render.
  c. Accept a finding — card disappears, feedback logged.
  d. Calibration-drilldown still renders at `/analysts/:id/performance`.
- [ ] 5.5 Write `docs/efforts/current/completion-report.md`.
- [ ] 5.6 Final gate run.

### Quality Gate
- [ ] **Lint**: `pnpm lint`
- [ ] **Build**: `pnpm build`
- [ ] **Markets CI**: `pnpm ci:markets`
- [ ] **Curl Tests**: admin trigger still returns 200. Findings endpoint returns 200.
- [ ] **Chrome Tests**: full smoke at `/findings` — cards, actions, empty state.
- [ ] **Phase Review**: Compare against entire PRD.
  - [ ] All §3 success criteria met?
  - [ ] All §5 technical requirements implemented?
  - [ ] No §7 out-of-scope items snuck in?
  - [ ] Cron schedule configured?
  - [ ] Completion report written?
