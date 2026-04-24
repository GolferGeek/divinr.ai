# Divinr.ai — Master Intention

**Drafted:** 2026-04-16
**Status:** v1 draft — source of truth for the effort restructure following the design conversation of 2026-04-15/16. Individual sub-intentions under [current/](current/) and [next/](next/) should be reconciled to this document, not the other way around.

---

## 1. Vision & Positioning

Divinr's promise is **explainability over black-box trading bots**. LLM-powered analysts produce predictions with captured, auditable reasoning. A risk debate system challenges every assessment. A three-tier learning loop lets the system improve over time — and every adaptation is visible.

**The closed loop is already operational:**
1. Analysts produce predictions with reasoning
2. Predictions evaluated against real outcomes nightly
3. Humans can read why analysts were right or wrong
4. System audits analyst reasoning against contracts
5. System proposes improvements, humans approve

**What this master intention establishes:** a unified business model, billing surface, authorship model, and architectural shape that makes the explainability thesis scalable, monetizable, and coherent. It supersedes every prior pricing/tier/club document, retires several earlier concepts entirely, and realigns the effort queue around a single vision.

---

## 2. Mental Model — Three Layers

Every user lives in all three of these layers simultaneously. Understanding the layers is understanding the product.

### 2.1 Base Layer (shared, Divinr-funded)

- Divinr curates a set of **base analysts** (currently 7: 5 personality analysts, 1 arbitrator, 1 portfolio manager) and **base instruments** (the covered universe).
- Every article flows against every base instrument (Stage 1 relevance), and every relevant (article × instrument) fans out to every base analyst (Stage 2+).
- Universal fanout. Shared compute. One analysis per (analyst × instrument × cycle), served to every user who's enabled that triple.
- **Users don't configure anything here.** The grind just runs; users consume outputs.
- Divinr owns this content, funds its compute, and expands its universe deliberately as revenue permits.

### 2.2 User-Authored Layer (personal, user-funded)

- Any Basic user can opt in to authoring their own content: custom analyst contracts, custom instrument contracts, brand-new analysts, brand-new instruments, source selections for their instruments, model choices per analyst.
- Authored content is **individually owned** — no joint ownership, no club-owned content.
- The author pays per-item fees and their underlying compute. Only the author sees the outputs by default (sharing is deferred plumbing).
- This is where power users, quants, and specialized retail operators build their "personalized analytical universe."

### 2.3 Social Layer (clubs, free)

- Clubs are social/tournament/messaging/member-discovery spaces. No billing implications. No content production. Zero quotas tied to them.
- Clubs are entirely opt-in. Users join or create clubs as they find them useful; no default club exists and no auto-enrollment happens at signup.
- Clubs eventually become the trust-graph substrate for user-to-user sharing (deferred), but at v1 they're pure social utility — tournaments, chat, shared activity feeds.

**Every active user has:** one $50/mo Basic subscription + optional per-item authorship charges + optional memberships in social clubs (free).

---

## 3. Architectural Foundation

### 3.1 Workflow Stages (named, first-class)

1. **Article Processing** — instrument-keyed relevance evaluation; no analysts involved
2. **Predictor Generation** — per (article × relevant instrument × analyst), only for articles that passed Stage 1
3. **Risk Assessment** — per (instrument × analyst), integrates new predictors into the analyst's evolving risk view; produces the analyst's holistic story on the instrument
4. **Prediction Generation** — per (instrument × analyst), informed by predictors and the just-updated risk view
5. **Learning** — post-outcome per-triple adaptation

**Key reorder from the current system:** Risk runs *before* predictions. Risk is the analyst's holistic understanding of the instrument; predictions derive from that understanding. The old "generate prediction, then debate it" flow is inverted.

### 3.2 Two-Step Article Pipeline

- **Step 1 — Relevance:** every article evaluated against **every instrument variant** (base + user-authored), using each instrument's `## Stage: Article Processing` contract section. Outputs the list of instruments the article touches.
- **Step 2 — Analyst fanout:** only fires for (article × instrument) pairs where relevance is positive. Generates predictors.

**Why every variant:** a user's custom China-aware AAPL contract may flag articles that base AAPL would skip. Each instrument variant deserves its own article-processing lens.

### 3.3 Stage-Keyed Contracts

Both analysts and instruments have **stage-keyed contracts**:

```markdown
## General
(universal, always sent)

## Stage: Article Processing
(INSTRUMENT ONLY — analysts don't have this stage)

## Stage: Predictor Generation
## Stage: Risk Assessment
## Stage: Prediction Generation
## Stage: Learning

## Adaptations
(recent learning-loop appendments, always sent)
```

At runtime, every analyst invocation pulls **(instrument's General + instrument's stage-section + analyst's General + analyst's stage-section + both Adaptations)** — merged into the prompt. Every stage has its contract context.

Closes today's gap where only the `## Adaptations` section actually flows into prompts and `persona_prompt` is the real behavior driver.

### 3.4 The Triple as Reasoning Atom

`(user_id, analyst_id, instrument_id)` is the atom of reasoning continuity. Predictors, risk summaries, predictions, and learning records are all keyed by this triple.

- `user_id IS NULL` → base content, global, shared compute
- `user_id IS NOT NULL` → user-authored, owned, individually billed

A single analyst running through multiple instrument-contract lenses holds **independent personas per triple** — "AAPL through base" and "AAPL through user's China-aware contract" have separate risk views, predictor streams, and prediction histories for the same analyst.

### 3.5 Stage 3 Has Two Sub-Components (Risk Reflection + Risk Debate)

The pre-prediction risk stage runs **two sub-components** per cycle:

**3a — Per-Analyst Risk Reflection (first-person, per triple)**
- Each analyst updates its own holistic risk view on the instrument, integrating the new predictors from Stage 2
- Writes to `analyst_risk_assessments` keyed by the (user, analyst, instrument) triple
- First-person framing: "as this analyst, how do the latest signals shift my risk view on this instrument?"
- This is the analyst's individual reasoning continuity — not shown as a debate, shown as the analyst's internal updated perspective

**3b — Red/Blue/Arbiter Risk Debate (multi-agent, per instrument, per-viewer filtered)**
- Consumes the just-updated per-analyst reflections from 3a as inputs
- Runs the adversarial Blue (bullish case) vs. Red (bearish case) vs. Arbiter (judgment) synthesis
- **The debate is what makes explainability visible to users** — "the AI arguing with itself" is a product-defining moment and a first-class feature, not an optional one
- **Participant set filtered per viewer-authorship-scope:**
  - Base instrument, no viewer customizations → standard debate with base analysts (shared run across all base viewers)
  - Base instrument, viewer has associated custom analyst(s) with it → *additional* per-viewer debate run including their custom analyst(s) as participants
  - Custom instrument (user-authored) → only that author's debate run, populated by the analysts they explicitly associated with the instrument
- Per-viewer debate runs are additive compute, paid for by the author's per-item authorship fees

**Both sub-components feed Stage 4 Prediction Generation.** Predictions draw on the analyst's just-updated reflection (3a) and the debate's synthesis (3b) to produce the final predictive claim.

### 3.6 Content-Keyed Compute Cost

Total cost ≈ `Σ (articles × instruments) + Σ (relevant_articles × instruments × analysts)`, weighted by model choice.

- Adding users to already-covered base content is nearly free
- Adding custom instruments inflates Stage 1 fanout forever (real cost commitment)
- Adding custom analysts adds Stage 2+ cost when articles for already-known instruments hit
- Per-user selection is filtering (free); per-item authorship is commissioning (paid)

---

## 4. Billing Model

### 4.1 Single User Tier

**Divinr Basic: `BASIC_MONTHLY_USD` (currently $50/mo)**

Includes:
- Full base layer access (all base analysts × all base instruments)
- Ability to join or create social clubs (no club is required, none is auto-assigned)
- Full UI, dashboards, risk debates, reasoning, performance data

### 4.2 Trial & Lifecycle

- 30-day free trial at signup
- Auto-converts to paid Basic if card on file
- No card → trial-expired state (read-only, 6-month dormancy window, then purge)
- Email touchpoints: trial-end conversion, 30-day-before-purge warning

### 4.3 Per-Item Authorship (opt-in, on top of Basic)

- `INSTRUMENT_AUTHORSHIP_USD` per authored custom instrument (currently $20/mo)
- `ANALYST_AUTHORSHIP_USD` per authored custom analyst (currently $60/mo)
- Contract overrides on existing base entities: TBD (possibly free on enabled items, small fee otherwise)
- Source selection from existing sources: free
- Custom source ingestion (BYO RSS/API): out of scope for v1
- Proration on mid-cycle add/remove (standard Stripe subscription-item behavior — authoring a new instrument on day 15 charges a half-month line item; deleting it on day 20 credits back the remainder)

### 4.4 BYO API Keys (premium models)

- Users can attach their own LLM provider credentials (Anthropic, OpenAI, etc.) to their authored analysts
- Platform fee on top of Basic (`BYO_PLATFORM_FEE_USD`) for this privilege
- User's provider bills them directly for inference; Divinr never sees those costs
- Non-BYO users run on Divinr's models (gemma local, frontier via Divinr's budget per cost modeling)

### 4.5 Student Pricing (flat discount on authorship)

- `.edu` email verification gates a **Student** membership modifier
- Base content access is **free** — no `BASIC_MONTHLY_USD` for students
- Per-item authorship is discounted by `STUDENT_DISCOUNT_PCT` (default `0.10` — students pay 10% of the regular per-item price)
  - Current numbers: $2 per custom instrument, $6 per custom analyst
- No BYO platform fee, no floor, no separate cost-pass-through accrual
- A student with zero authored items owes $0 and still gets full base access
- Proration on mid-cycle add/remove (same behavior as regular users)
- `.edu` lapse → graceful transition to regular Basic with full data preservation (existing authored items re-price at 100%, `BASIC_MONTHLY_USD` kicks in)

**Retired concepts:** `STUDENT_FLOOR_USD` (no floor needed when the bill derives from item count × fixed discount) and the variable cost-pass-through billing path (cost-modeling-system still computes unit economics internally, but students no longer pay "actual compute cost per month" — they pay a predictable flat discount on the published per-item price).

### 4.6 Operational Principle: Pricing in ENV

Every pricing lever lives in environment variables:
`BASIC_MONTHLY_USD`, `INSTRUMENT_AUTHORSHIP_USD`, `ANALYST_AUTHORSHIP_USD`, `BYO_PLATFORM_FEE_USD`, `STUDENT_DISCOUNT_PCT`, `TRIAL_DAYS`, `DORMANCY_MONTHS_BEFORE_PURGE`, etc.

Rapid pricing experimentation is a first-class capability, not a refactor.

---

## 5. Authorship Model

### 5.1 Schema Primitive

Every table that stores authored content (analyst config versions, instrument config versions, custom instruments, custom source selections, etc.) gets an `author_user_id` column:

- `NULL` → base content, owned by Divinr, shared, no billing attribution
- `NOT NULL` → user-authored, owned by that user, billed to them

### 5.2 Immutability of Base

- Users cannot modify base content under any circumstances
- Same-name authorship creates a separate record, never an update
- Multiple users authoring content with the same name coexist as distinct records

### 5.3 What Can Be Authored

- Custom analyst contracts (stage-keyed, parallel shape to base)
- Custom instrument contracts (stage-keyed, parallel shape to base)
- Brand-new analysts (full personality + contract from scratch)
- Brand-new instruments (not in base universe — subject to article-coverage limitation if name doesn't match base)
- Per-instrument source enablement (which of the existing sources feed a custom instrument)
- Analyst-instrument relationship selection (which analysts run on which instruments — explicit wiring, not all × all)
- Model selection per analyst (gemma / Haiku / Sonnet / Opus / GPT-4o, BYO or Divinr-billed)

### 5.4 Sharing (Plumbing Present, UI Deferred)

- `shared_with_clubs` boolean, `shared_with_users` FK set — both default false/empty
- Trust graph constraint: user-to-user sharing requires club co-membership
- v1 ships with no sharing UI. Lights up when real demand emerges.

---

## 6. Performance & P&L Attribution

**This is load-bearing, not decorative.**

The system tracks performance metrics at every entity dimension, and aggregates across arbitrary combinations:

- **Per triple** — hit rate, calibration, attributable P&L (what did this specific triple earn or lose?)
- **Per analyst** (aggregated across its triples) — the analyst's overall track record and contribution
- **Per instrument** (aggregated across analysts that ran on it) — "what did the system make on AAPL this week?"
- **Per source** (aggregated across articles from it) — "Reuters articles produce 15% better predictions than SCMP for our energy analysts"
- **Per article** — did this article produce profitable insights?
- **Per arbitrary combination** — instrument × analyst, analyst × source, source × instrument, etc.

### Why this is load-bearing

1. **Author retention.** "What did my AAPL analyst earn me this month?" is the question every paid author asks. Without an answer, per-item authorship feels like burning money.
2. **Graduation signal.** The custom-to-base graduation mechanism needs data to justify promotion. "This user's analyst has outperformed base analysts on tech instruments by 12% over 6 months" is the evidence.
3. **Community marketing.** When a custom analyst graduates to base, its attribution data is the pitch: "originally authored by @golfergeek — proven track record of 72% hit rate on growth stocks."
4. **Discovery.** "Top-earning custom analysts this month" becomes a browsable surface that attracts new authors and surfaces quality.
5. **System operations.** Divinr itself needs to know: which base instruments are generating value, which sources are worth paying for, which analysts need refinement.

### Schema Implication

A new subsystem (working name: `performance-attribution`) maintains outcome records keyed by every relevant dimension. Predictions get attached to outcomes; outcomes get attributed back through the triple to analyst, instrument, source, article, and user. Aggregation views make any dimension queryable.

---

## 7. Product Surfaces

### 7.1 Slot-Based Enablement

- Every user has a "portfolio" of enabled triples — the (analyst, instrument) pairs (plus their authorship scope) whose outputs they actively see
- Slots are enablement units. Enabling a triple doesn't commission new compute; it filters shared compute into the user's view.
- Basic tier has no fixed slot cap at launch (revisit if abuse emerges) — the real cost lever is authorship, not enablement

### 7.2 Relationship-Selection UI (Power-User)

- Users who author multiple analysts and multiple instruments wire which works on which
- Not all × all (as base does) — explicit selectivity is the whole point of custom authorship
- UI: matrix or wiring-diagram style interface in the authoring settings

### 7.3 Community Boards (post-graduation)

- **Community Analyst Board** and **Community Instrument Board** — browsable surfaces showcasing graduated content
- Attribution front-and-center: "authored by @golfergeek, donated 2026-07-12, track record: 72% hit rate on growth stocks over 6 months"
- Any user (regardless of tier) can enable board content for free — it's now base-equivalent
- Serves as discovery, marketing, and contributor recognition

### 7.4 Debate Viewing

- Instrument detail pages show the risk debate with the viewer's applicable participant set (their custom analysts + base analysts associated with that instrument)
- Different viewers see different debate participants on the same instrument — that's a feature, not a bug

### 7.5 Cost Transparency Dashboards

- Students see their actual compute cost accrual in real-time (educational and billing transparency)
- Regular users see a monthly summary of their compute + per-item charges, itemized for clarity
- Admins see system-wide cost data broken down by dimension

### 7.6 Custom-to-Base Graduation

- Opt-in, permission-based — author consents; system never auto-promotes
- Recognition framing — "are you proud of this? Let's put it on the community board"
- **Economic reward: cost reduction.** When an author donates their $20/mo custom instrument to base, that $20/mo is removed from their bill. Same for a $60/mo analyst. The system "semi-pays" the author by zeroing their ongoing cost for that item — while still retaining attribution credit.
- Author can continue to iterate privately (build v2 of their analyst while v1 lives in the commons, pay $60/mo for v2, keep recognition for v1)

---

## 8. What This Replaces (Explicit Retirements)

This document retires the following earlier concepts:

- **Starter $20 / Pro $50 / Premium $100 / Custom $500 individual tier ladder** (from original roadmap) — retired. Single $50 Basic tier.
- **"Custom Tier with users bring their own API keys"** as a separate SKU — retired. BYO is a Basic add-on with platform fee, not its own tier.
- **Club-as-billing-unit model** (capability-union + quota-sum across clubs) — retired. Clubs don't bill.
- **Multi-club entitlement stacking** — retired. Entitlements are individual.
- **Paid club tier catalog ($100/$500 clubs)** — retired. Clubs don't sell anything.
- **Club-authored custom content** — retired. Individuals author, clubs are social.
- **"Divinr Basic as free default"** — retired. Basic is $50/mo. Free trial is 30 days only.
- **Default "Divinr Basic" social club + auto-enrollment** — retired. Clubs are entirely opt-in; no default club exists.
- **Trial-expired → downgrade-to-free** — retired. Read-only 6-month dormancy → purge.
- **Cost-pass-through student billing with `STUDENT_FLOOR_USD`** — retired 2026-04-24. Superseded by a flat `STUDENT_DISCOUNT_PCT` (default 10%) on per-item authorship, with free base access and no floor. See §4.5.

These concepts should be purged from `roadmap.md`, the relevant memory files (`project_strategy.md`), and any sub-intentions still referencing them.

---

## 9. Phased Delivery Sketch

**Current (architecture foundation):**
- `workflow-stages-article-pipeline` (in [current/](current/)) — defines stages + two-step pipeline + risk-before-prediction reorder

**Architecture block (sequential, each depends on prior):**
- `stage-keyed-analyst-contracts`
- `instrument-contracts`
- `user-authored-custom-content` (renamed from `club-authored-custom-content`)
- `triple-model-reasoning-continuity`
- `slot-based-enablement-ui`

**Performance & economics substrate:**
- `cost-modeling-system` — must land early; everything downstream depends on it
- `performance-attribution` (elevated from bullet to top-level effort — per-entity P&L)

**Billing surface:**
- `user-billing-model` (single-tier $50/mo Basic + trial + lifecycle + per-item authorship charges, all at the individual level — no club coupling)
- `stripe-integration` (rescoped from multi-tier to single-tier + per-item)

**Authorship capabilities:**
- Relationship-selection UI (possibly folds into `user-authored-custom-content`)
- Source-selection UI per instrument (possibly folds into `user-authored-custom-content`)

**Graduation & recognition:**
- `custom-to-base-graduation` (opt-in donation with cost-reduction reward)
- `community-boards` (graduated content showcase with attribution)

**Student experience:**
- `student-accounts` (.edu-gated accounts with `STUDENT_DISCOUNT_PCT` applied to per-item authorship; no Basic subscription, no cost-pass-through)

**Experience polish & expansion:**
- `club-tournament-experience-polish` (intern showcase)
- `onboarding-tour-extended` (v2 — teaches the new model post-architecture)

**Post-beta:**
- `live-prediction-pnl`
- `spark-beta-hardening`
- `custom-source-ingestion` (BYO RSS/API — v2+ future)

---

## 10. Open Questions

Captured here so they're not forgotten when sub-intentions get rewritten:

1. **Contract-override pricing** — a user creating a contract *override* for a base analyst (keeping the analyst, changing its clauses): free? $20/mo? A partial markup?
2. **BYO platform fee structure** — flat monthly, percentage of provider bill, per-call surcharge?
3. **Relationship-selection UI scope** — its own effort, or folded into `user-authored-custom-content`?
4. **Default model per triple** — gemma local by default for all analysts, or user must explicitly choose a model at authorship?
5. **Authored instrument resolution against base** — if a user authors "AAPL" (same name as base), does their "AAPL" view override base when they navigate to AAPL, or are they shown as two separate entries in their enabled list?
6. **Source selection UX** — picker from the full source roster, or presets ("news-heavy," "analyst-reports-heavy")?
7. **Community board moderation** — who reviews donated content for inclusion on the public board? Admin-gated promotion, or auto-promotion with flagging?
8. **Graduation accounting for authors who already donated** — if a user donated their AAPL analyst (cost reduction) and later wants to stop paying for their private v2, what happens to the v1 on the community board? (Probably stays — attribution is a credit, not a service contract.)
9. **Performance attribution paper vs. real P&L** — today's system is paper trading. When real money comes in (post-beta), how does attribution handle the distinction?
10. **Is there still a "power-user-authorship" effort as a separate concept**, or does everything fold into `user-authored-custom-content` now that authorship is individual-only?

---

## 11. How This Document Is Used

- This is the **source of truth** for the current product vision. Individual sub-intentions under [current/](current/) and [next/](next/) must reconcile to this document.
- As individual efforts get promoted to current and executed, their intention files should be updated *from* this document, not independently.
- When design decisions change, they update here first, then propagate to affected sub-intentions.
- This document is long because the product is cohesive and changes propagate broadly. Length is the cost of internal consistency.

---

*Draft v1 — awaiting review and reconciliation pass against existing intentions.*
