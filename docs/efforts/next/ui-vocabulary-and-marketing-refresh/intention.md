# Effort: UI Vocabulary + Marketing Refresh

## Background

Two related problems have accumulated:

1. **User-visible copy still says "prediction" everywhere.** That word implies foresight and can be construed as a recommendation by a regulator or a misinformed user. The system does not predict — it analyzes, surfaces signal, and captures reasoning. The legal-language rule has always been "analysis/signal, never advice/recommendation," but "prediction" has been treated as a safe technical term. Tightening this up closes the remaining ambiguity.
2. **Marketing copy is stale.** The last week has shipped a lot (prediction-to-trade-intent, performance attribution, cost-modeling-system, slot-based enablement, all six architecture restructures, club polish, live intraday P&L, etc.). The landing page, hero copy, feature inventory, and personas don't reflect the current product.

Both problems want the same audit pass: sweep every user-visible string, reconcile vocabulary, and refresh marketing simultaneously. Doing them as one effort avoids a two-pass churn on the same files.

## Problem

- "Prediction" is everywhere in user-visible copy (267 web occurrences across 47 files as of 2026-04-19, plus API response field names that flow into the UI and marketing pages).
- Disclaimers are inconsistent and don't explicitly state that the system is not a prediction model — they rely on the reader to infer the limitation from the "paper trading" framing.
- Landing page, hero copy, and feature inventory describe a product that's a week or two older than what shipped, so marketing undersells current capability.

## Intention

Do a single user-facing-copy audit pass with two coordinated goals:

1. **Replace "prediction" (and variants like "predicted," "predictor") with "analysis," "signal," or equivalents** wherever the user sees them — UI labels, headings, tooltips, error messages, emails, marketing copy, landing page.
2. **Refresh the marketing surface** to accurately reflect current product capability — landing page, feature inventory, hero copy, personas.

Tighten disclaimers explicitly: "Divinr analyzes markets and captures reasoning — this is not a prediction model, and nothing here is investment advice."

## Scope

### 1. UI Copy Sweep (user-visible strings only)

- Every Vue template, every `.ts`/`.vue` string literal that renders to the DOM, every email template, every notification message
- Route labels and breadcrumb text (but not route paths themselves — those stay as-is)
- Tooltips, empty states, error messages, loading states
- Modal titles, button text, segment labels, chip labels

**Explicitly out of scope at this layer:**
- Code identifiers (variable names, type names, store names, function names)
- API response field names or request body keys
- Route URLs (`/predictions` stays; the label in the nav is what changes)
- DB schema and table names

Internal vocabulary stays `prediction.*` — it's the domain name we've always used in code, and renaming it is pure churn for zero user benefit. A future effort can tackle that layer if desired; this one does not.

### 2. Disclaimer Tightening

Every disclaimer surface audited and rewritten to include explicit "this is analysis, not a prediction model, not investment advice" language:

- Trade-intent CTA disclaimers (prediction-to-trade-intent feature)
- Tournament trade form disclaimers
- Landing page footer
- Terms of Service page (TermsOfServiceView)
- Any onboarding/welcome-modal copy that describes the system's purpose

Disclaimer template is centralized if it isn't already — probably a shared component or composable — so tightening is one edit, not twenty.

### 3. Marketing Copy Refresh

- Landing page hero and feature sections rewritten to reflect post-architecture capability: triple model, user-authored content, slot-based enablement, per-item authorship, custom-to-base graduation vision, performance attribution, live intraday P&L, club/tournament polish
- Feature inventory document refreshed (or created, per `project_feature_inventory.md` memory which has asked for this) — this also doubles as the seed list for onboarding first-touch content and marketing testing
- Personas updated if the user's actual beta cohort behavior has diverged from the originals (St. Thomas students, golfergeek-type builders, etc.)
- Hero copy: consider a "Divinr analyzes, not predicts" tagline angle — leans into the vocabulary tightening as a marketing differentiator

### 4. Memory + Documentation Reconciliation

- Update `project_legal_language.md` memory: new rule is "use 'analysis' or 'signal', never 'prediction' or 'advice' or 'recommendation' in user-visible copy"
- Note in the memory that code/DB/API identifiers are exempt
- Any other docs referencing "prediction model" or equivalent user-facing-sounding phrases get reconciled

## Success Criteria

- Zero user-visible occurrences of "prediction," "predicted," "predictor," or equivalents in the rendered UI (admin/internal debug surfaces are acceptable if needed)
- Every disclaimer surface explicitly states "not a prediction model" and "not investment advice"
- Landing page reflects every capability shipped through the date of this effort's completion
- Feature inventory document exists and covers the product comprehensively
- The `project_legal_language.md` memory reflects the tightened rule

## Out of Scope

- Renaming code identifiers, API field names, route paths, or DB schema (would be a separate, larger, mostly-invisible-to-users effort)
- Building a full marketing site, pricing page polish, or sign-up funnel work
- Translation / i18n
- Multi-language support
- SEO or meta tag overhaul beyond what the landing page refresh naturally touches

## Dependencies

None. Can ship at any time independent of other efforts.

## Open Questions for PRD Phase

- Is there a single disclaimer component or composable that disclaimers funnel through? If not, probably worth creating one as part of this effort so the tightening is durable
- Should the word "prediction" remain in admin debug surfaces (logs viewer, LLM usage dashboard, cost-modeling dashboard) where it's closer to internal vocabulary, or swept everywhere consistently?
- Feature inventory format — bulleted markdown doc in `docs/`, Notion page, landing-page content source-of-truth, all three?
- Personas: are they worth updating at all, or is the current "St. Thomas students + builders" framing enough for now?

---

*Drafted after onboarding-tour-extended planning surfaced that (a) the surface inventory was the seed for a marketing refresh anyway and (b) "prediction" everywhere in user-facing copy was a legal-language gap worth closing. Combined into one effort because the sweeps share files.*
