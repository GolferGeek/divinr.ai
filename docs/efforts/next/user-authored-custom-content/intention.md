# Effort: User-Authored Custom Content

## Problem

Basic users get the full base experience (all base analysts × all base instruments, universal fanout) for $50/mo. But a real segment of users wants to author their own — their own AAPL contract through a China-hawk lens, their own "Aggressive Growth" analyst with a different risk appetite, a brand-new instrument the base universe doesn't track. Today there's no path for them to do that, and the triple model architecture already anticipates them existing.

## Intention

Let users author their own analysts, instrument contracts, and custom instruments — individually (not through clubs) — on a per-item subscription model. Authorship is opt-in and additive; base behavior is unchanged for users who don't opt in. The system architecture (stage-keyed contracts, the (user, analyst, instrument) triple model, slot-based enablement) already accommodates this; this effort builds the authoring UI, billing integration, and runtime wiring.

## Scope

### Authorship Surface (individual, not club)

- **Authored analysts** — brand-new or same-named overrides of base analysts
- **Authored analyst contracts** — alternative contracts for any analyst (base or user-authored)
- **Authored instrument contracts** — alternative contracts for any instrument (base or user-authored)
- **Authored instruments** — brand-new instruments not in the base universe
- **Analyst-instrument relationship selection** — the user picks which of their authored (or enabled) analysts actually work on which of their instruments. Not all × all; explicit wiring.

### Schema

- `author_user_id` column on all authorship tables (`analyst_config_versions`, `instrument_config_versions`, custom `instruments`, etc.)
- `author_user_id IS NULL` = base content, global, owned by Divinr
- `author_user_id IS NOT NULL` = custom content, owned and billed to that user
- `shared_with_clubs` boolean and `shared_with_users` FK set (both default false/empty) — plumbing present, UI deferred per earlier design discussion

### Immutability of Base

- Users cannot modify base content under any circumstances
- Same-name authorship creates a separate record, never an update
- Multiple users can author content with the same name; they coexist as distinct records

### Per-Item Pricing

- **$20/mo per authored custom instrument**
- **$60/mo per authored custom analyst**
- **Authored contracts** (overrides of existing analyst/instrument): TBD — possibly free for a base item the user has enabled, or a small fee per override
- Sources selection (picking which existing sources feed a custom instrument) — free; custom source ingestion (BYO RSS/API) is out of scope for this effort

### BYO API Keys (power-user variant)

- Users can optionally attach their own LLM provider credential (Anthropic, OpenAI, etc.) to their authored analysts
- When the analyst runs, calls route through the user's key; provider bills user directly
- Platform fee on top of $50 Basic for this privilege (amount TBD in PRD)
- Non-BYO users run on Divinr's models (gemma locally; frontier via Divinr's budget as cost modeling allows)

### Authoring UI

- New section in user settings: "Your Authored Content"
- Create-flow per item type: name, scaffold (LLM pass to seed contract sections), editable markdown editor (reuses existing [ContractEditorView.vue](apps/web/src/views/ContractEditorView.vue) pattern with stage sections from `stage-keyed-analyst-contracts` effort)
- Relationship-selection UI: a matrix or explicit wiring interface showing "which of your analysts work on which of your (or enabled base) instruments"
- Billing preview: live calculation of monthly charge as items are added

### Runtime Behavior

- Authored triples (`user_id, analyst, instrument`) flow through the full pipeline (Stage 1 relevance → Stage 2 predictor generation → Stage 3 risk → Stage 4 prediction) same as base triples
- Content-keyed cost model still applies: one run per triple regardless of how many users enable it (though for user-authored content, typically only one user has it enabled — the author)
- Risk debate participant filter: only the authoring user sees their custom analyst in the per-instrument debate

## Success Criteria

- A user can author a new analyst, a new instrument, a contract override, and pay the correct per-item monthly charge
- Authored content runs through the same pipeline as base content (no special-casing)
- Only the author sees their authored analysts in the risk debate for any given instrument
- BYO API key holders' inference is correctly routed through their credentials; their provider bills them directly
- Base users (no authorship) experience zero change in their $50/mo Basic product

## Out of Scope

- Club-based authorship (removed — individuals own all authorship)
- Sharing authored content with other users (plumbing present, UI deferred until real demand)
- Custom source ingestion (BYO RSS/API for brand-new data feeds) — separate future effort
- The donation/graduation mechanic (separate effort: `custom-to-base-graduation`)
- Compute cost tracking for authored content (separate effort: `cost-modeling-system`)

## Dependencies

- `stage-keyed-analyst-contracts` and `instrument-contracts` — need the contract shape to author against
- `triple-model-reasoning-continuity` — need the triple-keyed storage
- `slot-based-enablement-ui` — need the enablement model (user's authored triples appear in their slot pool automatically)

## Open Questions for PRD Phase

- Relationship-selection UI shape — matrix, explicit wiring list, or drag-and-drop?
- What does the LLM scaffolding pass produce when a user creates a new analyst from scratch — a generic "analyst template" they edit, or a guided interview that infers their preferences?
- For a user with a custom instrument named "AAPL" (overlapping with base AAPL), does the risk debate show both base AAPL's debate AND their custom variant's debate, or a unified view? Probably separate per-triple debates (consistent with triple model).

---

*Renamed from `club-authored-custom-content` after the design collapsed onto individual authorship with no club production. Clubs remain social containers only.*
