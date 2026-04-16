> **🗄️ Archived 2026-04-16 — Superseded by [master-intention.md](../../master-intention.md).**
> This document describes a 4-tier personal ladder (Starter/Pro/Premium/Custom) and a parallel 4-tier club ladder with a capability-union ("superset") rule. The entire model is retired. See master-intention Section 8 ("What This Replaces") for the full retirement list. Kept here for historical reference — *why* we moved away from this structure is useful context.

---

# Effort: Paid Tiers — Personal + Club Superset Model

## Problem

Divinr is free during beta. We need a revenue model that gives users control over their experience, funds infrastructure, creates clear upgrade motivation, and makes clubs genuinely valuable beyond social features.

## The Model: Slot-Based Personal Tiers + Club Superset

### Personal Tiers (individual subscription)

Every analyst, instrument, and source is tagged with a tier level (1-4). Each user gets a number of **slots** per resource type based on their subscription. They choose what fills those slots and can swap anytime.

| Tier | Price | Analyst Slots | Instrument Slots | Source Slots | Picks From |
|------|-------|--------------|-----------------|-------------|------------|
| **Free trial** | $0 / 1 month | Pro-equivalent | Pro-equivalent | Pro-equivalent | Pro catalog |
| **Starter** | $20/mo | 3 | 10 | 2 | Tier 1 catalog |
| **Pro** | $50/mo | 5 | 20 | 5 | Tier 1+2 catalog |
| **Premium** | $100/mo | 8 | 40 | 10 | Tier 1+2+3 catalog |
| **Custom** | $500+/mo | Large + build own | Large | Large + bring own | Everything |

### Club Tiers (shared benefit via the superset rule)

Clubs subscribe to a tier. The club's tier **expands the catalog** every active member can pick from. A user's effective access is the **union** of their personal tier and every club tier they belong to.

| Tier | Price (owner pays) | What members get |
|------|-------------------|------------------|
| **Free** | $0 (beta) | Catalog matches free tier |
| **Starter club** | $50/mo | Members can pick from Tier 1 catalog |
| **Pro club** | $150/mo | Members can pick from Tier 1+2 catalog |
| **Premium club** | $500/mo | Members can pick from Tier 1+2+3 catalog |
| **Custom club** | $1500+/mo | Members share custom analysts/sources (club owner brings API keys) |

### The Superset Rule

A user's **effective catalog access = personal tier catalog ∪ every active club tier catalog**

Examples:
- Starter user ($20) in a Pro club ($150) → picks from Tier 1+2 catalog (like Pro personal access)
- Starter user ($20) in a Premium club ($500) → picks from Tier 1+2+3 catalog (like Premium personal access)
- Pro user ($50) in 3 clubs (Starter, Pro, Premium) → picks from the highest club's catalog (Tier 1+2+3)
- Free user in a Premium club → picks from Tier 1+2+3 catalog (great motivator for clubs!)

### Slot Counts Stay Personal

**Important:** Club membership expands the **catalog** the user can pick from, but does NOT expand their slot count.

A Starter user in a Premium club still has 10 instrument slots — but now they pick those 10 from the full Premium catalog (40 instruments) instead of just the Tier 1 catalog (10-15 instruments).

Why this design:
- Simple: one slot count to understand (your personal one)
- Sustainable: compute scales with total selected instruments, not with club membership
- Clean economic model: users still have upgrade motivation at the personal tier

### Leaving a Club

When a user leaves a club (or club cancels subscription):
- Their catalog access drops next billing cycle
- If their currently-selected slots are no longer in their tier, those picks become "read-only" (they can see historical data but not new analysis)
- They can re-pick within their new catalog
- No data loss — previous analyses remain viewable

## Why Clubs Become Economically Compelling

### For members
- Starter user ($20/mo) + Premium club membership = access to Premium-level analysts, instruments, and data
- Effectively a group-buying mechanism — pool resources for high-tier access
- Social + educational + economic value all in one

### For club owners
- Revenue opportunity: charge member dues that cover the club subscription
- Leadership value: curate experience, run tournaments, mentor
- Curriculum clubs (universities) have obvious value proposition

### For the platform
- Club subscriptions are high-revenue, predictable
- Retention mechanic: leaving the club means losing access
- Natural virality: members recruit others to share club costs

## Launch vs. Growth

**This is our launch catalog.** During beta and early launch we're limited by Spark/gemma4 infrastructure:
- ~40 total instruments we can analyze per cycle
- ~10 analysts (5 base + 3 day trader + a few specialized)
- ~15 sources (mostly free RSS)

As we move onto frontier-model infrastructure (Claude, GPT-4 on cloud):
- Catalog at each tier grows (more instruments, more analysts, more sources)
- Slot counts stay stable at each tier
- Early subscribers grandfather into the expanded catalog at the same price

**Marketing language:** "Our launch tiers reflect what we can deliver today on beta infrastructure. As we scale to frontier models and institutional data, your catalog grows with us. Your slot count doesn't shrink — you get access to more picks at the same price."

## Architecture Requirements

### Data Model
- **Tier tag column** on analysts, instruments, and sources (values: 1, 2, 3, 4)
- **User slot selections** table — user_id, resource_type, resource_id, selected_at
- **Club subscriptions** table — club_id, tier, stripe_subscription_id, active_until
- **Effective access resolver** — given a user, compute their superset tier access (max of personal + all active club memberships)

### Middleware
- **Tier gating** — check effective access before allowing resource selection
- **Slot count enforcement** — personal slot limits enforced regardless of club membership
- **Prediction pipeline scoping** — only run predictions for selected resources (coalesce across users)

### UI
- Resource selection UI shows full catalog; items above user's tier are locked or greyed with tier indicator
- "You get X via your Y Club" labeling to make club value visible
- Leaving-club warning: "You'll lose access to these resources after..."
- Club owner dashboard: current tier, member count, billing status

### Billing
- Stripe integration for both personal and club subscriptions
- Club owner pays; members get benefit automatically
- Pro-rated upgrades/downgrades
- Grace period on cancellation (2-7 days?) before catalog access drops

## Open Questions

- **Free user in a paid club**: do they still need some baseline ($0 tier)? Or does club membership alone grant access?
- **Member billing**: do we build a "collect dues from members" feature, or do clubs handle that externally?
- **Club owner revenue share** for Custom tier clubs where owner provides API keys/analysts?
- **Maximum clubs per user**: any limit to prevent abuse? (Probably not — superset caps at Premium catalog anyway.)
- **Club tier ceiling**: does the platform have a "Premium" ceiling for clubs, or do we need Custom club tier for institutional buyers?

## Dependencies
- Stripe integration must ship first
- Resource tier classification must be decided (research phase)
- Effective access resolver is a core new concept — needs design pass

## Out of Scope
- Desktop/local hybrid (removed — platform is the moat)
- Automated trading execution
- Domain expansion beyond financial markets (separate effort)
