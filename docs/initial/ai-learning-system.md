# AI Learning System — Design Intent

## 1) Purpose

This document defines the learning and self-improvement system for Divinr AI. The system enables analysts to improve autonomously within governed boundaries, using a canonical test framework to prevent regressions and overfitting.

It complements:

- `high-level-PRD.md` — product framing (differentiator: continuous system improvement)
- `phase-1-prd.md` — FR-5 evaluation and replay requirements
- `markets-orchestration-roadmap.md` — orchestration pipeline that learning wraps around

---

## 2) Problem

In the prior orchestrator-ai-enterprise system, the learning loop was primarily human-driven. A human reviewed missed opportunities, proposed context changes, tested them, and promoted learnings manually. This approach:

- Bottlenecks improvement velocity on human availability
- Scales poorly as analyst count and instrument coverage grow
- Biases toward recent failures (recency bias in what gets reviewed)
- Doesn't systematically prevent regressions when changes are made

The goal is to shift the balance: AI proposes, tests, and validates improvements autonomously. Humans govern the boundaries and approve strategic changes.

---

## 3) Core concept: Canonical test days

Rather than replaying every historical day (prohibitively expensive), the system maintains a **curated set of canonical test scenarios** — specific days where analyst behavior was meaningfully tested.

### What makes a day canonical

A day enters the canonical set when:

- An analyst confidently predicted the wrong direction
- Risk assessment missed a dimension that turned out to matter
- The analyst's context was demonstrably insufficient for what happened
- Market conditions were atypical enough to stress-test the persona
- An arbitrator override was needed to correct a strong analyst consensus

### What a canonical day captures (frozen snapshot)

| Field | Description |
|-------|-------------|
| `date` | The actual market date |
| `instrument_id` | Which instrument was involved |
| `analyst_config_snapshot` | The analyst persona, prompt, and context version at that time |
| `articles_snapshot` | The articles available to the system that day (titles, summaries, source, published_at) |
| `predictor_state_snapshot` | Active predictors and their relevance scores at time of run |
| `risk_analysis_snapshot` | **Full risk output**: per-dimension scores, composite score, debate result (blue/red/arbiter), debate adjustment. This is critical — risk analysis is a primary input to prediction prompts, so it must be frozen for prediction replay. |
| `risk_config_snapshot` | The risk dimension weights, system prompts, and debate context versions active that day (needed for risk-side replay) |
| `actual_outcome` | What the market actually did (direction, magnitude, timeframe) |
| `original_prediction` | What the system predicted (per-analyst + arbitrator outputs) |
| `original_risk_assessment` | What the risk system produced (for risk-side canonical testing) |
| `failure_classification` | Why this day is canonical (context gap, persona limitation, signal miss, risk dimension gap, debate blind spot, etc.) |
| `test_scope` | Which replay loops this day is relevant for: `prediction`, `risk`, or `both` |
| `added_at` | When this day was added to the canon |
| `is_active` | Whether this day still differentiates (not retired) |

### Canonical set lifecycle

- **Addition:** When a new meaningful failure occurs, the day is captured and added. This can be triggered by evaluation (actual vs predicted mismatch with high confidence) or by human review.
- **Retirement:** When every current analyst configuration handles a canonical day correctly, it can be retired (marked inactive). It remains in history but is no longer part of the active test suite.
- **Target size:** 6–15 active canonical days per instrument. Enough to constrain, not so many that testing becomes expensive.

---

## 4) Nightly autonomous evaluation cycle

The system runs a fully autonomous evaluation job at midnight (or market close + buffer). No human involvement required. This is the engine that feeds the tiered learning model.

### Multi-horizon evaluation windows

A single "right or wrong" evaluation is insufficient. Market moves play out over different timeframes. A prediction that looks wrong at 1 day may be correct at 3 days (the analyst was directionally right but early). A prediction that looks right at 1 day may reverse by 5 days (the analyst caught a short-term move but missed the reversal).

**Three evaluation windows per prediction:**

| Window | Evaluates predictions from | What it measures |
|--------|---------------------------|-----------------|
| **1-day** | Yesterday | Immediate directional accuracy. Fast feedback signal. |
| **3-day** | 3 days ago | Medium-term thesis validation. Catches "early but correct" patterns. |
| **5-day** | 5 days ago | Final verdict. If wrong at all three horizons, this is a real miss. |

Each prediction accumulates up to 3 evaluation records over its lifetime. The evaluation profile across horizons tells a different story than any single window:

| Pattern | Interpretation | Learning signal |
|---------|---------------|----------------|
| Right at 1d, 3d, 5d | Strong call | Reinforce — this analyst's approach worked |
| Wrong at 1d, right at 3d and 5d | Thesis correct, timing early | Adjust confidence/horizon, not direction logic |
| Right at 1d, wrong at 3d and 5d | Caught short-term move, missed reversal | Analyst may be over-indexing on momentum |
| Wrong at all three | Real miss | Canonical day candidate — investigate root cause |

### Nightly job structure

```
Midnight run (fully autonomous):

  PHASE 1 — Evaluate
    1. Pull all predictions where:
       - created 1 day ago AND not yet evaluated at 1-day window
       - created 3 days ago AND not yet evaluated at 3-day window
       - created 5 days ago AND not yet evaluated at 5-day window
    2. Fetch actual market data (close price, direction) for each window
    3. Score each: correct / incorrect / partial at each horizon
    4. Persist evaluation records with horizon metadata

  PHASE 2 — Profile
    5. Build rolling performance profile per analyst per instrument:
       - Accuracy at each horizon (last 7 days, 30 days, all-time)
       - Confidence calibration (are high-confidence calls more accurate?)
       - Systematic biases (always early? always bullish? blind to reversals?)
    6. Build risk assessment profile:
       - Did risk scores predict actual volatility?
       - Were debate adjustments helpful or noise?

  PHASE 3 — Propose (Tier 1 autonomous)
    7. Identify systematic patterns (not one-off misses)
    8. Propose micro-adjustments (confidence calibration, evidence weighting)
    9. Run proposals against canonical test set
    10. If passed: auto-apply to paper mode
    11. If any "wrong at all horizons + high confidence": flag as
        canonical day candidate for review

  PHASE 4 — Report
    12. Generate nightly summary (available in dashboard next morning):
        - Evaluations completed (by horizon)
        - Analyst accuracy trends
        - Adjustments proposed and their test results
        - Canonical day candidates flagged
        - Paper mode promotions/demotions
```

### Evaluation windows are configurable

The 1/3/5 day windows are defaults. Tenants can configure their own evaluation horizons based on their trading strategy:

- Day trader: 4-hour, 1-day, 3-day
- Swing trader: 1-day, 3-day, 5-day (default)
- Position trader: 3-day, 7-day, 14-day

The system supports arbitrary horizon configurations per organization.

---

## 5) Tiered learning model (informed by nightly evaluation)

### Tier 1 — Autonomous micro-adjustments (nightly)

**What:** Low-risk calibration changes that don't alter the analyst's fundamental character.

**Examples:**
- Confidence calibration (analyst consistently overconfident → reduce by 10%)
- Evidence weighting emphasis (macro signals underweighted this week)
- Prompt phrasing refinements (more specific instruction for ambiguous scenarios)

**Process:**
1. Nightly evaluation: compare today's predictions against outcomes
2. Identify systematic patterns (not one-off misses)
3. Propose micro-adjustment
4. Run proposed change against canonical test set
5. If no regressions on canonical days AND improvement on today: **auto-apply in paper mode**
6. Paper mode runs alongside production for N days
7. If paper mode outperforms production over the paper period: **auto-promote**

**Governance:** Changes are logged. Tenant admin can review and revert. Adjustments are bounded (e.g., confidence shift max ±15% per cycle).

### Tier 2 — Supervised experimentation (weekly)

**What:** Larger changes that could meaningfully alter analyst behavior.

**Examples:**
- Adding a new emphasis area to an analyst's persona prompt
- Changing how an analyst weighs risk context vs. predictor signals
- Proposing a new canonical day based on the week's failures
- Adjusting dimension weights in risk scoring

**Process:**
1. Weekly review: aggregate the week's performance across all analysts
2. AI proposes changes with rationale ("Analyst X missed 3 bearish signals this week because persona doesn't emphasize sell-off patterns")
3. Run proposed changes against canonical test set
4. Generate a report: improvement on target scenarios, regression risk on canonical days, confidence assessment
5. Report goes to **review queue** — AI recommends, human approves/rejects
6. Approved changes enter paper mode before production

**Governance:** Human approval required. Full audit trail of what was proposed, why, and what the canonical test results showed.

### Tier 3 — Strategic re-evaluation (monthly or triggered)

**What:** System-level questions about the analyst portfolio.

**Examples:**
- Are analysts converging too much? (diversity check)
- Should a new analyst persona be created to cover a gap?
- Is the contrarian analyst actually providing differentiation value?
- Should a risk dimension be added, removed, or reweighted?
- Is the arbitrator consistently overriding one analyst? (that analyst may need retirement or redesign)

**Process:**
1. Monthly (or triggered by significant market event): holistic portfolio analysis
2. AI generates a "state of the system" report with recommendations
3. Human reviews and decides strategic direction
4. Changes are implemented as new analyst versions or dimension configs

**Governance:** Fully human-directed. AI informs, human decides.

---

## 6) Canonical test execution

### How a change is tested

There are two distinct replay loops depending on what's being changed:

**Prediction replay** (testing analyst config changes):
- Freeze: articles, predictors, risk analysis output
- Vary: analyst persona/prompt/config
- Evaluate: did the prediction improve against actual outcome?

**Risk replay** (testing risk dimension/debate changes):
- Freeze: articles, predictor state
- Vary: risk dimension weights, system prompts, debate context
- Evaluate: did the risk output improve? Would the changed risk context have improved downstream predictions?

**Execution steps:**

1. Load the canonical test set for the relevant instrument(s), filtered by `test_scope`
2. For each canonical day:
   a. Restore the frozen snapshot appropriate to the replay type
   b. Run the **modified** config against that snapshot
   c. Compare output (direction, confidence, rationale) against:
      - The actual outcome (did it get closer to correct?)
      - The original prediction/risk assessment (did it change meaningfully?)
      - Other canonical days (did it regress anywhere?)
3. Score the change:
   - **Improvement count:** How many canonical days improved?
   - **Regression count:** How many canonical days got worse?
   - **Net score:** Improvements minus regressions
   - **Severity:** Did any regression flip a correct call to incorrect?
4. Decision rules:
   - Any severity regression (correct → incorrect) = **block**
   - Net score ≤ 0 = **reject**
   - Net score > 0, no severity regressions = **pass** (eligible for promotion)

### Cost model

With 7-10 canonical days per instrument and 5 instruments:
- One analyst change = ~35-50 LLM calls for canonical validation
- Nightly micro-adjustments across 3 analysts = ~100-150 LLM calls
- Using a smaller/cheaper model for canonical replay (not the production model) further reduces cost
- This is tractable — roughly equivalent to 1-2 full prediction runs

---

## 7) Data model implications

### New tables needed

```
prediction.prediction_horizon_evaluations
  id, prediction_id, run_id, organization_slug, instrument_id,
  analyst_id, horizon_window (1|3|5 or custom),
  prediction_date, evaluation_date,
  predicted_direction, actual_direction, actual_close_price,
  was_correct boolean, confidence_at_prediction,
  created_at

prediction.analyst_performance_profiles
  id, analyst_id, organization_slug, instrument_id,
  horizon_window, period (7d|30d|all),
  accuracy_rate, avg_confidence, calibration_score,
  systematic_biases jsonb, sample_size,
  computed_at

prediction.canonical_test_days
  id, instrument_id, organization_slug, canonical_date, failure_classification,
  articles_snapshot jsonb, predictor_state_snapshot jsonb, risk_context_snapshot jsonb,
  analyst_config_snapshot jsonb, original_prediction jsonb, actual_outcome jsonb,
  is_active, added_at, retired_at, added_by

prediction.learning_proposals
  id, organization_slug, tier (1|2|3), analyst_id, instrument_id,
  proposal_type, description, rationale, proposed_change jsonb,
  canonical_test_results jsonb, net_score, has_severity_regression boolean,
  status (proposed|testing|passed|failed|approved|rejected|applied|reverted),
  proposed_at, tested_at, reviewed_by, reviewed_at, applied_at

prediction.analyst_config_versions
  id, analyst_id, organization_slug, version_number,
  persona_prompt, config_overrides jsonb,
  source (manual|tier1_auto|tier2_approved|tier3_strategic),
  parent_version_id, canonical_test_score,
  is_active, created_at, created_by
```

### Relationship to existing schema

- `market_analysts` gains a `current_config_version_id` reference
- `market_predictions` gains a `config_version_id` to track which analyst version produced it
- `market_run_evaluations` feeds the nightly learning cycle
- Canonical days reference `instruments` and `market_articles`

---

## 8) Interaction with tenant control

Divinr's core differentiator is **client-controlled analysts**. The learning system must respect this:

- Tenants can **enable/disable** autonomous learning per analyst
- Tenants can **set boundaries** (max confidence adjustment, locked persona aspects)
- Tenants can **review and revert** any auto-applied change
- Tenants choose their tier 2 review cadence
- Tier 3 strategic changes always require tenant approval
- Canonical test days can be added by the tenant (not just by system detection)

The learning system improves the platform; it does not override the client's control.

---

## 9) The process vs. exploration question

The system supports both approaches:

**Process (structured):** Tiers 1-3 provide a governed improvement pipeline with clear gates, audit trails, and regression prevention via canonical tests.

**Exploration (generative):** Within tier 1, the AI can freely explore micro-adjustments — it's not constrained to human-imagined improvements. It can discover calibration patterns, evidence weightings, and prompt refinements that a human wouldn't think to try. The canonical test set acts as the safety net: explore freely, but prove you haven't broken anything.

The canonical test framework is what makes exploration safe. Without it, you either don't explore (human bottleneck) or you explore without guardrails (regression risk). With it, you get the velocity of AI exploration with the safety of structured validation.

---

## 10) Implementation phasing

| When | What |
|------|------|
| **Sprint 1 (schema)** | Add `canonical_test_days`, `learning_proposals`, `analyst_config_versions`, `prediction_evaluations` (multi-horizon) tables |
| **Sprint 2-3 (risk + prediction)** | Multi-horizon evaluation records during run evaluation; canonical day capture on "wrong at all horizons" |
| **Sprint 4** | Nightly evaluation job: Phase 1 (evaluate at 1d/3d/5d windows) + Phase 2 (analyst profiling) |
| **Sprint 5** | Canonical test execution engine (replay a change against the canonical set) |
| **Sprint 6** | Nightly job Phase 3 (Tier 1 autonomous proposals → canonical test → paper mode) + Phase 4 (reporting) |
| **Later** | Tier 2 weekly reports + review queue; Tier 3 strategic analysis |

---

## 11) Open questions

- What is the right paper mode duration before auto-promotion? (3 days? 5 days? configurable per tenant?)
- Should canonical days be shared across tenants (same instrument, same market event) or tenant-private (each org builds their own test suite)?
- How do we handle canonical days for instruments that are newly added (no history)?
- What smaller/cheaper model is appropriate for canonical replay validation?
- Evaluation horizon defaults are 1/3/5 days — should there be a maximum configurable horizon?
- How do we source actual market close data for evaluation? (external API, manual entry, or both?)

---

## 12) Revision history

| Date | Change |
|------|--------|
| 2026-03-31 | Initial design intent authored. |
| 2026-03-31 | Added nightly autonomous evaluation cycle with multi-horizon windows (1d/3d/5d). Added risk analysis snapshot to canonical days. |
