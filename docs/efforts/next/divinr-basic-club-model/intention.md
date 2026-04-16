# Effort: Divinr Basic Membership & Single-Tier Billing

## Problem

The product needs a clean answer to "who pays, how much, and for what." Previous iterations of this effort explored club-as-billing-unit models with multi-club entitlement stacking. We landed on something simpler: **every user is a $50/mo Basic user**. No individual tier ladder (Starter / Pro / Premium), no paid club tiers, no billing through clubs. Custom content authorship is a per-item add-on on top of Basic, not a separate tier.

## Intention

Formalize **Divinr Basic** as the single baseline product shape — every active user is a $50/mo Basic subscriber and auto-enrolled in the default Divinr Basic social club. Clubs become purely social/discovery spaces with zero billing implications. Custom content authorship (analysts, instruments, sources) is billed per-item on top of the Basic subscription, and the compute underlying it is tracked by the separate `cost-modeling-system` effort.

## Scope

### Divinr Basic — the only default tier

- **$50/mo per user**
- Includes base content (all base analysts × all base instruments, shared universe, content-keyed cost)
- Includes social membership in the default Divinr Basic club (tournaments, messaging, shared activity feed)
- 30-day free trial at signup → auto-converts to paid if card on file, else trial-expired state
- Trial-expired: read-only access for 6 months, then account purged (email warning 30 days before)

### Clubs — social only, zero billing

- Clubs exist as social/tournament/messaging spaces
- Users can create and join additional clubs beyond the default Basic one at no cost
- Club membership grants no entitlements, costs nothing, and never consumes quota
- Club admins manage membership and social surface — they are not content managers or billing payers

### Per-Item Authorship — the optional upgrade path

- Any Basic user can opt in to authoring custom content, billed per item:
  - **$20/mo per authored custom instrument**
  - **$60/mo per authored custom analyst**
  - (Prices illustrative; finalized during PRD phase)
- Per-item fees added to monthly bill alongside the $50 Basic charge
- Compute cost for authored content tracked separately by `cost-modeling-system` — either bundled into the per-item fee or itemized (PRD decision)
- BYO API key option (bring your own Claude/GPT/etc. credential) available for premium model authorship — platform fee charged; user's provider bills them directly for inference

### Per-User Opt-Outs

- Any user can disable social surfaces (visibility in member lists, messaging, tournament participation, notifications, leaderboard appearance)
- A silent, $50-only user who never sees another user and is never seen by one is a first-class experience

### Lifecycle

```
signup → trial (30 days) → active (paid $50/mo + any per-item fees) → expired (read-only, 6mo) → purged
                       ↘ no card → expired (read-only, 6mo) → purged
```

Email touchpoints: trial-end conversion prompt, 30-days-before-purge warning.

### Strategy/Roadmap Reset (prerequisite phase)

Before building, this effort owns rewriting the documented strategy to match the new model:

- Update `roadmap.md` to remove the old Starter/Pro/Premium/Custom individual tier table (Phase 1) and the old "users bring their own API keys" Custom Tier (Phase 2)
- Document the single-tier + per-item authorship model as current strategy
- Reconcile `project_strategy.md` memory in the same change
- Reconcile any other efforts still referencing multi-tier models

### Migration

- Existing users auto-enrolled in Basic at flip-over
- Grandfathered trial/active state per current account state (TBD in PRD)
- Existing clubs (St. Thomas, etc.) convert to social-only (no billing impact)

## Success Criteria

- Every active account is a $50/mo Basic user
- Clubs have zero billing implications anywhere in the product or codebase
- Per-item authorship charges correctly appear on monthly bills for users who author
- Strategy docs and memory reflect the single-tier + per-item model — no orphaned references to the old multi-tier model

## Out of Scope

- Stripe wiring itself (`stripe-integration` effort, rescoped to single-tier + per-item charges)
- The authorship *mechanics* — that's `user-authored-custom-content`
- The cost tracking *infrastructure* — that's `cost-modeling-system`
- The donation/graduation mechanic — that's `custom-to-base-graduation`
- Student pricing mechanics — that's `student-club-accounts` (cost-pass-through model)

## Dependencies

- Architecture restructure block must land first (workflow stages, contracts, triple model, slot-based enablement) — these define what "Basic" actually gives a user access to

## Open Questions for PRD Phase

- Does the $50 Basic subscription include any per-item authorship quota (e.g., "first analyst free"), or is per-item billing strict from the first item?
- For users with BYO API keys: what's the platform fee structure — flat monthly on top of $50, percentage of inference cost, or per-call surcharge?
- How do we display the monthly bill when a user has $50 Basic + 3 instruments ($60) + 2 analysts ($120) = $230 total? UX matters for perception of per-item model.

---

*Drafted after extensive conversation collapsing the earlier multi-tier and club-as-billing-unit models. Clubs are social, users pay, per-item authorship is an opt-in upgrade path.*
