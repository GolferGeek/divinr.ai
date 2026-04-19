# Pending first-touch surfaces

Keys from `docs/efforts/current/onboarding-tour-extended/prd.md` Appendix A whose
backing view/component does not currently host a `<FirstTouchPanel>` or
`useFirstTouch` call. Content for every key is already authored in
`surface-content.ts` — the moment a component for a key ships (or the attachment
is added), the panel fires automatically.

Every item here carries a short note on **why** it isn't wired so future efforts
know whether the fix is "attach to existing component" or "wait for a new view."

## No backing view yet

These keys need a view or component before they can be wired.

- `settings` — no general-settings shell exists. The Settings nav is a group, not a hub view. Wire if/when a `SettingsHomeView.vue` ships.
- `prediction.card` — no dedicated card component. Cards render inline in `DashboardView` and `PredictionsView`. Extracting a `PredictionCard.vue` (deferred) would be the wire-point.
- `prediction.trade-cta` — no dedicated CTA component; the button is inline in `InstrumentDetailView`. Attach if a `TradeCtaButton.vue` is extracted.
- `portfolio.position-row` — positions render as table rows inside `PortfolioDashboardView` without a dedicated row component. Attach when `PositionRow.vue` is extracted.
- `performance.author-retention` — no dedicated view; the metric may appear in a future `PerformanceAuthorRetentionView.vue`.
- `club.opt-outs` — no view yet. The opt-out flow is a future effort.
- `messages.direct-message-intent` — no dedicated intent component; currently an inline prompt in `MessagesView`. Attach if a `DirectMessageIntentDialog.vue` is extracted.
- `authoring.source-selection` — no dedicated view; inline in `CreateAnalystWizard`. Attach when a dedicated step/panel is extracted.
- `welcome-modal` — this is the Beginner Tour welcome modal, not a first-touch surface. Handled by `WelcomeModal.vue` + the tour state machine. Kept in the inventory for completeness; a first-touch panel never fires here.
- `admin.day-trader-runs` — no dedicated view. Wire when `DayTraderRunsView.vue` (or similar) lands.
- `admin.notification-debug` — no dedicated view.
- `settings.opt-outs` — no view yet.
- `settings.profile` — no view yet.

## Sub-section of a parent view (no dedicated file)

These keys describe a tab, panel, or section inside a larger view and don't map
to a standalone component today. A panel could be attached in the parent view
behind a `v-if` keyed on the active tab/segment — that's the correct fix when
those sub-sections become "interesting" on their own.

- `portfolio.my-triples` — tab inside `PortfolioDashboardView`.
- `portfolio.detail` — same view as the portfolios list (`PortfolioDashboardView`); the list-view variant is wired as `portfolios`.
- `performance.attribution` — tab inside `PerformanceDashboardView`.
- `performance.leaderboard` — tab inside `PerformanceDashboardView`.
- `club.activities` — tab inside `ClubDetailView` (query param `?tab=activities`).
- `club.analysts` — tab inside `ClubDetailView`.
- `tournament.detail.info` — segment inside `TournamentDetailView`.
- `tournament.detail.trade` — segment inside `TournamentDetailView`.
- `tournament.detail.leaderboard` — segment inside `TournamentDetailView`.
- `tournament.detail.my-positions` — segment inside `TournamentDetailView`.
- `messages.dm` — inside `MessagesView`; channel/DM share the same view, which is wired under `messages`.
- `authoring.contract-section.predictor-generation` — section inside `ContractEditorView`.
- `authoring.contract-section.risk-assessment` — section inside `ContractEditorView`.
- `authoring.contract-section.prediction-generation` — section inside `ContractEditorView`.
- `authoring.contract-section.learning` — section inside `ContractEditorView`.
- `authoring.contract-section.adaptations` — section inside `ContractEditorView`.
- `billing.compute-breakdown` — section inside `BillingSummaryView`.

## Duplicate view (another key already covers the same component)

These keys describe the same DOM surface a sibling key is already wired to.
Listed explicitly so the coverage check doesn't false-positive on them.

- `prediction.detail` — maps to `InstrumentDetailView`, already wired under `instrument.detail`.
- `club.discover` — maps to `ClubsView`, already wired under `clubs`.
- `club.mentoring` — maps to `MentorDashboardView`, already wired under `mentor.dashboard`.
- `club.curriculum` — maps to `CurriculumDashboardView`, already wired under `curriculum.dashboard`.
- `tournament.list` — maps to `TournamentsView`, already wired under `tournaments`.
- `messages.channel` — maps to `MessagesView`, already wired under `messages`.
- `authoring.custom-analyst.editor` — maps to `ContractEditorView`, already wired under `analyst.contract-viewer`.
- `admin.contract-editor` — maps to `ContractEditorView`, already wired under `analyst.contract-viewer`.
- `settings.byo-credentials` — maps to `LlmCredentialsTab.vue`, already wired under `authoring.byo-llm`.
