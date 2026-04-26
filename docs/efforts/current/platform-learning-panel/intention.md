# Effort: Platform Learning Panel

## Problem

The mastery-level system needs a companion surface where users can ask questions, understand what they are seeing, and learn what to do next. If the Learning Panel requires every Level 1 user to bring their own Claude key, it adds friction at the exact moment when the product should feel most helpful.

The better default is a Divinr-managed, Claude-backed Learning Panel whose expected cost is built into subscription pricing, metered internally, and bounded by product policy. Users can spend meaningful time in the panel without receiving open-ended external research or unrestricted model access.

## Intention

Build a **Claude-backed, Divinr-grounded Learning Panel** available from Level 1. The panel explains Divinr capabilities, risk reasoning, analyst behavior, portfolio comparison, trading mechanics, clubs, tournaments, and mastery progression using approved Divinr knowledge and user-visible context.

The panel is not a general web research agent. It does not browse the web, perform arbitrary outside research, fetch live market news on demand, or provide personalized investment advice. External research is a separately scoped, separately metered future capability.

## Scope

### Panel Experience

- App-shell Learning Panel visible from Level 1
- Collapsed/expanded panel behavior that works alongside the simplified left nav
- Level-aware prompts such as:
  - "What else should I learn before moving to the next level?"
  - "How do the risk analysts determine their red and blue strategy?"
  - "Why is this signal considered risky?"
  - "What is the difference between my portfolio and analyst portfolios?"
  - "How do tournaments work?"
- Contextual entry points from analyses/signals, risk explanations, trades, portfolios, clubs, and tournaments

### Knowledge and Context

- RAG-like retrieval from an approved Divinr knowledge base
- Use existing onboarding, first-touch, feature inventory, analyst/instrument explanations, and product docs as initial corpus
- Add curated learning documents where app concepts need clearer explanation
- Include only user-visible user context by default
- Enforce a per-turn context budget
- Compact/summarize conversation context so long chats do not grow unbounded

### Model and Cost Control

- Use Divinr-managed provider credentials, not per-user keys, for the default panel
- Start with an inexpensive Claude model such as Haiku unless the PRD identifies a reason to route specific tasks differently
- Record every call through the LLM usage logging/cost systems
- Apply per-user and per-plan usage limits
- Distinguish learning-chat usage from future builder/research usage
- Provide admin usage dashboards and abuse controls

### Safety and Policy

- No web search or external research in the default Learning Panel
- No tool access that can mutate app state in the foundation version
- No personalized investment advice, trade recommendations, or "you should buy/sell" language
- Answers should be educational, explanatory, and grounded in Divinr-visible context
- Use existing `<LegalDisclaimer>` patterns where panel surfaces need disclaimer treatment

### Future Extension Points

- Optional bring-your-own-key mode for power users or experiments
- Higher-tier research mode with explicit pricing, citations, limits, and audit logging
- Builder Panel mode for drafting instruments, analysts, or authored content after the read-only learning flow is proven

## Success Criteria

- Level 1 users can open the Learning Panel without configuring an external API key
- The panel answers core product questions from Divinr-approved knowledge and visible context
- The panel can explain the user's current mastery level and suggested next steps
- Backend enforcement prevents web research and arbitrary external tool use
- Usage is metered per user and visible to admins
- Long-running conversations are compacted or summarized to control context cost

## Out of Scope

- Creating or modifying instruments, analysts, contracts, trades, clubs, or tournaments from the panel
- User-provided Claude/Replit API key storage as the default model
- Open web research, live market news lookup, or arbitrary external content retrieval
- Replacing onboarding/first-touch coverage; the panel complements those systems

## Dependencies

- `mastery-levels-learning-profile` — defines levels, visible surfaces, and learning profile state
- `llm-usage-logging` — required for call-level metering and auditability
- `cost-modeling-system` — required for cost dashboards, plan limits, and pricing defensibility
- `user-billing-model` — subscription pricing needs to absorb expected panel usage
- `ui-vocabulary-and-marketing-refresh` — panel copy must use analysis/signal language and avoid advice/recommendation framing

## Open Questions for PRD Phase

- What monthly usage allowance is included in Basic?
- Should heavy users see warnings, hard caps, degraded mode, or upgrade paths?
- Which corpus documents are authoritative for the first Learning Panel release?
- How much conversation history should be retained, summarized, or deleted?
- Should the panel expose citations into Divinr docs and app surfaces?
- Should optional BYO key support remain future-only or be part of the first platform release?

---

*A native Learning Panel, priced into Divinr, grounded in Divinr knowledge, and bounded away from open-ended web research. It becomes the user's guide through mastery before it becomes a builder tool.*
