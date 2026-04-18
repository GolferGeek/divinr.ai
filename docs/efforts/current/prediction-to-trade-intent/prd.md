# Prediction → Trade Intent — Product Requirements Document

## 1. Overview

Today predictions and tournament trades live on disconnected surfaces. A user who likes a prediction has to leave the prediction surface, navigate to a tournament detail page, open the TRADE tab, and re-enter symbol, direction, and quantity by hand. This effort closes that loop with a **Trade this prediction** CTA on prediction surfaces that lands the user in the tournament trade form with symbol, direction, and a suggested quantity pre-filled. Submission writes through the existing `POST /tournaments/:id/queue-trade` endpoint — no schema changes, no new order type, no day-one position↔prediction linkage.

The existing "Trade" button on prediction cards currently invokes a paper-portfolio immediate-execute flow (`portfolioStore.executeTrade` in `AnalystPredictionModal.vue:215`), which is a different product surface from tournament trades. This effort adds a tournament-specific path; the paper-portfolio flow is untouched.

## 2. Goals & Success Criteria

### Goals
- G1: From any prediction surface, a user with a single active tournament can submit a tournament trade pre-filled from that prediction in **≤ 2 clicks** (open CTA → confirm). Users with multiple active tournaments add one click for the picker (3 total — tracked as acceptable, see R2).
- G2: Pre-fill populates **symbol + direction always**, and **quantity** from a client-side heuristic tied to analyst confidence, producing an integer share count between 1% and 5% of the selected tournament's starting balance (formula in 4.3). Quantity stays editable.
- G3: Active-tournament resolution handles three states explicitly: **one active** (auto-select), **multiple active** (picker), **zero active** (empty-state route to tournaments list).
- G4: Options-instrument predictions do not break the CTA — behavior is explicit and acceptable (see 4.6).
- G5: Submission uses the existing `POST /tournaments/:id/queue-trade` endpoint, passing `predictionId` so future attribution work has the data — zero schema changes.

### Success Criteria
- A user opens a prediction, clicks **Trade this prediction**, confirms (one editable quantity + submit), and a tournament trade is queued — total of 2 clicks after opening the prediction.
- The pre-filled quantity matches the prediction's implied size when a `TradeRecommendation` exists; otherwise it falls within 1–5% of the selected tournament's starting balance.
- With no active tournament, the CTA routes to the tournaments list with a clear "Join a tournament to trade" state — no silent failure, no console error.
- Tournament trade row includes `prediction_id` when queued from a prediction CTA (inspectable via `prediction.tournament_trade_queue`).
- Options predictions surface a user-readable message and do not produce a broken trade form (decision: disable CTA + show "Tournament trading is equity-only right now").

## 3. User Stories / Use Cases

- **U1 — Single active tournament:** Alice is in the "Spring Sprint" active tournament. On her Dashboard she sees an AAPL "up" prediction, clicks **Trade this prediction**, the form opens pre-filled (AAPL, long, suggested qty), she adjusts quantity to 10, submits, and sees "Trade Queued." → 2 clicks after opening the modal.
- **U2 — Multiple active tournaments:** Bob is entered in two active tournaments. He clicks **Trade this prediction**; a small tournament picker appears (radio list of active tournaments with names + starting balances). He selects one and proceeds to the pre-filled form.
- **U3 — No active tournament:** Carol has no active entry. She clicks **Trade this prediction**; she's routed to `/tournaments` with an empty-state banner: "Join a tournament to trade on predictions." No error toast.
- **U4 — Options prediction:** Dan opens a prediction on an options instrument. The **Trade this prediction** button is disabled with a tooltip/note: "Tournament trading is equity-only right now." He can still view the analysis.
- **U5 — Resolver returns only upcoming entries (no active ones):** Eve's only tournament entry is in `upcoming` status, not `active`. The resolver filters on `status === 'active'`, so she hits the zero-active branch: the CTA routes her to `/tournaments?reason=no-active-entry` with the empty-state banner. Once the sprint starts and her entry flips to `active`, the CTA resolves normally. If a future change loosens the filter to include `upcoming`, the already-present "Trading opens when the sprint starts on {start time}" block at `TournamentDetailView.vue:294-305` takes over after navigation.

## 4. Technical Requirements

### 4.1 Architecture

Three cooperating layers:

1. **Prediction surface** (`apps/web/src/components/AnalystPredictionModal.vue`, `apps/web/src/views/DashboardView.vue`, `apps/web/src/views/AnalystPerformanceView.vue`) — add a new **Trade this prediction** CTA distinct from the existing "Trade" button (which stays wired to the paper-portfolio flow). The two CTAs live side-by-side during this effort; a follow-up can unify them.
2. **Active-tournament resolver** (new composable `apps/web/src/composables/useActiveTournament.ts`) — wraps `GET /tournaments/me`, filters to `status='active'`, returns `{ state: 'none' | 'one' | 'many', tournaments }`.
3. **Trade form pre-fill** (`apps/web/src/views/TournamentDetailView.vue`) — read optional query params `?symbol=&direction=&qty=&predictionId=` on mount; if present and `tab === 'trade'`, populate `tradeSymbol`, `tradeDirection`, `tradeQuantity` and stash `predictionId` for submission.

### 4.2 Data Model Changes

**None.** The `prediction.tournament_trade_queue` table already has a nullable `prediction_id` column, and the INSERT in `apps/api/src/tournaments/tournament-portfolio.service.ts:131-135` already persists `input.predictionId ?? null`. The effort only starts sending a non-null value from the frontend.

### 4.3 API Changes

**None to endpoint signatures.** The endpoint `POST /tournaments/:id/queue-trade` in `apps/api/src/tournaments/tournament.controller.ts:297-317` already accepts an optional `predictionId` on the body type, and the service (`tournament-portfolio.service.ts:96-139`) already wires that value into the INSERT. The effort does not touch the API layer.

**Sizing: computed client-side.** A grep of `apps/api/src/markets` confirmed no `GET /predictions/:id/recommendation` endpoint exists; the only recommendation endpoint is `GET /runs/:runId/trade-recommendation` (`markets.controller.ts:785`), which is a run-scoped read, not per-prediction. Rather than add a new backend endpoint (out of scope), the frontend computes implied quantity with:

```
impliedQty = floor((starting_balance * pct) / currentPrice)
pct = clamp(0.01 + (confidence / 100) * 0.04, 0.01, 0.05)
```

- `starting_balance` from the selected tournament (`Tournament.starting_balance`).
- `confidence` from `AnalystStance.confidence` (0–100) as it already flows into the modal.
- `currentPrice` from the `currentPrice` prop the modal already receives (`AnalystPredictionModal.vue:52`).
- If `currentPrice` is null/zero, fall back to `impliedQty = 1` so the form is never un-submittable.

This yields an integer share count between 1% and 5% of starting balance, tracking analyst confidence, satisfying the intention's "prediction's implied contract size or a sensible heuristic (e.g. 1–5% of starting balance)." Quantity remains editable.

### 4.4 Frontend Changes

- `apps/web/src/stores/tournament.store.ts:127` — the current signature is `queueTrade(id, input: { symbol, direction, quantity })`. Extend `input` to include an optional `predictionId?: string`, include it in the JSON body, and leave the return type unchanged. This is a type-level change (the POST body grows by one optional field); existing call sites compile unchanged.
- `apps/web/src/views/TournamentDetailView.vue:54–83` — on mount, parse `route.query` for `symbol`, `direction`, `qty`, `predictionId`. When present: set tab to `'trade'`, set the form fields, keep `predictionId` in a ref, and pass it to `store.queueTrade` on submit. Clear the query params on successful queue (or on explicit cancel).
- `apps/web/src/composables/useActiveTournament.ts` (new) — exposes `resolveActiveTournaments()` returning `{ state, tournaments }`, hydrated from `store.fetchMyEntries()` (which calls `GET /tournaments/me`) filtered by `status === 'active'`. Callers pass the result into a picker or navigate accordingly.
- `apps/web/src/components/TournamentPicker.vue` (new, small) — Ionic modal/action-sheet listing active tournaments with name + starting balance; emits `select(tournamentId)`. Only rendered when resolver returns `state: 'many'`.
- `apps/web/src/components/AnalystPredictionModal.vue` — add a new **Trade this prediction** button in the view-mode action row (sibling to "Take This Trade" and "Skip") that runs `handleTradeThisPrediction(analyst)`. This function:
  1. Asset-type guard: if the underlying instrument is an option, render the button in a disabled state with an inline note and abort. Asset type must be plumbed into the modal via a new prop (`assetType?: string`) sourced from the parent view's instrument record.
  2. Resolve target tournament by calling `resolveActiveTournaments()` and branching on `state`:
     - `'none'` → `router.push({ path: '/tournaments', query: { reason: 'no-active-entry' } })` and return (no navigation to trade form).
     - `'one'` → use the single tournament's id as `targetId`.
     - `'many'` → open `TournamentPicker`; when it emits `select(id)`, set `targetId` and continue. If the picker is dismissed, abort.
  3. Once `targetId` is set (only in the `'one'` / `'many'` branches), compute `impliedQty` using the formula in 4.3 against that tournament's `starting_balance`, then navigate to `/tournaments/{targetId}?tab=trade&symbol={SYMBOL}&direction={long|short}&qty={impliedQty}&predictionId={pred_id}`.
- `apps/web/src/views/TournamentsListView.vue` (or equivalent index page; locate during Phase 2) — read `?reason=no-active-entry` and render an empty-state banner.
- `apps/web/src/views/DashboardView.vue` — the prediction-card action buttons (verified at the `<AnalystPredictionModal>` binding `modalInstrumentId`, `modalCurrentPrice`) already delegate to `AnalystPredictionModal`, which is where the new CTA lives. Also pass the underlying instrument's `asset_type` through to the modal (new `assetType` prop) so the asset-type guard in 4.4 can evaluate. No other changes here.
- `apps/web/src/views/AnalystPerformanceView.vue` — same modal consumer; pass `assetType` through here too. Verify in Phase 3 that the CTA shows and behaves consistently.

### 4.5 Infrastructure Requirements

None. No new services, migrations, background jobs, or environment variables.

### 4.6 Options Prediction Handling

The prediction model (`PredictionOutcome` in `apps/api/src/markets/markets.types.ts:198`) has no strike / expiry / option_type fields. `MarketInstrument.asset_type` distinguishes asset classes but no part of the tournament trade path consumes it. Tournament trades are equity-only today.

**Behavior:** The new CTA checks `instrument.asset_type`; if it's an option, the button renders **disabled** with an inline note: "Tournament trading is equity-only right now." This satisfies the intention's "works for options predictions" goal in the narrowest non-breaking sense without expanding scope into option trade modelling (explicitly a non-goal in the intention).

Alternative considered and rejected: route to the underlying equity ticker. Rejected because the user explicitly clicked a prediction on the option — silently re-pointing to the equity is misleading.

## 5. Non-Functional Requirements

- **Performance:** CTA→submit round trip should be indistinguishable from the current direct trade flow (no added server round trips beyond `GET /tournaments/me` on first resolve; cache within the Pinia store for the session).
- **Security:** No new attack surface. Query params are validated on the receiving view (symbol regex `^[A-Z.]{1,10}$`, direction whitelist, qty integer > 0). Malformed params fail to empty form silently.
- **Legal language:** The CTA label is "Trade this prediction" and the form submit button remains "Queue Trade." Avoid "recommend/advice" language. Keep the existing paper-trade disclaimer; no new disclaimer logic.
- **Compatibility:** Existing `AnalystPredictionModal` flows (view-mode "Take This Trade", trade-mode immediate execute) keep working unchanged. `store.queueTrade` signature extension is additive.
- **Accessibility:** Disabled state for option predictions must carry an accessible tooltip/aria-label; tournament picker must be keyboard navigable.

## 6. Out of Scope

- Position↔prediction linkage UI ("I traded this prediction" attribution on the outcome side) — deferred.
- Auto-execution or scheduled trades.
- Multi-leg option orders derived from option-style predictions.
- Changes to the prediction contract or outcome model.
- Server-side endpoint for computing a recommendation for a given prediction on demand (Option A in 4.3) — deferred to a follow-up only if heuristic sizing proves insufficient.
- Unifying the existing paper-portfolio "Trade" button with the new tournament CTA — follow-up.
- A dedicated direct-from-card CTA that bypasses the modal — follow-up. This is the softer reading of intention scope bullet 2 ("prediction cards in lists where it fits"); the modal-level CTA satisfies the hard requirement, and list-card placement can follow based on usage signal.
- A new backend read endpoint to fetch a per-prediction recommendation for server-side sizing — follow-up only if the client-side heuristic in 4.3 proves insufficient.

## 7. Dependencies & Risks

### Dependencies
- `GET /tournaments/me` returns entries with `status` — verified in `tournament.controller.ts:118`.
- `store.queueTrade` already uses the existing endpoint — verified at `tournament.store.ts:127`.
- `TournamentDetailView` reads `route.params.id` and owns `tab` local state — verified at `TournamentDetailView.vue:51–54`.

### Risks
- **R1 — Heuristic sizing feels arbitrary.** Users may find the suggested quantity disconnected from the analyst's actual recommendation. *Mitigation:* show the confidence/starting-balance math in a small "How we sized this" note; flag for revisit after beta feedback.
- **R2 — Multiple-active tournament picker UX adds friction.** If most users hit the `many` path, the 2-click success goal slips to 3 clicks (open modal → pick tournament → confirm). *Mitigation:* ship without any last-chosen memory; measure the distribution after beta rollout. If `many` is common, a follow-up effort adds a `localStorage` cache of the last-chosen tournament id — explicitly out of scope for this effort.
- **R3 — Query-param round-trip is fragile.** URL encoding, page reloads, and back-button behavior can produce surprises. *Mitigation:* clear the params after pre-fill application so they don't re-fire, and unit-test the parser.
- **R4 — Options disabled state looks like a bug.** Users may think the CTA is broken rather than by-design. *Mitigation:* clear copy and disabled styling distinct from a failure state.
- **R5 — `GET /tournaments/me` latency on slow networks.** Adds a click-to-nav gap. *Mitigation:* call `fetchMyEntries()` eagerly on app mount so the resolver hits cached state.

## 8. Phasing

Each phase ends with a runnable, demo-able slice. No phase ships half-wired UI.

### Phase 1 — Pre-fill plumbing on the tournament side
Extend `TournamentDetailView` to parse `?symbol=&direction=&qty=&predictionId=`, pre-fill the trade form, and pass `predictionId` through `store.queueTrade` to the existing endpoint. Extend the store's `queueTrade` signature.
**Done when:** manually navigating to `/tournaments/{id}?tab=trade&symbol=AAPL&direction=long&qty=10&predictionId=...` lands on a pre-filled trade form; submitting queues a trade with `prediction_id` populated (verified in `prediction.tournament_trade_queue`).

### Phase 2 — Active-tournament resolver + picker + prediction CTA (minimum viable)
Build `useActiveTournament` composable and `TournamentPicker` component, and wire them into `AnalystPredictionModal` behind the new **Trade this prediction** button. This bundles resolver + picker + CTA so the phase ends on a real demo-able slice, not scaffolding. Asset-type guard and sizing heuristic from 4.3 are included. Empty-state banner on the tournaments index is part of this phase since the `'none'` branch depends on it.
**Done when:** clicking the CTA from a Dashboard prediction card lands the user in the pre-filled tournament trade form (one-active case), in the picker then the form (many-active case), or on `/tournaments` with the empty-state banner (none-active case). Queued trades have `prediction_id` populated.

### Phase 3 — Surface coverage + end-to-end verification
Extend the CTA to the other prediction surfaces that use `AnalystPredictionModal` (`AnalystPerformanceView.vue`), verify all five user stories (U1–U5) in a live browser session, and polish copy / disabled states. Confirm the `tournament_trade_queue` row has `prediction_id` populated end-to-end by inspecting the DB (Supabase on port 7011).
**Done when:** all five user stories pass in a browser; a queued trade row has `prediction_id` populated and visible in the DB.

### Phase 4 — Measurement (deferrable)
Add a lightweight client-side log or analytics event when a tournament trade is queued with `predictionId` present, so beta observability can measure CTA adoption and drop-off. Explicitly safe to defer past initial ship — does not gate the feature.
**Done when:** a dev-console log or analytics event fires on each prediction-origin queued trade.
