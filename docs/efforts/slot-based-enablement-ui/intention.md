# Effort: Slot-Based Triple Enablement UI

## Problem

Once the (user, analyst, instrument) triple model lands, users need a way to choose **which triples are active in their portfolio**. Today's portfolio model assumes one analyst-per-instrument with no notion of multiple lenses. Users need to be able to:

- Enable base AAPL alongside any user-authored custom AAPL contract variants they have access to — each coexisting, each consuming a slot
- Enable any analyst variant (base or user-authored) against any instrument variant (base or user-authored) they have access to
- Manage their portfolio's composition clearly without tier-gated quota friction at the Basic level

## Intention

Build the user-facing surface that lets users assemble their portfolio by **selecting (user, analyst, instrument) triples** from the union of everything they have access to. Slots count triples, not raw instruments. Per master-intention, Basic has **no fixed slot cap at launch** — the real cost lever is authorship (per-item fees + compute), not enablement (which is just filtering shared compute).

## Scope

### Mental Model

- A **slot** = one enabled (user, analyst, instrument) triple in the user's portfolio
- The system runs every triple that has at least one enabler somewhere; user enablement is filtering, not commissioning
- Basic users: no hard slot cap at launch (revisit if abuse patterns emerge)
- Authored triples (where the user is the author) are billed per-item regardless of enablement; disabling doesn't stop the billing for authored content
- Enabling someone else's shared triple (when sharing UI eventually ships) is free — it's already running for them

### UI Surface

- Portfolio screen reworked: shows enabled triples grouped by instrument
- "Add to portfolio" flow: pick instrument → pick which contract variants you want active → pick which analysts × which contracts you want running on each
- Naming collision UX: when multiple "AAPL" instrument contracts exist (base + user-authored variants), they're shown distinctly with their authorship-source label (e.g., "AAPL (base)" vs "AAPL (your China-aware contract)")
- Slot count indicator visible but unobtrusive (if/when caps return)

### Navigation Patterns

- Click into an enabled triple → see its predictor stream, risk summary, prediction history (per-triple, not unified)
- Per-triple calibration / track record visible
- Switching focus between an instrument's variants (e.g., comparing Base AAPL view vs. your custom AAPL view) should be one click

### Disable / Re-enable

- Disabling a triple removes it from this user's view; the system continues to run it if any other enabler exists
- For user-authored triples, disabling does NOT stop the authorship billing — that continues until the user deletes the authored content itself
- Re-enabling a previously-enabled triple restores it instantly (no analytics gap)

### Discovery (longer-term, scoped out of v1)

- Empty-slot affordance: prompt suggesting popular base triples or community-board graduated content
- Once `custom-to-base-graduation` ships and community boards exist, discovery surfaces those

## Open Questions for PRD Phase

- Default enabled state for new users — empty portfolio, or auto-enable a starter set (top N base triples)?
- How does the UI handle the case where there are hundreds of base triples (many instruments × many analysts)? Filtering, search, curated starting picks?
- Should there be saved "presets" — e.g., "Tech-Forward 10" preset that enables a curated bundle of triples?
- If slot caps return later (per master-intention, deferred), what's the right quota model — fixed per-user, or dynamic based on Basic tier?
- How does this surface interact with the relationship-selection UI that user-authored-custom-content provides (analyst × instrument wiring)? Presumably: relationships define *what's runnable* for that user, slot enablement defines *what they see*.

## Success Criteria

- A user can fluidly assemble a portfolio of triples from base + their authored content + (future) enabled shared content
- A user with multiple lenses on the same instrument sees them clearly distinguished and can compare them
- Enabling/disabling is fluid and immediate
- The slot model feels like a natural product feature, not a quota-policing mechanism

## Out of Scope

- The triple data model itself (separate effort: `triple-model-reasoning-continuity`, prerequisite)
- Hard quota enforcement (not in scope at launch — `BASIC_SLOT_CAP` env var defaults to unlimited until we observe abuse)
- Authorship quota (that's the per-item pricing model, handled in `user-authored-custom-content` and `user-billing-model`)

## Dependencies

- `triple-model-reasoning-continuity` must land first — triples must exist as queryable, persistent entities
- `user-authored-custom-content` — for users to actually have authored content to enable

---

*Rewritten after the master intention retired the multi-club quota-stacking model. Slots are now a UX construct for filtering what the user sees, not a revenue or cost-control mechanism.*
