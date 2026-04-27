# Ethan Feedback Follow-Up — PRD

**Effort folder**: `docs/efforts/current/ethan-feedback-followup-2026-04-27/`  
**Status**: In Progress  
**Date**: 2026-04-27

## 1. Goal

Address the next round of Ethan’s beta feedback with narrowly scoped UX fixes that make Divinr easier to understand in the live shell without changing platform architecture.

This effort is not about adding new capability. It is about making existing capability legible:

- clearer Research detail pages
- clearer trade submission feedback
- cleaner instrument-detail affordances from dashboard entry points
- more persistent, more page-aware Learning Panel access

## 2. User Problems

### 2.1 Research is hard to scan

The Research detail page still reads like an internal analyst console:

- too much emphasis on raw percentages
- not enough quick “what does this analyst think?” framing
- article relevance is not organized in a way that helps users compare analyst inputs quickly

### 2.2 Trade placement is ambiguous

Users can queue trades, but the immediate feedback loop is weak:

- it is not obvious whether the trade was accepted
- nothing visible changes immediately if execution is deferred
- users do not see a recent activity trail

### 2.3 Instrument detail affordances are inconsistent

Users arriving from the dashboard can encounter controls that do not match their access level or navigation path:

- back behavior can feel wrong
- edit affordances can appear even when that surface is not truly appropriate for the current user
- Article Relevance selection behavior must be reliable

### 2.4 Learning Panel access should feel native

The Learning Panel is useful, but it should feel like a persistent in-product companion:

- accessible from anywhere
- not dependent on the user discovering a nav route
- aware of the current page, especially instrument pages

## 3. Product Requirements

### 3.1 Research detail simplification

For normal users on instrument detail pages:

- each analyst panel should expose a simple stance label:
  - `Buy`
  - `Sell`
  - `Hold`
- raw confidence can remain present, but as secondary context
- article relevance should be grouped by analyst
- builder-only article rescoring controls should not be shown to normal users

### 3.2 Instrument detail affordances

- the Back button should behave like a real back action with a safe fallback
- `Edit Contract` must only render when the current user level/role can actually use it
- Article Relevance selection must work reliably when the scoring workbench is visible

### 3.3 Trade submission clarity

In tournament trade flows:

- queueing a trade must show immediate visible success feedback
- a recent queued activity section should appear in the trade tab after submission
- the UI should explain the difference between:
  - queued trade activity
  - visible open positions after execution

This effort does not change execution timing or tournament engine semantics.

### 3.4 Learning Panel access and context

- add a persistent shell launcher outside the route-level nav
- preserve the existing modal/drawer behavior
- thread current-page context into Learning Panel requests
- instrument pages must pass instrument context into Learning Panel thread creation and message append flows

## 4. Technical Requirements

### 4.1 Frontend

Primary files expected:

- `apps/web/src/views/InstrumentDetailView.vue`
- `apps/web/src/components/InstrumentAnalystPanel.vue`
- `apps/web/src/components/PredictorScoringPanel.vue`
- `apps/web/src/views/TournamentDetailView.vue`
- `apps/web/src/layouts/DefaultLayout.vue`
- `apps/web/src/components/LearningPanelSurface.vue`
- `apps/web/src/api/learning-panel.ts`
- relevant Pinia stores as needed

### 4.2 Backend / API

No schema changes are required for this effort.

Learning Panel API shape may be widened only as needed to pass page context already available in the shell, especially `instrumentId`.

### 4.3 Authorization / mastery constraints

- builder-only controls stay builder-only
- operator/admin semantics do not change
- persistent Learning Panel launcher must not bypass route authorization

## 5. Testing Requirements

At minimum:

- web build stays green
- Learning Panel browser spec updated for the new launcher behavior
- tournament browser coverage still passes
- research/article relevance browser coverage updated or extended
- live shell sanity checks performed in the in-app browser for:
  - persistent Learning Panel launcher
  - Level 1 shell coherence
  - research detail affordances

Skip-safe browser coverage is acceptable where local seed data does not provide a reachable instrument.

## 6. Out of Scope

- broader redesign of dashboard cards beyond Ethan’s reported friction
- new research models or new analyst logic
- execution engine changes for queued trades
- open web research in Learning Panel
- builder-mode expansion

## 7. Current Status

Already landed on the active branch:

- persistent Learning Panel launcher
- page/instrument context threaded into Learning Panel create/append flows
- research detail simplification with buy/sell/hold framing
- article relevance grouped by analyst
- builder-only rescoring workbench hidden from normal users
- safer instrument-detail back behavior
- hidden `Edit Contract` for non-builder users
- trade success feedback
- recent queued activity in tournament trade flow

Remaining work is primarily validation, coverage, and any follow-on polish discovered in live browser testing.
