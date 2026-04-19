# Divinr.ai — Efforts Roadmap

**Last updated:** 2026-04-19 (activity-viewed-counter shipped; basic-club concept retired; divinr-basic-club-model renamed to user-billing-model; student-club-accounts renamed to student-accounts)
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

_None — `docs/efforts/current/` is empty and ready for the next promotion._

---

## Recently Shipped

- **[activity-viewed-counter](activity-viewed-counter/intention.md)** (2026-04-19, PR #64) — `prediction.club_members.last_viewed_at` + `(N)` unread badge on the ACTIVITIES tab and MY CLUBS cards. One-round-trip SQL with `COALESCE(last_viewed_at, joined_at)` fallback; `markActivitiesViewed` store action zeroes the badge on tab-view with exactly one POST. Last beta-coolness polish item from PR #58.
- **[prediction-to-trade-intent](prediction-to-trade-intent/intention.md)** (2026-04-18, PR #59) — "Trade this prediction" CTA on prediction cards/drawers. Active-tournament resolver (`useActiveTournament`) handles none/one/many via `TournamentPicker.vue`; CTA routes to `/tournaments/:id?tab=trade&symbol&direction&qty&predictionId`. Sizing heuristic `floor((startingBalance * pct) / price)` where `pct = clamp(0.01 + confidence*0.04, 0.01, 0.05)`. Query-param parser with regex/whitelist/int guards + `router.replace` strip. Empty-state banner on `/tournaments?reason=no-active-entry`. Equity-only disabled state for options. Frontend-only — `prediction.tournament_trade_queue.prediction_id` was already nullable.
- **[club-tournament-experience-polish](club-tournament-experience-polish/intention.md)** (2026-04-18, PR #58) — 6-phase polish pass across club + tournament surfaces for the St. Thomas cohort. 8 PRD-called-out bug fixes + 4 follow-ups (ClubPreviewPanel for non-members, analytics tournament-count filter, TRADE tab upcoming branch, IonSegment v-model bug, chat author display_name, dashboard pluralize, leaderboard em-dash standardization, DISCOVER filter hides joined). Empty-state + explainer pass (ACTIVITIES reorder, CURRICULUM/ANALYSTS explainers, MENTORING gating, analytics tooltip, tournament INFO). Default Activities tab + `ActiveTournamentBanner` + tournament list countdown + player count + prize line. Leaderboard storytelling — Risk-Adjusted Return label, neutral/green/red colorClass, YOU badge, clickable rows → `MemberProfileDrawer`, new `GET /clubs/:id/members/:userId` endpoint, MY POSITIONS size bar. Mobile (390px) responsiveness — scrollable IonSegments, mobile overflow chrome with aggregated unread, sticky Rank/Player leaderboard columns. Nav role-gating extended to SETTINGS items + disclaimer consolidation. 51 new API assertions. 5 feature-deferrals queued as their own efforts (below).
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

## Next — Queued Efforts (2)

The onboarding-tour-extended effort is now the active one (promoted to `current/`). Two queued efforts follow: the user-visible vocabulary + marketing refresh (first — small, legal-flavored, shares files with onboarding), then the testing-team harness port (second — bigger infrastructure lift, depends on both onboarding and vocab landing so the surface inventory and strings are stable).

### Experience + Marketing

1. [ui-vocabulary-and-marketing-refresh](next/ui-vocabulary-and-marketing-refresh/intention.md) — sweep user-visible copy to replace "prediction" with "analysis" / "signal", tighten disclaimers to say explicitly "not a prediction model," and refresh landing page + feature inventory to reflect the last week of shipped work. User-facing copy only; code/DB/API internal vocabulary stays as `prediction.*`. Bundled because both sweeps audit the same files.

### Operations & Validation

2. [testing-team](next/testing-team/intention.md) — port the four-layer Orchestrator AI testing harness to Divinr: file-based finding lifecycle (`open/ → triaged/ → in-fix/ → needs-verify/ → closed/`) with dedup-hash regression detection, a Divinr-specific discover agent plus copy-verbatim triage/verify agents, a Chrome-patterns base skill + one deep skill per facet (predictions, portfolios, tournaments, clubs, analysts, instruments, performance, authoring, admin), and a daily cron pipeline that produces a morning digest. Depends on onboarding-tour-extended (surface inventory is the coverage checklist) and ui-vocabulary-and-marketing-refresh (strings stable before `where.md` files are written).

---

## Future

Preserved from prior planning because the concepts remain pertinent, but deferred until the experience layer is locked in and we're ready to commercialize.

### Billing Surface (deferred)

- [user-billing-model](future/user-billing-model/intention.md) — $50/mo Basic tier, 30-day trial, lifecycle mechanics (individual-only; clubs are uncoupled from billing entirely)
- [stripe-integration](future/stripe-integration/intention.md) — Stripe wiring for Basic subscription, per-item line items, BYO platform fee, student cost-pass-through
- [student-accounts](future/student-accounts/intention.md) — .edu-gated student accounts with cost-pass-through pricing

### Graduation & Contribution Layer (deferred)

- [custom-to-base-graduation](future/custom-to-base-graduation/intention.md) — opt-in donation from user-authored to base, with cost-reduction-on-donation reward and community board attribution

### Operations & Validation (deferred)

- [regression-testing-harness](future/regression-testing-harness/intention.md) — historical-day replay system; validate contract changes, model upgrades, and graduation candidates against real past data

### Infrastructure & Reliability (deferred)

- [spark-beta-hardening](future/spark-beta-hardening/intention.md) — one-day hardening pass: UPS, systemd reliability, Backblaze B2 backups, UptimeRobot monitoring, recovery runbook
- [infrastructure-migration](future/infrastructure-migration/intention.md) — Spark → cloud migration when revenue and scale justify it; OpenRouter + managed DB/compute

### Content Ingestion (deferred)

- [custom-source-ingestion](future/custom-source-ingestion/intention.md) — power users attach custom article-ingestion sources for niche authored instruments

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
