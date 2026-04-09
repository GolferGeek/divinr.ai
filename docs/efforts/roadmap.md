# Divinr.ai — Efforts Roadmap

**Last updated:** 2026-04-09
**Maintained by:** `/roadmap` skill

## Vision

Divinr's core promise is **explainability over black-box trading bots**. The system produces predictions through a panel of LLM-powered analysts, each with their own perspective and decision criteria. The vision is a closed loop:

1. **Analysts produce predictions** with captured reasoning (shipped).
2. **Predictions are evaluated** against real outcomes by a nightly pipeline (shipped).
3. **Humans can read** why analysts were right or wrong (shipped: `see-your-reasoning`, `calibration-drilldown`).
4. **The system itself audits** analyst reasoning against stated contracts and surfaces discrepancies (shipped: `analyst-contracts`, `tier-2-audit`).
5. **A human approves** or rejects the system's proposals, and the system learns from the human's judgments over time (shipped: tier-2 inbox with accept/reject/note feedback log).

**All 5 steps are now operational.** The loop is closed end-to-end. What follows is deepening, widening, and automating it.

The tier system (`tier1_auto` / `tier2_approved` / `tier3_strategic` on `analyst_config_versions.source`): Tier 1 (autonomous micro-adjustments) is built and running. Tier 2 (human-in-the-loop audit + approval) is built and running. Tier 3 (strategic overhauls) is future.

---

## Completed Efforts

| Effort | What it did | Archived |
|---|---|---|
| `auth-bootstrap` | JWT auth, RBAC, admin middleware | `docs/efforts/auth-bootstrap/` |
| `llm-reasoning-capture` | Capture reasoning_content on every LLM call into `llm_usage` | `docs/efforts/llm-reasoning-capture/` |
| `see-your-reasoning` | Render captured reasoning in the prediction modal's Reasoning tab | `docs/efforts/see-your-reasoning/` |
| `calibration-drilldown` | Analyst performance view: metrics, per-instrument breakdown, scatter, wrong-first list, inline reasoning expansion | `docs/efforts/calibration-drilldown/` |
| `analyst-contracts` | Structured markdown contracts for 7 base analysts, config version bootstrap, canonical readers, tier-1 carry-forward | `docs/efforts/analyst-contracts/` |
| `tier-2-audit` | Contract-vs-output audit with gemma4:26b, admin inbox at /findings, cron schedule, accept/reject/note feedback | `docs/efforts/tier-2-audit/` |

---

## Current Effort

*None.* `docs/efforts/current/` is empty. Ready for the next effort.

---

## Next Efforts

These have enough definition to write intentions for. Order reflects dependencies.

### 1. Day Trader Contracts ← next
**Depends on:** Analyst Contracts (complete)
**Scope:** Extend structured contracts to the 3 day-trader analysts (`gap-and-go`, `mean-reversion`, `momentum-breakout`). Requires first understanding the day-trader subsystem — these analysts don't appear in `market_predictions` and live in a separate workflow. Discovery-heavy.

### 2. Automated Meta-Loop (Tier 2 v2)
**Depends on:** Tier 2 Audit (complete — needs real accept/reject data, which is now accumulating)
**Scope:** The system reads the append-only accept/reject log from Tier 2, produces an updated "selection policy" (what to surface, what to skip), and the next audit cycle uses the policy. Makes Tier 2 stop being a dumb cron job and start being a learning system.

### 3. Harden + Monitor (extended effort)
**Depends on:** Day Trader Contracts, Automated Meta-Loop
**Scope:** Extended effort focused on fixing errors, monitoring system health, and hardening everything that's been built. Not a single feature — a sweep across the entire system. Includes: fixing the pre-existing `test:compliance:mutation` failure, monitoring the Tier 1 + Tier 2 pipelines for silent failures, cleaning up edge cases in the audit/contract/calibration surfaces, adding error alerting, stress-testing the cron jobs, reviewing and acting on accumulated audit findings, and general stability work. This is the "make it solid" effort before any beta-user share path.

---

## Future Efforts

### Tier 1 Structured Writes
Update the Tier 1 learning engine to write into `## Adaptations` instead of appending hardcoded text suffixes to `persona_prompt`. Deferred until after the meta-loop + hardening — the carry-forward keeps contracts alive in the meantime.

### Contract Editor UI
Admin surface for reading and editing contracts with diff viewer (side-by-side version comparison) and one-click rollback. Lives alongside the Tier 2 inbox.

### Leaderboard → Calibration Affordance
Small effort. Wire the existing leaderboard to the calibration-drilldown view so clicking an analyst navigates to their performance page.

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
         calibration-drilldown ✅
                      │
                      ▼
            analyst-contracts ✅
               │           │
               ▼           ▼
     tier-2-audit ✅    day-trader-contracts
          │
          ├──────────────────┐
          ▼                  ▼
  tier-1-structured-writes   automated-meta-loop
```

---

## How This Document Is Maintained

- **Updated by the `/roadmap` skill** whenever the user wants to discuss, reprioritize, or add/remove efforts.
- **Updated at effort transitions:** when an effort completes and archives, the skill moves it to Completed, promotes the next effort to Current, and adjusts the dependency graph.
- **Not a plan.** This document captures *what* and *why* and *in what order*. The *how* lives in each effort's intention → PRD → plan chain.
