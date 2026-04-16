# Effort: Club-Authored Custom Content

## Problem

Today, base analysts and base instruments are the only entities in the system. There's no path for a club (or user) to author their own analyst, override an existing analyst's contract with their own perspective, override an instrument's contract with a club-specific lens, or introduce a brand-new instrument the system doesn't track. This means clubs can't differentiate, can't express their identity through curated content, and can't pay for premium customization.

## Intention

Add a **club-authored content layer** that lets clubs (within their tier-defined quota) create their own analysts, override base analyst contracts, override base instrument contracts, and introduce brand-new instruments. Authorship is **additive only** — it never modifies base content, only creates parallel records that coexist with base.

## Scope

### Authorship Surface (per club)

- **Authored analysts** — brand-new analysts (any name) OR same-named overrides of base analysts
- **Authored analyst contracts** — alternative contracts for an existing analyst (base or club-authored)
- **Authored instrument contracts** — alternative contracts for an existing instrument (base or club-authored)
- **Authored instruments** — brand-new instruments not in the base universe (with their own contract)

### Immutability of Base

- Clubs and users **cannot modify base content** under any circumstances
- Same-name authorship creates a separate record, never an update
- Multiple clubs can author entities with the same name; they coexist as distinct records

### Quota Per Club Tier

- Quota numbers defined in the `paid-club-tier-catalog` effort
- Custom-instrument authorship is the premium cost lever — should be tightly capped (or paid as separate add-on) since it inflates Stage 1 fanout for every article forever
- Custom-analyst and custom-contract authorship can be more generous — they don't add Stage 1 cost, only Stage 2+ when articles for already-known instruments fan out

### Schema

- `analysts` table gets a `club_id` column (nullable; null = base)
- `analyst_config_versions` already has a `source` field; add a `club_id` for club-authored versions
- Same pattern for instruments and instrument contracts
- Constraint: club-authored content is only visible/enableable to members of the authoring club (plus admins)

### Authoring UI

- Club admin (or designated authors within the club) gets editor surfaces for all four authorship types
- New analyst flow: name, base persona, contract scaffolding (LLM pass to seed sections, then editable)
- New instrument flow: name, ticker (if applicable), contract scaffolding
- Override flow: pick a base entity, fork its contract, edit the fork

## Open Questions for PRD Phase

- **User-direct authorship** — can individual users (without going through a club) author their own custom content? Earlier conversation suggested possibly, but landed on "associated with clubs." Could be solved by a "personal club of one" abstraction; needs explicit decision.
- **Authorship roles within a club** — who can author? Club owner only? Designated authors? Any member?
- **Brand-new instrument data sources** — instruments not named after a base instrument get no article flow (real limitation). Should clubs be able to wire custom RSS/API data sources for their authored instruments? (Probably future feature; out of scope here.)
- **Quota enforcement** — soft (warning + grace) or hard (creation blocked at quota)?

## Success Criteria

- A club admin can author a new analyst, a contract override, an instrument contract override, and a brand-new instrument
- Authored content is visible/enableable only to members of the authoring club
- Authored content runs through the same pipeline as base content (Stage 1 + Stage 2+) without special-casing
- Quotas enforce per-club tier limits

## Out of Scope

- The triple-model storage of analyses (separate effort: `triple-model-reasoning-continuity`)
- User-side enablement UI for choosing which authored content to surface in their portfolio (separate effort: `slot-based-enablement-ui`)
- Pricing/tier definitions (separate effort: `paid-club-tier-catalog`)

## Dependencies

- `stage-keyed-analyst-contracts` and `instrument-contracts` must land first — authorship needs the contract shape to author against

---

*Stub — fourth effort in the architecture restructure sequence. Opens the door to club differentiation and the premium-content revenue lever.*
