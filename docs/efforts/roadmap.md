# Divinr.ai — Efforts Roadmap

**Last updated:** 2026-04-10
**Maintained by:** `/roadmap` skill

## Vision

Divinr's core promise is **explainability over black-box trading bots**. The system produces predictions through a panel of LLM-powered analysts, each with their own perspective and decision criteria. The vision is a closed loop:

1. **Analysts produce predictions** with captured reasoning (shipped).
2. **Predictions are evaluated** against real outcomes by a nightly pipeline (shipped).
3. **Humans can read** why analysts were right or wrong (shipped: `see-your-reasoning`, `calibration-drilldown`).
4. **The system itself audits** analyst reasoning against stated contracts and surfaces discrepancies (shipped: `analyst-contracts`, `tier-2-audit`).
5. **A human approves** or rejects the system's proposals, and the system learns from the human's judgments over time (shipped: `automated-meta-loop`).

**All 5 steps are now operational.** The loop is closed end-to-end. The codebase has been hardened and monitored. All three learning tiers are running (Tier 1 autonomous, Tier 2 audited, Tier 3 strategic).

**What follows is a three-phase product expansion:**

1. **Professional polish** — Make the financial-domain SaaS product ready to charge for. Multi-analyst coordination, notifications, performance dashboard, mobile, testing, and marketing readiness.
2. **SaaS Power tier** — Let power users extend the shared platform within SaaS: custom data sources, custom articles, custom analysts, all running on our infrastructure alongside the shared layer.
3. **Local Hybrid tier** — Desktop app with a local API backend (e.g., DGX Spark). Power users get everything from the SaaS layer plus private analysts and proprietary data that never leaves their machine.

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
| `dead-table-cleanup` | Dropped legacy `prediction.analysts` and `prediction.analyst_context_versions` tables via ensureSchema() DDL | `docs/efforts/dead-table-cleanup/` |
| `tier3-strategic-overhauls` | Tier 3 learning: evidence aggregation from Tier 2 findings, LLM contract rewrites via gemma4:26b, canonical test validation, admin /proposals page with approve/reject, weekly cron | `docs/efforts/tier3-strategic-overhauls/` |

---

## Current Effort

(none — ready for a new effort)

---

## Next Efforts

These have enough definition to write intentions for. Order reflects dependencies.

### Phase 1: Professional Polish (target: ~1 week sprint)

1. **Multi-Analyst Coordination** — Detect redundant or conflicting analysts ("these two always cancel each other out", "these two are saying the same thing"). Surface coordination insights to admin. Builds on Tier 3's evidence aggregation patterns.

2. **Notification System** — Push alerts for stop-loss hits, new Tier 3 proposals, position entries/exits, nightly evaluation summaries. Start with in-app + email; Slack later. A professional tool doesn't make you poll a dashboard.

3. **Performance Dashboard** — At-a-glance equity curve, PnL summary, analyst leaderboard for beta readers and subscribers. The data exists (portfolio snapshots, calibration scores) — needs a compelling read-only view.

4. **Mobile Polish** — Capacitor/iOS app refinement. For a stock app, mobile is table stakes. Electron desktop is already scaffolded but needs attention too.

5. **Testing & Marketing Readiness** — Comprehensive E2E testing, demo scenarios, marketing copy that communicates the explainability story. Understand and document all the coolness we have.

---

## Future Efforts

### Phase 2: SaaS Power Tier

**Custom extensions within the SaaS platform.** Power users get the full shared layer (all base analysts, predictions, risk debates, evaluations) plus their own sandbox:
- Custom data sources and article feeds (proprietary research, private RSS)
- Custom analysts with their own contracts, running on our infrastructure
- Separate API namespace or app section for their extensions
- Natural monetization boundary: shared = standard subscription, custom = power tier

### Phase 3: Local Hybrid Tier

**Desktop app with local API backend.** The most advanced tier — everything from Phase 2, plus:
- Desktop app (Electron, already scaffolded) that federates between the SaaS API and a local backend
- Local LLM execution on user's hardware (DGX Spark, etc.) for private analysts
- Proprietary data that never leaves the user's machine
- Private analysis layered on top of the shared intelligence
- Hardest to build (federation protocol, local deployment packaging, sync) but most defensible

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
          │
          ▼
  dead-table-cleanup ✅
          │
          ▼
  tier3-strategic-overhauls ✅
          │
          ▼
  ┌── Phase 1: Professional Polish ──┐
  │                                   │
  │  multi-analyst-coordination       │
  │  notification-system              │
  │  performance-dashboard            │
  │  mobile-polish                    │
  │  testing-marketing-readiness      │
  │                                   │
  └───────────┬───────────────────────┘
              ▼
  ┌── Phase 2: SaaS Power Tier ──────┐
  │  custom-sources-articles          │
  │  custom-analysts                  │
  │  power-user-api-namespace         │
  └───────────┬───────────────────────┘
              ▼
  ┌── Phase 3: Local Hybrid Tier ────┐
  │  desktop-app-federation           │
  │  local-llm-backend                │
  │  private-data-layer               │
  └───────────────────────────────────┘
```

---

## How This Document Is Maintained

- **Updated by the `/roadmap` skill** whenever the user wants to discuss, reprioritize, or add/remove efforts.
- **Updated at effort transitions:** when an effort completes and archives, the skill moves it to Completed, promotes the next effort to Current, and adjusts the dependency graph.
- **Not a plan.** This document captures *what* and *why* and *in what order*. The *how* lives in each effort's intention → PRD → plan chain.
