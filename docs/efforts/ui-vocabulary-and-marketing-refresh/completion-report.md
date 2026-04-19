# UI Vocabulary + Marketing Refresh — Completion Report

**Plan**: ./plan.md
**PRD**: ./prd.md
**Intention**: ./intention.md
**Completed**: 2026-04-19
**Final Status**: All Phases Complete

## Summary
- Total phases: 5
- Phases completed: 5
- Phases remaining: 0

## Phase Results

### Phase 1 — Foundation (Complete)
- Created `docs/efforts/current/ui-vocabulary-and-marketing-refresh/vocabulary.md` (translation dictionary).
- Created `apps/web/src/onboarding/disclaimers.ts` with 4 initial variants (`short`, `full`, `trade-cta`, `tournament`); a 5th `club` variant was added in Phase 3.
- Created `apps/web/src/components/LegalDisclaimer.vue` (presentational) and `apps/web/src/composables/useLegalDisclaimer.ts`.
- **Deviation**: fixed 22 pre-existing typecheck errors on baseline (per user direction "just fix all build and linting issues"). Added `"DOM", "DOM.Iterable"` to `tsconfig.json` libs, cast shims in 6 stores, and three small typing fixes in views. Phase 1 gate passed clean.

### Phase 2 — UI copy sweep (Complete)
- Swept 28+ Vue views and components (`PredictionsView`, `CanonicalDayDetailView`, `OnboardingSettingsView`, `SourceQualityView`, `AttachmentPicker`, `TermsOfServiceView`, `TournamentsView`, `EvaluationsView`, `GraduationCandidatesView`, `InviteSignupView`, `ClubDetailView`, `CoordinationView`, `AttributionAdminView`, `ChatView`, `MemberProfileDrawer`, `DailyAnalystSummary`, `ActivityPanel`, `ProvenanceTooltip`, `AnalystPredictionModal`, `PerformanceDashboardView`, `RunDetailView`, `RunsView`, `TournamentDetailView`, and more).
- Updated onboarding `surface-content.ts` bodies (7 entries).
- Router labels step was a no-op — router has only path/name/component tuples, no meta titles.
- Grep verification: every remaining `predict(ion|ed|or)` match is on the PRD §6 exemption list.
- **Deviations**: (1) "Prediction Challenges" club feature renamed to "Signal Challenges" (consistent with noun rule, not a dictionary entry); (2) `ActivityPanel` event chip labels `predictor`/`prediction` → `scorer`/`analysis`; (3) `LandingView.vue` got a vocabulary-only pass — full semantic rewrite deferred to Phase 4.

### Phase 3 — Disclaimer tightening (Complete)
- Wired the 5 PRD-listed disclaimer surfaces: landing footer (`full`), ToS opening callout (`full`), analyst modal trade-CTA + modal (`trade-cta`/`full`), tournament detail trade (`tournament`), `settings.terms` first-touch (`short` via `DISCLAIMERS.short` import).
- **Discovered 11 additional stray inline disclaimer surfaces** via the "investment advice" grep and wired them too:
  - `DefaultLayout.vue` app-shell footer → `short` (appears on every authenticated page)
  - `ClubDetailView.vue` (non-member + member banners), `ClubCreateView.vue`, `ClubInviteView.vue` → new `club` variant
  - `ClubJoinSignupView.vue` → `short`
  - `TournamentCreateView.vue`, `TournamentInviteView.vue`, `TournamentResultsView.vue`, `TournamentHistoryView.vue`, second occurrence in `TournamentDetailView.vue` → `tournament`
  - `AttributionMineView.vue`, `CalibrationChart.vue` → `short` (contextual prefix retained)
- Added a new `club` variant to `disclaimers.ts` (and extended the `DisclaimerVariant` union).
- **Deviations**: (1) `welcome-modal` surface-content entry referenced in plan step 3.5 was a no-op — that entry has no disclaimer content. (2) Chrome walkthrough of every variant surface was blocked by the WelcomeModal overlay on authenticated pages; app-shell `short` and landing `full` verified visually, remaining variants verified by build + grep + code inspection.

### Phase 4 — Marketing refresh (Complete)
- Created `docs/features.md` — authoritative feature inventory, 7 sections, shipped/in-progress markers.
- Created `docs/personas.md` — 3 personas (St. Thomas student, builder-type power user, casual-curious beta tester).
- Rewrote `docs/what-divinr-can-do.md` — full vocab sweep + added Trading & Portfolio section, Social & Onboarding section, Entity-Level Attribution bullet, Legal Language & Disclaimers section; added pointer to `docs/features.md`.
- Rewrote `LandingView.vue` hero ("Divinr analyzes markets — we don't predict them."), feature cards (14 cards organized per PRD §4.4.4 buckets), and "How it works" step 3.
- Chrome verified: hero H1 renders correctly, feature card "Five-Analyst Panel" renders, how-it-works step 3 renders the updated "paper-trade signal" paragraph.
- **Deviations**: (1) 14 landing cards (upper bound of 10–14 range) to cover every PRD §4.5 bucket. (2) Added Trading & Portfolio section to `what-divinr-can-do.md` that did not exist previously. (3) Added Legal & Trust section to `features.md`.

### Phase 5 — Memory + docs reconciliation (Complete)
- Updated `project_legal_language.md` auto-memory: dated 2026-04-19, now includes "prediction" in the banned list, disclaimer-variant inventory, and explicit exemption list.
- Updated `MEMORY.md` one-liner to match.
- Added "UI vocabulary: analysis/signal, never prediction/advice" section to repo `CLAUDE.md`.
- **Deviation**: Optional `check-ui-vocabulary.mjs` lint script (plan step 5.3) deferred. Rationale: the PRD §6 exemption list is large and context-sensitive (HTML comments, API keys, CSS class names, route paths, telemetry events, etc.). A correct lint script needs a curated allowlist that is best authored over time as the rule is challenged in real PRs, rather than pre-emptively. The manual `grep -rniE 'predict(ion|ed|or)' apps/web/src` check serves until then, and the CLAUDE.md note plus the memory record ensure Claude applies the rule on future edits.

## Gate Results
- **Phase 1**: lint ✓, typecheck ✓ (22 baseline fixes), build ✓, first-touch ✓.
- **Phase 2**: lint ✓, typecheck ✓, build ✓ (566ms), first-touch ✓, grep ✓, Chrome spot-checks ✓.
- **Phase 3**: lint ✓, typecheck ✓, build ✓ (1.05s), first-touch ✓, grep (investment advice + not a prediction model) ✓, Chrome partial (see Deviations).
- **Phase 4**: lint ✓, typecheck ✓, build ✓ (1.05s), first-touch ✓, docs verification ✓, Chrome ✓.
- **Phase 5**: memory + CLAUDE.md updated; completion report written.

## Deviations from PRD
See per-phase Deviations above. Summary:
1. Phase 1 bundled a baseline typecheck cleanup (22 errors) per user direction — net-positive for all later phases.
2. Added a 5th `club` disclaimer variant not called out in PRD §4.4.3 — required to meet PRD success criteria on club surfaces that were carrying stray inline disclaimers.
3. Wired 11 surfaces beyond the 5 PRD §4.4.3 explicitly listed — tightens the rule across the whole app in one pass.
4. Added content to `features.md` (Legal & Trust section) and `what-divinr-can-do.md` (Trading & Portfolio section) beyond the literal §4.5 inventory — reflects capabilities that existed but were underdescribed.
5. Deferred the optional vocabulary lint script (plan step 5.3) — rationale above.

## Follow-Up Items
- **Backend email-template audit (deferred)**: any server-side email templates that carry disclaimer-like copy need a separate audit. This was flagged in plan step 3.7 and is not in scope for this effort.
- **Optional `check-ui-vocabulary.mjs` lint script**: if `prediction`-language regressions start showing up in PRs, build the script with a curated allowlist. Model it on `check-first-touch-coverage.mjs`.
- **Archive this effort**: after the PR merges, move `docs/efforts/current/ui-vocabulary-and-marketing-refresh/` → `docs/efforts/archive/ui-vocabulary-and-marketing-refresh/` and update the CLAUDE.md pointer.

## Next Steps
- Run repo-wide final gate, commit, push, open PR.
- Send email notification to `golfergeek@gmail.com` per the `run-plan` skill.
- User runs `/pr-eval` when ready to merge.
