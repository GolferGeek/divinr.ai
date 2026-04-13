# Divinr.ai — Efforts Roadmap

**Last updated:** 2026-04-13
**Maintained by:** `/roadmap` skill

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
**Users:** 3 active (demo-user, golfergeek, ethan) + invite flow ready
**Status:** Feature-complete for beta. Revenue model defined. Ready for Stripe.

---

## Next (2 efforts)

### 1. Live Prediction PnL
Run prediction cycles during market hours to generate real day trader returns. Validates that positions open at market prices, hold through intraday movement, and close at EOD with actual PnL.

**Blocked on:** Market hours (weekday 9:30 AM - 4:00 PM ET)

### 2. Stripe Integration
Payment processing, subscription management, tier gating. Prerequisite for everything in the revenue pipeline.

**Scope:** Customer creation, subscription CRUD, webhook handling, billing portal, pricing page, feature gating middleware.

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
