# Day Trader Contracts — Product Requirements Document

## 1. Overview

Bootstrap config versions and generate structured strategy specification documents for the 3 day-trader analysts (`gap-and-go`, `mean-reversion`, `momentum-breakout`). The contracts describe each algorithm's behavior in plain English — entry/exit rules, risk parameters, signal usage, market conditions — so humans can read what each strategy does without reading TypeScript.

This is a documentation/foundation effort. Day traders are hard-coded algorithmic strategies, not LLM-driven. Their contracts are strategy specs, not LLM operating instructions. No strategy logic is changed.

## 2. Goals & Success Criteria

Goals:
- Config versions bootstrapped for all 3 day-trader analysts (currently NULL).
- Each has a structured markdown contract describing its actual behavior.
- Contracts verified against the source code for accuracy.

Success criteria:
- 3 `analyst_config_versions` rows exist for day-trader analysts with non-null `context_markdown`.
- Each contract has `## General`, `## Role: Day Trader`, `## Adaptations` sections.
- Each contract's described entry/exit rules match the hard-coded logic in the strategy source files.
- `current_config_version_id` is non-null for all 3 day-trader analysts.
- All existing gates pass.

## 3. User Stories

- **Founder:** "I can read what gap-and-go actually does — enters after 14:30 UTC on a 1%+ gap-up with a green bar, exits on first red bar — without opening the TypeScript file."
- **Future domain expert:** "I can review each strategy's spec and decide whether the entry/exit rules make sense for the current market conditions, then propose changes."
- **Future position-action audit:** "I have a contract describing what the strategy *should* do, so I can compare it against what it *actually* did in `analyst_positions`."

## 4. Technical Requirements

### 4.1 Architecture

Reuse the bootstrap + generate pattern from `analyst-contracts`. Extend the existing scripts (or write parallel ones for day traders specifically). No new services, no new endpoints, no new tables, no frontend changes.

### 4.2 Data Model Changes

None. The `analyst_config_versions` table and `context_markdown` column already exist. The `market_analysts.current_config_version_id` column already exists. This effort just populates rows that are currently missing.

### 4.3 Strategy Source Files (input for contract generation)

| Strategy | File | Key Constants |
|---|---|---|
| Gap and Go | `apps/api/src/markets/strategies/gap-and-go.strategy.ts` | `GAP_PCT = 0.01` (1% gap threshold), arms after 14:30 UTC, fires once per session, exits on first red bar |
| Mean Reversion | `apps/api/src/markets/strategies/mean-reversion.strategy.ts` | `LOOKBACK = 20`, `K = 2.0` (2 stdevs below 20-bar SMA for entry, exits on reversion to mean) |
| Momentum Breakout | `apps/api/src/markets/strategies/momentum-breakout.strategy.ts` | `LOOKBACK = 20` (buys on fresh 20-bar high breakout, exits on first lower high) |

All three use the shared `convictionModifier()`:
- Flat signal + >70% confidence → **veto** (no open)
- Otherwise: confidence maps linearly to 0.5x–1.5x sizing multiplier

All three are force-closed at EOD (22:00 UTC) regardless of strategy state.

### 4.4 Contract Section Structure

Same structure as personality analyst contracts for parser consistency:

```markdown
> v1 placeholder context, machine-authored, intended to be replaced by domain-expert review.

## General

[Strategy philosophy, market conditions where it works, risk profile,
 how it interacts with the broader system (reads signals from personality
 analysts, manages positions directly, force-closed at EOD).]

## Role: Day Trader

[Exact entry conditions from the source code. Exact exit conditions.
 Position sizing logic (conviction modifier). Signal usage (veto logic).
 EOD behavior. State management (what persists between ticks).
 Key constants with their values.]

## Adaptations

[Empty. Reserved for future use.]
```

### 4.5 Generation Method

A script reads each strategy's **source code** (not predictions — day traders don't have rationales) and asks `gemma4:26b` to produce a human-readable contract. The prompt includes:
- The strategy class source code (or key excerpts)
- The conviction modifier logic
- The EOD force-close rule
- The target section structure
- Legal-language rules (analysis/signal not advice/recommendation)
- Instruction to document actual behavior accurately, not aspirationally

Post-processing: same legal-language replacements as personality contracts. Same placeholder header dedup logic.

Validation: same structural checks (section headers, placeholder header, no apology text) plus a **manual code-vs-contract accuracy check** for each strategy's entry/exit rules.

### 4.6 API Changes

None.

### 4.7 Frontend Changes

None.

## 5. Non-Functional Requirements

- **No strategy logic changes.** Read-only documentation effort.
- **No carry-forward updates needed.** The Tier 1 learning engine filters on `analyst_type = 'personality'` and ignores day traders. The `createMarketAnalyst` and `updateMarketAnalyst` paths already carry forward from `analyst-contracts`.
- **No regressions** in `pnpm ci:markets`, `pnpm lint`, `pnpm build`.

## 6. Out of Scope

- Changing any day-trader strategy logic.
- Tier 2 audit integration for day traders (no LLM rationale to audit — needs a different audit type).
- Tier 1 learning for day traders.
- Position-level `config_version_id` tracking.
- Conviction modifier tuning.
- Any changes to `DayTraderRunnerService` or strategy classes.

## 7. Dependencies & Risks

Dependencies (all met):
- `analyst-contracts` merged ✅
- Strategy source files exist ✅
- `gemma4:26b` available ✅
- Bootstrap/generate script patterns established ✅

Risks:
- **R1: LLM misrepresents strategy logic.** The contract says "enters on 2-stdev breakout" but the code says K=2.0 stdevs below the mean (entry, not breakout). Mitigation: manual code-vs-contract verification for each strategy's entry/exit rules. This is the most important gate check.
- **R2: Strategy code changes after contracts are written.** The contracts become stale. Mitigation: this is a known limitation — contracts are a point-in-time snapshot. The hardening effort can add a CI check or a comment convention.

## 8. Phasing

**Phase 1 — Bootstrap + Generate**
Bootstrap v1 config versions for the 3 day-trader analysts (same pattern as `analyst-contracts`). Generate v2 contracts from strategy source code via `gemma4:26b`. Validate structurally. Verify entry/exit rules match the actual code for each strategy.

**Phase 2 — Polish + Completion Report**
Final gate run. Completion report. Verify all 10 base analysts (7 personality + 3 day traders) now have config versions with contracts.
