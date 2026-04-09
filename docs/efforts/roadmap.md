# Divinr.ai — Efforts Roadmap

**Last updated:** 2026-04-09
**Maintained by:** `/roadmap` skill

## Vision

Divinr's core promise is **explainability over black-box trading bots**. The system produces predictions through a panel of LLM-powered analysts, each with their own perspective and decision criteria. The vision is a closed loop:

1. **Analysts produce predictions** with captured reasoning (shipped).
2. **Predictions are evaluated** against real outcomes by a nightly pipeline (shipped).
3. **Humans can read** why analysts were right or wrong (shipped: `see-your-reasoning`, `calibration-drilldown`).
4. **The system itself audits** analyst reasoning against stated contracts and surfaces discrepancies (shipped: `analyst-contracts`, `tier-2-audit`).
5. **A human approves** or rejects the system's proposals, and the system learns from the human's judgments over time (shipped: `automated-meta-loop`).

**All 5 steps are now operational.** The loop is closed end-to-end. The codebase has been hardened and monitored. What follows is deepening, widening, and preparing for users.

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
| `day-trader-contracts` | Extended structured contracts to day-trader analysts (gap-and-go, mean-reversion, momentum-breakout) | `docs/efforts/day-trader-contracts/` |
| `automated-meta-loop` | Audit learns from user feedback — selection policy updates from accept/reject log | `docs/efforts/automated-meta-loop/` |
| `harden-monitor` | Full codebase scan + hardening: 40 issues fixed across 89 files (@Inject, admin auth, security, legal language, dead code, accessibility) | `docs/efforts/harden-monitor/` |
| `tier-1-structured-writes` | Learning engine writes structured adaptations into `## Adaptations` of `context_markdown` instead of appending to `persona_prompt`; audit and runner now include adaptations | `docs/efforts/tier-1-structured-writes/` |
| `beta-user-share-path` | Invite-based signup for beta readers with read-only access; mutation guard on all endpoints; frontend canWrite composable | `docs/efforts/beta-user-share-path/` |
| `leaderboard-calibration-affordance` | One-click link from leaderboard calibration score to analyst drilldown; added analyst_id to portfolio summary API | `docs/efforts/leaderboard-calibration-affordance/` |
| `contract-editor-ui` | Admin contract editor at /analysts/:id/contract: read, version history, side-by-side diff, inline edit, one-click rollback; navigation from analyst list and findings | `docs/efforts/contract-editor-ui/` |
| `risk-debate-drilldown` | Expandable LLM reasoning panels on Blue/Red/Arbiter debate columns; GET /risk-debates/:id/reasoning endpoint; lazy-loaded with provider/model/token metadata | `docs/efforts/risk-debate-drilldown/` |

---

## Current Effort

None — ready for a new effort.

---

## Next Efforts

These have enough definition to write intentions for. Order reflects dependencies.

---

## Future Efforts

### Dead Table Cleanup
Drop `prediction.analysts` and `prediction.analyst_context_versions` (dead since 2026-03-15).

### Tier 3 Strategic Overhauls
The third tier of the learning system — significant analyst redesigns based on accumulated evidence. Requires substantial Tier 2 data history first.

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
     tier-2-audit ✅    day-trader-contracts ✅
          │
          ├──────────────────┐
          ▼                  ▼
  automated-meta-loop ✅   harden-monitor ✅
          │                  │
          ▼                  ▼
  tier-1-structured-writes ✅ beta-user-share-path ✅
          │
          ▼
  leaderboard-calibration-affordance ✅
          │
          ▼
  contract-editor-ui ✅
          │
          ▼
  risk-debate-drilldown ✅
```

---

## How This Document Is Maintained

- **Updated by the `/roadmap` skill** whenever the user wants to discuss, reprioritize, or add/remove efforts.
- **Updated at effort transitions:** when an effort completes and archives, the skill moves it to Completed, promotes the next effort to Current, and adjusts the dependency graph.
- **Not a plan.** This document captures *what* and *why* and *in what order*. The *how* lives in each effort's intention → PRD → plan chain.
