# Divinr.ai — Efforts Roadmap

**Last updated:** 2026-04-17 (live-prediction-pnl shipped; club-tournament-experience-polish promoted to current)
**Maintained by:** `/roadmap` skill

> **Canonical vision:** [master-intention.md](master-intention.md) is the single source of truth for product shape, business model, and architecture. This roadmap is a status snapshot of efforts; when they diverge, master-intention wins.

## Vision

Divinr's core promise is **explainability over black-box trading bots**. LLM-powered analysts each produce independent predictions with captured reasoning. A risk debate system challenges every assessment. A three-tier learning loop makes the system smarter over time — and every adaptation is visible.

**The closed loop is fully operational:**
1. Analysts produce predictions with reasoning (shipped)
2. Predictions evaluated against real outcomes nightly (shipped)
3. Humans can read why analysts were right or wrong (shipped)
4. System audits analyst reasoning against contracts (shipped)
5. System proposes improvements, humans approve (shipped)

---

## What's Built & Tested

- 14 feature areas Chrome-tested and verified
- Landing page live at /welcome
- Grouped sidebar nav with role-based visibility
- St. Thomas Investing Club with 3 members, tournament scheduled for Apr 20
- One-step club signup at /join with invite code
- Marketing compilation: hero copy, 15-feature inventory, 4 user personas
- Onboarding tour v1 (welcome modal → 12-step docent → completion, per-step walkthrough videos)
- Spark beta hardening: automated Postgres backups every 3 hours

---

## Current State

**Infrastructure:** DGX Spark running gemma4 (local inference, zero cost). Hardening in place (backups, service recovery).
**Users:** 3 active (demo-user, golfergeek, ethan); St. Thomas intern joining shortly; broader beta pending architecture work.
**Business model direction:** See [master-intention.md](master-intention.md). Single $50/mo Basic tier. Per-item authorship ($20/instrument, $60/analyst). Clubs are purely social. No multi-tier ladder. Cost-pass-through for students.
**Status:** Onboarding v1 shipped. Architecture restructure block underway. No billing wired yet (Stripe queued behind architecture foundation).

---

## Current Effort

**[club-tournament-experience-polish](current/club-tournament-experience-polish/intention.md)** — polish-and-tighten pass on club + tournament surfaces for the St. Thomas intern cohort. Scope is stubbed pending a deliberate walkthrough with the intern's perspective before the PRD is written.

---

## Recently Shipped

- **[live-prediction-pnl](live-prediction-pnl/intention.md)** (2026-04-17, PR #57) — day-trader strategies now have a real intraday runtime. `DayTraderSchedulerService` hourly cron during market hours + dedicated 3:55 PM ET EOD-flat cron, DST-aware `MarketHoursService` via `Intl.DateTimeFormat('America/New_York')`, `TwelveDataAdapter.fetchIntradayBars` routed through the existing 8rpm rate limiter, `IntradayBarRefresherService` merging hourly OHLC into `instruments.current_state.intraday_bars` (cap 24), `prediction.market_day_trader_runs` audit table, runner scoping per base vs. authored analyst, `OutcomeTrackingService` decoupled from day-trader runtime, admin `POST /markets/admin/day-trader/run-now`. 140 new unit assertions across 6 suites.
- **[entity-level-performance-attribution](entity-level-performance-attribution/intention.md)** (2026-04-17, PR #56) — multi-dimensional paper P&L attribution across triple/analyst/instrument/source/article/author. `prediction.outcome_records` table + 6 materialized views, 10 endpoints (8 admin-gated + 2 author), 5 views + banner + widget extensions. Feeds graduation candidate ranking, author retention surfaces, and cost-defensibility value-per-$ estimate.
- **[cost-modeling-system](cost-modeling-system/intention.md)** (2026-04-17, PR #55) — analytical layer on top of llm-usage-logging: per-model cost calibration with weekly cron + drift alerts, per-user prediction with cold-start + headroom, pricing defensibility (per-item-kind margin), student billing accrual, experimentation mode (serial-execute alternative models on saved prompts), 4 admin views + user billing summary + student widget.
- **[llm-usage-logging](llm-usage-logging/intention.md)** (2026-04-17, PR #54) — structured `prediction.llm_usage_log` table with 18 dimensional columns + 7 indexes; `LlmUsageLogger` with cost-on-write from `public.llm_models`; all 18 `generateText()` call sites instrumented with stage/sub_stage/IDs; 8 materialized views + nightly refresh + 90d retention; 7 API endpoints + admin dashboard + per-user widget.
- **[slot-based-enablement-ui](slot-based-enablement-ui/intention.md)** (2026-04-17, PR #53) — portfolio composition via (author, analyst, instrument) triples. Enablement table + API, "My Triples" tab with instrument-grouped display, inline add-to-portfolio flow with naming collision disambiguation, per-triple filtered instrument detail views, variant switcher chip bar.
- **[triple-model-reasoning-continuity](triple-model-reasoning-continuity/intention.md)** (2026-04-17, PR #51) — all reasoning records (predictors, predictions, risk assessments, performance profiles, horizon evaluations) keyed by (author_user_id, analyst_id, instrument_id) triple. `resolveTripleContext()` utility, COALESCE-based triple indexes, per-triple calibration drill-down. Foundation for user-authored content producing independent reasoning streams.
- **[user-authored-custom-content](user-authored-custom-content/intention.md)** (2026-04-17, PR #50) — individual authorship of analysts, instrument contracts, instruments; per-item pricing; BYO LLM credentials; sharing plumbing; base-content immutability guards.
- **[instrument-contracts](instrument-contracts/intention.md)** (2026-04-16, PR #49) — first-class instrument contracts with General + 6 stage-keyed sections + Adaptations. Stage 1 pulls the instrument's Article Processing fragment; Stages 2–4 merge instrument + analyst fragments at every LLM call site.
- **[stage-keyed-analyst-contracts](stage-keyed-analyst-contracts/intention.md)** (2026-04-16, PR #48) — restructured analyst contracts to General + 5 stage-keyed sections + Adaptations. Every LLM call now injects `General + stage-section + Adaptations` via shared `loadContractFragment` helper.
- **[workflow-stages-article-pipeline](workflow-stages-article-pipeline/intention.md)** — named workflow stages, two-step article pipeline, predictor → risk → prediction reorder.

---

## Next — Queued Efforts (6)

Reordered 2026-04-17 around beta-phase priorities: beta testers are already active, so **coolness comes before billing, and ops/validation comes last**. (Prior ordering — Economics first → Billing → Graduation → Polish → Ops — would have locked in the engine before users saw it working; wrong phase for that.)

### Beta Coolness (1 effort — remainder of the current block)

1. [onboarding-tour-extended](next/onboarding-tour-extended/intention.md) — chaptered, hour-long, interaction-aware, video-ready tour v2 (teaches the post-architecture product)

### Billing Surface (3 efforts)

2. [divinr-basic-club-model](next/divinr-basic-club-model/intention.md) — $50/mo Basic tier, 30-day trial, lifecycle mechanics, social-only clubs
3. [stripe-integration](next/stripe-integration/intention.md) — Stripe wiring for Basic subscription, per-item line items, BYO platform fee, student cost-pass-through
4. [student-club-accounts](next/student-club-accounts/intention.md) — .edu-gated student accounts with cost-pass-through pricing (depends on cost-modeling-system)

### Graduation & Contribution Layer (1 effort)

5. [custom-to-base-graduation](next/custom-to-base-graduation/intention.md) — opt-in donation from user-authored to base, with cost-reduction-on-donation reward and community board attribution

### Operations & Validation (1 effort — last)

6. [regression-testing-harness](next/regression-testing-harness/intention.md) — historical-day replay system; validate contract changes, model upgrades, and graduation candidates against real past data

---

## Future

Preserved from prior planning because the concepts remain pertinent, but deferred indefinitely until demand or scale justifies the work.

### [infrastructure-migration](future/infrastructure-migration/intention.md)

Spark → cloud when revenue and scale justify it. Platform never leaves Divinr's infrastructure (no desktop/local hybrid — that's the moat). Target: OpenRouter for LLM routing + managed cloud for DB/compute. Timing gated on authorship volume, parallel-inference demand, and revenue sufficient to fund the migration.

### [custom-source-ingestion](future/custom-source-ingestion/intention.md)

Let power users attach their own article-ingestion sources (custom RSS, APIs, manual submission) for truly niche authored instruments not covered by Divinr's base sources. Scoped out of `user-authored-custom-content` v1; revisit when demand emerges.

---

## Completed Efforts (36)

### Core Engine
| Effort | What it did |
|---|---|
| `cost-modeling-system` | Per-model cost calibration + per-user prediction + pricing defensibility + student billing + experimentation mode (4 admin views + user billing summary) |
| `llm-usage-logging` | Structured LLM call log with triple/stage/sub-stage/model/cost dimensions + 8 materialized views + admin dashboard |
| `slot-based-enablement-ui` | Portfolio triple enablement UI — add/disable/navigate triples, variant switcher |
| `triple-model-reasoning-continuity` | All reasoning records keyed by (author_user_id, analyst_id, instrument_id) triple |
| `user-authored-custom-content` | Individual authorship of analysts, instruments, contracts; per-item pricing; BYO LLM |
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

### Experience & Marketing
| Effort | What it did |
|---|---|
| 14 test efforts | API + Chrome verification of every feature area |
| Marketing compilation | Landing page copy, 15-feature inventory, 4 personas |
| Nav redesign | Grouped sidebar, admin-only sections, notification cleanup |
| Landing page | Public page at /welcome with hero, features, how-it-works |
| Fix orphaned evaluations | Remapped 3,036 instrument IDs, fixed contributions + findings |
| Tournament competitive loop | St. Thomas Sprint #1 with 3 players, 6 trades |
| Friend invite flow | One-step /join page with club code signup |
| **`onboarding-tour-v1`** | Welcome modal → 12-step docent → completion, per-step videos |

---

## How This Document Is Maintained

- [master-intention.md](master-intention.md) is the canonical product vision. This roadmap is an effort-status snapshot.
- Each effort has its own `intention.md` → `plan.md` chain in `docs/efforts/{current,next,future}/`
- `current/` = in progress, `next/` = queued, `future/` = planned but unscheduled, `archive/` = shipped or retired
- Updated whenever efforts complete, efforts get promoted/archived, or priorities shift
- Retired efforts / strategies move to `archive/` with a superseded-by banner pointing at the current source of truth
