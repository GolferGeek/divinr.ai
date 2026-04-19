# What Divinr.ai Can Do

A living document of the system's capabilities — what's built, what's running, and what's coming.

> For the structured, authoritative feature inventory see [`docs/features.md`](./features.md).

---

## The Explainability Loop (shipped)

Divinr doesn't predict markets. It analyzes them, surfaces signal, explains *why* it reached a conclusion, shows you *when* it was wrong, and tells you *what* it thinks went wrong. Every step is transparent.

### Captured Reasoning
Every LLM call in the system captures the model's reasoning content — not just the final answer, but the thinking that led to it. When a Sentiment Analyst says "bearish on AAPL," you can read the actual chain of thought: what data it looked at, what patterns it noticed, what it weighed more heavily.

### See Your Reasoning
Click any analysis in the dashboard and a Reasoning tab shows you the captured model thinking. Provider, model, token counts, the full reasoning text. No black box.

### Calibration Drilldown
Visit any analyst's performance page and see:
- **Headline metrics** — accuracy, average confidence, calibration score, sample size
- **Per-instrument breakdown** — which stocks is this analyst good at? Which ones is it terrible at?
- **Confidence vs. accuracy scatter plot** — is the analyst overconfident? Underconfident? The chart tells you at a glance
- **Wrong-first analysis list** — every resolved analysis sorted so the mistakes surface first. Click any row to expand and read the full rationale + actual outcome side by side

---

## The Learning System (shipped)

### Tier 1: Autonomous Micro-Adjustments
A background learning engine runs on a schedule, reads analyst performance profiles, and identifies systematic patterns:
- **Overconfidence** — analyst averages 80% confidence but only 45% accuracy? The engine proposes a prompt adjustment to tone down confidence
- **Directional bias** — bullish calls at 30% accuracy but bearish at 70%? The engine flags the asymmetry

Proposals are validated against canonical test days, applied to **paper mode** (runs alongside production for 3 days), and auto-promoted if paper outperforms production. No human in the loop — bounded, safe, continuous improvement.

### Tier 2: Human-in-the-Loop Audit
A background audit loop runs every 2 hours, spot-checking resolved analyses against analyst contracts:

1. Picks an analysis (weighted toward wrong ones)
2. Loads the analyst's structured contract — what it's supposed to do, how it should make decisions
3. Asks `gemma4:26b`: "does this output honor this contract?"
4. If something's off, writes a structured **finding** with:
   - The specific contract clause that was violated
   - The specific part of the analyst's output that violates it
   - A one-sentence discrepancy statement
   - A hypothesis for *why* the model drifted

You review findings in the **Audit Inbox** at `/findings`. Three buttons: **Agree** (yes, that's a real problem), **Disagree** (no, the audit is wrong), **Note** (interesting, but no action needed). Every response feeds a feedback log.

### Analyst Contracts
Every analyst — the 5 personality analysts, the arbitrator, the portfolio manager, and the 3 day-trader algorithms — has a structured markdown contract that describes:
- **General** — worldview, risk philosophy, tone, legal-language rules, known failure modes
- **Role** — specific decision criteria, good reasoning examples, failure modes for that role
- **Adaptations** — reserved section for learning-engine improvements

Contracts are versioned. Every analysis records which contract version was active when it was made. You can reconstruct "what was the analyst's stated purpose when it produced this wrong analysis?" for any historical row. That's compliance-grade traceability.

### Entity-Level Attribution
Per-analyst, per-instrument, and per-triple contribution to portfolio P&L and accuracy. Answers "which analyst is carrying the book" and "which triple is bleeding money" without hand-rolling a SQL query.

### Automated Meta-Loop (coming soon)
The system will read your accept/reject feedback from the audit inbox and learn what kinds of discrepancies you care about. Over time, the audit stops surfacing noise and starts surfacing the patterns that actually matter to you. The audit gets smarter the more you use it.

---

## The Analyst Panel (shipped)

### 5 Personality Analysts
Each sees the market through a different lens:
- **Fundamentals Analyst** — P/E, FCF yield, margins, debt-to-equity, sector comparisons
- **Macro Strategist** — Fed policy, yield curves, inflation data, cross-asset signals
- **Momentum Analyst** — volume breakouts, 52-week highs, sector rotation, earnings acceleration
- **Sentiment Analyst** — short interest, options flow, analyst revisions, insider clusters, contrarian signals
- **Technical Analyst** — RSI, MACD, Bollinger Bands, moving average crossovers, support/resistance levels

### The Arbitrator (Mini-Me)
Synthesizes all analyst signals into a single composite view per instrument. Weighs competing opinions, flags disagreements, produces an honest confidence level. Doesn't paper over dissent — if analysts disagree, the arbitrator says so and explains which signal it prioritized.

### The Portfolio Manager
Converts the arbitrator's composite signal into a sized trade action: BUY, SELL, or HOLD with position size, entry price, and stop-loss. Applies Kelly criterion adjusted by calibration accuracy, respects hard position limits (max 5% per instrument), and won't take a position on a weak signal.

### 3 Day-Trading Strategies
Algorithmic, not LLM-driven. Execute every 15 minutes:
- **Gap and Go** — enters on 1%+ opening gaps with green-bar confirmation after 14:30 UTC, exits on first red bar
- **Mean Reversion** — buys when price drops >2 standard deviations below the 20-bar average, exits when it returns to the mean
- **Momentum Breakout** — enters on fresh 20-bar high breakouts, exits on the first lower high

All three use a **conviction modifier** from the personality analysts' signals — a flat signal with high confidence vetoes the trade entirely. Positions are force-closed at 22:00 UTC (end of session).

---

## Trading & Portfolio (shipped)

### Paper Trading Throughout
Every portfolio is simulated. No real securities are bought or sold. Simulated results may differ from live trading due to slippage, commissions, execution timing, and liquidity — paper is for learning, not promising future returns.

### Signal-to-Trade-Intent CTA
Every analysis links to a pre-filled paper-trade ticket sized by the arbitrator's conviction. One click turns a read into a simulated position.

### Live Intraday P&L
Open positions mark-to-market in real time against the latest price feed. Watch a trade work, or not, while you're watching.

### Cost Modeling
Per-analyst margin analysis, triple-level cost tracking, and calibration dashboards. See which analysts are worth their inference budget.

---

## Social & Onboarding (shipped)

### Investment Learning Clubs
Discover, create, and join clubs. Club features:
- **Activity feed with unread badges** — catch up on what happened while you were away
- **Curriculum and mentoring** — structured learning paths, mentor assignments, opt-outs
- **Signal Challenges** — head-to-head analysis challenges between members
- **Chat channels** — per-club messaging with block enforcement

### Tournaments
Weekly sprints, sector challenges, and analyst drafts.
- **Leaderboards with rank deltas** — watch your position move in real time
- **Avatar stacks** — preview who else has entered
- **My positions + trade surface** — manage a virtual portfolio inside the tournament

### Direct Messaging
DMs and club channels with bidirectional block checks. Member profile drawer exposes a "Message" CTA.

### Onboarding Tour v2 + First-Touch
A 5-beat Beginner Tour explains the core flow. Beyond the tour, first-touch walkthroughs light up on 66 active surfaces (105 authored including deferred) — contextual popovers the first time you land somewhere new. All are opt-out per surface or globally.

---

## The Infrastructure (shipped)

### Config Versioning
Every analyst config change (prompt updates, weight adjustments, tier instruction changes) creates a new version row with a parent pointer. Version history is immutable and auditable. The learning engine's paper-mode system runs proposed changes alongside production for 3 days before promoting or demoting them.

### Auth & RBAC
JWT authentication with role-based access control. Every API endpoint is guarded. The admin endpoints (`/admin/run-*`) require authentication. IDOR defense on every query via `organization_slug` filter.

### Background Pipelines
Cron-driven pipelines that run continuously:
- **Article crawler** — every 15 minutes
- **Analysis generation** — every 5 minutes
- **Outcome tracking** — every 15 minutes (captures price snapshots, runs stop-loss sweeps, executes day-trader strategies)
- **Nightly evaluation** — daily at midnight (resolves analysis horizons, updates analyst performance profiles)
- **Tier 1 learning cycle** — on schedule (pattern detection, proposal generation, paper-mode management)
- **Tier 2 audit** — every 2 hours (contract-vs-output spot checks)

### Local-First LLM
All heavy LLM work runs on local models via Ollama — no cloud API costs, no latency constraints, no data leaving the machine:
- `gemma4:e4b` — fast, cheap, good for simple structured generation
- `gemma4:26b` — quality, used for audit findings that humans will read
- `gemma4:31b` — available for the most demanding reasoning tasks

### Legal Language & Disclaimers
Every user-visible disclaimer surface routes through a single `<LegalDisclaimer>` component. Five variants (`short`, `full`, `trade-cta`, `tournament`, `club`) cover every context and always state the two required phrases: "not a prediction model" and "not investment advice."

---

## What's Coming Next

### Automated Meta-Loop
The audit learns from your feedback. Surfaces fewer false positives, more of the patterns you actually care about. Gets smarter the more you use it.

### Harden + Monitor
Extended sweep across the whole system: fix errors, monitor pipelines for silent failures, stress-test cron jobs, clean up edge cases, act on accumulated audit findings. The "make it solid" effort before anyone else sees it.

### Contract Editor UI
Admin surface for reading and editing analyst contracts with side-by-side version diffs and one-click rollback.

### Tier 1 Structured Writes
The learning engine writes into the `## Adaptations` section of contracts instead of appending text suffixes to prompts. Cleaner, auditable, reversible.

### Risk-Debate Drilldown
Visualize the three-way blue team / red team / arbiter debate for any analysis.

### Custom → Base Graduation
Path for promoting well-calibrated custom analysts from power-user tiers into the base panel.

### Beta-User Share Path
Let someone other than the founder see the explainability surfaces. The demo moment.
