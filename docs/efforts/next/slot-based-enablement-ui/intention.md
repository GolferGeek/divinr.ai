# Effort: Slot-Based Triple Enablement UI

## Problem

Once the (club, analyst, instrument) triple model lands, users need a way to choose **which triples are active in their portfolio**. Today's portfolio model assumes one analyst-per-instrument with no notion of multiple lenses. Users need to be able to:

- Enable Base AAPL alongside Club X's China-aware AAPL alongside Club Y's ESG-tilt AAPL — all three coexisting, each consuming a slot
- Enable any analyst variant from any club they belong to, against any instrument variant they have access to
- Manage their slot budget within their tier's quota

## Intention

Build the user-facing surface that lets users assemble their portfolio by **selecting (club, analyst, instrument) triples** from the union of everything they have access to. Slots count triples, not raw instruments. A user with 10 Basic slots can spread them across 10 different instruments, or stack 10 lenses on a single instrument, or anything in between.

## Scope

### Mental Model

- A **slot** = one enabled (club, analyst, instrument) triple in the user's portfolio
- The system runs every triple that has at least one enabler somewhere; user enablement is filtering, not commissioning
- Quota is per user, summed across all clubs they belong to (Basic 10 + Premium Club 13 + Boutique Club 5 = 28 slots total)

### UI Surface

- Portfolio screen reworked: shows enabled triples grouped by instrument
- "Add to portfolio" flow: pick instrument → pick which contract variants you want active → pick which analysts × which contracts you want running on each
- Naming collision UX: when three different "AAPL" instrument contracts exist (base + two clubs), they're shown distinctly with their authoring-club label
- Slot counter visible at all times (X of Y used)

### Navigation Patterns

- Click into an enabled triple → see its predictor stream, risk summary, prediction history (per-triple, not unified)
- Per-triple calibration / track record visible
- Switching focus between an instrument's variants (e.g., comparing Base AAPL view vs Club X's AAPL view) should be one click

### Disable / Re-enable

- Disabling a triple frees a slot; the system continues to run it (because other users may have it enabled), but it disappears from this user's view
- Re-enabling a previously-enabled triple restores it instantly (no analytics gap)

### Quota Management

- Hard cap at quota — adding a triple beyond quota requires either disabling something or upgrading a club tier
- Empty-slot affordance: prompt suggesting popular triples or recently-discussed ones

## Open Questions for PRD Phase

- Default enabled state for new users — empty portfolio, or auto-enable a starter set (top N base triples)?
- How does the UI handle the case where a user is in 5 clubs and the "add to portfolio" picker becomes overwhelming?
- Should there be saved "presets" — e.g., "Tech-Forward 10" preset that enables a curated bundle of triples?
- Does a triple include the analyst, or do analysts get selected at portfolio-render time? (Earlier conversation strongly suggested triple-includes-analyst.)

## Success Criteria

- A user can fluidly assemble a portfolio of triples from any club they belong to
- A user with multiple lenses on the same instrument sees them clearly distinguished and can compare them
- Quota enforcement is intuitive and never silently degrades the experience
- The slot model feels like a natural product feature, not a quota-policing mechanism

## Out of Scope

- The triple data model itself (separate effort: `triple-model-reasoning-continuity`, prerequisite)
- Tier quota numbers (separate effort: `divinr-basic-club-model` defines Basic; `paid-club-tier-catalog` defines higher tiers)

## Dependencies

- `triple-model-reasoning-continuity` must land first — triples must exist as queryable, persistent entities

---

*Stub — sixth and final effort in the architecture restructure sequence. The user-facing surface that makes the triple model real to users.*
