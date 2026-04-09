# Analyst Contracts — Product Requirements Document

## 1. Overview

Replace the flat `persona_prompt` field that defines each analyst's identity with a structured markdown contract document stored in a new `context_markdown` column on `prediction.analyst_config_versions`. Bootstrap the config version system for the 7 base analysts (which currently has zero rows for production analysts), generate structured contracts via AI scaffolding, add canonical reader methods, and update all INSERT paths to carry the contracts forward so Tier 1 learning cycles never drop them.

This is a foundation effort. It does not build any consumer of these contracts — no audit loop, no inbox, no admin view, no prompt editor. It produces contracts, makes them readable, and prevents drift. The next effort (Tier 2 Audit + Approval) builds on top.

## 2. Discovery Findings That Shape The Design

These findings override or refine assumptions from the intention.

1. **`analyst_config_versions` has ZERO rows for base analysts.** All 7 base analysts at `__base__` have `current_config_version_id = NULL`. The 8 existing rows are tenant-scoped test fixtures. The entire config version system is dormant for production analysts. Phase 1 must bootstrap initial version rows — there is no existing row to backfill.

2. **`context_markdown` column does not exist** on `analyst_config_versions`. The current DDL in `markets-schema.service.ts` defines the table without it. Migration required via `ALTER TABLE ADD COLUMN IF NOT EXISTS`.

3. **3 INSERT paths exist** for `analyst_config_versions` (the intention assumed 2):
   - `activatePaperMode` in `learning-engine.service.ts:265–271`
   - `createMarketAnalyst` in `markets.service.ts:462–472`
   - `updateMarketAnalyst` in `markets.service.ts:514–529`
   All 3 must carry forward `context_markdown`. The promotion path in `checkPaperModePromotions` does UPDATE (flips `is_active`), not INSERT, so it preserves existing columns automatically.

4. **All existing predictions have NULL `config_version_id`** because no base analyst has ever had a config version. After Phase 1 bootstraps version rows, the prediction-runner (line 277: `const configVersionId = analyst.current_config_version_id ?? null`) starts capturing non-null version IDs automatically. No prediction-runner change needed.

5. **Default LLM: `gemma4:e4b`** (Gemma 4, 9.6 GB) via Ollama local at `localhost:11434`. Env: `OLLAMA_DEFAULT_MODEL=gemma4:e4b`.

6. **37 resolved predictions across 5 personality analysts** (6–8 each). Arbitrator and portfolio manager have 0 resolved `analyst`-role predictions — their scaffolding input is persona-only.

7. **Existing scripts live at** `/home/golfergeek/projects/divinr.ai/scripts/`. The pattern from `seed-demo-tenants.ts` uses Supabase client with dotenv config.

## 3. Goals & Success Criteria

Goals:
- Every base analyst has a config version with a structured markdown contract in `context_markdown`.
- Two canonical reader methods exist for consuming contracts: one for "active contract for analyst X" and one for "contract that was active when prediction Y was made."
- All INSERT paths into `analyst_config_versions` carry `context_markdown` forward so Tier 1 learning cycles never produce rows with NULL contracts.
- The prediction-runner starts recording `config_version_id` on new predictions (automatic once config versions exist).

Success criteria:
- 7 `analyst_config_versions` rows exist for `__base__` analysts with non-null `context_markdown`.
- Each contract has a `## General` section, at least one `## Role: <name>` section, and a `## Adaptations` section.
- Each contract has the placeholder header: `> v1 placeholder context, machine-authored, intended to be replaced by domain-expert review.`
- No contract contains "advice," "recommendation," "as an AI," "I cannot," or "I apologize."
- `getActiveContextForAnalyst` returns parsed sections for each of the 7 analysts.
- `getContextForConfigVersion` returns the correct contract for a given version ID.
- A simulated Tier 1 insert produces a new row with non-null `context_markdown` carried from the prior version.
- All existing gates pass: `pnpm ci:markets`, `pnpm lint`, `pnpm build`.

## 4. User Stories

- **Founder (system builder):** "I want each analyst to have a structured description of what it is and how it makes decisions, so the audit loop I'm building next has something concrete to audit against."
- **Future tier-2 audit loop:** "Given a prediction and its `config_version_id`, I can retrieve the structured contract that was active when that prediction was made, extract the relevant role section, and use it as the rubric for discrepancy detection."
- **Future domain expert:** "I can read an analyst's contract, see clearly which parts are general vs role-specific vs adaptive, and edit specific sections without disrupting the rest."

## 5. Technical Requirements

### 5.1 Architecture

One new column on an existing table. Two new service methods. Two new one-shot scripts. Carry-forward updates to 3 existing INSERT statements. No new tables, no new API endpoints, no frontend changes.

### 5.2 Data Model Changes

**`prediction.analyst_config_versions` — add column:**

```sql
ALTER TABLE prediction.analyst_config_versions
ADD COLUMN IF NOT EXISTS context_markdown text;
```

Added to the `analystVersioningDdl()` method in `apps/api/src/markets/schema/markets-schema.service.ts` so it runs on every schema ensure pass.

No other schema changes. No new tables. No new indexes (the column is read by primary key lookup, which is already indexed).

### 5.3 Config Version Bootstrap

A one-shot script (`scripts/bootstrap-analyst-versions.ts`) creates the first `analyst_config_versions` row (v1) for each of the 7 `__base__` analysts:

```
id:                 randomUUID()
analyst_id:         <analyst.id>
organization_slug:  '__base__'
version_number:     1
persona_prompt:     <analyst.persona_prompt>
tier_instructions:  <analyst.tier_instructions>
default_weight:     <analyst.default_weight>
config_overrides:   '{}'
source:             'manual'
change_reason:      'Bootstrap initial config version'
parent_version_id:  null
is_active:          true
created_by:         'system'
created_at:         now()
context_markdown:   null  (populated in Phase 3)
```

After inserting, the script UPDATEs `market_analysts.current_config_version_id` to point at the new row for each analyst.

**Target analysts (7):**

| Slug | Type | Role | Prompt length | Resolved predictions |
|---|---|---|---|---|
| `fundamentals-analyst` | personality | Analyst | 480 chars | 8 |
| `macro-strategist` | personality | Analyst | 334 chars | 6 |
| `momentum-analyst` | personality | Analyst | 405 chars | 7 |
| `sentiment-analyst` | personality | Analyst | 457 chars | 8 |
| `technical-analyst` | personality | Analyst | 501 chars | 8 |
| `arbitrator` | arbitrator | Arbitrator | 26 chars | 0 |
| `portfolio-manager` | portfolio_manager | Portfolio Manager | 481 chars | 0 |

### 5.4 Contract Generation (AI Scaffolding)

A one-shot script (`scripts/generate-analyst-contracts.ts`) generates structured contracts for each of the 7 base analysts. For each analyst:

1. Reads persona_prompt, tier_instructions from the v1 config version (created in Phase 1).
2. Reads up to 10 most recent resolved predictions (rationale + actual outcome) for personality analysts. Skips this for arbitrator and portfolio manager (0 resolved predictions).
3. Calls `gemma4:e4b` via Ollama HTTP API (`POST http://localhost:11434/api/generate`) with a prompt containing:
   - The persona_prompt
   - The tier_instructions (gold/silver/bronze if present)
   - Sample predictions with outcomes (if any)
   - Target structure template
   - Legal-language rules
   - Instruction to include the placeholder header
4. Validates the output (see §5.7).
5. Creates a v2 `analyst_config_versions` row:
   ```
   version_number:     2
   persona_prompt:     <same as v1, unchanged>
   tier_instructions:  <same as v1, unchanged>
   default_weight:     <same as v1, unchanged>
   context_markdown:   <generated contract>
   source:             'manual'
   change_reason:      'AI-scaffolded structured contract'
   parent_version_id:  <v1 id>
   is_active:          true
   created_by:         'system'
   ```
6. Deactivates v1 (`is_active = false`).
7. Updates `market_analysts.current_config_version_id` to v2.

### 5.5 Contract Section Structure

Each contract is a markdown document with these sections:

```markdown
> v1 placeholder context, machine-authored, intended to be replaced by domain-expert review.

## General

[Analyst's worldview, tone, legal-language constraints, cross-role failure modes.
 "This analyst produces analysis and signals, not financial advice or recommendations."
 What the analyst is for and when its judgment matters.]

## Role: Analyst

[Decision criteria for producing predictions. What data to weigh.
 Examples of good reasoning patterns. Role-specific failure modes to avoid.
 For the arbitrator: "## Role: Arbitrator". For the PM: "## Role: Portfolio Manager".]

## Adaptations

[Empty in v1. Reserved for future Tier 1 structured writes.
 Will contain learning-engine-generated adaptations like
 "Recent calibration shows overconfidence on bearish calls — apply extra scrutiny."]
```

**Section heading exact strings:**
- `## General`
- `## Role: Analyst` (for 5 personality analysts)
- `## Role: Arbitrator` (for the arbitrator)
- `## Role: Portfolio Manager` (for the portfolio manager)
- `## Adaptations`

### 5.6 Canonical Reader Methods

Added to `markets.service.ts`:

**`getActiveContextForAnalyst(analystId: string, orgSlug: string): Promise<AnalystContract | null>`**

Joins `market_analysts.current_config_version_id` to `analyst_config_versions`, reads `context_markdown`. Returns null if `current_config_version_id` is null or `context_markdown` is null.

**`getContextForConfigVersion(configVersionId: string): Promise<AnalystContract | null>`**

Direct lookup by ID. Returns null if the row doesn't exist or `context_markdown` is null.

**Return type:**

```typescript
interface AnalystContract {
  markdown: string;
  sections: {
    general: string;
    roles: Record<string, string>;  // key = role display name, e.g. "Analyst"
    adaptations: string;
  };
}
```

**Section parser** (`parseContractMarkdown`): private helper method. Splits on `## ` headings. Matches `General`, `Role: *` (captures role name after colon-space), `Adaptations`. Unrecognized headings are ignored. Missing sections return empty strings.

### 5.7 Structural Validation

Applied to every generated contract during scaffolding (Phase 3). Checks:

1. `## General` heading present.
2. At least one `## Role: ` heading present.
3. `## Adaptations` heading present.
4. Placeholder header line present (starts with `> v1 placeholder`).
5. No forbidden phrases: "as an AI", "I cannot", "I apologize", "I'm sorry", "advice", "recommendation", "recommend".
6. Content under `## General` is at least 100 characters (guards against empty/stub generation).

If validation fails, the script retries once with a correction prompt. If the retry also fails, the script logs the failure and skips the analyst (to be fixed manually). The phase gate checks that all 7 passed.

### 5.8 Tier 1 Carry-Forward

Three INSERT statements updated to include `context_markdown`:

**1. `activatePaperMode` (`learning-engine.service.ts:265–271`):**

Add `context_markdown` to the column list with a subselect:

```sql
(SELECT context_markdown FROM prediction.analyst_config_versions
 WHERE analyst_id = $2 AND context_markdown IS NOT NULL
 ORDER BY version_number DESC LIMIT 1)
```

**2. `createMarketAnalyst` (`markets.service.ts:462–472`):**

Add `context_markdown` to the column list as `NULL`. New analysts don't have contracts yet — contracts are generated separately. This is correct: the column is nullable, and the carry-forward subselect for future updates will find nothing and return null, which is the truthful state.

**3. `updateMarketAnalyst` (`markets.service.ts:514–529`):**

Add `context_markdown` to the column list with the same subselect pattern as #1.

### 5.9 API Changes

None. No new endpoints. No changes to existing endpoints. Contracts are not exposed via the API in this effort.

### 5.10 Frontend Changes

None.

## 6. Non-Functional Requirements

- **DI convention:** any new constructor parameters use explicit `@Inject(...)` per CLAUDE.md. (No new constructor params expected — reader methods are added to existing `MarketsService`.)
- **Performance:** reader methods do a single indexed lookup (primary key on `analyst_config_versions`). Section parsing is string splitting — negligible cost.
- **Security:** reader methods go through `requireRead` + org-slug filter, matching existing patterns. Scripts run locally with direct DB access (same as `seed-demo-tenants.ts`).
- **Compatibility:** the new column is nullable with no default. Existing queries that don't select it are unaffected. No existing behavior changes.
- **No regressions** in `pnpm ci:markets`, `pnpm lint`, `pnpm build`, or the calibration-drilldown view.

## 7. Out of Scope

Inherits all out-of-scope items from the intention. Additionally:

- **Day trader contracts** (3 analysts in a separate subsystem — follow-on effort).
- **Tenant-scoped analyst copies** (only `__base__` gets contracts).
- **Any API endpoint for contracts** (readers are service-only, not controller-exposed).
- **Updating `loadConfigVersion` in prediction-runner** to include `context_markdown` (the prediction runner doesn't need contracts; future Tier 2 does).
- **Changing Tier 1's pattern detection or suffix-append behavior.**
- **Append-only enforcement on `analyst_config_versions`.**
- **Any UI for viewing, editing, or diffing contracts.**
- **Cleaning up dead tables** (`prediction.analysts`, `prediction.analyst_context_versions`).

## 8. Dependencies & Risks

Dependencies (all met):
- `calibration-drilldown` merged ✅.
- `analyst_config_versions` table exists with the expected schema ✅.
- Ollama running locally with `gemma4:e4b` available ✅.
- `prediction_horizon_evaluations` has resolved rows for scaffolding input ✅.

Risks:

- **R1: Scaffolding output quality.** `gemma4:e4b` is a local 9.6 GB model. Contract quality may be uneven. Mitigation: structural validation catches formatting failures; retry-once logic catches first-attempt failures; user skim-approves for coherence. Substantive quality is explicitly deferred.
- **R2: Silent carry-forward failure.** If any of the 3 INSERT paths is missed or the subselect has a bug, Tier 1 will silently create version rows without contracts. Mitigation: phase-gate test in Phase 4 specifically verifies carry-forward by simulating an insert and asserting the result.
- **R3: `config_version_id` tracking gap.** All historical predictions have NULL `config_version_id`. This gap is permanent and truthful — those predictions were made before config versioning existed. The audit in Tier 2 treats NULL as "no contract was active for this prediction." Not a risk per se, just a documented limitation.
- **R4: Tier 1 runs between Phase 1 and Phase 4.** If a Tier 1 cycle fires after bootstrap (Phase 1) but before carry-forward (Phase 4), the new config version row will have `context_markdown = NULL`. Mitigation: Phase 3 generates contracts on v2 rows; even if Tier 1 creates a v3 with NULL contract, Phase 4's carry-forward fixes future rows and the v2 contract is still retrievable via the reader method. The one Tier 1 row with NULL is a single historical artifact, not a drift.

## 9. Phasing

Each phase ends with quality gates. Each phase is independently mergeable (though all ship together in one PR).

**Phase 1 — Schema + Bootstrap**
**Objective:** Every base analyst has a config version row. `config_version_id` tracking activates on new predictions.

Add `context_markdown` column to `analyst_config_versions` DDL. Write and run `scripts/bootstrap-analyst-versions.ts` to create v1 rows for 7 base analysts. Wire `current_config_version_id`.

Gate: 7 rows exist, all analysts have non-null `current_config_version_id`, `pnpm ci:markets` passes.

**Phase 2 — Canonical Reader Methods**
**Objective:** Two service methods exist for reading and parsing contracts from any config version.

Add `getActiveContextForAnalyst`, `getContextForConfigVersion`, and `parseContractMarkdown` to `markets.service.ts`. The `AnalystContract` interface is defined here.

Gate: unit tests for section parsing (happy path, missing sections, null input). `pnpm ci:markets` passes.

**Phase 3 — AI Scaffolding + Contract Generation**
**Objective:** Each of the 7 base analysts has a structured markdown contract in `context_markdown`.

Write and run `scripts/generate-analyst-contracts.ts`. Creates v2 rows with structured contracts, deactivates v1, wires v2 as current. Structural validation on each contract. User skim-approves.

Gate: all 7 have non-null `context_markdown` passing structural validation. `getActiveContextForAnalyst` returns parsed sections for each. Calibration-drilldown still renders. `pnpm ci:markets` passes.

**Phase 4 — Tier 1 Carry-Forward**
**Objective:** All 3 INSERT paths propagate `context_markdown` so future config versions never drop the contract.

Update `activatePaperMode` in `learning-engine.service.ts`, `createMarketAnalyst` and `updateMarketAnalyst` in `markets.service.ts`. Write a focused test that verifies carry-forward.

Gate: carry-forward test passes. `pnpm ci:markets` passes.

**Phase 5 — Polish + Completion Report**
**Objective:** Everything verified end-to-end. Completion report written.

Final gate run. Verify calibration-drilldown still renders. Verify `getActiveContextForAnalyst` works for all 7 analysts. Write completion report.

Gate: all gates green. Completion report in `docs/efforts/current/completion-report.md`.
