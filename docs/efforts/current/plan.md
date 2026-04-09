# Analyst Contracts — Implementation Plan

**PRD**: ./prd.md
**Created**: 2026-04-09
**Status**: Not Started

## Progress Tracker
<!-- run-plan uses this section to track where we are -->
- [x] Phase 1: Schema + Bootstrap
- [x] Phase 2: Canonical Reader Methods
- [x] Phase 3: AI Scaffolding + Contract Generation
- [x] Phase 4: Tier 1 Carry-Forward
- [x] Phase 5: Polish + Completion Report

---

## Phase 1: Schema + Bootstrap
**Status**: Not Started
**Objective**: Add `context_markdown` column to `analyst_config_versions` and create v1 config version rows for the 7 base analysts so `config_version_id` tracking activates on new predictions.

### Steps
- [ ] 1.1 In `apps/api/src/markets/schema/markets-schema.service.ts`, find the `analystVersioningDdl()` method (or the DDL block that creates `analyst_config_versions`). Add `ALTER TABLE prediction.analyst_config_versions ADD COLUMN IF NOT EXISTS context_markdown text;` after the table creation.
- [ ] 1.2 Run `pnpm --filter @divinr/api build` to confirm the schema change compiles.
- [ ] 1.3 Restart the dev API (port 7100) so `ensureSchema()` runs and applies the new column. Verify column exists: `SELECT column_name FROM information_schema.columns WHERE table_schema='prediction' AND table_name='analyst_config_versions' AND column_name='context_markdown';`
- [ ] 1.4 Write `scripts/bootstrap-analyst-versions.ts`. Pattern: read `scripts/seed-demo-tenants.ts` for DB access style. For each of the 7 `__base__` analysts (fundamentals-analyst, macro-strategist, momentum-analyst, sentiment-analyst, technical-analyst, arbitrator, portfolio-manager):
  - Read `persona_prompt`, `tier_instructions`, `default_weight` from `prediction.market_analysts` where `slug = X and organization_slug = '__base__'`
  - Skip if `current_config_version_id` is already non-null (idempotent)
  - INSERT into `prediction.analyst_config_versions` with: `version_number=1, source='manual', change_reason='Bootstrap initial config version', context_markdown=NULL, is_active=true, created_by='system'`
  - UPDATE `prediction.market_analysts SET current_config_version_id = <new_id>` for that analyst
- [ ] 1.5 Run the bootstrap script: `cd /home/golfergeek/projects/divinr.ai && npx tsx scripts/bootstrap-analyst-versions.ts`
- [ ] 1.6 Verify bootstrap: query `SELECT ma.slug, acv.id, acv.version_number, acv.is_active FROM prediction.analyst_config_versions acv JOIN prediction.market_analysts ma ON ma.current_config_version_id = acv.id WHERE ma.organization_slug = '__base__';` — should return 7 rows.

### Quality Gate
Before moving to Phase 2, ALL of the following must pass:
- [ ] **Lint**: `pnpm lint`
- [ ] **Build**: `pnpm build`
- [ ] **Markets CI**: `pnpm ci:markets`
- [ ] **DB Verification**: 7 config version rows exist for `__base__` analysts. All 7 `market_analysts` rows have non-null `current_config_version_id`.
- [ ] **Curl Tests**: calibration endpoint still works:
  - Login: `TOKEN=$(curl -s http://localhost:7100/auth/login -H 'content-type: application/json' -d '{"email":"demo-user@orchestratorai.io","password":"DemoUser123!"}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["accessToken"])')`
  - `curl -s "http://localhost:7100/markets/analysts/<macro-strategist-id>/calibration?organizationSlug=__base__" -H "Authorization: Bearer $TOKEN"` returns 200.
- [ ] **Chrome Tests**: N/A (no UI changes).
- [ ] **Phase Review**: Compare against PRD §5.2 and §5.3.
  - [ ] Column exists on `analyst_config_versions`?
  - [ ] 7 v1 rows bootstrapped with correct `persona_prompt`, `tier_instructions`, `default_weight`?
  - [ ] `current_config_version_id` wired on all 7 analysts?
  - [ ] Bootstrap script is idempotent (running again does not duplicate rows)?

---

## Phase 2: Canonical Reader Methods
**Status**: Not Started
**Objective**: Add `getActiveContextForAnalyst`, `getContextForConfigVersion`, and `parseContractMarkdown` to `markets.service.ts` so contracts are readable through one canonical path.

### Steps
- [ ] 2.1 Define the `AnalystContract` interface in `markets.service.ts` (inline, same convention as `LlmCallRow` and `AnalystCalibrationPayload`):
  ```typescript
  interface AnalystContract {
    markdown: string;
    sections: {
      general: string;
      roles: Record<string, string>;
      adaptations: string;
    };
  }
  ```
- [ ] 2.2 Implement `private parseContractMarkdown(markdown: string): AnalystContract['sections']`. Split on `## ` headings. Match `General` → `sections.general`, `Role: <name>` → `sections.roles[name]`, `Adaptations` → `sections.adaptations`. Unrecognized headings are ignored. Missing sections return empty strings.
- [ ] 2.3 Implement `async getActiveContextForAnalyst(analystId: string, orgSlug: string): Promise<AnalystContract | null>`. Query: `SELECT acv.context_markdown FROM prediction.market_analysts ma JOIN prediction.analyst_config_versions acv ON acv.id = ma.current_config_version_id WHERE ma.id = $1 AND (ma.organization_slug = $2 OR ma.organization_slug = '__base__')`. Return null if no row or `context_markdown` is null. Otherwise return `{ markdown, sections: parseContractMarkdown(markdown) }`. Use `requireRead` + `ensureSchema` per existing pattern.
- [ ] 2.4 Implement `async getContextForConfigVersion(configVersionId: string): Promise<AnalystContract | null>`. Query: `SELECT context_markdown FROM prediction.analyst_config_versions WHERE id = $1`. Return null if no row or `context_markdown` is null. Otherwise parse and return.
- [ ] 2.5 Write a focused unit test for `parseContractMarkdown` (can be inline in an existing test file or a new `tests/unit/parse-contract-markdown.test.ts`):
  - Happy path: all three sections present, correct extraction.
  - Missing `## Adaptations`: returns empty string for adaptations.
  - Multiple `## Role:` sections: all captured in `roles` record.
  - Null/empty input: returns empty strings for all sections.
  - Content between sections preserves leading/trailing whitespace trimmed.

### Quality Gate
Before moving to Phase 3, ALL of the following must pass:
- [ ] **Lint**: `pnpm lint`
- [ ] **Build**: `pnpm build`
- [ ] **Unit Tests**: `pnpm test` — new parser test passes (pre-existing compliance:mutation failure is unrelated, documented in calibration-drilldown).
- [ ] **Markets CI**: `pnpm ci:markets`
- [ ] **Curl Tests**: N/A (no new endpoints).
- [ ] **Chrome Tests**: N/A.
- [ ] **Phase Review**: Compare against PRD §5.6.
  - [ ] `getActiveContextForAnalyst` exists and returns null for analysts with `context_markdown=NULL`?
  - [ ] `getContextForConfigVersion` exists and returns null for v1 rows?
  - [ ] `parseContractMarkdown` handles all edge cases?
  - [ ] `AnalystContract` interface matches PRD shape?

---

## Phase 3: AI Scaffolding + Contract Generation
**Status**: Not Started
**Objective**: Generate structured markdown contracts for each of the 7 base analysts via `gemma4:e4b` and store them as v2 config versions.

### Steps
- [ ] 3.1 Write `scripts/generate-analyst-contracts.ts`. DB access pattern: follow `seed-demo-tenants.ts` (dotenv + Supabase client or direct pg). LLM access: HTTP POST to `http://localhost:11434/api/generate` with `model: 'gemma4:e4b'`.
- [ ] 3.2 For each of the 7 `__base__` analysts:
  a. Read the v1 config version's `persona_prompt` and `tier_instructions` (via `current_config_version_id`).
  b. For personality analysts: query up to 10 most recent resolved predictions: `SELECT mp.rationale, mp.predicted_direction, mp.confidence, phe.actual_direction, phe.was_correct, phe.actual_outcome_data FROM prediction.prediction_horizon_evaluations phe JOIN prediction.market_predictions mp ON mp.id = phe.prediction_id WHERE phe.analyst_id = $1 AND phe.organization_slug = '__base__' ORDER BY phe.evaluation_date DESC LIMIT 10`.
  c. For arbitrator/portfolio-manager: skip prediction samples (0 available).
  d. Build the scaffolding prompt. Include:
     - The existing persona_prompt
     - Tier instructions (if non-empty)
     - Sample predictions with outcomes (if any)
     - The target structure: `## General`, `## Role: <appropriate role>`, `## Adaptations`
     - Legal-language rules: "use 'analysis' and 'signal', never 'advice' or 'recommendation'"
     - Instruction: start with `> v1 placeholder context, machine-authored, intended to be replaced by domain-expert review.`
     - Instruction: `## Adaptations` section should be empty with a comment "Reserved for learning-engine adaptations"
  e. Call Ollama API, receive generated contract.
- [ ] 3.3 Validate each generated contract (PRD §5.7):
  - `## General` heading present
  - At least one `## Role: ` heading present
  - `## Adaptations` heading present
  - Placeholder header line present (starts with `> v1 placeholder`)
  - No forbidden phrases: "as an AI", "I cannot", "I apologize", "I'm sorry", "advice", "recommendation", "recommend"
  - Content under `## General` is at least 100 characters
  - If validation fails, retry once with a correction prompt. If retry fails, log and skip.
- [ ] 3.4 For each passing contract, create a v2 config version row:
  - `INSERT INTO prediction.analyst_config_versions` with `version_number=2, context_markdown=<generated>, persona_prompt=<same as v1>, tier_instructions=<same as v1>, default_weight=<same as v1>, source='manual', change_reason='AI-scaffolded structured contract', parent_version_id=<v1 id>, is_active=true, created_by='system'`
  - `UPDATE prediction.analyst_config_versions SET is_active=false WHERE id=<v1 id>`
  - `UPDATE prediction.market_analysts SET current_config_version_id=<v2 id> WHERE id=<analyst id>`
- [ ] 3.5 Run the script: `npx tsx scripts/generate-analyst-contracts.ts`. Print each contract to stdout for review.
- [ ] 3.6 Verify: query all 7 analysts' active config version for non-null `context_markdown`. Use `getActiveContextForAnalyst` (from Phase 2) to confirm parsed sections for each.
- [ ] 3.7 Read each generated contract once and confirm it is not gibberish, respects legal-language rules, and has the expected section structure. (User approval — structural, not substantive.)

### Quality Gate
Before moving to Phase 4, ALL of the following must pass:
- [ ] **Lint**: `pnpm lint`
- [ ] **Build**: `pnpm build`
- [ ] **Markets CI**: `pnpm ci:markets`
- [ ] **DB Verification**: all 7 analysts have non-null `context_markdown` on their active config version. Each contract passes structural validation.
- [ ] **Curl Tests**: calibration endpoint still returns 200 for a known analyst.
- [ ] **Chrome Tests**: N/A.
- [ ] **Phase Review**: Compare against PRD §5.4 and §5.5.
  - [ ] All 7 contracts generated and stored as v2?
  - [ ] v1 deactivated, v2 active, `current_config_version_id` pointing at v2?
  - [ ] Each contract has placeholder header, `## General`, `## Role: <X>`, `## Adaptations`?
  - [ ] Legal-language smoke test passes on all 7?
  - [ ] `parent_version_id` links v2 → v1?
  - [ ] Scaffolding script is runnable and idempotent-safe (checks for existing v2 before creating)?

---

## Phase 4: Tier 1 Carry-Forward
**Status**: Not Started
**Objective**: All 3 INSERT paths into `analyst_config_versions` propagate `context_markdown` so future Tier 1 learning cycles never produce rows without contracts.

### Steps
- [ ] 4.1 Update `activatePaperMode` in `apps/api/src/markets/services/learning-engine.service.ts:265–271`. Add `context_markdown` to the INSERT column list with the subselect: `(SELECT context_markdown FROM prediction.analyst_config_versions WHERE analyst_id = $2 AND context_markdown IS NOT NULL ORDER BY version_number DESC LIMIT 1)`.
- [ ] 4.2 Update `createMarketAnalyst` in `apps/api/src/markets/markets.service.ts:462–472`. Add `context_markdown` to the INSERT column list as `NULL` (new analysts don't have contracts yet).
- [ ] 4.3 Update `updateMarketAnalyst` in `apps/api/src/markets/markets.service.ts:514–529`. Add `context_markdown` to the INSERT column list with the same subselect pattern as step 4.1.
- [ ] 4.4 Write a focused test (`tests/unit/context-markdown-carry-forward.test.ts` or inline):
  - Setup: create a mock config version row with known `context_markdown` for a test analyst.
  - Test: call the `updateMarketAnalyst` code path (or directly execute the INSERT SQL with the subselect). Verify the new row's `context_markdown` matches the prior version's.
  - Test: call the `activatePaperMode`-equivalent INSERT. Verify carry-forward.
  - Test: call `createMarketAnalyst` INSERT. Verify `context_markdown` is NULL (correct for new analysts).
- [ ] 4.5 Rebuild the API: `pnpm --filter @divinr/api build`. Restart the dev API.

### Quality Gate
Before moving to Phase 5, ALL of the following must pass:
- [ ] **Lint**: `pnpm lint`
- [ ] **Build**: `pnpm build`
- [ ] **Unit Tests**: carry-forward test passes. `pnpm test` passes.
- [ ] **Markets CI**: `pnpm ci:markets`
- [ ] **Curl Tests**: N/A (no new endpoints).
- [ ] **Chrome Tests**: N/A.
- [ ] **Phase Review**: Compare against PRD §5.8.
  - [ ] All 3 INSERT paths updated?
  - [ ] `activatePaperMode` carries forward via subselect?
  - [ ] `createMarketAnalyst` uses NULL (correct for new analysts)?
  - [ ] `updateMarketAnalyst` carries forward via subselect?
  - [ ] Phase-gate test verifies carry-forward works?
  - [ ] No changes to Tier 1 pattern detection, suffix generation, or paper-mode logic?

---

## Phase 5: Polish + Completion Report
**Status**: Not Started
**Objective**: Final end-to-end verification and completion report.

### Steps
- [ ] 5.1 Verify `getActiveContextForAnalyst` returns a valid `AnalystContract` for all 7 base analysts.
- [ ] 5.2 Verify `getContextForConfigVersion` returns the correct contract for a v2 config version ID and returns null for a v1 config version ID (which has `context_markdown=NULL`).
- [ ] 5.3 Verify calibration-drilldown view still renders for an analyst with data.
- [ ] 5.4 Confirm the bootstrap and generation scripts are committed and documented (comments explaining they are one-shot scripts).
- [ ] 5.5 Write `docs/efforts/current/completion-report.md` summarizing: phases completed, discovery corrections from intention (zero-row bootstrap, 3 INSERT paths not 2, config_version_id was NULL), contracts generated, carry-forward verified, follow-on efforts.
- [ ] 5.6 Run the full gate one final time.

### Quality Gate
Before completion, ALL of the following must pass:
- [ ] **Lint**: `pnpm lint`
- [ ] **Build**: `pnpm build`
- [ ] **Unit Tests**: `pnpm test` (parser test + carry-forward test pass)
- [ ] **Markets CI**: `pnpm ci:markets`
- [ ] **Curl Tests**: calibration endpoint returns 200 for a known analyst.
- [ ] **Chrome Tests**: N/A (no UI changes).
- [ ] **Phase Review**: Compare against entire PRD.
  - [ ] All §3 success criteria met?
  - [ ] All §5 technical requirements implemented?
  - [ ] No §7 out-of-scope items snuck in?
  - [ ] Completion report written?
