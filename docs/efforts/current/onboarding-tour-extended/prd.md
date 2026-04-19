# Onboarding Tour Extended (v2) — Product Requirements Document

## 1. Overview

Replace the v1 linear 12-step tour (archived at `docs/efforts/archive/onboarding-v1/`) with a two-part delivery model:

1. A small **Beginner Tour** at signup — ~5 beats, ~10 minutes max, "enough to play" — reusing the v1 docent panel UI and the existing onboarding store/backend (both remain in production).
2. A **first-touch walkthrough infrastructure** that fires a short docent panel the first time a user reaches any meaningful surface in the app. One row per (user, surface). Never re-fires after dismiss unless the user resets.

The user controls three things: dismiss one walkthrough, globally mute all first-touch walkthroughs (one-click from any panel), or reset per-section / globally from settings.

This effort also owns the **Forever Rule** enforcement so the surface inventory doesn't rot: a CLAUDE.md convention and a `verify-plan` skill check that flag any new user-facing surface shipped without a `useFirstTouch()` registration.

## 2. Goals & Success Criteria

**Primary goals** (directly from intention §"Intention" and §"Success Criteria"):

- A new user completes the Beginner Tour in under 10 minutes and is immediately productive (finds predictions, makes a paper trade, reads the dashboard).
- A user who skips the Beginner Tour can use the full product without restriction (no nav gating, unlike v1).
- A user who never opens a given surface never sees that surface's walkthrough content.
- A user reaching a new surface sees a short, useful rundown (1–3 sentences, optional CTA) alongside the surface — not blocking it.
- Every first-touch panel offers a one-click **"Don't show me these anymore"** global mute.
- A user can reset first-touch state per section or globally from Settings → Onboarding and re-experience walkthroughs.
- `user_surface_touches` accumulates accurate first-touch data usable as a discoverability signal.
- Every new user-facing surface shipped after this effort ships with a `useFirstTouch()` call and a `surface-content.ts` entry — enforced by CLAUDE.md convention and `verify-plan` skill check.

**Done when**: all success criteria above are observable in a running build, the full surface inventory in §4.4 has content shipped, the Beginner Tour content is rewritten to v2, the Forever Rule enforcement is merged, and the v1 nav-locking behavior is removed so the Beginner Tour no longer gates routes.

**Explicit non-goals** (from intention "Out of Scope"): multi-language, role-specific tour variants, per-step analytics dashboards, annotated tours from other users, achievement/completion badges, personalized content ("your AAPL analyst said…"), marketing discoverability nudges on the dashboard.

## 3. User Stories / Use Cases

**New user (first signup)**
- Lands on `/` post-signup, sees welcome modal (reused from v1).
- Picks "Start Tour" → walks 5 beats of the Beginner Tour via the existing docent panel. Can "Skip tour" from any beat.
- Finishes tour → sees the dashboard. Every subsequent click into a new surface fires a one-time first-touch panel alongside the surface.

**Returning user (pre-existing beta cohort)**
- Existing onboarding state in `authz.user_preferences.onboarding_state` is honored — users who already completed v1 tour are not re-tourified.
- On first visit to any surface post-deploy, the first-touch infrastructure fires normally (they start from zero touches for first-touch purposes, but the Beginner Tour does not restart).

**Advanced user (wants to bail)**
- Clicks "Skip tour" on the welcome modal → Beginner Tour never starts.
- First time they land on a surface, first-touch panel appears → one click on "Don't show me these anymore" → globally muted. No more panels.

**Authoring user (reaches a deep surface)**
- Lands on the custom analyst editor for the first time. First-touch panel renders alongside the editor with a 1–3 sentence rundown + CTA. User can ignore the panel and start authoring immediately; nothing gates the editor. Marking touched happens on mount regardless of whether the user engaged with the panel.

**Curious user (wants to re-see walkthroughs)**
- Settings → Onboarding → "Re-enable first-touch walkthroughs" flips global mute off. Previously-touched surfaces stay touched (no re-fire).
- Per-section "Show me again for Portfolios" resets the `portfolio.*` subtree; those walkthroughs re-fire on next visit.
- "Show me everything again" resets all touches.

## 4. Technical Requirements

### 4.1 Architecture

**Reused components (no change)**
- `apps/web/src/components/DocentPanel.vue` — the docent panel UI. Both the Beginner Tour and first-touch walkthroughs render through it. One visual treatment.
- `apps/web/src/components/WelcomeModal.vue` — triggers the Beginner Tour. Content copy rewritten to v2 voice (see §4.4).
- `apps/web/src/stores/onboarding.store.ts` + `apps/api/src/onboarding/*` — the Beginner Tour pipeline (state, API, persistence). Remains the host of Beginner Tour state. **Nav-lock gating (`isUnlocked`, `navLocks`) is removed** — v2 does not gate routes.

**New components**
- `apps/web/src/composables/useFirstTouch.ts` — composable that, on mount, registers a surface touch and renders a first-touch docent panel if this is the first time. No-op if already touched or globally muted.
- `apps/web/src/stores/firstTouch.store.ts` — Pinia store for first-touch state. Holds: `globallyMuted: boolean`, `touched: Set<string>`, actions to fetch state, mark touched, mute/unmute, reset section, reset global.
- `apps/web/src/onboarding/surface-content.ts` — content store keyed by `surface_key`. Each entry: `{ title: string; body: string; cta?: { label: string; to: string } }`. Single file for v1; may split by section if it grows past ~400 keys.
- `apps/web/src/views/settings/OnboardingSettingsView.vue` — new settings section (see §4.4).
- `apps/api/src/first-touch/` — new NestJS module: `FirstTouchController`, `FirstTouchService`, `FirstTouchSchemaService` (follow the existing `onboarding/` module shape, including the inline `ensureSchema()` pattern).

**Two parallel flows, one UI**
- Beginner Tour flow: driven by existing onboarding store; shows `DocentPanel` pinned to the router-resolved path; advances on "Next". Unchanged v1 pipeline minus the nav locks.
- First-touch flow: driven by `useFirstTouch(key)` per view/component; shows `DocentPanel` in a non-blocking placement (see §4.4 "Panel placement"). Not coupled to router; fires wherever mounted.
- Both flows can fire at the same time in principle but in practice the Beginner Tour completes before any first-touch panels fire, because a new user who starts the tour ticks the touched row for each surface as they visit (see §4.4 "Beginner Tour marks touched").

### 4.2 Data Model Changes

**New table**: `prediction.user_surface_touches`

Schema choice matches the intention wording (`prediction.user_surface_touches`) and aligns with the existing `prediction.user_enabled_triples` pattern — user-behavior state, not preference data. (Preferences like the global mute flag stay in `authz.user_preferences`; see below.)

```sql
CREATE TABLE IF NOT EXISTS prediction.user_surface_touches (
  user_id           TEXT NOT NULL,
  surface_key       TEXT NOT NULL,
  first_touched_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  dismissed         BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, surface_key)
);

CREATE INDEX IF NOT EXISTS idx_user_surface_touches_user
  ON prediction.user_surface_touches (user_id);
```

**Global mute** lives on the existing `authz.user_preferences.onboarding_state` JSONB blob as a new field:
```json
{ "first_touch_muted": false }
```
No new column; extend the patch applicator in `apps/api/src/onboarding/onboarding.types.ts` with a new `action: 'set_first_touch_mute'` patch case.

**Schema creation pattern (codebase-critical)**: migration files in `apps/api/db/migrations/` are **documented snapshots** — they are *not* the authoritative runtime source. Authoritative DDL runs idempotently at API boot via a per-module `*-schema.service.ts` (see existing `onboarding-schema.service.ts` and the header comment on `2026-04-14-user-preferences.sql`). Phase 1 therefore ships **two** artifacts that must agree:
1. `apps/api/db/migrations/2026-04-19-user-surface-touches.sql` — documentation snapshot (header must note runtime DDL is authoritative, matching `2026-04-14-user-preferences.sql` header).
2. `apps/api/src/first-touch/first-touch-schema.service.ts` — `ensureSchema()` that runs the same `CREATE TABLE IF NOT EXISTS` + index on module init, wired into the module providers.

**Surface key convention** (resolves intention open question): dotted hierarchy, lowercase, kebab-case segments. Example: `portfolio.detail.position-row`. Per-section reset uses a prefix match: `DELETE FROM prediction.user_surface_touches WHERE user_id = $1 AND surface_key LIKE 'portfolio.%'`.

### 4.3 API Changes

New NestJS module at `apps/api/src/first-touch/`:

| Method | Path | Purpose | Body / Params |
|---|---|---|---|
| `GET`  | `/api/first-touch/state` | Fetch all touched keys + mute flag for current user | — |
| `POST` | `/api/first-touch/touched` | Mark a (user, surface) row touched | `{ surface_key: string }` |
| `POST` | `/api/first-touch/mute`    | Set global mute | `{ muted: boolean }` |
| `POST` | `/api/first-touch/reset`   | Reset touches | `{ scope: 'all' } \| { scope: 'prefix', prefix: string }` |

Response shape for `GET /state`:
```json
{ "muted": false, "touched": ["dashboard", "predictions", "portfolio.detail"] }
```

**Auth pattern** — copied verbatim from `apps/api/src/onboarding/onboarding.controller.ts`: class-level `@UseGuards(JwtAuthGuard)` imported from `@orchestratorai/planes/auth`; every handler receives `@Req() req` and calls a local `getUser(req)` helper that pulls `req.user.id` (throws `BadRequestException` if missing). No user_id in request bodies or URL params for regular endpoints. The reset endpoint is scoped to the authenticated user — no cross-user reset path (contrast the onboarding controller's super-admin `POST /reset/:userId`, which we do *not* mirror here).

All service constructor params use explicit `@Inject(ClassName)` per CLAUDE.md, including `@Inject(DATABASE_SERVICE)` for the database service injection token.

**Existing onboarding API**: no new endpoints needed for the Beginner Tour — the v1 endpoints (`GET /api/onboarding/state`, `PATCH /api/onboarding/state`) remain. The `PATCH` applicator is extended to accept `{ action: 'set_first_touch_mute', muted: boolean }` so mute state lives with other onboarding prefs.

### 4.4 Frontend Changes

**`useFirstTouch(surfaceKey)` composable**
- On component mount:
  1. Read from `firstTouch.store` — if `globallyMuted` or `touched.has(key)`, no-op.
  2. Else: show `DocentPanel` bound to `surface-content.ts[key]`. If the key is missing from the content store, log a dev warning and no-op (fail-soft, don't break the view).
  3. Fire `POST /api/first-touch/touched { surface_key }` and update local `touched` set immediately (optimistic).
- The panel exposes two buttons:
  - **"Got it"** (or X) — closes the panel for this visit. Touched row already written; does not re-fire.
  - **"Don't show me these anymore"** — sets `globallyMuted = true` via `POST /api/first-touch/mute`; closes the panel.

**Panel placement** (resolves intention open question "Auto-suppress when user is mid-flow")
- Decision: appear alongside, not blocking. Panel renders as a dismissable floating card in a consistent corner (bottom-right on desktop, bottom sheet on mobile). No throttling, matching intention §"Decided During Planning".
- The panel does not intercept pointer events on the underlying surface.

**Beginner Tour marks touched**
- When the Beginner Tour advances through a beat that corresponds to a registered surface_key, the corresponding `user_surface_touches` row is written. This prevents double-teaching (Beginner Tour, then first-touch panel for the same surface).
- Mapping from tour beat → surface_keys lives in `apps/web/src/onboarding/tour-to-surface-map.ts`.

**Beginner Tour v2 content** — rewrite `apps/web/src/onboarding/tour-content.ts` down to 5 beats:
1. `welcome` — "What Divinr is" — explainability over black-box trading bots, warm welcome, thanks for coming.
2. `analysts-and-instruments` — roster shot + sample instrument detail; "disagreement between them is the point."
3. `reading-an-analysis` — direction, confidence, rationale link. Copy still uses "prediction" today; reconciled once `ui-vocabulary-and-marketing-refresh` lands (noted inline).
4. `making-a-trade` — trade button, paper-trading disclaimer.
5. `where-to-go-from-here` — clubs / tournaments / learning framed as menu options, not requirements. "Have fun, and welcome."

All beats: "Skip tour" available; resume-per-beat behavior honored (existing v1 state model). The v1 `StepId` enum shrinks to these 5 values; old values deleted cleanly (no backwards-compat shims — any user mid-v1-tour when this ships restarts from the v2 welcome).

**Nav-lock removal** — delete `navLocks` from `tour-content.ts`, delete `isUnlocked()` from the store, delete the router guard that uses it. The Beginner Tour no longer prevents navigation.

**Surface content store** — `apps/web/src/onboarding/surface-content.ts`

Format:
```ts
export const surfaceContent: Record<string, SurfaceContent> = {
  'dashboard': {
    title: 'Your home base',
    body: 'The cards here summarize what your analysts are saying right now and how your paper portfolio is doing. Tap any card to dig in.',
    cta: { label: 'See predictions', to: { name: 'predictions' } },
  },
  // ...
};
```

Full inventory from intention §3 is locked into this PRD (reproduced in the appendix of this document as the canonical list for plan execution). ~130 keys across: top-level nav, predictions & trade path, instrument, analyst, portfolio, performance, clubs, tournaments, messaging, authoring, authored content, risk & sentiment, coordination, sources, per-instrument attribution, curriculum & learning, mentor, billing, admin, settings, auth. All must have content shipped in v1 of this effort. Every entry has to pass the "would a non-author care?" test per intention §"Content quality bar".

**Settings → Onboarding section** — new view `apps/web/src/views/OnboardingSettingsView.vue` (mirrors the existing flat `views/` directory convention). Route `/settings/onboarding` follows the same shape as the existing `/settings/authored-content` route in `apps/web/src/router/index.ts`. Controls:
- Toggle: **"Show first-touch walkthroughs"** (inverse of global mute)
- Buttons: **"Show me again for [Section]"** for each top-level subtree — Dashboard, Predictions, Instruments, Analysts, Portfolios, Performance, Clubs, Tournaments, Messages, Authoring, Settings, Billing, Admin (admin section only visible to admins)
- Button: **"Show me everything again"** (global reset)

**No general Settings shell in scope.** A consolidated Settings hub with a left-nav linking to Profile / Opt-outs / BYO credentials / Terms is *not* built by this effort. Those views either don't exist yet (`settings.profile`, `settings.opt-outs`, `settings.byo-credentials` are future efforts) or live at existing routes (`TermsOfServiceView.vue` already routes at `/terms`). This effort only adds the `/settings/onboarding` route and its view. The left-nav in `apps/web/src/layouts/DefaultLayout.vue` already has a "Settings" group (currently containing "Your Content", "My Attribution" (admin), "Billing Summary" (admin)); this effort adds an **"Onboarding"** item pointing to `/settings/onboarding`. No other nav additions.

**Voice and tone** — all new content follows the voice spec from intention §"Voice and tone": enjoyable, warm, slightly excited; honest about getting going; gracious ("thanks for coming"); options, not obligations for social/learning; plain-language first use of jargon.

**First-touch dismiss & resume semantics** (from intention §"Resume & Dismiss Semantics"):
- The touched row is written on mount, not on user action. If a user navigates away before reading the panel, the surface still counts as touched.
- Dismiss is per-walkthrough — closing one panel never affects other pending panels.
- Only Settings → Onboarding can restore a touched surface.
- Beginner Tour resume-per-beat behavior is inherited unchanged from v1.

**Telemetry bonus** (intention §"Telemetry Bonus") — `prediction.user_surface_touches` doubles as a discoverability signal: rows-missing-after-30-days is a "which surfaces aren't users finding?" metric for future UX/marketing work. No analytics dashboard in v1 (explicitly out of scope, §6); the table itself is the telemetry surface.

### 4.5 Infrastructure Requirements

- One new SQL migration file (§4.2) + inline idempotent schema creation.
- No new services, containers, env vars, or third-party dependencies.
- No deployment ordering constraints beyond running the migration before the API restart.

## 5. Non-Functional Requirements

**Performance**
- `GET /api/first-touch/state` runs once at app boot per session; response is small (<5 KB for a full inventory of ~130 keys). Target < 100 ms p95 on local Spark.
- `POST /api/first-touch/touched` is fire-and-forget from the UI's perspective — UI updates local state optimistically. Target < 200 ms p95.

**Security**
- All endpoints require auth; user_id comes from the session, never from the request body.
- Reset operations are scoped to the authenticated user. No cross-user state access.

**Scalability**
- Table grows at most `(users × surfaces)` = low thousands for beta, unbounded but small per user. Primary key on `(user_id, surface_key)` is sufficient; no partitioning needed.

**Compatibility**
- Users with a pre-v2 `onboarding_state` row in `authz.user_preferences` are handled by the existing patch applicator — adding the `first_touch_muted` field falls through `applyOnboardingPatch` as a defaulted field. Existing v1-completed users do not re-tour.
- No Vue component breaking changes: `DocentPanel.vue` props are extended backwards-compatibly to accept a `mode: 'beginner-tour' | 'first-touch'` prop that affects placement.

## 6. Out of Scope

Explicitly excluded from this effort (from intention §"Out of Scope"):
- Multi-language content (English only)
- Role-specific tour variants (admin / student / etc.)
- Per-step analytics dashboards (the `user_surface_touches` table itself is the v1 telemetry surface)
- "Tour my friend gave me" — annotated tours from experienced users
- Achievement / completion badges
- Personalization based on the user's enabled triples
- Marketing-side discoverability nudges (dashboard cards advertising authorship etc.)
- Optional lint rule for `useFirstTouch()` coverage (intention §4.3) — deferred until drift is observed; CLAUDE.md convention + `verify-plan` check ship first.
- The `ui-vocabulary-and-marketing-refresh` effort queued in `next/` (listed as adjacent in intention). "prediction" → "analysis" vocabulary sweep happens in that effort; v2 beat 3 copy uses "prediction" for now.
- `autonomous-testing-team` effort (orchestrator AI work, not yet queued). The surface inventory is useful to it, but that effort is parked.

## 7. Dependencies & Risks

**Dependencies** (all shipped per intention §"Dependencies")
- Six architecture restructure efforts (workflow-stages-article-pipeline → slot-based-enablement-ui) ✅
- `club-tournament-experience-polish` ✅
- v1 onboarding code (docent panel, welcome modal, store, API, migration) — present and used as the foundation.

**Risks & mitigations**

| Risk | Likelihood | Mitigation |
|---|---|---|
| Surface inventory drifts — new views ship without `useFirstTouch()` | High without enforcement | Forever Rule: CLAUDE.md convention + `verify-plan` skill check (Phase 6). ESLint rule deferred. |
| Content quality slips below the "would a non-author care?" bar | Medium | Content review is part of the Phase 4 gate before merge; each surface's copy must pass the test as written in intention §"Content quality bar". |
| Beginner Tour v2 and first-touch fire simultaneously for new users (double-teach) | Medium | Tour-to-surface map in `tour-to-surface-map.ts` marks surfaces touched as the beat advances. First-touch won't re-fire for covered surfaces. |
| Removing nav-locks from v1 breaks pages that implicitly relied on tour state | Low | Grep for uses of `isUnlocked`; delete the router guard and all call sites in the same commit. No other known consumers. |
| Migration naming collision if run on an env that already has v1 onboarding migration with overlapping date | Low | Migration named `2026-04-19-user-surface-touches.sql`; dated after the v1 `2026-04-14-user-preferences.sql`. |
| First-touch panel floods user on first session (e.g., 12 surfaces hit on one page) | Low-Medium | No throttling per intention. One-click mute on every panel is the user's escape hatch. Confirmed decision in intention §"Decided During Planning". |
| Contract editor walkthrough requires the editor to be presentable (intention "Honest About System Capabilities") | Medium | First-touch content is written; if the editor UX is not presentable, the copy can still ship against whatever the editor is today — improvements to the editor itself live in a follow-up `stage-keyed-analyst-contracts` effort, not a blocker here. |

## 8. Phasing

Each phase ends at a validatable boundary. Phases run in order; no skipping.

**Phase 1 — Backend: first-touch module + migration**
- Create migration `2026-04-19-user-surface-touches.sql`
- Create `apps/api/src/first-touch/` module (schema service, service, controller) following the existing onboarding module pattern and CLAUDE.md DI convention
- Extend `applyOnboardingPatch()` to handle `set_first_touch_mute`
- Tests: service unit tests for touched/mute/reset-prefix/reset-all paths
- **Gate**: `curl` or integration test round-trips all four endpoints end-to-end against a real Postgres; migration runs cleanly on a fresh DB.

**Phase 2 — Frontend: first-touch plumbing**
- `firstTouch.store.ts` Pinia store
- `useFirstTouch(surfaceKey)` composable
- `DocentPanel.vue` extended with `mode` prop (non-breaking)
- Content store stub `surface-content.ts` with 3 hand-written entries (`dashboard`, `predictions`, `portfolio.detail`) for smoke testing
- Wire `useFirstTouch` into the 3 smoke-test views
- **Gate**: log in as a fresh user, visit the 3 smoke-test surfaces, see the panel once each, click "Don't show me these anymore", visit again — no panel. Reload — still muted. Reset via API — re-fires. Verified in Chrome.

**Phase 3 — Settings → Onboarding section + nav-lock removal**
- Create `apps/web/src/views/OnboardingSettingsView.vue` with the three controls (global mute toggle, per-section reset buttons, global reset button). Route at `/settings/onboarding` added to `router/index.ts` mirroring the `/settings/authored-content` shape.
- Add an "Onboarding" item to the Settings group in `apps/web/src/layouts/DefaultLayout.vue` (pointing to `/settings/onboarding`), alongside the existing "Your Content" entry.
- Remove `isUnlocked` / `navLocks` from the onboarding store and `tour-content.ts`; remove the router guard that uses them (router/index.ts lines ~137–164); remove `ALWAYS_UNLOCKED_DURING_TOUR` (no longer needed).
- **Gate**: in the running app, `/settings/onboarding` renders; global mute toggle flips, per-section and global reset each flow end-to-end (curl + UI); navigation to any route while Beginner Tour is incomplete is no longer blocked by the router guard.

**Phase 4 — Full content authoring + `useFirstTouch` coverage**
- Populate `surface-content.ts` with entries for **every** key in the Appendix A inventory — including keys whose backing view/component does not yet exist (`settings.profile`, `settings.opt-outs`, `settings.byo-credentials`, etc.). Content is written regardless of view existence; it will activate when the view ships.
- Add `useFirstTouch(key)` calls to every view and component whose surface is in the inventory **and exists in the codebase today**. Track the "key exists, view does not" subset in `apps/web/src/onboarding/pending-surfaces.md` (a short checklist) so future efforts know what to wire.
- Content review: each entry passes the "would a non-author care?" test (intention §"Content quality bar") and matches the voice spec (intention §"Voice and tone").
- **Gate**:
  - Every inventory key has an entry in `surface-content.ts` (grep-based check).
  - Every top-level view file in `apps/web/src/views/` either calls `useFirstTouch` at least once OR is listed in `pending-surfaces.md` OR is a public/unauthenticated view (`LandingView`, `LoginView`, `InviteSignupView`, `ClubJoinSignupView`).
  - Manual walk-through in Chrome for a representative ~10 surfaces confirming panels fire and the copy reads well. Full-inventory manual walkthrough is not required at this gate — Phase 6 relies on the Forever Rule + testing team (adjacent effort) for ongoing coverage.

**Phase 5 — Beginner Tour v2 content rewrite + tour-to-surface map**
- Rewrite `tour-content.ts` to the 5 v2 beats
- Shrink `StepId` enum; delete v1 beats cleanly (no compat shims)
- Rewrite `WelcomeModal.vue` copy to v2 voice
- Add `tour-to-surface-map.ts` — when a Beginner Tour beat completes, the corresponding surfaces are marked touched so they don't re-fire
- **Gate**: fresh user walks the Beginner Tour in under 10 minutes including reading; skips are honored; after tour completion, visiting the surfaces that the tour already covered does not re-fire a first-touch panel, but visiting an uncovered surface (e.g., `analyst.contract-viewer`) does fire.

**Phase 6 — Forever Rule enforcement**
- Update root `CLAUDE.md`: add convention *"Every new user-facing surface ships with a `useFirstTouch(key)` call and a corresponding entry in `surface-content.ts`. Part of Definition of Done for any effort that adds or substantially changes a user-facing view, modal, or interactive component."*
- Update `.claude/skills/verify-plan/` (and `.claude/skills/build-plan/` if it generates Definition of Done text) to flag missing first-touch coverage as a **Major** issue for any phase that touches user-visible surfaces
- **Gate**: run `verify-plan` against a synthetic plan that adds a view without a `useFirstTouch` entry; verify it flags the issue. Run against this effort's own plan; verify it does not false-positive.
- The optional ESLint rule from intention §4.3 is **deferred** and not part of this effort.

---

## Appendix A — Canonical Surface Inventory (locked)

This is the authoritative v1 list of `surface_key` entries that `surface-content.ts` must contain at the end of Phase 4. Keys use the dotted-hierarchy convention from §4.2. Reproduced verbatim from intention §3; any adjustments during plan execution must amend this appendix.

**Top-level sections (11)**: `dashboard`, `predictions`, `instruments`, `portfolios`, `performance`, `analysts`, `clubs`, `tournaments`, `messages`, `notifications`, `settings`

**Predictions & trade path (4)**: `prediction.card`, `prediction.detail`, `prediction.trade-cta`, `tournament.picker`

**Instrument surfaces (3)**: `instrument.detail`, `instrument.debate`, `instrument.variant-switcher`

**Analyst surfaces (4)**: `analyst.detail`, `analyst.contract-viewer`, `analyst.calibration-drilldown`, `analyst.affinity`

**Portfolio (4)**: `portfolio.my-triples`, `portfolio.add-triple`, `portfolio.position-row`, `portfolio.detail`

**Performance (4)**: `performance.equity-curve`, `performance.attribution`, `performance.author-retention`, `performance.leaderboard`

**Clubs (8)**: `club.discover`, `club.create`, `club.detail`, `club.activities`, `club.mentoring`, `club.curriculum`, `club.analysts`, `club.opt-outs`

**Tournaments (6)**: `tournament.list`, `tournament.detail.info`, `tournament.detail.trade`, `tournament.detail.leaderboard`, `tournament.detail.my-positions`, `tournament.avatar-stack`

**Messaging (3)**: `messages.dm`, `messages.channel`, `messages.direct-message-intent`

**Authoring (12)**: `authoring.custom-analyst.create`, `authoring.custom-analyst.editor`, `authoring.custom-instrument.create`, `authoring.custom-instrument.editor`, `authoring.contract-section.predictor-generation`, `authoring.contract-section.risk-assessment`, `authoring.contract-section.prediction-generation`, `authoring.contract-section.learning`, `authoring.contract-section.adaptations`, `authoring.byo-llm`, `authoring.relationship-selection`, `authoring.source-selection`

**Authored content (2)**: `authored.overview`, `authored.attribution.mine`

**Risk & sentiment (2)**: `risk-dashboard`, `fear-greed-alerts`

**Coordination (1)**: `analyst.coordination`

**Sources (2)**: `sources`, `source.quality`

**Per-instrument attribution (1)**: `instrument.attribution`

**Curriculum & learning (4)**: `learning-dashboard`, `curriculum.dashboard`, `curriculum.create`, `curriculum.detail`

**Mentor (1)**: `mentor.dashboard`

**Tournaments extra (3)**: `tournament.create`, `tournament.history`, `tournament.invite-landing`

**Clubs extra (4)**: `club.compare`, `club.rankings`, `club.invite-landing`, `club.join-signup`

**Auth & onboarding (2)**: `auth.invite-signup`, `welcome-modal`

**Cost & billing (3)**: `billing.summary`, `billing.compute-breakdown`, `billing.student-accrual`

**Admin (16)**: `admin.cost-modeling.calibration`, `admin.cost-modeling.defensibility`, `admin.cost-modeling.experiments`, `admin.llm-usage`, `admin.day-trader-runs`, `admin.findings-inbox`, `admin.evaluations`, `admin.runs.list`, `admin.runs.detail`, `admin.canonical-day`, `admin.proposals`, `admin.graduation-candidates`, `admin.contract-editor`, `admin.notification-debug`, `admin.attribution`, `admin.domain-dashboard`

**Settings (5)**: `settings.onboarding`, `settings.opt-outs`, `settings.byo-credentials`, `settings.profile`, `settings.terms`

**Public (no first-touch — listed for completeness, excluded from inventory)**: `public.landing`, `public.login`

**Total in scope: 105 surface keys** (not counting the two public surfaces). Phase 4 is done when all 105 have content shipped in `surface-content.ts` and every one whose backing view currently exists has a corresponding `useFirstTouch` call. Keys whose views don't exist yet are listed in `pending-surfaces.md` and picked up by future efforts under the Forever Rule (Phase 6).
