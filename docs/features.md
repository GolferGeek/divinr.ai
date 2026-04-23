# Divinr Features — Authoritative Inventory

**Last updated**: 2026-04-23
**Source of truth for**: marketing copy, landing page, onboarding seed content, regression test checklists.

This doc is the single place to look up "what does Divinr ship today?" Anything added to the product should land here in the same PR that ships it.

**Legend**
- **Shipped** — in production use by beta testers
- **In progress** — active effort underway in `docs/efforts/current/`
- **Planned** — queued in `docs/efforts/next/` or the roadmap

---

## Analysis & Signal

- **Five-analyst panel** — five personality-driven AI analysts plus an arbitrator, portfolio manager, and day trader each produce independent reads on every instrument. Shipped.
- **Reasoning capture** — every analysis ships with the analyst's written rationale, conviction score, and the evidence it drew from. Shipped.
- **Calibration drilldown** — per-analyst calibration charts show projected vs. realized accuracy bucketed by conviction. Shipped.
- **Conviction scoring + structured debate** — analysts disagree out loud; the arbitrator resolves. Shipped.
- **Live intraday P&L** — paper-trade positions mark-to-market in real time against the latest price feed. Shipped.
- **Signal-to-trade-intent flow** — every analysis links to a pre-filled paper-trade ticket sized by conviction. Shipped.
- **Article sourcing on analyst signals** — every analyst signal surfaces the articles it cited, collapsed by default and expandable inline. Pre-migration signals show a best-effort fallback of recent articles the analyst scored for the ticker. Shipped.
- **Article Relevance tab on tickers** — every ticker detail page lists the articles each analyst scored for it, with per-analyst relevance bars and timestamps. Shipped.
- **Slim dashboard analysis cards** — the home page fits five+ cards above the fold on a 1440×900 display; stance chips per analyst, a single trade-line summary, and a "Read more" inline link that opens the full-analysis modal. Shipped.

## Learning System

- **Three-tier learning loop** — per-analyst, per-triple, and cross-analyst-coordination evaluation with nightly rebalancing. Shipped.
- **Entity-level attribution** — per-analyst, per-instrument, per-triple P&L and accuracy contribution. Shipped.
- **Author retention + graduation candidates** — tracks which custom analysts are converging on base-tier quality. Shipped.
- **Canonical day detail** — single replay view tying together analyses, trades, news, and outcomes for a given day. Shipped.
- **Coordination matrix** — correlation and leave-one-out contribution scoring across the analyst panel. Shipped.

## Authoring (power users)

- **Custom analyst contract editor** — author your own analysts with strategy, decision criteria, and instrument scope. Shipped.
- **Custom instrument authoring** — add instruments beyond the default universe. Shipped.
- **Triple-slot model** — analyst × universe × strategy, enabled on a per-slot basis. Shipped.
- **BYO-LLM credentials** — point analysts at your own OpenAI / Anthropic / local model keys. Shipped.
- **Per-item authorship** — every piece of content carries its author and cost attribution. Shipped.
- **Custom → base graduation** — path for promoting well-calibrated custom analysts. In progress.

## Social

- **Investment Learning Clubs** — discover, create, activity feed with unread badges, curriculum, mentoring, analyst assignments, opt-outs. Shipped.
- **Tournaments** — list, detail, trade surface, leaderboard with rank deltas, my-positions, avatar stacks for entrant previews, invite landing. Shipped.
- **Direct messaging** — DMs and club channels with bidirectional block checks. Shipped.
- **Member profile drawer** — inline profile with "Message" CTA. Shipped.
- **Signal Challenges** — head-to-head challenges within a club. Shipped (formerly "Prediction Challenges").

## Onboarding & Explainability

- **First-touch walkthroughs** — 66 active surfaces wired with contextual popovers (105 authored incl. deferred). Shipped.
- **5-beat Beginner Tour** — five-stop guided walkthrough surfaced on welcome. Shipped.
- **Welcome modal** — lightweight entry point that offers the tour or freeform exploration. Shipped.
- **Settings-driven opt-outs** — per-surface and global onboarding opt-outs. Shipped.
- **Nav naming — "Research"** — the ticker/analysis surface is surfaced to users as "Research" in the sidebar and page heading; domain identifiers (routes, schema, API keys) retain "instrument" terminology. Shipped.
- **Readable analyst playbooks** — every analyst's contract (strategy, criteria, known weaknesses) is readable in-app. Shipped.

## Platform

- **Paper trading throughout** — no real trades are placed; all portfolios are simulated. Shipped.
- **Background pipelines on local LLMs** — Ollama-backed Gemma for most analyses; workflows grind in the background rather than blocking the UI. Shipped.
- **Cost modeling** — per-analyst margin analysis, triple-level cost tracking, calibration dashboards. Shipped.
- **LLM usage + cost dashboards** — admin surfaces showing where compute went. Shipped.
- **Notifications** — rank changes, mentor activity, system updates; preference controls. Shipped.
- **Auth + invite flow** — invite-gated signup, club-invite landing, tournament-invite landing. Shipped.

## Legal & Trust

- **Centralized disclaimers** — every user-visible disclaimer routes through `<LegalDisclaimer>` (`short`, `full`, `trade-cta`, `tournament`, `club` variants). Shipped.
- **Terms of Service** — public page at `/terms` with paper-trade framing, AI-content limitations, and risk disclosure. Shipped.
- **Analysis vs. advice framing** — consistently "analysis and signal," never "prediction" or "recommendation," in user-visible copy. Shipped.

---

## Pointers

- Archived effort docs live under `docs/efforts/archive/`.
- Current in-flight effort: `docs/efforts/current/`.
- Queued efforts: `docs/efforts/next/`.
- Human-readable capability explainer: `docs/what-divinr-can-do.md`.
- Personas this product targets: `docs/personas.md`.
