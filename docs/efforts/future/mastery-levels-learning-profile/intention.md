# Effort: Mastery Levels and Learning Profile

## Problem

Divinr has grown into a broad platform: analyses/signals, risk reasoning, trading, portfolios, analyst portfolios, clubs, tournaments, authored content, analyst and instrument construction, admin calibration, audit, source quality, attribution, and cost surfaces. That breadth is valuable, but it can bury the core user loop for a new or casual user.

The first product experience should make the basic loop obvious:

- read analyses/signals
- understand risk
- make trades
- compare the user's portfolio against analyst portfolios

Everything else should become visible as the user becomes familiar enough to benefit from it. The left nav is the main expression of this progression: Level 1 users should see almost nothing beyond the core loop and the Learning Panel, while later levels progressively reveal social, competitive, authoring, builder, and operator capabilities.

## Intention

Create a **mastery-level system** that uses familiarity to shape application complexity. Each user has a learning profile that tracks their current level, key milestones, visible capabilities, first-touch progress, and suggested next learning steps. The app should feel focused at Level 1 and progressively richer as the user advances.

This is not primarily a permissions system. Roles still control true authorization. Mastery levels control user-facing visibility, navigation complexity, onboarding guidance, and what the Learning Panel can explain or suggest next.

## Proposed Mastery Ladder

### Level 1: Core Trading

The base Divinr loop. The user can:

- browse analyses/signals
- inspect risk explanations
- make tournament or paper trades where available
- view their portfolio
- compare against analyst portfolios
- open the Learning Panel

The left nav should be aggressively simplified. Surfaces outside the core loop should be hidden unless required for account/billing/access.

### Level 2: Competitive Participation

The user can join clubs and tournaments, understand leaderboards, view competition context, and ask the Learning Panel what to learn before moving deeper.

Creation can remain hidden at this level. The initial emphasis is participation, not administration.

### Level 3: Community Creation

The user can create clubs or tournaments, invite others, structure group activity, and use the Learning Panel for setup guidance and moderation/participation explanation.

### Level 4: Builder

The user can access builder-oriented surfaces for instruments, analysts, contracts, authored content, and eventually panel-assisted drafting workflows. This is where the Learning Panel can expand into a Builder Panel after the safer read-only foundation proves useful.

### Level 5: Operator

Admin/operator surfaces: calibration, defensibility, experiments, attribution, source quality, audit findings, usage/cost views, graduation candidates, and system health. This level remains role-gated; mastery alone cannot grant operator authority.

## Scope

### Learning Profile

Persist user-level learning state:

- current mastery level
- manually selected preferred complexity level, if allowed
- completed first-touch surfaces
- key milestones such as first trade, first portfolio comparison, first tournament joined, first club joined, first authored item
- concepts introduced or dismissed
- next suggested learning steps
- Learning Panel availability and usage summary

Raw chat history is not the default source of truth for learning state. Store useful summaries and explicit preferences only when needed, with deletion/retention rules defined in the PRD.

### Navigation and Visibility

- Define a surface-to-level inventory for the app shell and left nav
- Hide most non-core left-nav entries at Level 1
- Reveal clubs/tournaments at Level 2
- Reveal creation/administering surfaces at Level 3
- Reveal authoring/builder surfaces at Level 4
- Keep operator/admin surfaces role-gated at Level 5
- Provide a clear way for advanced users to opt into more complexity, subject to role authorization

### Progression

- Define milestone-based suggestions for advancing levels
- Decide whether level advancement is automatic, user-confirmed, admin-controlled, or a hybrid
- Avoid making users feel locked out; hidden capabilities should be explainable from the Learning Panel and settings

### Learning Panel Integration

- The Learning Panel is visible from Level 1
- It should know the user's current level and visible surfaces
- It can answer "what else should I learn before the next level?"
- It can explain why a feature is not currently visible
- It should not unlock role-gated or higher-risk capabilities by itself

## Success Criteria

- New users see a left nav focused on the Level 1 core loop and Learning Panel
- Every existing user-facing surface has an assigned mastery level or an explicit admin/operator exception
- A user's current level and learning profile are persisted and queryable
- The Learning Panel can provide level-aware learning guidance
- Advanced users can reach deeper capabilities without needing a hidden route or admin workaround

## Out of Scope

- Implementing the Claude-backed Learning Panel itself — separate effort: `platform-learning-panel`
- Builder actions that create instruments or analysts — future builder-mode effort
- Rewriting authorization or role semantics; mastery levels control visibility and guidance, not security
- External web research or open-ended market research

## Dependencies

- `onboarding-tour-extended` — first-touch inventory and `surface-content.ts` are the natural basis for surface-level coverage
- `testing-team` — any newly visible/hidden user-facing behavior needs deep skill and Playwright coverage updates
- `user-billing-model` — account/billing surfaces may need to remain reachable regardless of mastery level

## Open Questions for PRD Phase

- Should users be able to manually switch to a higher level immediately?
- Should Level 2 include creating clubs/tournaments, or only joining/participating?
- What are the exact Level 1 left-nav entries?
- How should hidden-but-available capabilities be discoverable without cluttering the nav?
- What learning profile data is stored permanently, summarized, or discarded?
- Does mastery level affect only app-shell navigation, or also in-page affordances and route guards?

---

*Progressive disclosure as product architecture: the app starts with the core trading loop and Learning Panel, then reveals social, creation, builder, and operator capability as the user becomes ready for it.*
