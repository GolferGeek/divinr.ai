# Analyst Contracts — Intention

## What This Effort Is

Replace the flat `persona_prompt` field that today defines what each analyst is and how it should think with a **structured markdown contract document** stored alongside it in the existing `analyst_config_versions` table. The contract has clearly-marked sections (general purpose, per-role decision criteria, current adaptations) so that downstream consumers — humans, audits, future learning workflows — can read the right slice of the right analyst's intent.

This is the **foundational** effort. It does not build any consumer of these contracts. It does not build the audit loop, the inbox, the human approval gate, or the smarter pattern detection. It writes contracts to a column, makes them readable through one canonical service method, and prevents the existing tier-1 learning engine from corrupting them. That's it.

## Why It Matters For Divinr

The system already has a learning engine (Tier 1, `learning-engine.service.ts`) that pattern-matches on numeric metrics from `analyst_performance_profiles` and proposes prompt adjustments. It works. It runs on a schedule. It has paper-mode A/B testing and auto-promotion based on real outcomes. It is more sophisticated than I had assumed before reading the code.

But Tier 1 has two structural problems that this effort is the precondition for fixing:

1. **It writes by appending hardcoded text suffixes to a flat string.** After N learning cycles an analyst's `persona_prompt` is the original prose plus N stacked advisory paragraphs with no organizing principle. The structure collapses under successive appends. There's no way to tell which advisory is still relevant or which superseded which.
2. **It detects patterns by reading aggregate accuracy/confidence numbers, not by reading what the model actually said.** It can notice "this analyst is overconfident on AAPL bearish calls" but it cannot notice "this analyst's reasoning cited a Fed signal that doesn't exist in the actual macro data." The richer kind of audit — reading the input, the contract, and the output, and finding discrepancies — is exactly what divinr's explainability story needs and is exactly what Tier 1 cannot do.

Both problems become solvable once contracts are structured documents instead of flat strings:

- Tier 1's append-suffix problem becomes "update the adaptations section" — a clean write target instead of an unbounded accumulator. (This effort does *not* update Tier 1 to do that. A future effort does.)
- The richer audit becomes possible — a workflow can extract the matching role section from the contract, drop it into the audit prompt as the rubric, and ask a local model "did the output honor this contract on this input?" That workflow is **Tier 2**, and the schema already has a `tier2_approved` source slot reserved for it on `analyst_config_versions.source`. Tier 2 is not part of this effort. It is the next effort.

The bigger framing: divinr's `analyst_config_versions.source` enum (`manual` / `tier1_auto` / `tier2_approved` / `tier3_strategic`) is a *designed but half-built* tier system. Tier 1 is built. Tiers 2 and 3 are slots in the schema with no code behind them. The entire "spot-check, propose, approve, learn" loop the user has been describing is **the missing tier 2**, and tier 2 is impossible to build well without first having structured contracts to audit against. This effort builds the foundation. The next effort builds tier 2 on top.

## Why Now

- Calibration-drilldown just shipped. The user can now *see* why analysts are wrong. The natural follow-on is letting the system act on that observation, but acting requires an editing surface that's better than a flat string. Contracts are that surface.
- The Tier 1 learning engine is actively running and writing rows to `analyst_config_versions` on its schedule. Every day this effort is delayed, more `persona_prompt` rows accumulate stacked suffixes. Doing this now means future tier-1 rows can carry forward structured content from day one.
- The infrastructure to consume contracts already exists: `analyst_config_versions` has parent pointers, LLM call linkage, paper-mode dual-channel, and a `source` enum with reserved slots. Each `prediction_horizon_evaluations` row already records the `config_version_id` that produced it, so per-prediction reconstruction of "what was the contract when this happened" is *free* — no `valid_from`/`valid_to` columns needed, no append-only enforcement, no clock-based reconstruction. The compliance story is already solved by an existing column the user didn't know about.
- The user has explicitly named themselves as not-the-finance-expert. Contract content will be machine-authored placeholders, structurally approved, with the explicit understanding that a finance person sharpens them later. This means the slow part of the effort (writing 7 long-form documents) is replaced by an LLM scaffolding workflow plus a structural skim. Doable in a sitting.

## What Good Looks Like

- A new `context_markdown` text column exists on `prediction.analyst_config_versions`. Migration is reversible.
- The 7 base analysts at `__base__` (the 5 personalities, the arbitrator, the portfolio manager) each have a `context_markdown` populated on their currently-active config version. Each contract is structured: a `## General` section, one or more `## Role: <role>` sections, and an empty `## Adaptations` section reserved for future learning-engine writes.
- The contract content is machine-authored from the existing `persona_prompt` plus a sample of the analyst's recent predictions. Each contract has a header line stating *"v1 placeholder context, machine-authored, intended to be replaced by domain-expert review."* The header is load-bearing and is part of the audit-prompt anchor in the next effort.
- A canonical reader exists on `markets.service.ts`: `getActiveContextForAnalyst(analystId, organizationSlug)` returns the structured contract for the currently-active config version, and `getContextForConfigVersion(configVersionId)` returns the contract for any historical config version (the per-prediction reconstruction path). Both return the raw markdown plus parsed sections so consumers don't have to re-parse.
- The Tier 1 learning engine's two write paths in `learning-engine.service.ts` (`activatePaperMode` and the promotion path in `checkPaperModePromotions`) **carry forward** the existing `context_markdown` from the prior active version when creating new rows. Tier 1's append-suffix behavior on the flat `persona_prompt` field is *not* changed in this effort — the suffixes still accumulate, the contract just stays continuous in parallel.
- A focused phase-gate test verifies that running a Tier 1 learning cycle preserves the `context_markdown` field. Without this test the drift is invisible until the next effort notices the audit can't find a contract for a recent prediction.
- The legal-language rules ("analysis/signal not advice/recommendation," disclaimers on trade actions) pass a smoke check on every generated contract. No "as an AI" or "I cannot" text from the scaffolding LLM.
- All existing markets gates pass: `pnpm ci:markets`, `pnpm test:unit`, calibration-drilldown view still renders, the Tier 1 cycle still runs without errors.

## What "Approval" Means In Phase A

The user is not the finance expert. Approval of generated contracts is **structural, not substantive**. Phase A is done when:

- Each contract has the expected sections (`## General`, at least one `## Role: <role>`, `## Adaptations`).
- The placeholder header is present.
- The legal-language rules pass.
- No obviously-broken LLM apology text appears.
- The user reads each contract once and confirms it isn't gibberish.

Phase A is **not** done when a domain expert has line-edited the contracts for finance accuracy. That happens in a separate, later, optional pass by somebody other than the user.

## Out Of Scope

- **Day traders.** The 3 day-trader analysts (`gap-and-go`, `mean-reversion`, `momentum-breakout`) live in a different subsystem and don't appear in `market_predictions` at all. They have ~16-character placeholder prompts. Writing contracts for them requires understanding the day-trader subsystem first, which is its own discovery effort. **They get contracts in a follow-on effort, soon after this one.** Out of scope here.
- **Tenant-specific analyst rows.** The `momentum-analyst` slug has 8 tenant-scoped copies in `market_analysts` with 40-character placeholder prompts (auto-generated test fixtures). Only the `__base__` row gets a contract in this effort. Tenant copies are out of scope.
- **The audit loop.** The contract-vs-output discrepancy detection workflow that Tier 2 will run is a separate effort. Phase A produces the contracts but does not consume them.
- **The inbox / admin view.** No UI for reading or editing contracts in this effort. The contracts sit in the database. The next effort builds the inbox alongside the audit consumer that needs it.
- **The diff viewer.** "Show me what changed between version 6 and version 8" is a real affordance and the data supports it (parent pointers exist), but the rendering surface lives in the next effort with the inbox.
- **Rollback UI.** The service method that rolls back is a single insert (new row with old content), and rollback works from a script or repl in this effort. A button in admin mode is part of the next effort.
- **Updating Tier 1 to write into `## Adaptations` instead of appending to `persona_prompt`.** Tier 1 keeps its current behavior. We carry the structured field forward but do not change how Tier 1 generates or applies its proposals. That rewrite is downstream of having a working audit consumer, because the audit consumer is what tells us whether the structured-write Tier 1 actually does better than the append-suffix Tier 1.
- **Tier 3 (`tier3_strategic`).** Slot exists in the schema. Has nothing to do with this effort.
- **Editing UI.** No textarea, no "save contract" button, no admin form. Contracts are written by a one-time scaffolding script during phase A execution. Edits happen in phase B's inbox.
- **Cleaning up the dead tables.** `prediction.analysts` (32 rows, last updated 2026-03-15) and `prediction.analyst_context_versions` (28 rows, last created 2026-03-15) are remnants of an earlier design iteration that got superseded by `market_analysts` + `analyst_config_versions`. They are referenced by exactly one file each and have no recent writes. This effort ignores them. A separate cleanup effort can drop them.

## Where It Fits In The Roadmap

**Immediately after** `calibration-drilldown`. That effort gave the user a way to read why an analyst was wrong. This effort gives the system a structured editing surface that future efforts can write into. The two together complete the *read* side of the explainability loop.

**Immediately before** the **Tier 2 audit + approval loop** (the next effort). Tier 2 is the workflow the user actually wants — spot-check predictions, find contract violations, present to the user with a hypothesis for why the model drifted, three buttons (you're right / you're wrong / interesting but no action), append-only feedback log. Tier 2 is impossible to build well without contracts to audit against. This effort provides the contracts.

**In parallel with** any effort that wants to consume contracts directly. The canonical reader methods will be available immediately after this effort merges, so any future surface (calibration view enrichment, an admin "what does this analyst look like today" page, a debugging tool) can use them.

## Decisions (settled before PRD-build)

- **Storage:** new `context_markdown` column on the existing `prediction.analyst_config_versions` table. Not a new table. Not a new versioning system. Discovery confirmed `analyst_config_versions` is the production version-tracking table (last write was today, used by `markets.service.ts` and `learning-engine.service.ts` and `prediction-runner.service.ts`). It already has parent pointers, LLM linkage, source attribution, and a tier enum. It does not have append-only enforcement (it uses `is_active` flip-the-flag). We accept the existing pattern rather than fight it.

- **Compliance reconstruction:** already solved by `prediction_horizon_evaluations.config_version_id`, an existing column that pins each prediction to the exact config version that produced it. The `getContextForConfigVersion(configVersionId)` reader method walks this pointer and returns the contract that was active when the prediction was made. No new timestamp columns, no append-only constraints, no clock arithmetic. The compliance story was already in the schema; we just expose it.

- **Section structure:** `## General` + one or more `## Role: <role>` + `## Adaptations`. The general section is the analyst's worldview, tone, legal-language rules, and failure modes that apply across roles. Each role section is the decision criteria + good-call examples + role-specific failure modes. The adaptations section is empty in v1 and reserved as the future write target for a smarter Tier 1 (out of scope this effort).

  In practice each base analyst plays exactly one role today (`market_predictions.role` distribution: 5 personalities × `analyst`, 1 arbitrator × `arbitrator`, 1 portfolio manager × `portfolio_manager`). The section structure is forward-compatible — when an analyst eventually picks up a second role, that role gets its own section without restructuring the document — but most v1 contracts will have one general section and one role section.

- **Inventory:** 7 contracts. The 5 personality analysts (`fundamentals-analyst`, `macro-strategist`, `momentum-analyst`, `sentiment-analyst`, `technical-analyst`), the arbitrator (`arbitrator`, display name "Arbitrator (Mini-Me)"), and the portfolio manager (`portfolio-manager`). All at `__base__` org. Day traders out of scope.

- **Generation method:** AI scaffolding workflow. For each analyst, the scaffolding script reads the existing `persona_prompt` plus a sample of recent predictions (rationale + outcome) and asks an LLM to produce a structured contract following the section template. The user reads each one and confirms it's not gibberish. No interview, no blank template. Contracts are explicitly labeled as v1 placeholders.

- **Tier 1 carry-forward:** the **smallest possible touch** to `learning-engine.service.ts`. The two `INSERT INTO analyst_config_versions` statements in `activatePaperMode` and the promotion path are updated to also populate `context_markdown` by selecting the most recent non-null `context_markdown` for the same analyst. Tier 1's pattern detection, suffix generation, paper-mode logic, canonical test validation, and auto-promotion are *unchanged*. Only the new column is propagated forward.

  This is the load-bearing piece. Without it, the very first Tier 1 cycle after deploy creates a config version with `context_markdown=null`, and from that point on `current_config_version_id` points at a row with no contract while the contract sits on a now-historical row. The audit reconstruction breaks within days. With it, every new tier-1 row inherits the latest contract automatically.

- **Backfill:** before enabling carry-forward, a one-time script populates `context_markdown` on the most recent active `analyst_config_versions` row for each of the 7 base analysts. This guarantees the carry-forward subquery has something to copy on its first invocation. Older config-version rows (paper-mode rejects, superseded versions) are *not* backfilled. They keep `context_markdown=null`. Per-prediction reconstruction against an old config version that has no contract returns null and the audit consumer treats that as "no contract was active for this prediction" — which is truthful for the historical period before this effort existed.

- **Phase-gate test:** a focused unit or smoke test that runs a Tier 1 cycle in a fixture environment and asserts that any new `analyst_config_versions` row has a non-null `context_markdown` carried from the prior version. This is the only place in the effort where we explicitly verify the carry-forward works. Without it the drift would be invisible.

- **Append-only enforcement:** **not added** in this effort. The existing table uses `is_active` flip-the-flag and the existing learning engine does `update` statements on it. Adding append-only would break Tier 1. The compliance story is carried by `config_version_id` capture on each prediction, not by row immutability on the version table. If hard append-only is needed later it's a separate refactor that touches the learning engine.

- **No editing UI:** the only way to write a contract in this effort is the one-time scaffolding script. No admin form. No textarea. The next effort owns all read/edit affordances.

## Open Questions To Settle When This Effort Starts

- **Exact backfill content for `paper_config_version_id` rows.** Some analysts may have an active paper-mode config alongside their production config. Does the backfill populate `context_markdown` on both, only on the production one, or only on whichever is currently `is_active=true`? Default answer for PRD: backfill only the row pointed at by `current_config_version_id`. Paper-mode rows get carry-forward on next learning cycle. PRD discovery confirms.

- **What the scaffolding script reads as input.** Each analyst's existing `persona_prompt` is obvious. The "sample of recent predictions" is less obvious — how many, sorted how, filtered how. PRD picks: 10 most recent resolved predictions for the personality analysts, all of the analyst's recent predictions (capped) for the arbitrator and portfolio manager. PRD discovery confirms the counts.

- **Where the scaffolding script lives.** `apps/api/scripts/`? A test fixture? A one-shot Nest command? PRD picks. Probably a small standalone TypeScript file that uses the existing `LLMServiceProvider` to call the local model.

- **Which local model.** The user mentioned Gemma 31B in an earlier conversation but the current local-model setup may have moved. PRD discovery checks `MARKETS_ENABLE_LLM` config and the available models, picks the largest available local model that can hold the prompt + sample predictions in context.

- **Section heading exact strings.** `## General` and `## Role: Prediction` are working names. PRD pins the exact strings (case, punctuation, whether role names are slugs or display names) so the parser in the canonical reader knows what to look for.

- **Whether the canonical reader returns a typed sections object or just the raw markdown.** Reader-side parsing is cheap but every consumer doing it independently risks drift. PRD recommends: reader returns both — `{ markdown: string, sections: { general: string, roles: Record<string, string>, adaptations: string } }`. Consumers pick whichever they need.

## Dependencies

- `calibration-drilldown` is merged. ✅ (commit `f1453ee`)
- `see-your-reasoning` is merged. ✅ (commit `11e79a9`)
- `auth-bootstrap` is merged. ✅ (commit `ad1004d`)
- `llm-reasoning-capture` is merged. ✅ (commit `c36e3e1`)
- The Tier 1 learning engine continues to run on its existing schedule. Verified: code at `apps/api/src/markets/services/learning-engine.service.ts` (454 lines). The carry-forward update is the only change this effort makes to it.
- `analyst_config_versions` continues to be the production version-tracking table. Verified: 8 rows, last write 2026-04-09 02:20.
- `prediction_horizon_evaluations.config_version_id` continues to be populated by the prediction runner. Verified by inspection of `learning-engine.service.ts:304-310` which uses the column for paper-vs-prod accuracy comparison.
- The local LLM is available for the scaffolding workflow. Verification in PRD discovery.
- No concurrent refactors of `learning-engine.service.ts`, `analyst_config_versions`, or `market_analysts` while this effort is in flight.

## Discovery Findings That The PRD Should Not Re-Discover

These are facts I learned during intention-build that future-me would otherwise re-derive painfully:

1. **`prediction.analyst_config_versions` is the live versioning table.** Used by `markets.service.ts`, `learning-engine.service.ts`, `prediction-runner.service.ts`. Has parent pointers, LLM linkage, source enum, paper-mode pointer. Is what `market_analysts.current_config_version_id` references.

2. **`prediction.analysts` and `prediction.analyst_context_versions` are dead tables.** Last write 2026-03-15. Each referenced by one file. Remnants of an earlier design. **Ignore them. Do not write to them. Do not read from them.**

3. **`prediction_horizon_evaluations.config_version_id` exists** and is populated. The compliance reconstruction question is already solved.

4. **`market_analysts.paper_config_version_id` is a real column** with active learning-engine code behind it. Paper-mode A/B is already shipped.

5. **The Tier 1 learning engine is fully built.** It detects three patterns (overconfidence, underconfidence, directional bias), generates proposals, validates against canonical tests, applies passing ones to paper mode, auto-promotes/demotes after 3 days. It writes to `learning_proposals` and `learning_reports` (existing tables). The "learning loop" the user has been describing wanting to build is *partially already built*. What's missing is **Tier 2** (richer pattern detection from contract-vs-output diffs, human approval gate). Tier 3 is also a slot.

6. **The `source` enum on `analyst_config_versions` reserves `tier2_approved` and `tier3_strategic` slots** that have no code behind them yet. Tier 2 is the next effort.

7. **Day traders live in a separate subsystem** (not yet read). They have rows in `market_analysts` with empty prompts but no rows in `market_predictions`. Discovery for them is its own effort.

8. **The arbitrator's display name is "Arbitrator (Mini-Me)".** "Mini-me" is the user's affectionate name for the arbitrator role. There is exactly one. Singular.

9. **Tier 1's prompt suffixes are hardcoded strings** like "IMPORTANT: Recent analysis shows your confidence levels tend to be too high...". They get appended verbatim to `persona_prompt`. After several cycles the prompt becomes a wall of stacked advisories. This is the structural problem the structured contracts eventually solve — but **not in this effort**. This effort just stops the bleeding by giving a clean parallel field that doesn't accumulate the same way.
