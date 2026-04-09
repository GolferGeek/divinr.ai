# Divinr.ai — Efforts Roadmap

**Last updated:** 2026-04-09
**Maintained by:** `/roadmap` skill

## Vision

Divinr's core promise is **explainability over black-box trading bots**. The system produces predictions through a panel of LLM-powered analysts, each with their own perspective and decision criteria. The vision is a closed loop:

1. **Analysts produce predictions** with captured reasoning (shipped: `llm-reasoning-capture`).
2. **Predictions are evaluated** against real outcomes by a nightly pipeline (shipped: evaluation infrastructure).
3. **Humans can read** why analysts were right or wrong (shipped: `see-your-reasoning`, `calibration-drilldown`).
4. **The system itself audits** analyst reasoning against stated contracts, surfaces discrepancies, and proposes improvements (building: `analyst-contracts` → next: `tier-2-audit`).
5. **A human approves** or rejects the system's proposals, and the system learns from the human's judgments over time.

Steps 1–3 are shipped. Step 4 is in progress (the contracts that make audit possible). Step 5 is the next effort after contracts land.

The tier system (`tier1_auto` / `tier2_approved` / `tier3_strategic` on `analyst_config_versions.source`) is the schema-level embodiment of this vision. Tier 1 (autonomous micro-adjustments) is already built and running. Tier 2 (human-in-the-loop audit + approval) is the next major effort. Tier 3 (strategic overhauls) is future.

---

## Completed Efforts

| Effort | What it did | Archived |
|---|---|---|
| `auth-bootstrap` | JWT auth, RBAC, admin middleware | `docs/efforts/auth-bootstrap/` |
| `llm-reasoning-capture` | Capture reasoning_content on every LLM call into `llm_usage` | `docs/efforts/llm-reasoning-capture/` |
| `see-your-reasoning` | Render captured reasoning in the prediction modal's Reasoning tab | `docs/efforts/see-your-reasoning/` |
| `calibration-drilldown` | Analyst performance view: metrics, per-instrument breakdown, scatter, wrong-first list, inline reasoning expansion | `docs/efforts/calibration-drilldown/` |

---

## Current Effort

### Analyst Contracts
**Branch:** `effort/analyst-contracts` (not yet created)
**Intention:** `docs/efforts/current/intention.md`
**Status:** Intention written, awaiting `/build-prd`

Replace flat `persona_prompt` with structured markdown contract documents (General + Role sections + Adaptations) stored in `analyst_config_versions.context_markdown`. Generate v2 contracts for 7 base analysts via AI scaffolding. Add canonical reader methods. Minimally update Tier 1 learning engine to carry forward `context_markdown` on new version rows.

**Why now:** Tier 2 (the audit loop) is impossible without contracts to audit against. The Tier 1 engine is actively appending suffixes to flat `persona_prompt` strings — every day without contracts means more structural debt accumulating.

**Unblocks:** Tier 2 Audit + Approval, Day Trader Contracts

---

## Next Efforts

These have enough definition to write intentions for. Order reflects dependencies.

### 1. Tier 2 Audit + Approval Loop
**Depends on:** Analyst Contracts (current)
**Scope:** The "mostly AI, some human in the loop" audit that spot-checks predictions against analyst contracts. Background loop picks a resolved prediction, reads the contract + input + output, finds contract-vs-output discrepancies, writes a finding with a hypothesis to a queue. Admin inbox with three buttons (you're right / you're wrong / interesting but no action). Append-only feedback log. Uses `learning_proposals` table (already exists) with `tier=2`. Approved proposals follow the existing paper-mode path from Tier 1.

**Key design decisions (settled in conversation):**
- One audit type in v1: contract-vs-output discrepancy on a single resolved prediction
- Dumb inbox, no filtering, no batch ops — let real volume inform the v2 UX
- Manual meta-loop in v1: append-only accept/reject log, no automated policy learning
- Selection starts random/round-robin weighted toward wrong predictions
- Local model (Gemma or equivalent) runs the audit — no latency budget, background only

### 2. Day Trader Contracts
**Depends on:** Analyst Contracts (current)
**Scope:** Extend structured contracts to the 3 day-trader analysts (`gap-and-go`, `mean-reversion`, `momentum-breakout`). Requires first understanding the day-trader subsystem — these analysts don't appear in `market_predictions` and live in a separate workflow. Discovery-heavy.

**Why separate from analyst-contracts:** day traders are a different subsystem with different data paths. Bundling them would have doubled the discovery surface for the current effort.

### 3. Tier 1 Structured Writes
**Depends on:** Tier 2 Audit + Approval (to validate that structured writes are better than suffix appends)
**Scope:** Update the Tier 1 learning engine to write into `## Adaptations` section of the structured contract instead of appending hardcoded text suffixes to `persona_prompt`. Requires the audit consumer to be running first so we can compare outcomes.

---

## Future Efforts

These are real ideas that need more definition before they become intentions. Rough priority order.

### Automated Meta-Loop (Tier 2 v2)
The system reads the append-only accept/reject log from Tier 2, produces an updated "selection policy" (what to surface, what to skip), and the next audit cycle uses the policy. This is the piece that makes Tier 2 stop being a dumb cron job and start being a learning system. Deferred from Tier 2 v1 because it needs real accept/reject data to design against.

### Contract Editor UI
Admin surface for reading and editing contracts with diff viewer (side-by-side version comparison) and one-click rollback. Lives in the same admin view as the Tier 2 inbox. Deferred from analyst-contracts because contracts are generated by script in v1 and the editing surface should be designed against the actual reading pattern from the inbox, not guessed at.

### Leaderboard → Calibration Affordance
Small effort. Wire the existing leaderboard (which already shows per-analyst accuracy metrics) to the calibration-drilldown view so clicking an analyst takes you to their performance page. Zero new routes — just a `router-link` on the leaderboard row. Identified as a follow-on in the calibration-drilldown completion report.

### Risk-Debate Drilldown
Visualize the three-way blue/red/arbiter debate that already has reasoning linked through `llm_usage_id`. Separate interaction-design problem from the prediction drilldown. Identified as out of scope in calibration-drilldown intention.

### Beta-User Share Path
Let someone other than the founder see the explainability surfaces. The drilldown + contracts + audit together form the demo moment that takes divinr from "shows predictions" to "explains why predictions were right or wrong." This is the effort that makes that moment visible to a second person.

### Dead Table Cleanup
Drop `prediction.analysts` (32 rows, last updated 2026-03-15) and `prediction.analyst_context_versions` (28 rows, last created 2026-03-15). Remnants of an earlier design iteration. Referenced by one file each. No urgency but they confuse future discovery.

---

## Dependency Graph

```
auth-bootstrap ──────┐
                      │
llm-reasoning-capture─┤
                      │
see-your-reasoning────┤
                      ▼
         calibration-drilldown
                      │
                      ▼
            analyst-contracts ◄── (current)
               │           │
               ▼           ▼
     tier-2-audit    day-trader-contracts
          │
          ▼
  tier-1-structured-writes
          │
          ▼
  automated-meta-loop
```

---

## How This Document Is Maintained

- **Updated by the `/roadmap` skill** whenever the user wants to discuss, reprioritize, or add/remove efforts.
- **Updated at effort transitions:** when an effort completes and archives, the skill moves it to Completed, promotes the next effort to Current, and adjusts the dependency graph.
- **Not a plan.** This document captures *what* and *why* and *in what order*. The *how* lives in each effort's intention → PRD → plan chain.
