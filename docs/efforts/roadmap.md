# Divinr.ai — Efforts Roadmap

**Last updated:** 2026-04-09
**Maintained by:** `/roadmap` skill

## Vision

Divinr's core promise is **explainability over black-box trading bots**. The system produces predictions through a panel of LLM-powered analysts, each with their own perspective and decision criteria. The vision is a closed loop:

1. **Analysts produce predictions** with captured reasoning (shipped: `llm-reasoning-capture`).
2. **Predictions are evaluated** against real outcomes by a nightly pipeline (shipped: evaluation infrastructure).
3. **Humans can read** why analysts were right or wrong (shipped: `see-your-reasoning`, `calibration-drilldown`).
4. **The system itself audits** analyst reasoning against stated contracts, surfaces discrepancies, and proposes improvements (shipped: `analyst-contracts` → building: `tier-2-audit`).
5. **A human approves** or rejects the system's proposals, and the system learns from the human's judgments over time.

Steps 1–3 are shipped. Step 4 is in progress (contracts done, audit loop starting now). Step 5 is part of the current effort.

The tier system (`tier1_auto` / `tier2_approved` / `tier3_strategic` on `analyst_config_versions.source`) is the schema-level embodiment of this vision. Tier 1 (autonomous micro-adjustments) is already built and running. Tier 2 (human-in-the-loop audit + approval) is the current effort. Tier 3 (strategic overhauls) is future.

---

## Completed Efforts

| Effort | What it did | Archived |
|---|---|---|
| `auth-bootstrap` | JWT auth, RBAC, admin middleware | `docs/efforts/auth-bootstrap/` |
| `llm-reasoning-capture` | Capture reasoning_content on every LLM call into `llm_usage` | `docs/efforts/llm-reasoning-capture/` |
| `see-your-reasoning` | Render captured reasoning in the prediction modal's Reasoning tab | `docs/efforts/see-your-reasoning/` |
| `calibration-drilldown` | Analyst performance view: metrics, per-instrument breakdown, scatter, wrong-first list, inline reasoning expansion | `docs/efforts/calibration-drilldown/` |
| `analyst-contracts` | Structured markdown contracts for 7 base analysts, config version bootstrap, canonical readers, tier-1 carry-forward | `docs/efforts/analyst-contracts/` |

---

## Current Effort

### Tier 2 Audit + Approval Loop
**Branch:** `effort/tier-2-audit` (not yet created)
**Intention:** `docs/efforts/current/intention.md` (not yet written)
**Status:** Promoting to current — intention to be written now

The "mostly AI, some human in the loop" audit that spot-checks predictions against analyst contracts. Background loop picks a resolved prediction, reads the contract + input + output, finds contract-vs-output discrepancies, writes a finding with a hypothesis to a queue. Admin inbox with three buttons (you're right / you're wrong / interesting but no action). Append-only feedback log. Uses `learning_proposals` table (already exists) with `tier=2`. Approved proposals follow the existing paper-mode path from Tier 1.

**Key design decisions (settled in conversation):**
- One audit type in v1: contract-vs-output discrepancy on a single resolved prediction
- Dumb inbox, no filtering, no batch ops — let real volume inform the v2 UX
- Manual meta-loop in v1: append-only accept/reject log, no automated policy learning
- Selection starts random/round-robin weighted toward wrong predictions
- Local model (`gemma4:26b` for quality) runs the audit — no latency budget, background only
- The audit prompt extracts the matching role section from the contract as the rubric
- Findings are structured: contract excerpt, input excerpt, output excerpt, discrepancy, hypothesis

**Why now:** Contracts exist. The tier-2 slot in the schema is empty. The user wants the "see, I see this thing, what do you think?" loop operational.

**Unblocks:** Automated Meta-Loop, Tier 1 Structured Writes

---

## Next Efforts

### 1. Day Trader Contracts
**Depends on:** Analyst Contracts (complete)
**Scope:** Extend structured contracts to the 3 day-trader analysts (`gap-and-go`, `mean-reversion`, `momentum-breakout`). Requires first understanding the day-trader subsystem — these analysts don't appear in `market_predictions` and live in a separate workflow. Discovery-heavy.

### 2. Tier 1 Structured Writes
**Depends on:** Tier 2 Audit + Approval (to validate that structured writes are better than suffix appends)
**Scope:** Update the Tier 1 learning engine to write into `## Adaptations` section of the structured contract instead of appending hardcoded text suffixes to `persona_prompt`. Requires the audit consumer to be running first so we can compare outcomes.

---

## Future Efforts

### Automated Meta-Loop (Tier 2 v2)
The system reads the append-only accept/reject log from Tier 2, produces an updated "selection policy" (what to surface, what to skip), and the next audit cycle uses the policy. This is the piece that makes Tier 2 stop being a dumb cron job and start being a learning system. Deferred from Tier 2 v1 because it needs real accept/reject data to design against.

### Contract Editor UI
Admin surface for reading and editing contracts with diff viewer (side-by-side version comparison) and one-click rollback. Lives in the same admin view as the Tier 2 inbox. Deferred from analyst-contracts because contracts are generated by script in v1 and the editing surface should be designed against the actual reading pattern from the inbox, not guessed at.

### Leaderboard → Calibration Affordance
Small effort. Wire the existing leaderboard to the calibration-drilldown view so clicking an analyst takes you to their performance page.

### Risk-Debate Drilldown
Visualize the three-way blue/red/arbiter debate that already has reasoning linked through `llm_usage_id`.

### Beta-User Share Path
Let someone other than the founder see the explainability surfaces.

### Dead Table Cleanup
Drop `prediction.analysts` and `prediction.analyst_context_versions` (dead since 2026-03-15).

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
            analyst-contracts ✅
               │           │
               ▼           ▼
     tier-2-audit ◄── (current)    day-trader-contracts
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
