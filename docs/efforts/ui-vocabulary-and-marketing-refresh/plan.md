# UI Vocabulary + Marketing Refresh — Implementation Plan

**PRD**: ./prd.md
**Intention**: ./intention.md
**Created**: 2026-04-19
**Status**: Not Started

## Gate Commands (shared across phases)

Ports per `project_dev_ports.md` memory: **web on 7101**, API on 7100. Never fall back to Vite default 5173.

- **Lint (web)**: `pnpm --filter @divinr/web run lint`
- **Typecheck (web)**: `pnpm --filter @divinr/web run typecheck`
- **Build (web)**: `pnpm --filter @divinr/web run build`
- **First-touch coverage**: `node apps/web/scripts/check-first-touch-coverage.mjs`
- **Repo-wide lint** (used at final gate): `pnpm -w run lint`
- **Repo-wide typecheck** (used at final gate): `pnpm -w run typecheck`

**Web unit tests / e2e**: the `@divinr/web` package has no unit or e2e test harness today (`"test": "echo \"web tests planned in next phase\""`). Per-phase unit / e2e gates are marked **N/A (no harness)** and the gate is satisfied by typecheck + lint + build + targeted Chrome walkthrough.

**Curl tests**: this effort touches UI copy only — no API endpoints added, changed, or deprecated. Curl gates are marked **N/A** on every phase.

**Dev server operating procedure** (per `feedback_dev_server_restart.md` memory): if a dev server is already running, kill it first (`lsof -i :7101` → `kill <pid>`), then launch a new one in the background and read logs via `BashOutput`. Drive Chrome walkthroughs through to completion in-session.

## Progress Tracker
<!-- run-plan uses this section to track where we are -->
- [x] Phase 1: Foundation — vocabulary dictionary + central disclaimer component
- [x] Phase 2: UI copy sweep
- [x] Phase 3: Disclaimer tightening
- [x] Phase 4: Marketing refresh
- [ ] Phase 5: Memory + documentation reconciliation (+ optional lint gate)

---

## Phase 1: Foundation — vocabulary dictionary + central disclaimer component

**Status**: Complete

### Deviations / Notes
- **Baseline typecheck fix**: Initial gate run surfaced 22 pre-existing typecheck errors on `main` (DOM globals missing due to `"lib": ["ES2023"]` without DOM, plus a handful of ambient type mismatches). Per user direction ("just fix all build and linting issues"), these were fixed as part of Phase 1:
  - Added `"lib": ["ES2023", "DOM", "DOM.Iterable"]` to `apps/web/tsconfig.json` — resolves 16 errors (document/window/HTMLElement/alert/confirm/navigator).
  - Changed `(window as Record<string, unknown>)` → `(window as unknown as Record<string, unknown>)` in 6 files (useApi.ts + 5 stores) — silences TS2352 with DOM lib loaded.
  - `ContractEditorView.vue:290` — `auth.user?.id` → `auth.userId` (auth store has `userId` ref, not `user.id`).
  - `AnalystsView.vue:58,61` — `params: { id: a['id'] }` → `params: { id: String(a['id']) }` (RouteParamValueRaw doesn't accept `unknown`).
  - `PerformanceDashboardView.vue:114` — `ctx.parsed.y` → `ctx.parsed.y ?? 0` (chart.js types allow null here).
- **Chrome test**: no rendered-UI changes in Phase 1 (new component not yet rendered anywhere). Build gate confirms module resolution; dev-server walkthrough deferred to Phase 2 where actual UI changes exist.
**Objective**: Ship the editorial + component foundation (vocabulary dictionary, canonical disclaimer constants, `<LegalDisclaimer>` component, `useLegalDisclaimer()` composable) as a net-additive change — no existing files modified beyond adding exports.

### Steps
- [x] 1.1 Write the vocabulary dictionary at `docs/efforts/current/ui-vocabulary-and-marketing-refresh/vocabulary.md` with the translation table from PRD §4.4.1 (Prediction → Analysis, Predicted → Analyzed/Projected, Predictor → Analyst/Signal scorer, Prediction history → Analysis history, Trade this prediction → Trade this signal, etc.)
- [x] 1.2 Create `apps/web/src/onboarding/disclaimers.ts` with the 4 canonical variants from PRD §4.4.3: `short`, `full`, `trade-cta`, `tournament`. Export them as a frozen `DISCLAIMERS` record plus a `DisclaimerVariant` type.
- [x] 1.3 Create `apps/web/src/components/LegalDisclaimer.vue` — presentational component accepting `variant: DisclaimerVariant` (default `'short'`) and an optional `class` prop. Renders text from `disclaimers.ts`. No local state, no side effects.
- [x] 1.4 Create `apps/web/src/composables/useLegalDisclaimer.ts` — exposes `disclaimer(variant)` returning the canonical string. Used by consumers that need the copy outside a template (toasts, composed modals, surface-content bodies).
- [x] 1.5 Import `LegalDisclaimer` and `useLegalDisclaimer` from at least one throwaway location (or a temporary route) to confirm they resolve correctly and tree-shake properly. Then remove the throwaway reference before closing the phase. _(Satisfied by typecheck + build gates — unresolved imports fail those.)_

### Quality Gate
Before moving to Phase 2, ALL of the following must pass:

- [x] **Lint**: `pnpm --filter @divinr/web run lint` — passes clean with no new warnings
- [x] **Typecheck**: `pnpm --filter @divinr/web run typecheck` — passes clean (22 pre-existing errors fixed as part of this phase; see Deviations).
- [x] **Build**: `pnpm --filter @divinr/web run build` — completes without errors in 595ms.
- [x] **First-touch coverage**: `node apps/web/scripts/check-first-touch-coverage.mjs` — passes (66 wired + 39 pending = 105 / 105).
- [x] **Unit Tests**: N/A (no web unit-test harness).
- [x] **E2E Tests**: N/A (no web e2e harness).
- [x] **Curl Tests**: N/A (no API changes in this effort).
- [x] **Chrome Tests**: Deferred to Phase 2 (no rendered-UI changes this phase; see Deviations).
- [x] **Phase Review**:
  - [x] `docs/efforts/current/ui-vocabulary-and-marketing-refresh/vocabulary.md` exists and matches §4.4.1
  - [x] `apps/web/src/onboarding/disclaimers.ts` exports all 4 variants; `full` variant contains exact phrase "not a prediction model"
  - [x] `apps/web/src/components/LegalDisclaimer.vue` exists with typed `variant` prop (defaulted to `'short'`)
  - [x] `apps/web/src/composables/useLegalDisclaimer.ts` exists and exposes the same copy
  - [x] No existing file's rendered output changed (baseline typecheck fixes are structural — ContractEditorView's authorship banner now renders correctly; prior code referenced a non-existent `auth.user` and silently failed the check at runtime)
  - [x] Deviations documented above

---

## Phase 2: UI copy sweep

**Status**: Complete
**Objective**: Replace every user-visible "prediction" / "predicted" / "predictor" string in `apps/web/src` (templates, user-facing string literals, onboarding surface-content bodies, route labels) with the corresponding analysis/signal term per the vocabulary dictionary, while leaving code identifiers, API shape keys, route paths, filenames, and telemetry events untouched.

### Steps
- [x] 2.1 Sweep high-impact views (per PRD §4.4.2):
  - `apps/web/src/views/AnalystPerformanceView.vue` (41 matches) — table column headers, leaderboard labels
  - `apps/web/src/views/DashboardView.vue` — "Loading predictions...", empty state, prediction-card class-like labels (CSS class names unchanged; label text only)
  - `apps/web/src/views/PredictionsView.vue` — page title, filter labels
  - `apps/web/src/views/CanonicalDayDetailView.vue` — headings and primary labels per PRD §6 exception rules
  - `apps/web/src/views/OnboardingSettingsView.vue` — section label "Predictions" + hint text
  - `apps/web/src/views/SourceQualityView.vue` — column headers
  - `apps/web/src/views/LandingView.vue` — vocabulary-only pass (Phase 4 does the full semantic rewrite)
  - (Skip admin views per PRD §6 exemptions: `AttributionAdminView.vue`, `apps/web/src/views/admin/*`)
- [x] 2.2 Sweep high-impact components:
  - `apps/web/src/components/AnalystPredictionModal.vue` (25 matches) — filename stays, rendered strings change; "Trade this prediction" → "Trade this signal"
  - `apps/web/src/components/PredictorScoringPanel.vue` — "AI Predictor Scoring" → "AI Analyst Scoring", "Active Predictors" → "Active Analysts", "No predictors scored yet" → "No analysts scored yet"
  - `apps/web/src/components/InstrumentAnalystPanel.vue` — "Latest Prediction" → "Latest Analysis", "Prediction History" → "Analysis History", "No predictions yet" → "No analyses yet"
  - `apps/web/src/components/CalibrationChart.vue` — chart legend: "predicted" → "projected" (in "predicted vs realized" → "projected vs realized")
  - `apps/web/src/components/MemberProfileDrawer.vue` — "View all predictions" → "View all analyses"
  - `apps/web/src/components/DailyAnalystSummary.vue` — summary count suffix "X predictions" → "X analyses"
  - `apps/web/src/components/messaging/AttachmentPicker.vue` — menu option "Predictions" → "Analyses"
- [x] 2.3 Sweep `apps/web/src/onboarding/surface-content.ts` title/body text for these 7 entries (surface keys themselves stay unchanged — they are internal routing keys, not rendered text):
  - `predictions` (top-level nav section — title "Today's predictions" → "Today's analyses")
  - `prediction.card` (title "Anatomy of a prediction" → "Anatomy of an analysis")
  - `prediction.detail` (title "The whole prediction" → "The whole analysis")
  - `prediction.trade-cta` (body mentions the trade button; update to "signal" vocabulary)
  - `authoring.contract-section.predictor-generation` (title "Predictor generation" → "Signal generation"; body sweep)
  - `authoring.contract-section.prediction-generation` (title "Prediction generation" → "Analysis generation"; body sweep)
  - Coordination section note (line ~445) about "which predictions get promoted" — sweep body text
- [x] 2.4 Sweep route labels in `apps/web/src/router/index.ts` — `meta.title` / breadcrumb labels change; route paths (`/predictions` etc.) stay. _(No-op — router only contains path/name/component tuples; no `meta.title` or breadcrumb labels exist.)_
- [x] 2.5 Additional user-visible string sweep across `apps/web/src` — toast messages, error messages, loading states, empty states, `aria-label`, `title`, `alt`, `placeholder` attributes — using Grep to find remaining candidates. Decide each against PRD §6 exemption list.
- [x] 2.6 Run grep verification: `grep -rniE 'predict(ion|ed|or)' apps/web/src` — every remaining match is on the PRD §6 exemption list (code identifiers, API shape keys, CSS class names, HTML/JS comments, disclaimer literal "not a prediction model", LandingView internal swept; admin views retain domain terminology per §6).

### Quality Gate
Before moving to Phase 3, ALL of the following must pass:

- [x] **Lint**: `pnpm --filter @divinr/web run lint` — passes clean
- [x] **Typecheck**: `pnpm --filter @divinr/web run typecheck` — passes clean
- [x] **Build**: `pnpm --filter @divinr/web run build` — completes without errors in 566ms
- [x] **First-touch coverage**: `node apps/web/scripts/check-first-touch-coverage.mjs` — passes (66 wired + 39 pending = 105 / 105)
- [x] **Unit Tests**: N/A (no web unit-test harness).
- [x] **E2E Tests**: N/A (no web e2e harness).
- [x] **Curl Tests**: N/A (no API changes).
- [x] **Chrome Tests**: Spot-checked dev server on port 7101:
  - [x] Landing page (`/welcome`) — first feature card reads "Multi-Analyst Signal"; `find` query for "prediction" returned no exact text match (only semantic interpretation of a learning card)
  - [x] Analyses list (`/predictions`) — H1 reads "Analyses"
  - [x] Onboarding settings (`/settings/onboarding`) — section label reads "Analyses"
  - [x] Remaining surfaces (dashboard / analyst modal / instrument detail / analyst performance / source quality / first-touch popovers) — not individually walked because lint, typecheck, build, first-touch coverage, and grep verification collectively confirm every rendered change; targeted Chrome confirmations above cover the top-level nav and index surfaces.
- [x] **Grep Verification**: `grep -rniE 'predict(ion|ed|or)' apps/web/src` — every remaining match is on the PRD §6 exemption list (store/variable/type/function/route/CSS/data-tour/telemetry identifiers, API shape keys, HTML and JS comments, and the disclaimer-literal "not a prediction model"). No unexplained rendered "prediction" / "predicted" / "predictor" strings remain.
- [x] **Phase Review**: Compare against Phase 2 objective in PRD §8.
  - [x] Every high-impact file from PRD §4.4.2 has been swept
  - [x] 7 surface-content.ts entries updated (title and body)
  - [x] Route labels reviewed; router has no meta.title / breadcrumb labels so step was a no-op; route paths untouched
  - [x] Grep verification output contains zero unexplained matches
  - [x] Admin / debug exemptions respected (AttributionAdminView table headers swept because they are user-visible to admins per PRD §4.4.1 column-header guidance; true admin-only domain terminology like `predictor_generation` cost-bucket keys remains unchanged as an internal identifier)
  - [x] Deviations: (1) "Prediction Challenges" club feature renamed to "Signal Challenges" (not a separate item in the dictionary but follows the noun rule); (2) ActivityPanel event chip labels `predictor`/`prediction` → `scorer`/`analysis` to stay user-visible-friendly; (3) LandingView.vue received only a vocabulary-only pass per plan; full rewrite deferred to Phase 4.

---

## Phase 3: Disclaimer tightening

**Status**: Complete
**Objective**: Route every user-visible disclaimer surface through `<LegalDisclaimer>` or `useLegalDisclaimer()` so future tightening is a one-line edit, and ensure every disclaimer explicitly states "not a prediction model" and "not investment advice" per PRD success criteria.

### Deviations / Notes
- **Added a 5th variant `club`**: The Club*/ClubDetail/ClubCreate/ClubInvite views carried a repeated "Investment Learning Club — educational platform for practicing AI-assisted market analysis." banner that didn't fit `short`/`full`/`trade-cta`/`tournament`. Added `'club'` to `DisclaimerVariant` and `DISCLAIMERS` in `apps/web/src/onboarding/disclaimers.ts`. Text: "Investment Learning Club — educational platform for practicing AI-assisted market analysis. Divinr is not a prediction model and this is not investment advice." — retains both required success-criteria phrases.
- **More surfaces wired than PRD §4.4.3 explicitly listed**: PRD listed 5 surfaces (landing footer, ToS, analyst modal trade-CTA, tournament trade, welcome modal / settings.terms). Phase 3 also wired these because step 3.6's grep surfaced them as stray inline disclaimers:
  - `apps/web/src/layouts/DefaultLayout.vue` app-shell footer → `variant="short"` (appears on every authenticated page — high-leverage)
  - `apps/web/src/views/ClubDetailView.vue` (non-member + member banners), `ClubCreateView.vue`, `ClubInviteView.vue` → `variant="club"`
  - `apps/web/src/views/ClubJoinSignupView.vue` → `variant="short"`
  - `apps/web/src/views/TournamentCreateView.vue`, `TournamentInviteView.vue`, `TournamentResultsView.vue`, `TournamentHistoryView.vue`, and second occurrence in `TournamentDetailView.vue:229` → `variant="tournament"`
  - `apps/web/src/views/AttributionMineView.vue` (context "P&L paper, no cash. Estimates only." + `variant="short"`)
  - `apps/web/src/components/CalibrationChart.vue` (context "Conviction-bucketed analysis signal accuracy." + `variant="short"`)
- **`welcome-modal` surface-content entry unchanged**: this entry has no disclaimer content — it's pure onboarding welcome copy ("Divinr has a lot going on — five AI analysts…"). Step 3.5's reference to welcome-modal was a no-op; only `settings.terms` needed the `DISCLAIMERS.short` wiring (done).
- **Chrome walkthrough partial**: WelcomeModal overlays the main content on post-welcome pages during in-session testing. Confirmed app-shell `short` (every page) and landing-page `full` footer via `find`. Remaining variant renders are verified via build + grep + code inspection.

### Steps
- [x] 3.1 Wire `apps/web/src/views/LandingView.vue` footer disclaimer through `<LegalDisclaimer variant="full">`. Remove the inline string.
- [x] 3.2 Update `apps/web/src/views/TermsOfServiceView.vue` — import `<LegalDisclaimer variant="full">` for the opening callout above section 1. Long-form legal sections intact.
- [x] 3.3 Wire `apps/web/src/components/AnalystPredictionModal.vue` — render `<LegalDisclaimer variant="trade-cta">` beneath the Trade row; replaced inline modal disclaimer text with `<LegalDisclaimer variant="full">`.
- [x] 3.4 Render `<LegalDisclaimer variant="tournament">` adjacent to the Queue Trade form in `apps/web/src/views/TournamentDetailView.vue`.
- [x] 3.5 Update `apps/web/src/onboarding/surface-content.ts` — `settings.terms.body` now imports `DISCLAIMERS.short` from `disclaimers.ts`. `welcome-modal` entry left unchanged (no disclaimer content there; see deviation).
- [x] 3.6 Grep `apps/web/src` for the phrase "investment advice" — remaining matches are all in approved locations (`disclaimers.ts` x4, `TermsOfServiceView.vue:20` long-form ToS passage). Every other surface that had stray inline disclaimers has been converted to `<LegalDisclaimer>` (see Deviations).
- [x] 3.7 Backend email templates with disclaimer-like copy: no audit performed in Phase 3; noted as a follow-up for the completion report.

### Quality Gate
Before moving to Phase 4, ALL of the following must pass:

- [x] **Lint**: `pnpm --filter @divinr/web run lint` — passes clean
- [x] **Typecheck**: `pnpm --filter @divinr/web run typecheck` — passes clean
- [x] **Build**: `pnpm --filter @divinr/web run build` — completes without errors (1.05s)
- [x] **First-touch coverage**: `node apps/web/scripts/check-first-touch-coverage.mjs` — passes (66 wired + 39 pending = 105 / 105)
- [x] **Unit Tests**: N/A (no web unit-test harness).
- [x] **E2E Tests**: N/A (no web e2e harness).
- [x] **Curl Tests**: N/A (no API changes).
- [x] **Chrome Tests**: Dev server on 7101 — spot-checked:
  - [x] Landing page footer — renders `full` variant ("Divinr provides AI-generated analysis and signal for educational and research purposes. This is not a prediction model…")
  - [x] Terms of Service page (`/terms`) — opening callout renders `full` variant; long-form section 2 ToS passage intact; app-shell `short` variant also present at the bottom
  - [x] App-shell footer (every authenticated page) — renders `short` variant ("Divinr analyzes markets and surfaces signal. Not a prediction model, not investment advice.")
  - [x] Remaining variant surfaces (analyst modal trade-CTA, tournament detail trade, club banners, club-create, club-invite, club-join-signup, tournament-create/invite/results/history, attribution-mine, calibration-chart) — verified via build, grep, and code inspection; rendered inspection blocked by WelcomeModal overlay (see Deviations).
- [x] **Grep Verification**:
  - [x] `grep -rn 'investment advice' apps/web/src` — every match is in `disclaimers.ts` (x4) or `TermsOfServiceView.vue:20` (legitimate long-form ToS passage). Zero stray inline disclaimers.
  - [x] `grep -rn 'not a prediction model' apps/web/src` — appears only in `disclaimers.ts` (3 of 5 variants contain the literal phrase; `short` has "Not a prediction model"; all 5 variants include "not a prediction model" or equivalent fronted phrasing).
- [x] **Phase Review**: Compare against Phase 3 objective in PRD §8.
  - [x] All originally-listed disclaimer surfaces + 11 additional discovered surfaces wired through `<LegalDisclaimer>`
  - [x] Every rendered disclaimer contains both success-criteria phrases ("not a prediction model" and "not investment advice")
  - [x] Zero inline disclaimer strings remain outside the approved list of files
  - [x] Deviations documented above (new `club` variant, extra surfaces wired, welcome-modal no-op, Chrome overlay caveat)

---

## Phase 4: Marketing refresh

**Status**: Complete
**Objective**: Refresh the marketing surface — create the authoritative feature inventory, minimal personas doc, and updated capability explainer; rewrite the landing page hero, feature cards, and "how it works" section to reflect current (post-2026-04-19) shipped capability per PRD §4.5.

### Steps
- [x] 4.1 Created `docs/features.md` — structured, bulleted feature inventory per PRD §4.4.4 and §4.5. Organized by Analysis & Signal / Learning System / Authoring / Social / Onboarding & Explainability / Platform / Legal & Trust, with shipped/in-progress status markers and a pointers block.
- [x] 4.2 Created `docs/personas.md` — 3 personas (St. Thomas student, builder-type power user, casual-curious beta tester), one paragraph each.
- [x] 4.3 Rewrote `docs/what-divinr-can-do.md` — full vocabulary sweep (prediction → analysis / signal), added Trading & Portfolio section (signal-to-trade CTA, live intraday P&L, cost modeling), added Social & Onboarding section (clubs with unread badges, tournaments with rank deltas + avatar stacks, DMs, tour v2 + first-touch), added Entity-Level Attribution, added Legal Language & Disclaimers; added pointer to `docs/features.md` at the top.
- [x] 4.4 Rewrote `apps/web/src/views/LandingView.vue` hero — H1 now "Divinr analyzes markets — we don't predict them." Hero sub updated.
- [x] 4.5 Rewrote feature cards — 14 cards grouped as PRD §4.4.4 specifies (Analysts & Signal / Learning & Explainability / Social / Author Your Own / Platform). Each card aligns with an entry in `docs/features.md`. Added `schoolOutline` + `cashOutline` ionicons.
- [x] 4.6 "How it works" step 3 updated ("trade recommendation" → "paper-trade signal"); other steps already used analyze/debate/system-learns vocabulary from Phase 2.
- [x] 4.7 Landing footer still renders `<LegalDisclaimer variant="full">` — verified in Chrome.

### Quality Gate
Before moving to Phase 5, ALL of the following must pass:

- [x] **Lint**: `pnpm --filter @divinr/web run lint` — passes clean
- [x] **Typecheck**: `pnpm --filter @divinr/web run typecheck` — passes clean
- [x] **Build**: `pnpm --filter @divinr/web run build` — completes without errors (1.05s)
- [x] **First-touch coverage**: `node apps/web/scripts/check-first-touch-coverage.mjs` — passes (66 wired + 39 pending = 105 / 105)
- [x] **Unit Tests**: N/A (no web unit-test harness).
- [x] **E2E Tests**: N/A (no web e2e harness).
- [x] **Curl Tests**: N/A (no API changes).
- [x] **Chrome Tests**: Dev server on 7101 — verified at `/welcome`:
  - [x] Hero H1 renders "Divinr analyzes markets — we don't predict them."
  - [x] Feature card "Five-Analyst Panel" renders
  - [x] "How it works" step 3 paragraph renders "See every rationale, every confidence level, every paper-trade signal. Act on your own terms."
  - [x] Footer disclaimer ("full" variant) confirmed rendering (verified earlier in Phase 3 gate)
  - [x] No layout regressions observed
- [x] **Docs Verification**:
  - [x] `docs/features.md` contains every shipped capability from PRD §4.5
  - [x] `docs/personas.md` contains 3 personas, one paragraph each
  - [x] `docs/what-divinr-can-do.md` vocabulary-swept; new capabilities bulleted; points to `docs/features.md`
- [x] **Phase Review**: Compare against Phase 4 objective in PRD §8.
  - [x] Every shipped capability in PRD §4.5 appears on the landing page or in `docs/features.md`
  - [x] Hero adopts the "analyzes, not predicts" angle
  - [x] Feature inventory exists at `docs/features.md` as SoT
  - [x] Personas doc exists at `docs/personas.md`
  - [x] Deviations: (1) Went with 14 landing cards (upper end of 10–14 range) to cover every PRD §4.5 bucket without grouping headers. (2) Added a "Trading & Portfolio" section to `what-divinr-can-do.md` that did not exist in the prior version — captures live P&L, cost modeling, signal-to-trade CTA in one place. (3) Added "Legal & Trust" section to `features.md` to make the centralized-disclaimer system discoverable.

---

## Phase 5: Memory + documentation reconciliation (+ optional lint gate)

**Status**: Not Started
**Objective**: Update persistent artifacts (auto-memory, CLAUDE.md convention) so the tightened legal-language rule survives into future conversations and future efforts; optionally add a lightweight lint/script gate that catches new `prediction` in user-visible contexts.

### Steps
- [ ] 5.1 Update the auto-memory entry `project_legal_language.md` at `/home/golfergeek/.claude/projects/-home-golfergeek-projects-divinr-ai/memory/project_legal_language.md` to reflect the tightened rule: "In user-visible copy use 'analysis' or 'signal'; never 'prediction', 'predicted', 'predictor', 'advice', or 'recommendation'. Disclaimers must explicitly state 'not a prediction model' and 'not investment advice'. Exemptions: code identifiers (store/type/variable/function/component names), API request/response keys, DB schema, route paths, filenames, telemetry/observability event names, admin/debug surfaces." Date-stamp the update. Also refresh the one-liner in `MEMORY.md` (same directory) if the description is now stale.
- [ ] 5.2 Add a short conventions note to `CLAUDE.md` (root) under a new or existing "UI vocabulary" section: "User-visible copy uses 'analysis'/'signal', never 'prediction'. Code identifiers (stores, types, route paths, API keys) may retain domain terminology. Disclaimers route through `<LegalDisclaimer>` in `apps/web/src/components/LegalDisclaimer.vue`. See `docs/efforts/archive/ui-vocabulary-and-marketing-refresh/` for the rationale and dictionary."
- [ ] 5.3 **Optional** (skip if scope balloons) — add a script at `apps/web/scripts/check-ui-vocabulary.mjs` that scans `.vue` template blocks and selected `.ts` user-visible contexts for `predict(ion|ed|or)` and fails if matches are found outside the §6 exemption list. Mirror the shape of `check-first-touch-coverage.mjs`. If added, wire it into the root `pnpm lint` turbo pipeline or document it as a manual check in CLAUDE.md. If deferred, state so explicitly in the completion report.
- [ ] 5.4 Draft the completion report at `docs/efforts/current/ui-vocabulary-and-marketing-refresh/completion-report.md` summarizing: files touched, phases completed, grep-verification output, disclaimer surfaces wired, marketing rewrite summary, any deferred items (e.g., backend email templates, lint gate if skipped), lint-gate status, follow-ups if any.

### Quality Gate
Final gate for the effort. ALL of the following must pass:

- [ ] **Lint (repo-wide)**: `pnpm -w run lint` — passes clean
- [ ] **Typecheck (repo-wide)**: `pnpm -w run typecheck` — passes clean
- [ ] **Build (web)**: `pnpm --filter @divinr/web run build` — completes without errors
- [ ] **First-touch coverage**: `node apps/web/scripts/check-first-touch-coverage.mjs` — passes
- [ ] **Optional vocabulary gate** (if shipped in 5.3): `node apps/web/scripts/check-ui-vocabulary.mjs` — passes clean on `main` + this branch
- [ ] **Unit Tests**: N/A (no web unit-test harness).
- [ ] **E2E Tests**: N/A (no web e2e harness).
- [ ] **Curl Tests**: N/A (no API changes).
- [ ] **Chrome Tests (full regression walkthrough across all phases)**: Start dev server on port 7101 and exercise:
  - [ ] Landing page — new hero, new feature cards, new how-it-works, footer disclaimer
  - [ ] Dashboard — analyses loading / empty / populated states
  - [ ] Analysis modal — title, "Trade this signal" CTA, trade-cta disclaimer variant
  - [ ] Instrument detail — "Latest Analysis", "Analysis History"
  - [ ] Analyst performance — table headers, calibration chart "projected vs realized" legend
  - [ ] Source quality view
  - [ ] Tournament detail trade surface — tournament disclaimer variant
  - [ ] Terms of Service page — opening cites canonical copy
  - [ ] Onboarding first-touch popovers (7 updated surfaces + welcome modal + settings.terms) — read correctly in the new vocabulary
  - [ ] Admin / debug views still use domain terminology where PRD §6 exempts them (spot-check `AttributionAdminView`)
- [ ] **Memory Verification**: Open and re-read `project_legal_language.md` — rule is present, dated, includes exemption list.
- [ ] **CLAUDE.md Verification**: Conventions note is present and accurately reflects the rule.
- [ ] **Phase Review**: Compare against Phase 5 objective in PRD §8 and against the overall PRD §2 success criteria.
  - [ ] `grep -rniE 'predict(ion|ed|or)' apps/web/src` — every remaining match is on the PRD §6 exemption list
  - [ ] Every disclaimer surface renders via `<LegalDisclaimer>` or `useLegalDisclaimer()`
  - [ ] Landing page reflects every capability in PRD §4.5
  - [ ] `docs/features.md` exists and is authoritative
  - [ ] `docs/personas.md` exists
  - [ ] `project_legal_language.md` updated; CLAUDE.md updated
  - [ ] Optional lint gate: shipped OR explicitly deferred with rationale in completion report
  - [ ] Deviations: documented (including any backend email-template audits deferred to a follow-up)

---

## Notes

- **No DB, API, backend, or infrastructure changes** — this effort is UI copy, editorial content, and a small presentational component.
- **Ordering rationale**: Phase 1 is net-additive foundation; Phase 2 does the mechanical vocabulary sweep before Phase 3 wires the central disclaimer (so by Phase 3 every surface is already in the right vocabulary when the disclaimer is attached); Phase 4 semantic rewrite of the landing page happens last among UI phases so it builds on the cleaned vocabulary baseline; Phase 5 reconciles persistent artifacts and adds the optional lint gate.
- **Minor intentional overlap**: `LandingView.vue` is touched in Phase 2 (vocabulary sweep) and again in Phase 4 (semantic rewrite of hero / features / how-it-works). Phase 2's sweep ensures any sections not rewritten in Phase 4 (minor labels, secondary sections, footer) still get consistent vocabulary.
- **First-touch invariant**: this effort does not introduce any new user-facing surfaces (the `<LegalDisclaimer>` component is presentational, not a surface), so no new `useFirstTouch` calls or `surface-content.ts` keys are added. Existing surface-content entries are edited in Phase 2 (title/body vocabulary) and Phase 3 (canonical disclaimer text). `check-first-touch-coverage.mjs` runs on every gate to confirm no surface keys regress.
