# Effort: Onboarding Tour Extended (v2)

## Background

Onboarding v1 shipped — see [archive/onboarding-v1/](docs/efforts/archive/onboarding-v1/). It's a 12-step linear tour that walks new users through the left-nav top-to-bottom with a docent panel. It works for the original beta cohort and proves the docent UX pattern.

This v2 effort extends that foundation into a substantially deeper experience that matches the depth of the product after the architecture restructure lands.

## Problem

Three things have changed since v1 shipped:

1. **The product got deeper.** Stage-keyed contracts, the (user, analyst, instrument) triple model, user-authored content with optional sharing, slot-based enablement, per-item authorship pricing, and custom-to-base graduation — all non-obvious to a new user and central to understanding what Divinr does.
2. **12 linear steps undersells the product.** A new user genuinely deserves an hour of guided context if they want it. Half-explaining a product whose whole thesis is explainability is self-defeating.
3. **The tour isn't interaction-aware.** When a user clicks "Add a new club," the docent loses them. Each meaningful sub-flow inside a section deserves its own beats.

## Intention

Restructure the tour as a **chaptered, interaction-aware, hour-long product walkthrough** with a video slot per chapter (text-first now, video later as we record them). Keep it fast click-through for users who want pace; make it deep for users who want depth. Opt out anywhere.

## Scope

### Chapter Structure

Each chapter has multiple beats, a video slot, and follows the user's actual interactions:

1. **Welcome** — what Divinr is, why it exists
2. **Dashboard** — your home, anatomy of each card
3. **Prediction cards** — direction, confidence, rationale, drill-in
4. **Instrument detail** — arbitrator synthesis, analyst cards, reading disagreement
5. **Analysts** — roster, performance, **contracts deep beat** (stage sections, why portioned, why it matters for explainability — depends on architecture restructure landing first)
6. **Risk debate** — Blue/Red/Arbiter, risk dimensions, the holistic-view framing
7. **Portfolios** — analyst portfolios, positions, **making a trade** (its own deep beat), looking inside a portfolio (cost basis, P&L, history)
8. **Performance** — equity curves vs SPY, calibration, leaderboards
9. **Clubs** — overview, anatomy of a club, **add a new club** (interaction-aware sub-flow), inviting members, per-club opt-outs, messaging, handoff to tournaments
10. **Tournaments** — mechanics, leaderboard storytelling, how trades execute, club connection
11. **Messages** — club chat
12. **Wrap** — completion celebration, where to go next

### Interaction-Aware Docent

- Docent listens for "user clicked X" / "user landed on route Y" events to advance through beats inside a chapter
- Sub-flows (like create-club) are walked explicitly — the docent follows the user into the modal/page and explains what they're seeing
- Optional vs required interactions: most beats can be advanced by either performing the action or pressing "Show me how"

### Video Slots

- Each chapter has a video slot at the top (or wherever feels right)
- Text-first launch — videos are added incrementally
- Mobile-friendly playback (already proven in v1)

### Resume & Skip Granularity

- Resume per beat, not just per chapter (state model already supports it)
- Skip per chapter ("I get clubs, move on")
- Skip globally (existing v1 behavior)
- Re-entry recap: when a user comes back tomorrow to chapter 6, brief "where you left off" callout before resuming

### Content Authoring

- Content lives in `apps/web/src/onboarding/tour-content.ts` (existing structured TS file from v1)
- Each chapter is its own export, each beat is its own structured object
- Diff-friendly, type-checked

### Honest About System Capabilities

- The contracts beat in the Analysts chapter requires architecture restructure efforts to land first — otherwise the tour would teach a model that doesn't match runtime behavior
- Other chapters can ship before architecture work; the contracts beat is the gating one

## Open Questions for PRD Phase

- Do we add chapter-level estimated time labels ("Clubs — about 5 minutes")?
- Should we add a "tour my friend gave me" mode where a more experienced user can record annotations on top of the standard tour?
- Achievement / completion badges per chapter — worth it or feature creep?
- For the contracts beat specifically: how visual is the stage-keyed contract structure in the editor at that point? May need a UI lift in `stage-keyed-analyst-contracts` effort to make this teachable.

## Success Criteria

- A new user who takes the full tour ends understanding the entire product, including explainability, contracts (as portioned by stage), the (user, analyst, instrument) triple model, how per-item authorship lets power users build their own analytical universe, and how custom-to-base graduation rewards contribution
- A new user who skips can use the full product without restriction
- A user can pause at any beat and resume cleanly later
- Each chapter's content can be authored or edited independently of the others

## Out of Scope

- Multi-language content (English-only, same as v1)
- Role-specific tour variants
- Per-step analytics dashboard

## Dependencies

- All six architecture restructure efforts (workflow-stages-article-pipeline through slot-based-enablement-ui) — shipped. Cleared the blocker on the contracts, analysts, and portfolios beats.
- `club-tournament-experience-polish` — shipped. Club/tournament surfaces are in finished shape for the tour to walk through.

No remaining hard blockers. The Clubs chapter should teach the current model: clubs are purely social, fully opt-in, with no default club and no auto-enrollment.

---

*v2 builds on v1 (archived). The contracts beat is the most architecturally-dependent part — sequence accordingly.*
