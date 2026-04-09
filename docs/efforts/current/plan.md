# Day Trader Contracts — Implementation Plan

**PRD**: ./prd.md
**Created**: 2026-04-09
**Status**: Not Started

## Progress Tracker
- [x] Phase 1: Bootstrap + Generate
- [x] Phase 2: Polish + Completion Report

---

## Phase 1: Bootstrap + Generate
**Status**: Not Started
**Objective**: Bootstrap config versions for 3 day-trader analysts and generate structured strategy specification contracts from their source code.

### Steps
- [ ] 1.1 Extend `scripts/bootstrap-analyst-versions.ts` to include the 3 day-trader slugs (`gap-and-go`, `mean-reversion`, `momentum-breakout`) in its `TARGET_SLUGS` array, or write a separate small script. Run it. Verify 3 new config version rows exist.
- [ ] 1.2 Write `scripts/generate-day-trader-contracts.ts`. For each day-trader analyst:
  a. Read the strategy source file (`apps/api/src/markets/strategies/<name>.strategy.ts`).
  b. Read the conviction modifier logic from `day-trader-runner.service.ts`.
  c. Build a prompt that includes the source code excerpts, the conviction modifier, the EOD force-close rule, and the target contract structure.
  d. Call `gemma4:26b` via Ollama.
  e. Post-process: legal-language replacements, placeholder header dedup.
  f. Validate: section headers, placeholder header, no apology text.
  g. Create v2 config version row with `context_markdown`, deactivate v1, wire `current_config_version_id`.
- [ ] 1.3 Run the generation script.
- [ ] 1.4 **Manual code-vs-contract verification** for each strategy:
  - Gap and Go: contract says enters after 14:30 UTC on 1%+ gap-up with green bar, exits on first red bar, fires once per session? Matches `GAP_PCT = 0.01` and the arming/fire logic in the source?
  - Mean Reversion: contract says buys when price >2 stdevs below 20-bar SMA, exits on reversion to mean? Matches `LOOKBACK = 20`, `K = 2.0`?
  - Momentum Breakout: contract says buys on fresh 20-bar high breakout, exits on first lower high? Matches `LOOKBACK = 20`?
  - All three: contract mentions conviction modifier (flat + >70% confidence → veto, sizing 0.5x–1.5x)? EOD force-close at 22:00 UTC?
- [ ] 1.5 Verify all 3 via DB query: `SELECT ma.slug, acv.version_number, length(acv.context_markdown) FROM prediction.analyst_config_versions acv JOIN prediction.market_analysts ma ON ma.current_config_version_id = acv.id WHERE ma.analyst_type = 'day_trader';`

### Quality Gate
- [ ] **Lint**: `pnpm lint`
- [ ] **Build**: `pnpm build`
- [ ] **Markets CI**: `pnpm ci:markets`
- [ ] **DB Verification**: 3 day-trader analysts have non-null `context_markdown` on their active config version.
- [ ] **Code-vs-Contract**: each strategy's entry/exit rules in the contract match the actual source code.
- [ ] **Curl Tests**: calibration endpoint still returns 200. Audit findings endpoint still returns 200.
- [ ] **Phase Review**: Compare against PRD §4.3, §4.4, §4.5.
  - [ ] All 3 contracts have `## General`, `## Role: Day Trader`, `## Adaptations`?
  - [ ] Entry/exit rules are accurate per source code?
  - [ ] Conviction modifier documented?
  - [ ] EOD behavior documented?
  - [ ] Placeholder header present?

---

## Phase 2: Polish + Completion Report
**Status**: Not Started
**Objective**: Final verification and completion report.

### Steps
- [ ] 2.1 Verify all 10 base analysts (7 personality + 3 day traders) have config versions with contracts: `SELECT ma.slug, ma.analyst_type, acv.version_number, length(acv.context_markdown) as md_len FROM prediction.analyst_config_versions acv JOIN prediction.market_analysts ma ON ma.current_config_version_id = acv.id WHERE ma.organization_slug = '__base__' ORDER BY ma.analyst_type, ma.slug;`
- [ ] 2.2 Write `docs/efforts/current/completion-report.md`.
- [ ] 2.3 Final gate run.

### Quality Gate
- [ ] **Lint**: `pnpm lint`
- [ ] **Build**: `pnpm build`
- [ ] **Markets CI**: `pnpm ci:markets`
- [ ] **DB Verification**: 10/10 base analysts have non-null `context_markdown`.
- [ ] **Phase Review**: Compare against entire PRD.
  - [ ] All §2 success criteria met?
  - [ ] No §6 out-of-scope items snuck in?
  - [ ] Completion report written?
