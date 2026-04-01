# Analyst System — Design Intent

## 1) Purpose

This document defines the analyst architecture for Divinr AI: how analysts are created, configured, assigned, versioned, and governed per tenant. The analyst system is the primary lever of client control — it's what makes one tenant's predictions different from another's on the same instrument.

It complements:

- `high-level-PRD.md` — differentiator: complete client analyst control
- `ai-learning-system.md` — how analysts improve over time
- `markets-orchestration-roadmap.md` — how analysts execute in prediction and risk pipelines

---

## 2) Core model

### Two analyst types

| Type | Role | Examples |
|------|------|---------|
| **Personality** | Decision-maker. Produces directional calls, confidence, rationale. These are the analysts that "vote" in the ensemble and that the arbitrator synthesizes. | Fundamental Fred, Technical Tina, a tenant's custom "ESG Emily" |
| **Context Provider** | Knowledge layer. Provides domain/sector/instrument expertise that gets injected into personality analyst prompts. Does not vote independently. | A macro economics context, a sector-specific context, an instrument-specific context |

Personality analysts make decisions. Context providers inform them.

### Default analyst pack (starter kit)

Every new organization is seeded with the following 5 personality analysts. These are the system defaults — available immediately, no setup required.

| Slug | Name | Perspective | Default Weight |
|------|------|-------------|---------------|
| `fundamental-fred` | Fundamental Fred | Earnings quality, revenue trends, margins, balance sheet strength, valuation metrics, competitive position | 1.00 |
| `technical-tina` | Technical Tina | Chart patterns, support/resistance levels, volume analysis, momentum indicators, trend identification | 1.00 |
| `sentiment-sally` | Sentiment Sally | News tone, social media buzz, analyst ratings changes, insider activity, institutional flows | 1.00 |
| `aggressive-alex` | Aggressive Alex | High-conviction momentum plays: breakouts, trend acceleration, volume surges, relative strength | 1.10 |
| `cautious-carl` | Cautious Carl | Risk management: downside protection, margin of safety, position sizing discipline | 0.90 |

Each default analyst includes **tier instructions** for different analysis depths:

- **Gold:** Comprehensive multi-step reasoning with full evidence
- **Silver:** Balanced approach covering key factors with clear reasoning
- **Bronze:** Quick assessment focused on the single most important factor

### Tenant control over defaults

Tenants can:

- **Disable** any default analyst (it stops participating in runs for that org)
- **Modify** a default's persona prompt, weight, or tier instructions (this creates a tenant-specific version — the system default is preserved but overridden)
- **Re-enable** a disabled default at any time
- **Reset** a modified default back to the system version

Defaults are never deleted — they're toggled. The tenant always has the option to come back to the starter kit.

### Custom analysts

Tenants can create **unlimited custom analysts** with:

- A unique slug and display name
- A persona prompt (the analyst's perspective and decision-making approach)
- A default weight (how much influence in the ensemble, 0.1–2.0)
- Tier instructions (optional — gold/silver/bronze analysis depth)
- Type: personality or context_provider

Custom analysts are fully tenant-owned. They can be assigned to specific instruments or applied broadly. They participate in the same ensemble and arbitration pipeline as defaults.

**Examples of custom analysts a tenant might create:**

- "ESG Emily" — environmental/social/governance focused analysis
- "Sector Steve" — deep expertise in a specific industry vertical
- "Contrarian Chris" — systematically opposes consensus
- "Macro Mike" — focuses on macroeconomic indicators and central bank policy
- "Earnings Eve" — specialized in earnings season analysis and guidance interpretation

There is no limit on the number of analysts per tenant. The system handles ensemble aggregation regardless of count.

---

## 3) Analyst fields

### Core fields (on `market_analysts` table)

| Field | Type | Description |
|-------|------|-------------|
| `id` | text PK | UUID |
| `organization_slug` | text | Tenant owner |
| `slug` | text | Unique identifier within org |
| `display_name` | text | Human-readable name |
| `analyst_type` | text | `personality` or `context_provider` |
| `persona_prompt` | text | The analyst's perspective, approach, and decision framework |
| `tier_instructions` | jsonb | `{ gold, silver, bronze }` — analysis depth per LLM tier |
| `default_weight` | numeric | Influence in ensemble (0.1–2.0, default 1.0) |
| `is_system_default` | boolean | True if this is a seeded default analyst |
| `is_enabled` | boolean | Tenant can toggle on/off |
| `workflow_scope` | text | `prediction`, `risk`, or `both` (default `both`) |
| `created_by` | text | Who created it |
| `created_at` | timestamptz | When created |
| `updated_at` | timestamptz | Last modified |

### Assignment (on `market_instrument_analyst_assignments`)

| Field | Type | Description |
|-------|------|-------------|
| `organization_slug` | text | Tenant |
| `instrument_id` | text | Which instrument |
| `analyst_id` | text | Which analyst |
| `weight_override` | numeric | Optional per-instrument weight override |
| `assigned_by` | text | Who assigned |
| `created_at` | timestamptz | When assigned |

PK: `(organization_slug, instrument_id, analyst_id)`

If no analysts are explicitly assigned to an instrument, the system uses **all enabled analysts** for that org. Explicit assignment narrows the roster for that instrument.

### Versioning (on `analyst_config_versions`)

Every change to an analyst's persona_prompt, tier_instructions, or default_weight creates a new version record:

| Field | Type | Description |
|-------|------|-------------|
| `id` | text PK | UUID |
| `analyst_id` | text | Which analyst |
| `organization_slug` | text | Tenant |
| `version_number` | integer | Sequential |
| `persona_prompt` | text | The prompt at this version |
| `tier_instructions` | jsonb | Tier instructions at this version |
| `default_weight` | numeric | Weight at this version |
| `config_overrides` | jsonb | Any additional config at this version |
| `source` | text | `manual`, `tier1_auto`, `tier2_approved`, `tier3_strategic` |
| `change_reason` | text | Why this version was created |
| `parent_version_id` | text | Previous version (lineage chain) |
| `canonical_test_score` | integer | How this version scored against canonical tests (if applicable) |
| `is_active` | boolean | Is this the current active version |
| `created_by` | text | Who/what created it |
| `created_at` | timestamptz | When |

This enables:
- Full audit trail of how an analyst evolved
- Rollback to any previous version
- The learning system to track which changes improved performance
- Explainability: "this prediction was made with analyst version X"

---

## 4) Analyst lifecycle

### Creation

```
Org created → seed 5 default personality analysts (is_system_default=true, is_enabled=true)
             → seed default context providers if applicable

Tenant action → create custom analyst (is_system_default=false)
             → assign to instruments (or leave unassigned for broad application)
```

### Configuration

```
Tenant modifies default analyst → new config version created (source=manual)
                                → original system default preserved
                                → tenant sees their version, not the system one

Tenant creates custom analyst → initial version created (source=manual, version_number=1)
```

### In a prediction run

```
1. Get all enabled analysts for org (is_enabled=true)
2. If instrument has explicit assignments → use only those analysts
3. If no explicit assignments → use all enabled analysts
4. Filter by workflow_scope (prediction analysts only for prediction runs, risk for risk runs)
5. For each personality analyst:
   - Load current active config version
   - Build prompt from persona_prompt + tier_instructions + shared context
   - Inject any context_provider outputs relevant to this instrument
   - Execute LLM call
   - Persist per-analyst outcome with config_version_id
6. Arbitrator synthesizes all personality analyst outputs
```

### In a risk run

Same pattern, but:
- Uses analysts with `workflow_scope` = `risk` or `both`
- Per-dimension: each dimension's LLM call can be influenced by relevant context providers
- Debate agents (blue/red/arbiter) are separate from the analyst roster

### Learning cycle modifies an analyst

```
Nightly evaluation identifies pattern → Tier 1 proposes change
  → New config version created (source=tier1_auto)
  → Tested against canonical days
  → If passed: applied in paper mode
  → After paper period: promoted to active (new is_active=true version)
  → Old version preserved (is_active=false, lineage chain intact)
```

---

## 5) Ensemble mechanics

### How analysts combine

When multiple personality analysts produce outputs for a single run:

1. **Each analyst produces:** `{ direction, confidence, rationale, key_factors, risks }`
2. **Weighted aggregation:** Each analyst's output is weighted by their `default_weight` (or `weight_override` if instrument-specific)
3. **Arbitrator receives:** All analyst outputs as structured input, plus shared context
4. **Arbitrator produces:** Final consensus call with `consensus_notes` explaining agreement/disagreement

### Weight semantics

- `1.0` = standard influence
- `> 1.0` = more influence (e.g., Aggressive Alex at 1.10 — slightly more voice)
- `< 1.0` = less influence (e.g., Cautious Carl at 0.90 — slightly less voice, but still heard)
- `0.1` = minimal influence (included but barely counts)
- Weights are relative, not absolute — a 1.0 among other 1.0s is equal; a 1.0 among 2.0s is half influence

### What the arbitrator sees

The arbitrator prompt includes:
- Each analyst's name, perspective summary, direction call, confidence, rationale
- The analyst's weight (so the arbitrator understands relative influence)
- Areas of agreement and disagreement
- Shared context (risk state, active predictors)

The arbitrator is not a personality analyst — it's a synthesis engine. It doesn't have opinions; it has judgment about which opinions are best supported.

---

## 6) Tenant differentiation story

This is how the demo narrative works with 3 orgs:

### Alpha Capital (aggressive growth)
- Defaults: Fred enabled, Tina enabled, Sally enabled, **Alex enabled (weight bumped to 1.30)**, Carl **disabled**
- Custom: "Momentum Maria" — breakout specialist with high conviction
- Result: Aggressive calls, higher confidence, momentum-driven

### Steadfast Advisors (conservative value)
- Defaults: **Fred enabled (weight bumped to 1.20)**, Tina enabled, Sally enabled, Alex **disabled**, **Carl enabled (weight bumped to 1.20)**
- Custom: "Value Victor" — deep value with margin-of-safety focus
- Result: Conservative calls, emphasis on fundamentals and downside protection

### Apex Quant (quantitative/technical)
- Defaults: Fred **disabled**, **Tina enabled (weight bumped to 1.30)**, Sally enabled, Alex enabled, Carl enabled
- Custom: "Quant Quinn" — statistical patterns and mean reversion, "Macro Max" — central bank and rates focused
- Result: Technically driven calls, macro-informed, less emphasis on fundamentals

**Same instruments. Same articles. Same risk dimensions. Different analyst packs. Different predictions.** That's the product.

---

## 7) Relationship to risk system

Risk analysis uses a different mechanism than predictions:

- **Risk dimensions** (market, fundamental, technical, macro) each get their own LLM analysis
- **Context providers** can feed into dimension prompts (a sector-specific context provider enriches the fundamental dimension for that sector)
- **The debate system** (blue/red/arbiter) is independent of the analyst roster
- **But:** personality analysts can be scoped to risk workflow (e.g., Cautious Carl's perspective is valuable in risk assessment)

For risk runs with `workflow_scope = risk` or `both`:
- Personality analysts contribute per-dimension commentary alongside the dimension analyzer
- Their perspectives inform the debate agents
- The composite score aggregation uses dimension weights, not analyst weights

---

## 8) What we are NOT doing (yet)

- **Three-way fork model** (user/AI/arbitrator contexts per analyst) — deferred. Adds complexity. The learning system's config versioning provides a simpler path to the same goal.
- **P&L-driven motivation** (virtual portfolios, probation, suspension) — deferred. Cool feature, not needed for Phase 1 demo.
- **Full scope hierarchy** (runner/domain/universe/target) — deferred. We have `instrument-specific` vs `general` assignment, which covers the Phase 1 need. Full hierarchy added when we expand to multiple domains.
- **Agent self-adaptation** (analysts modifying their own context) — deferred to Tier 1 learning system. The analyst doesn't modify itself; the learning engine proposes changes on its behalf.

---

## 9) Open questions

- Should context providers be seeded per org like personalities, or are they created on-demand?
- Should there be a maximum analyst count per instrument (cost control)?
- When a tenant modifies a default analyst, should the UI show "based on Fundamental Fred" or treat it as a new entity?
- Should analyst weights be normalized before ensemble (so total always equals a fixed value) or left as raw relative values?

---

## 10) Revision history

| Date | Change |
|------|--------|
| 2026-03-31 | Initial analyst system design authored. |
