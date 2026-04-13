# Effort: Paid Tiers — Slot-Based Model

## Problem

Divinr is free during beta. We need a revenue model that gives users control over their experience while funding infrastructure and creating clear upgrade motivation.

## Pricing Model: Slots + Tier Tags

Every analyst, instrument, and source is tagged with a tier level (1-4). Users get a number of **slots** per resource type based on their subscription. They choose what fills those slots and can swap anytime.

### Tiers

| Tier | Price | Analyst Slots | Instrument Slots | Source Slots |
|------|-------|--------------|-----------------|-------------|
| **Free trial** | $0 / 1 month | Pro-equivalent | Pro-equivalent | Pro-equivalent |
| **Starter** | $20/mo | TBD | TBD | TBD |
| **Pro** | $50/mo | TBD | TBD | TBD |
| **Premium** | $100/mo | TBD | TBD | TBD |
| **Custom** | $500+/mo | Large + build your own | Large | Large + bring your own |

### Tier Tags on Resources

Every resource (analyst, instrument, source) has a tier tag indicating when it becomes **available to select**:

- **Tier 1** resources: available to Starter ($20) and above
- **Tier 2** resources: available to Pro ($50) and above
- **Tier 3** resources: available to Premium ($100) and above
- **Tier 4** resources: available to Custom ($500+) only

Users at a given tier can pick from ALL resources at their tier and below, but are limited by their **slot count**.

### User Control: Opt In / Opt Out

- Users **select** which analysts, instruments, and sources fill their slots
- They can **swap anytime** — drop one, add another
- Predictions only run for instruments the user has selected (saves compute)
- "Opted out" items are still visible (greyed out) — user can check back in later
- Dashboard and notifications personalize to selected resources only

### Examples

**Starter user ($20/mo):**
- Picks 3 analysts from the tier-1 pool (e.g., Technical, Momentum, Fundamentals)
- Picks 10 instruments from tier-1 (e.g., AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA, AMD, CRM, NFLX)
- Picks 2 sources from tier-1 (e.g., RSS feeds, public filings)
- Decides they don't care about CRM → swaps it out for ORCL

**Pro user ($50/mo):**
- Picks 5 analysts from tier-1 + tier-2 pool (gets access to refined analysts with better contracts)
- Picks 25 instruments (tier-1 + tier-2: includes mid-caps, ETFs)
- Picks 5 sources (tier-1 + tier-2: adds Polygon, premium news)

**Custom user ($500+/mo):**
- Gets a large allocation from tiers 1-4
- Can also build their own analysts (their API keys)
- Can also add their own data sources (their API keys)
- Swaps freely across the full resource catalog

## Resource Classification (TODO — needs research)

### Analysts — Tier Tags
- **Tier 1 (Starter):** Base analysts running on gemma4 / local models. Solid but not refined.
- **Tier 2 (Pro):** Refined analysts — better-tuned contracts, more evaluation data, specialized strategies.
- **Tier 3 (Premium):** Frontier-model analysts — Claude/GPT-4 powered when infrastructure supports it.
- **Tier 4 (Custom):** User-built analysts with their own API keys.

### Instruments — Tier Tags
- **Tier 1 (Starter):** Core large-cap stocks (AAPL, MSFT, GOOGL, etc.)
- **Tier 2 (Pro):** Extended universe — mid-caps, popular ETFs, sector leaders
- **Tier 3 (Premium):** Full universe + crypto, commodities, forex when ready
- **Tier 4 (Custom):** Anything the user requests (validated by platform)

### Sources — Tier Tags
- **Tier 1 (Starter):** Free sources — RSS feeds, SEC filings, free news APIs
- **Tier 2 (Pro):** Paid APIs — Polygon, premium financial news, earnings data
- **Tier 3 (Premium):** Institutional-grade — real-time feeds, alternative data
- **Tier 4 (Custom):** User-provided sources with their own API keys

## Slot Numbers (TODO — needs analysis)

Need to determine the right slot counts per tier. Factors:
- Compute cost per instrument per day (LLM inference for 5+ analysts)
- Data source API costs per instrument
- What feels generous vs. restrictive at each price point
- Competitive positioning vs. other platforms

## Architecture Requirements

- **Tier tag column** on analysts, instruments, and sources tables
- **User slot selections** table — user_id, resource_type, resource_id, selected_at
- **Slot count enforcement** — middleware checks slot count before allowing selection
- **Tier gating** — middleware checks user's tier before allowing access to tier-tagged resources
- **Prediction pipeline scoping** — only run predictions for instruments the user has selected
- **Swap API** — deselect one resource, select another (atomic)
- **Dashboard personalization** — only show selected resources
- **Greyed-out display** — unselected resources visible but muted, with "add to slots" action

## Dependencies
- Stripe integration must ship first
- Resource tier classification must be decided (the research phase)

## Out of Scope
- Desktop/local hybrid (removed — platform is the moat)
- Automated trading execution
- Domain expansion beyond financial markets (separate effort)
