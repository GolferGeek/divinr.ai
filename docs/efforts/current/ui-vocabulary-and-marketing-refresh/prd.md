# UI Vocabulary + Marketing Refresh — Product Requirements Document

## 1. Overview

Two user-facing-copy problems have accumulated and share the same files, so they ship together as one audit pass:

1. **"Prediction" vocabulary leak.** ~127 user-visible occurrences of "prediction" / "predicted" / "predictor" across ~50 `.vue` / `.ts` files in `apps/web/src`. The word implies foresight and can be construed as a recommendation. The system does not predict — it analyzes and surfaces signal. The legal-language rule has always been "analysis/signal, never advice/recommendation," and "prediction" closes the last remaining ambiguity.
2. **Stale marketing surface.** Landing page, feature cards, ToS, and the `what-divinr-can-do.md` feature doc predate the last ~2 weeks of shipped capability (onboarding tour v2, DMs, live intraday P&L, entity-level attribution, tournament avatar stack, leaderboard rank deltas, club activity unread badges, prediction-to-trade-intent, cost-modeling system).

This effort sweeps every user-visible string once, reconciles vocabulary, centralizes disclaimers, and refreshes marketing — all on the same traversal of the same files. Internal code identifiers (store names, types, API field names, DB schema, route paths) stay `prediction.*` — renaming them is churn for zero user benefit and explicitly out of scope.

## 2. Goals & Success Criteria

### Goals

1. Zero user-visible occurrences of "prediction," "predicted," or "predictor" in the rendered web UI (outside admin/debug surfaces — see §6).
2. Every disclaimer surface explicitly states "analysis, not a prediction model, not investment advice" — via one shared component/composable so future tightening is a one-line edit.
3. Landing page and feature inventory accurately reflect every capability shipped through effort completion.
4. A persistent feature-inventory document exists in `docs/` as the single source of truth for marketing copy, onboarding seed content, and regression-test checklists.
5. Legal-language memory (`project_legal_language.md`) updated to reflect the tightened rule and exemptions.

### Success Criteria (measurable)

- `grep -i 'predict' apps/web/src/**/*.{vue,ts}` returns only: (a) code identifiers (type/variable/function/store names), (b) import paths, (c) route paths, (d) API request/response shape keys, (e) admin/debug surfaces explicitly listed in §6. The grep check is scripted and produces a clean diff from baseline.
- Every disclaimer surface (§4.4 inventory) renders via `<LegalDisclaimer>` component or `useLegalDisclaimer()` composable. Inline disclaimer copy is purged except where the central component cannot reach (e.g., backend-rendered email templates, which get the same text but must be audited manually).
- `docs/what-divinr-can-do.md` and `apps/web/src/views/LandingView.vue` both enumerate every capability from the §4.5 inventory. Landing-page feature cards pull from or mirror the same inventory.
- `project_legal_language.md` memory contains the tightened rule ("analysis/signal, never prediction/advice/recommendation in user-visible copy; code/DB/API identifiers exempt") and is dated.
- Onboarding first-touch content in `apps/web/src/onboarding/surface-content.ts` contains zero `prediction|predicted|predictor` strings in titles or bodies (surface keys themselves, like `prediction.card`, stay — they're internal routing keys, not rendered text).
- Optional (nice-to-have, §8 Phase 5): an ESLint or script-based gate catches new `prediction` appearances in Vue templates / user-visible string literals in PRs.

## 3. User Stories / Use Cases

- **Prospective user visiting the landing page** sees hero copy that says "Divinr analyzes markets — we don't predict them" and feature cards that describe the product's actual current capabilities (tours, DMs, clubs, tournaments, live P&L, per-analyst attribution, custom analysts, triple-slot enablement). Not "multi-analyst predictions" framing from six weeks ago.
- **Beta tester opening an analyst modal** sees "Analysis" and "Trade this analysis" instead of "Prediction" and "Trade this prediction," with a disclaimer below the CTA that says "Divinr provides analysis and signal, not a prediction model, and nothing here is investment advice."
- **Beta tester reviewing performance dashboards** sees "Analyses evaluated" / "Analyses contributed" column headers, same data underneath.
- **Claude reading the `project_legal_language.md` memory in a future conversation** finds an explicit rule it can apply without re-deriving from context: "analysis/signal in user-visible copy; code identifiers exempt; disclaimers via `<LegalDisclaimer>`."
- **Regulator or legal reviewer skimming the app** finds no copy that implies predictive guarantees; disclaimers consistently frame Divinr as analysis, not advice.
- **Future effort author writing marketing copy** opens `docs/features.md` (the new inventory) and finds the current authoritative capability list in one place rather than stitching it together from `what-divinr-can-do.md`, `LandingView.vue`, and five archived effort PRDs.

## 4. Technical Requirements

### 4.1 Architecture

**No new services, no DB changes, no API-shape changes.** This is a copy-audit effort with two small architectural additions inside `apps/web`:

- **`<LegalDisclaimer>` component** at `apps/web/src/components/LegalDisclaimer.vue` — renders the canonical disclaimer text with variant props (`variant: 'short' | 'full' | 'trade-cta' | 'tournament'`) so different surfaces can use appropriate length/emphasis while sharing the same underlying copy source.
- **`useLegalDisclaimer()` composable** at `apps/web/src/composables/useLegalDisclaimer.ts` — exposes the same canonical strings for consumers that need the text outside a template context (e.g., a modal that composes its own layout, a toast that needs to quote part of the disclaimer).

Both read from a single source-of-truth constants file: `apps/web/src/onboarding/disclaimers.ts` (new file, co-located with `surface-content.ts` since both are editorial content).

### 4.2 Data Model Changes

None.

### 4.3 API Changes

None. API response field names (`prediction_id`, `predictions[]`, etc.) remain unchanged — the UI renames are display-layer only, mapping API fields to user-facing labels at the template level.

### 4.4 Frontend Changes

#### 4.4.1 Vocabulary Dictionary

A canonical mapping file at `docs/efforts/current/ui-vocabulary-and-marketing-refresh/vocabulary.md` documents the agreed translations so the sweep is consistent:

| Old term | New term | Notes |
|---|---|---|
| Prediction (noun) | Analysis | "Today's analyses," "View all analyses" |
| Prediction (as a single-card unit) | Analysis or Signal | Context-dependent — "this signal" for conviction-laden language, "this analysis" for descriptive |
| Predicted (adj) | Analyzed / Projected | "Projected return" (not "predicted return") |
| Predictor (scoring agent) | Analyst / Signal scorer | "AI Analyst Scoring" replaces "AI Predictor Scoring" |
| Prediction model | Analysis engine | In disclaimers: "not a prediction model" stays as-is because that's the literal disclaimer language |
| Prediction history | Analysis history | |
| Trade this prediction | Trade this signal | Trade-CTA copy |

#### 4.4.2 User-Visible Copy Sweep

Files with highest user-visible impact (from research — not exhaustive, sweep is file-by-file):

- `apps/web/src/views/AnalystPerformanceView.vue` (41 matches)
- `apps/web/src/components/AnalystPredictionModal.vue` (25 matches) — component filename stays; only rendered strings change
- `apps/web/src/components/PredictorScoringPanel.vue` — rendered strings only
- `apps/web/src/views/DashboardView.vue`
- `apps/web/src/components/InstrumentAnalystPanel.vue`
- `apps/web/src/components/CalibrationChart.vue`
- `apps/web/src/views/LandingView.vue` (covered by §4.4.4 marketing refresh)
- `apps/web/src/views/PredictionsView.vue` — page title and filter labels
- `apps/web/src/components/MemberProfileDrawer.vue`
- `apps/web/src/components/DailyAnalystSummary.vue`
- `apps/web/src/views/CanonicalDayDetailView.vue`
- `apps/web/src/views/OnboardingSettingsView.vue`
- `apps/web/src/views/SourceQualityView.vue`
- `apps/web/src/views/AttributionAdminView.vue` — admin view, see §6 for exemption rules
- `apps/web/src/components/messaging/AttachmentPicker.vue`
- Onboarding: `apps/web/src/onboarding/surface-content.ts` — title/body strings for `predictions`, `prediction.card`, `prediction.detail`, `prediction.trade-cta`, `authoring.contract-section.predictor-generation`, `authoring.contract-section.prediction-generation`, and the coordination-section note

Sweep scope includes:
- Vue template text nodes
- Vue template attributes that render to DOM (`aria-label`, `title`, `alt`, `placeholder`)
- `.ts` / `.vue` string literals used in user-visible contexts: toast messages, error messages, loading states, empty states, chart legend labels, chip/segment labels
- Onboarding surface-content titles and bodies
- Notification/toast content strings
- Route labels and breadcrumb text in `router/index.ts` (labels only — paths stay)

Explicitly NOT touched:
- Component filenames (e.g., `AnalystPredictionModal.vue` stays — filename is code)
- Store names (`predictions.store.ts`, `predictors.store.ts`)
- Type/interface names, variable names, function names, composable names
- API request/response keys (the UI maps them to user-facing labels at render)
- Route paths (`/predictions` stays; the nav label changes)
- Code comments
- Test fixture data
- Telemetry / observability event names (e.g., `prediction-to-trade-intent cta_navigated`) — these are code-facing, not user-visible

#### 4.4.3 Centralized Disclaimer Component

**`<LegalDisclaimer>`** — new component at `apps/web/src/components/LegalDisclaimer.vue`.

Props:
- `variant: 'short' | 'full' | 'trade-cta' | 'tournament'` (default: `'short'`)
- `class?: string` — pass-through for styling

Canonical text (source: `apps/web/src/onboarding/disclaimers.ts`):

- `short` — "Divinr analyzes markets and surfaces signal. Not a prediction model, not investment advice."
- `full` — "Divinr provides AI-generated analysis and signal for educational and research purposes. This is not a prediction model, and nothing here is investment, financial, or trading advice. All trades shown are paper trades unless explicitly stated."
- `trade-cta` — "This is a paper-trade signal, not investment advice. Divinr analyzes markets — it is not a prediction model."
- `tournament` — "Tournament positions are paper trades. Divinr analyzes markets and surfaces signal — this is not investment advice or a prediction model."

Wire-through targets (replace inline disclaimer strings):
1. `apps/web/src/views/LandingView.vue` footer
2. `apps/web/src/views/TermsOfServiceView.vue` intro / §2 / §5 — the ToS keeps its long-form legal language but the opening and key sections cite `<LegalDisclaimer variant="full">` for the canonical statement, so future tightening propagates
3. `apps/web/src/components/AnalystPredictionModal.vue` — below the "Trade this signal" CTA (`variant="trade-cta"`)
4. Tournament trade form — research did not find a dedicated tournament-trade form component in `apps/web/src`. Phase 3 begins by locating wherever the tournament trade CTA renders (likely `TournamentDetailView.vue` or a sub-component under `apps/web/src/views/tournament*`). If no single form exists, the `tournament` variant renders adjacent to the trade CTA on the tournament detail surface.
5. `apps/web/src/onboarding/surface-content.ts` — `settings.terms` body uses the `short` variant text verbatim (composable or imported constant, not `<component>` since surface-content is a plain TS data file)
6. `welcome-modal` onboarding surface — uses `short` variant text

#### 4.4.4 Marketing Refresh

**`apps/web/src/views/LandingView.vue`:**

- Hero tagline angle: "Divinr analyzes markets — we don't predict them." (Drafted direction from intention; copy to be finalized during Phase 4.)
- Feature cards rewritten to reflect current capability set (see §4.5 inventory). Targeted 10–14 cards total, grouped: Analysts & Signal / Learning & Explainability / Social (Clubs, Tournaments, Messaging) / Author Your Own / Platform.
- "How it works" section: update 4 steps to use "analyze / debate / you decide / system learns" vocabulary.
- Footer: `<LegalDisclaimer variant="full">`.

**`docs/what-divinr-can-do.md`:**

- Vocabulary sweep (same rules as §4.4.2).
- Add sections / bullets for shipped-since-last-update capabilities: onboarding tour v2, first-touch walkthroughs, DMs, tournament avatar stacks, leaderboard rank deltas, club activity unread counts, intraday P&L, entity-level attribution, signal-to-trade-intent flow (user-visible CTA copy; internal effort name stays `prediction-to-trade-intent`), cost-modeling system.
- This doc is NOT the source of truth anymore — see `docs/features.md` below. This doc becomes a narrative / explainer companion.

**`docs/features.md` (NEW):**

- Structured, bulleted feature inventory organized by product area.
- Each feature entry: short name, one-line description, current status (shipped / in progress / planned), pointer to any effort doc.
- This is the source of truth for: landing page feature cards, onboarding seed content, regression test checklist (per `project_feature_inventory.md` memory which explicitly asked for this), and any future marketing copy.

**`docs/personas.md` (NEW, minimal):**

- Minimum viable doc: 2–3 personas reflecting current beta cohort — St. Thomas students (classroom/curriculum flow), builder-type power users (golfergeek archetype — custom analyst authoring, cost-modeling, slot management), casual-curious (paper-trade explorer, clubs browser).
- One paragraph each. Not a full persona exercise — just enough to anchor marketing copy decisions.

### 4.5 Current Capability Inventory (feeds §4.4.4)

Shipped through 2026-04-19 (source: recent effort archives + `what-divinr-can-do.md` + current state):

**Analysis & signal:**
- Five-analyst panel (personality-driven, plus arbitrator + portfolio manager + day trader)
- Reasoning capture on every analysis (explainability loop)
- Calibration drilldown per analyst
- Conviction scoring and debate
- Live intraday P&L on analysis-derived positions

**Learning system:**
- Three-tier learning loop (per-analyst, per-triple, cross-analyst coordination)
- Performance attribution at entity level (per analyst, per instrument, per triple)
- Author retention and graduation-candidate tracking
- Canonical day detail view for replay and evaluation

**Authoring (power users):**
- Custom analyst authoring with contract editor
- Custom instrument authoring
- Triple-slot model (analyst × universe × strategy) with slot-based enablement
- BYO-LLM credentials support
- Per-item authorship with attribution
- Custom-to-base graduation vision

**Social:**
- Investment clubs (discover, create, detail, activity feed with unread badges, mentoring, curriculum, analyst assignments, opt-outs)
- Tournaments (list, detail, trade, leaderboard with rank deltas, my-positions, avatar stacks for entrant previews, invite landing)
- Direct messaging (DMs + club channels with bidirectional block checks)
- Member profile drawer with "Message" CTA

**Onboarding & explainability:**
- First-touch walkthroughs on 66 active surfaces (105 authored incl. deferred)
- 5-beat Beginner Tour
- Welcome modal and settings-driven opt-outs

**Platform:**
- Paper trading throughout
- Background pipelines (local-first LLM, Ollama)
- Triple model with cost-modeling (per-analyst margin analysis)
- LLM usage + cost dashboards (admin)
- Notifications with preference controls
- Auth with invite flow

This list is authoritative for Phase 4 and seeds `docs/features.md`.

## 5. Non-Functional Requirements

- **Performance:** No runtime performance concerns — this is a static-text audit. `<LegalDisclaimer>` should be stateless and cheap to render.
- **Accessibility:** Replaced strings must maintain or improve `aria-label` coverage. Disclaimer text must be readable (not a tiny-font legal dump — the "short" variant is already legible at small sizes).
- **Consistency:** Every disclaimer surface must render text that matches one of the 4 canonical variants in `disclaimers.ts`. Grep for "investment advice" across `apps/web/src` after Phase 3 should find only `LegalDisclaimer.vue`, `disclaimers.ts`, `TermsOfServiceView.vue`, and `surface-content.ts`.
- **Backwards compatibility:** Route paths, stored user preferences, DB schema, and API contracts unchanged — no migration or version bump required. An existing user signing in after the merge sees only cosmetic label changes.
- **Durability (anti-regression):** The central disclaimer component makes future legal-language tightening a one-line change. Optional Phase 5 lint gate prevents new `prediction` from sneaking back in through PRs.
- **First-touch coverage invariant** (per CLAUDE.md): any new surface this effort introduces (`<LegalDisclaimer>` variants that render as modals / drawers / substantial components) must have a `useFirstTouch('<surface-key>')` call and a corresponding `surface-content.ts` entry. `<LegalDisclaimer>` itself is presentational and not a surface — the surfaces that USE it (trade-CTA modal, tournament form, welcome modal) already have their first-touch keys and are not changed by this effort.

## 6. Out of Scope

- Renaming code identifiers: store names (`predictions.store.ts`), type names, variable names, function names, composable names, component filenames.
- Renaming API request/response keys, endpoint paths, or DB tables/columns.
- Renaming route paths (`/predictions` stays; nav label changes).
- Translation / i18n / multi-language support.
- Full marketing-site buildout (pricing page, blog, signup funnel).
- SEO / meta-tag overhaul beyond what landing-page refresh naturally touches.
- **Admin / internal debug surfaces retain "prediction" vocabulary** — these are acceptable exemptions because they surface internal domain terminology to operators, not end users. Specifically exempt:
  - `apps/web/src/views/AttributionAdminView.vue`
  - `apps/web/src/views/admin/*` views
  - LLM usage dashboards
  - Cost-modeling admin views
  - Canonical-day detail view (`CanonicalDayDetailView.vue`) — this view is debug-flavored but may be reachable by non-admin users. Sweep the headings and primary labels per the dictionary; internal-metadata columns and debug-tooling micro-labels may retain domain terminology. Decide per-label during Phase 2 and note ambiguous calls in the completion report.
- Backend email templates (if any) — audit them but defer if they require a backend-deploy cadence that doesn't fit the web-only scope. Note in completion report if deferred.

## 7. Dependencies & Risks

### Dependencies

- None technically — effort ships independently on any branch at any time.
- Coordinates lightly with `apps/web/src/onboarding/surface-content.ts` content authored in onboarding-tour-extended (archived 2026-04-17). The 7 prediction-bearing entries in that file are updated in Phase 2 as part of the sweep.

### Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| UI/UX churn — replaced strings don't fit in original layout (word lengths differ) | Medium | Phase 2 includes a visual-regression check: spin up dev server, click through the top-10 surfaces from §4.4.2, screenshot, compare layout. "Analysis" is same length as "prediction" (8 vs 10 chars) so risk is low, but "analyses" (8) vs "predictions" (11) saves space. Watch for truncation or awkward wrapping in tables and chips. |
| Missed user-visible strings | Medium | Phase 2 ends with a grep-based verification: `grep -ri 'predict' apps/web/src/**/*.{vue,ts}` and manually review every remaining match against the §6 exemption list. Any match not on the exemption list is a bug. |
| Inconsistent translation — different files use "analysis" vs "signal" vs "projection" unpredictably | Medium | §4.4.1 vocabulary dictionary is authoritative. Sweep references it for every decision. Dictionary lives in the effort folder and ships with the PR for reference during review. |
| Disclaimer tightening breaks existing tests | Low | Disclaimer component is new; existing tests don't assert specific disclaimer text (per research — no CI gate exists). Any test asserting old disclaimer strings gets updated in Phase 3. |
| Landing page hero copy needs design review before shipping | Medium | Phase 4 writes copy; if copy needs design input beyond plain text changes, surface that in completion report and defer the visual polish to a follow-up effort. This effort ships the *copy*, not a visual redesign. |
| Feature inventory (`docs/features.md`) drifts immediately after merge as new efforts ship | Medium | Document has a "last updated" date and points to effort archive as the source of truth for shipped features. Future efforts update it as part of Definition of Done. Add a note to CLAUDE.md conventions section during Phase 5. |
| Regulator-sensitive edge case — a rendered string we miss gets pointed to post-launch | Low (current phase is beta) | Beta cohort is small and the legal-language rule is already in place for advice/recommendation. Tightening "prediction" is incremental risk reduction, not a legal precondition. |

## 8. Phasing

### Phase 1 — Foundation: vocabulary dictionary + central disclaimer component

**Deliverables:**
- `docs/efforts/current/ui-vocabulary-and-marketing-refresh/vocabulary.md` — the translation dictionary from §4.4.1.
- `apps/web/src/onboarding/disclaimers.ts` — canonical disclaimer text constants (4 variants).
- `apps/web/src/components/LegalDisclaimer.vue` — presentational component.
- `apps/web/src/composables/useLegalDisclaimer.ts` — composable exposing the same strings.
- Unit test (if test harness exists for simple components) verifying each variant renders expected text.

**Validation:** Component renders all 4 variants in a throwaway story/route. No other code touched yet — ships as a net-additive change.

### Phase 2 — UI copy sweep

**Deliverables:**
- All files in §4.4.2 updated per the vocabulary dictionary.
- `apps/web/src/onboarding/surface-content.ts` title/body strings updated (7 affected entries).
- Route labels in `apps/web/src/router/index.ts` updated.
- Grep verification script run and output attached to PR: `grep -rniE 'predict(ion|ed|or)' apps/web/src` — every remaining match is on the §6 exemption list.

**Validation:** Dev server spun up. Click through top-10 surfaces (dashboard, analyses list, analysis modal, instrument detail, analyst performance, landing page, onboarding, club detail, tournament detail, settings). No visual regressions, no broken labels, vocabulary is consistent.

### Phase 3 — Disclaimer tightening

**Deliverables:**
- Every location in §4.4.3 wired through `<LegalDisclaimer>` or the composable.
- Trade-CTA in `AnalystPredictionModal.vue` renders `variant="trade-cta"`.
- Tournament trade form (locate during phase) renders `variant="tournament"`.
- `TermsOfServiceView.vue` imports the `full` variant text for its opening statement / key sections; long-form legal language retained but references the canonical copy.
- `LandingView.vue` footer uses `variant="full"`.

**Validation:** Grep `apps/web/src` for "investment advice" — results limited to `LegalDisclaimer.vue`, `disclaimers.ts`, `TermsOfServiceView.vue`, and `surface-content.ts`. Visually verify each disclaimer surface renders correctly in dev server.

### Phase 4 — Marketing refresh

**Deliverables:**
- `docs/features.md` created, populated per §4.5 inventory.
- `docs/what-divinr-can-do.md` vocabulary-swept and augmented with the shipped-since-last-update capabilities from §4.5.
- `docs/personas.md` created (minimal: 2–3 personas, one paragraph each).
- `apps/web/src/views/LandingView.vue` hero, feature cards, and "how it works" section rewritten from `docs/features.md`.

**Validation:** Dev server: landing page visually reviewed. Every shipped capability in §4.5 is represented on the landing page (feature card, "How it works" step, or a platform-features line). Hero copy aligns with the "analyzes, not predicts" angle. No user-visible "prediction" vocabulary remains on the page.

### Phase 5 — Memory + documentation reconciliation (+ optional lint gate)

**Deliverables:**
- `project_legal_language.md` memory updated to state the tightened rule with exemptions (use auto-memory tooling to edit the existing file).
- `CLAUDE.md` gets a short "UI vocabulary: analysis/signal, not prediction" note in the conventions section so future efforts don't reintroduce drift.
- Optional: ESLint rule OR a small Node script (`apps/web/scripts/check-ui-vocabulary.mjs`) that flags `predict(ion|ed|or)` in `.vue` template blocks and selected `.ts` user-visible contexts. If added, wire it into the coverage-check script or as a pre-commit hook. Skip if scope balloons — the phase is durable-enough without it.

**Validation:** Memory file re-read to confirm rule is captured. CLAUDE.md skim confirms convention is stated. If the lint gate ships, it runs clean on `main` post-Phase-4-merge.

**Integration / final validation across all phases:**

Before opening the PR for merge, run the full coverage and quality gates end-to-end: web build passes, type check passes, first-touch coverage check passes (per `apps/web/scripts/check-first-touch-coverage.mjs` — no surfaces changed but the check confirms nothing regressed), a dev-server walkthrough of the top-10 surfaces from §4.4.2 plus the landing page confirms no visual or vocabulary regressions.
