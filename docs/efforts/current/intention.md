# Day Trader Contracts — Intention

## What This Effort Is

Extend the structured contract system to the 3 day-trader analysts (`gap-and-go`, `mean-reversion`, `momentum-breakout`). Bootstrap their config versions (currently NULL) and generate strategy specification documents that describe each algorithm's behavior, entry/exit rules, risk parameters, and market conditions.

This is a smaller effort than `analyst-contracts` because day traders are fundamentally different from personality analysts. Personality analysts are LLM-driven — their contracts describe how the LLM should reason, and the Tier 2 audit checks whether the reasoning honored the contract. Day traders are **hard-coded algorithmic strategies** — they don't produce rationale text, they execute `decide()` → `open/close/noop` based on bar data and signals. Their contracts describe *what the algorithm does and should do*, not how an LLM should think.

## Why It Matters

The day trader subsystem currently has:
- 3 `market_analysts` rows with `analyst_type='day_trader'` and 16-char stub prompts ("Day trader seed.")
- NULL `current_config_version_id` on all 3
- No structured documentation of what each strategy actually does — the only source of truth is the TypeScript code in the strategy classes

Without contracts:
- There's no human-readable description of "what does gap-and-go actually do?" outside the code
- The hardening effort (next after this) can't audit day trader behavior against a stated intent
- Future strategy tuning has no baseline to compare against
- The config version system has a gap — 3 analysts are invisible to it

With contracts:
- Each strategy has a plain-English spec: entry conditions, exit conditions, signal usage, risk philosophy
- Config version tracking activates for day traders (predictions from their positions will record `config_version_id` if the system is extended to do so in the future)
- The hardening effort has a baseline to check against
- A domain expert can read the contracts and say "that's not what I want gap-and-go to do"

## Discovery Findings

These facts were learned during exploration and should not be re-discovered:

1. **Day traders are stateful strategy classes**, not LLM calls. Three strategies registered in `DayTraderRunnerService`:
   - `MomentumBreakoutStrategy` — buys on 20-bar high breakout, exits on first lower high
   - `MeanReversionStrategy` — buys when price >2 stdevs below 20-bar SMA, exits on reversion
   - `GapAndGoStrategy` — enters after 14:30 UTC on 1%+ gap-up + green bar, exits on first red bar

2. **Day traders do NOT write to `market_predictions`.** They read the latest signals (predictions from personality analysts) as input, but their output goes directly to `analyst_positions` (open/close) and `analyst_portfolios` (balance, P&L, strategy_state).

3. **The data flow:** `OutcomeTrackingService` (every 15 min) → `DayTraderRunnerService.runStrategies()` → each strategy's `decide(ctx)` → open/close via `AutotradeOpenHelper` → `analyst_positions` + `analyst_portfolios` updates.

4. **Strategy logic is hard-coded in TypeScript.** Entry/exit conditions, lookback periods, thresholds — all in the strategy class files. No external configuration. No LLM involvement.

5. **Conviction modifier:** signals from other analysts can veto a trade (flat + >70% confidence → no open) or adjust sizing (confidence maps to 0.5x–1.5x multiplier). This is the only cross-system interaction.

6. **EOD boundary:** at 22:00 UTC, all open day-trader positions are force-closed regardless of strategy. Strategies are not consulted.

7. **Day trader portfolios exist:** `pf-portfolio-gap-and-go`, `pf-portfolio-mean-reversion`, `pf-portfolio-momentum-breakout` in `analyst_portfolios` with `kind='day_trader'`.

8. **The Tier 1 learning engine ignores day traders** — it filters on `analyst_type = 'personality'` only. So no carry-forward concern.

9. **The Tier 2 audit can't spot-check day traders the same way** — there's no LLM rationale to compare against a contract. A future effort could audit *position actions* against the contract's stated rules, but that's a different audit type. Out of scope here.

## What Good Looks Like

- Config versions bootstrapped for all 3 day-trader analysts (v1 from stub prompt, v2 with structured contract).
- Each contract has:
  - `## General` — what this strategy is, its risk philosophy, market conditions where it works vs doesn't
  - `## Role: Day Trader` — entry conditions (exact rules from the code), exit conditions (exact rules), position sizing logic, signal usage (conviction modifier), EOD behavior
  - `## Adaptations` — empty, reserved for future use
- The contracts accurately describe the hard-coded strategy behavior (verified by reading the strategy source code, not by asking an LLM to guess).
- `current_config_version_id` is non-null for all 3 day-trader analysts.
- All existing gates pass.

## What "Contracts" Means Here

For personality analysts, contracts are **LLM operating instructions** — they tell the model what to focus on, how to reason, what to avoid. The Tier 2 audit reads the contract and the LLM's output and finds discrepancies.

For day traders, contracts are **strategy specification documents** — they describe an algorithm's behavior in plain English. They are documentation, not instructions. The algorithm doesn't read the contract; the contract describes what the algorithm does. The value is:
- Human readability (a non-programmer can understand what the strategy does)
- Auditability (a future audit can compare actual position actions against stated rules)
- Change tracking (when someone modifies the algorithm, they update the contract too)
- Baseline for tuning (you can't decide "this strategy should be more aggressive" without first documenting what "current behavior" is)

## Out Of Scope

- **Changing any day-trader strategy logic.** Read-only. The contracts describe behavior; they don't modify it.
- **Tier 2 audit integration for day traders.** The current audit checks LLM rationale against contracts. Day traders have no rationale. A position-action audit is a different type and belongs in a future effort.
- **Tier 1 learning for day traders.** The learning engine already filters them out.
- **Any changes to `DayTraderRunnerService` or the strategy classes.** Pure documentation effort.
- **Position-level config_version_id tracking.** Day trader positions don't currently record which config version was active. Adding that is a schema change that belongs in the hardening effort if needed.
- **Conviction modifier tuning.** The signal-veto and sizing-multiplier logic is hard-coded. Documenting it in the contract is in scope; changing it is not.

## Decisions

- **Generation method:** AI scaffolding from the **source code** of each strategy class, not from predictions (day traders don't have prediction rationales). The scaffolding script reads the strategy TypeScript files, extracts the entry/exit logic, and asks the LLM to produce a human-readable contract. Use `gemma4:26b` for quality.
- **Section structure:** same as personality analysts (`## General`, `## Role: Day Trader`, `## Adaptations`) for consistency. The parser in `parseContractMarkdown` handles them identically.
- **Bootstrap pattern:** same as `analyst-contracts` — create v1 from stub prompt, generate v2 with contract, wire `current_config_version_id`.
- **No carry-forward update needed.** The learning engine already skips day traders (`WHERE analyst_type = 'personality'`). The `createMarketAnalyst` and `updateMarketAnalyst` paths already carry forward from the `analyst-contracts` effort.
- **Validation:** same structural checks as personality analysts (section headers, placeholder header, legal language, no apology text) plus a manual verification that the described entry/exit rules match the actual code.

## Dependencies

- `analyst-contracts` is merged ✅
- Strategy source files exist: `momentum-breakout-strategy.ts`, `mean-reversion-strategy.ts`, `gap-and-go-strategy.ts` (or similar names in `apps/api/src/markets/services/`)
- `gemma4:26b` available via Ollama ✅
- Bootstrap/generate script patterns established in prior effort ✅
