# Divinr.ai — Efforts Roadmap

**Last updated:** 2026-04-16
**Maintained by:** `/roadmap` skill

> **⚠️ Strategy under revision.** The tier model documented in the *Future — Revenue Pipeline* section below (Starter / Pro / Premium / Custom) is **historical**, not current strategy. The system is moving to a **club-as-billing-unit** model with capability-union + quota-sum entitlements, where every user is auto-enrolled in a default paid club (**Divinr Basic**, $50/mo). The in-flight redesign lives in [next/divinr-basic-club-model/intention.md](next/divinr-basic-club-model/intention.md), which owns the rewrite of this document as its prerequisite phase. Treat the Phase 1/2 tier tables below as the prior plan, not the active one.

## Vision

Divinr's core promise is **explainability over black-box trading bots**. Five LLM-powered analysts each produce independent predictions with captured reasoning. A risk debate system challenges every assessment. A three-tier learning loop makes the system smarter over time — and every adaptation is visible.

**The closed loop is fully operational:**
1. Analysts produce predictions with reasoning (shipped)
2. Predictions evaluated against real outcomes nightly (shipped)
3. Humans can read why analysts were right or wrong (shipped)
4. System audits analyst reasoning against contracts (shipped)
5. System proposes improvements, humans approve (shipped)

**What's built and tested:**
- 14 feature areas Chrome-tested and verified
- Landing page live at /welcome
- Grouped sidebar nav with role-based visibility
- St. Thomas Investing Club with 3 members, tournament scheduled for Apr 20
- One-step club signup at /join with invite code
- Marketing compilation: hero copy, 15-feature inventory, 4 user personas

---

## Current State

**Infrastructure:** DGX Spark running gemma4 (local inference, zero cost)
**Users:** 3 active (demo-user, golfergeek, ethan) + invite flow ready; St. Thomas intern joining shortly
**Status:** Onboarding tour v1 shipped. Architecture restructure block queued ahead of billing — the system is moving from individual-tier pricing to a club-as-billing-unit model, which requires foundational work on contracts, the workflow pipeline, and the (club, analyst, instrument) triple model before billing can be wired.

**Current effort:** *(none active — promote first architecture effort when ready)*

---

## Next (14 efforts queued)

See [next/](next/) for full intention files. Logical ordering with dependencies:

**Architecture restructure block** (sequential — each depends on the prior):
1. [workflow-stages-article-pipeline](next/workflow-stages-article-pipeline/intention.md) — named workflow stages, two-step article pipeline, predictor → risk → prediction reorder
2. [stage-keyed-analyst-contracts](next/stage-keyed-analyst-contracts/intention.md) — restructure contracts; close documented-vs-runtime gap
3. [instrument-contracts](next/instrument-contracts/intention.md) — first-class contract entity for instruments
4. [club-authored-custom-content](next/club-authored-custom-content/intention.md) — clubs author analysts, contracts, instruments
5. [triple-model-reasoning-continuity](next/triple-model-reasoning-continuity/intention.md) — (club, analyst, instrument) becomes the reasoning atom
6. [slot-based-enablement-ui](next/slot-based-enablement-ui/intention.md) — user-facing triple selection

**Membership / club model block** (depends on architecture):
7. [divinr-basic-club-model](next/divinr-basic-club-model/intention.md) — default paid club, multi-club entitlement, opt-outs, lifecycle (and **owns the rewrite of this roadmap document**)
8. [club-tournament-experience-polish](next/club-tournament-experience-polish/intention.md) — UX polish on club + tournament surfaces (intern showcase)
9. [student-club-accounts](next/student-club-accounts/intention.md) — .edu-gated student clubs (free, paid-ready)
10. [paid-club-tier-catalog](next/paid-club-tier-catalog/intention.md) — $100 / $500 club SKUs above Basic

**Product expansion block:**
11. [onboarding-tour-extended](next/onboarding-tour-extended/intention.md) — chaptered, hour-long, interaction-aware, video-ready (v2 of shipped tour)
12. [live-prediction-pnl](next/live-prediction-pnl/) — real-money intraday cycle validation
13. [spark-beta-hardening](next/spark-beta-hardening/) — operational hardening for beta on DGX Spark
14. [stripe-integration](next/stripe-integration/) — billing wiring (rescoped to club subscriptions, not individual tiers)

---

## Key Architectural Insights (driving the restructure)

- **Inference cost is content-keyed, not user-keyed.** Total cost ≈ (articles × analysts) + (predictions × predictors × analysts) — adding users who follow already-covered content is nearly free; adding instruments to the universe is what costs money. Pricing should align with content commitment, not headcount.
- **The (club, analyst, instrument) triple is the atom of reasoning continuity.** A single analyst running through multiple instrument-contract lenses holds independent risk views, predictor streams, and learning per lens.
- **Custom-instrument authorship is the real revenue lever.** Custom analyst authorship is meaningful but bounded; custom-instrument authorship inflates Stage 1 article fanout for every article forever — the right place for premium pricing (~$4k/mo magnitude per quota of 10 custom instruments).
- **Beta strategy is "premium content as showcase."** Put genuinely attractive instruments/sources/analysts in beta labeled "premium-eligible later, free now" — beta validates the model, not revenue.

---

## Future — Revenue Pipeline

### Phase 1: Paid Tiers

| Tier | Price | Analysts | Sources | Instruments |
|------|-------|----------|---------|-------------|
| **Free trial** | $0 / 1 month | Pro-level access | All | All |
| **Starter** | $20/mo | 5 base (gemma4) | Free (RSS, public filings) | Core stocks (~15-20) |
| **Pro** | $50/mo | Refined (better contracts) | Paid (Polygon, news APIs) | Full stock universe |
| **Premium** | $100/mo | Frontier-model (Claude/GPT-4) | Institutional-grade | Full + crypto/commodities |

**Key:** Quality ladder — better sources produce better analysis. Users upgrade when they see Pro analysts outperform Starter ones.

### Phase 2: Custom Tier ($500+/mo)

Power users bring their own API keys:
- **Custom analysts** — user's LLM key pays for inference
- **Custom data sources** — user's data API key pays for feeds
- **Platform fee** covers orchestration, learning loop, evaluation
- **Private analysis** invisible to other users
- Pure margin — they pay their own compute/data costs

### Phase 3: Infrastructure Migration

Revenue from tiers funds the move from Spark/gemma4 to frontier models on cloud:
1. **Now:** Spark + gemma4 (bootstrap, zero inference cost)
2. **Revenue:** Stripe + paid tiers fund the transition
3. **Scale:** Frontier models on cloud (faster, smarter, concurrent)

**No desktop/local hybrid.** Platform never leaves our infrastructure. That's the moat.

---

## Completed Efforts (31)

### Core Engine
| Effort | What it did |
|---|---|
| `auth-bootstrap` | JWT auth, RBAC, admin middleware |
| `llm-reasoning-capture` | Capture reasoning on every LLM call |
| `see-your-reasoning` | Render reasoning in prediction modal |
| `calibration-drilldown` | Per-instrument accuracy, scatter, wrong-first list |
| `analyst-contracts` | Structured markdown contracts for 7 analysts |
| `tier-2-audit` | Contract-vs-output audit, admin findings inbox |
| `day-trader-contracts` | Contracts for 3 day trader strategies |
| `automated-meta-loop` | Audit policy evolves from accept/reject feedback |
| `tier-1-structured-writes` | Autonomous adaptations into context_markdown |
| `tier3-strategic-overhauls` | Full contract rewrites with canonical test validation |
| `user-scoped-platform` | Replaced org-slug with user_id ownership (117 files) |

### Professional Polish
| Effort | What it did |
|---|---|
| `harden-monitor` | 40 issues fixed across 89 files |
| `dead-table-cleanup` | Dropped legacy tables |
| `beta-user-share-path` | Invite signup, mutation guards, canWrite composable |
| `leaderboard-calibration-affordance` | One-click from leaderboard to drilldown |
| `contract-editor-ui` | Admin contract editor with version history, diff, rollback |
| `risk-debate-drilldown` | Expandable reasoning panels on debate columns |
| `user-analyst-affinity` | Affinity scoring, contrarian alerts, personalization |
| `notification-system` | Unified notification bell, 5 event producers, SSE |
| `fear-greed-alerting` | Sentiment crowd reaction alerts |
| `multi-analyst-coordination` | Correlation matrix, coverage gaps, contribution scoring |
| `performance-dashboard` | Equity curves, PnL summary, analyst leaderboard |
| `mobile-polish` | Responsive layouts 375px–1440px |

### Social / Game Layer
| Effort | What it did |
|---|---|
| `messaging-system` | DMs, channels, threads, reactions, attachments, moderation |
| `tournament-system` | Paper-trading competitions, isolated portfolios, leaderboards |
| `learning-clubs` | Clubs, invites, challenges, polls, journals, analytics |
| `public-club-rankings` | Cross-club leaderboards, badges, comparison |
| `curriculum-builder` | Multi-week courses, auto-unlock, professor dashboard |
| `mentor-mentee-pairing` | Mentor eligibility, pairing, feedback, leaderboard |

### Testing & Marketing (this session)
| Effort | What it did |
|---|---|
| 14 test efforts | API + Chrome verification of every feature area |
| Marketing compilation | Landing page copy, 15-feature inventory, 4 personas |
| Nav redesign | Grouped sidebar, admin-only sections, notification cleanup |
| Landing page | Public page at /welcome with hero, features, how-it-works |
| Fix orphaned evaluations | Remapped 3,036 instrument IDs, fixed contributions + findings |
| Tournament competitive loop | St. Thomas Sprint #1 with 3 players, 6 trades |
| Friend invite flow | One-step /join page with club code signup |

---

## How This Document Is Maintained

- Updated whenever efforts complete or priorities change
- Each effort has its own `intention.md` → `plan.md` chain in `docs/efforts/`
- `current/` = in progress, `next/` = queued, `future/` = planned but not scheduled
