# Effort: Paid Club Tier Catalog

## Problem

Once Divinr Basic and the multi-club entitlement model are in place, we need actual paid club SKUs above Basic to prove the stacking model and unlock revenue beyond the $50 entry tier. The differentiation between tiers should be primarily about **curated content** (analysts, sources, club identity) rather than raw quotas — quotas grow modestly, the value grows substantially.

## Intention

Build out the paid club tier catalog above Basic, starting with two SKUs ($100/mo and $500/mo) that demonstrate the capability-union + quota-sum entitlement model with real differentiated content. Slot caps grow modestly (Basic 10 → $100 tier 13 → $500 tier 16) because the real value is in curated analysts, sources, and club identity, not slot count.

## Scope

### Tier SKUs

| SKU | Price | Portfolio Slots | Differentiator |
|-----|-------|-----------------|----------------|
| Divinr Basic | $50/mo | 10 | (defined in divinr-basic effort) |
| Tier-2 Club | $100/mo | 13 | Curated analyst set, premium source bundle |
| Tier-3 Club | $500/mo | 16 | Frontier-model analysts, institutional sources, identity |

The slot numbers are deliberately close — slot count is a personalization knob, not the value driver.

### Curated Content Per Tier

- Each paid tier above Basic ships with a deliberate analyst lineup and source bundle
- Stacks via capability-union: a user in Basic + Tier-2 + Tier-3 sees all analysts and sources from all three
- Quotas sum: 10 + 13 + 16 = 39 portfolio slots

### Per-User Charge Model

- Each club has a per-user/month price
- Club admin (or member directly?) pays
- Decision point in PRD: pass-through to members vs. club-payer model

## Open Questions for PRD Phase

- Who pays — the member directly, the club admin who passes the cost on, or a hybrid?
- What specifically differentiates the curated content at each tier? Need a real lineup, not placeholder copy.
- Should there be more than two SKUs at launch, or start narrow and expand based on signal?
- Do paid tiers above Basic have any extra opt-out mechanics, or do they inherit Basic's?

## Success Criteria

- Two paid tier SKUs above Basic exist as real products
- A user joining a paid tier club sees stacked entitlements working correctly (more analysts, more sources, summed quotas)
- Pricing surface is exclusively club-based — no individual user tier ever appears in the product or docs

## Out of Scope

- Stripe wiring (in the rescoped `stripe-integration` effort)
- Custom-per-user analysts (separate concern; paid tiers ship with curated lineups, not per-user customization)
- Additional tiers beyond the initial two (decide once these prove the model)

## Dependencies

- `divinr-basic-club-model` (defines the club shape, entitlement rules, lifecycle)
- Rescoped `stripe-integration` (handles the actual subscription mechanics)

---

*Stub — to be expanded after `divinr-basic-club-model` settles the entitlement engine.*
