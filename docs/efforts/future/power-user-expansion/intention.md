# Effort: Power User Expansion

## Problem

Divinr.ai has a complete engine — predictions, risk debates, 3-tier learning, trading, admin tooling — but no pricing model or infrastructure to monetize it. Every instrument, analyst, and data source costs real compute (LLM tokens, data API calls, nightly evaluation cycles). We can't offer an unlimited instrument universe. We need a model where users pay for the resources they consume, and where costs drop naturally as more users share the load.

## Intention

Build a three-level product expansion that turns divinr.ai from an internal tool into a revenue-generating platform with transparent, crowd-funded pricing.

### Level 1: SaaS Standard ($20/mo base)

Access to the shared pool — base instruments, base analysts, base article sources. Pure consumer. Whatever we're already running analysis on, subscribers can see. The cost of the shared pool is spread across all standard subscribers.

### Level 2: SaaS Power (pay-per-resource on top of base)

Users can extend beyond the shared pool by adding resources à la carte:

| Resource | Already in shared pool | Available but not active | New (we'd have to add it) |
|---|---|---|---|
| **Instrument** | Included in base | $10/mo | $150/mo until 50 users adopt it, then drops to $10/mo |
| **Data source** | Included in base | $10/mo | $200+/mo (depends on upstream API costs) until 150 users, then $10/mo |
| **Analyst** | Included in base | $10/mo (from our growing library) | $200/mo to build a custom one, until 150 users adopt it, then $10/mo |

Key economics:
- **Crowd-funded infrastructure.** Early adopters pay the real cost of spinning up a new resource. Once enough people share the load, the price drops automatically.
- **Built-in demand signal.** We know exactly what users want because they're paying for it. 30 people paying $150/mo for a crypto instrument tells us to prioritize crypto.
- **No artificial scarcity.** No caps on instruments or analysts. If someone wants 30 instruments and will pay, great.
- **Contributor flywheel.** Users who build good custom analysts that others adopt could earn rev share or credits — turning power users into platform contributors.

### Level 3: Local Hybrid (future, higher price point)

Desktop app (Electron, already scaffolded) with a local API backend on user's own hardware (e.g., DGX Spark). Users get everything from Level 2 (the full SaaS layer) plus:
- Private analysts running locally that never touch our infrastructure
- Proprietary data sources and articles that never leave their machine
- Private analysis layered on top of the shared intelligence
- Federation between the SaaS API (shared layer) and the local API (private layer)

This is the most defensible tier — most stock platforms are cloud-only.

## Scope

### Architecture Requirements
- **Per-user resource metering** — track instrument, analyst, and source subscriptions per organization with caps enforced at the API level. Build on existing `source_entitlements` (already per-org) and `organization_slug` scoping.
- **Threshold tracking** — monitor adoption count per resource. When a resource crosses its threshold (50 for instruments, 150 for sources/analysts), automatically drop the price for all subscribers.
- **Billing integration** — Stripe or similar. Subscription base + metered add-ons.
- **Resource provisioning** — when a user requests a new instrument/source/analyst, workflow to validate feasibility, estimate cost, and activate.
- **Custom analyst creation UI** — the admin contract editor exists; needs to be user-facing for power-tier users with appropriate guardrails.
- **Custom source ingestion** — let users configure RSS feeds, API endpoints, or upload article batches for their custom sources.

### For Local Hybrid (Level 3, later phase)
- Desktop app federation protocol — how the Electron app talks to both the SaaS API and the local API
- Local deployment packaging — bundling the API backend for user hardware
- Sync protocol — what shared data flows to local, what local data stays private

## Success Criteria

- Users can subscribe at $20/mo and access the shared instrument pool.
- Users can add instruments, sources, and analysts à la carte with transparent pricing.
- New resources start at the early-adopter price and automatically drop when adoption thresholds are met.
- Per-user resource usage is metered and enforced.
- Custom analysts created by one user can be discovered and adopted by others.
- (Level 3) Desktop app connects to both SaaS and local backends seamlessly.

## Out of Scope

- Domain expansion beyond financial markets (separate future effort).
- Automated trading execution (we provide signals, not brokerage).
- Free tier / freemium (the $20/mo base is the entry point).

## Open Questions

- When a resource crosses its adoption threshold, do all existing subscribers drop to $10 instantly? Or step down gradually? Instant is simpler and a great user moment, but creates a revenue cliff.
- Should custom analyst creators get rev share when others adopt their analyst? This could be a powerful contributor incentive but adds billing complexity.
- For new data sources, the $200/mo might not cover upstream API costs for expensive feeds. Need a feasibility check step and flexible pricing.
- What's the right price point for Level 3 (local hybrid)? $1000/mo? Flat annual license?
