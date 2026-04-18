# Prediction → Trade Intent — Implementation Plan

**PRD**: ./prd.md
**Intention**: ./intention.md
**Created**: 2026-04-18
**Status**: Complete (Chrome walkthroughs + DB verification deferred to `/pr-eval`)

## Progress Tracker
<!-- run-plan uses this section to track where we are -->
- [x] Phase 1: Tournament-side pre-fill plumbing
- [x] Phase 2: Resolver + picker + prediction CTA (MVP slice)
- [x] Phase 3: Surface coverage + end-to-end verification
- [x] Phase 4: Measurement (deferrable)

---

## Phase 1: Tournament-side pre-fill plumbing
**Status**: Complete (browser/curl verification deferred to `/pr-eval`)
**Objective**: Land the minimum plumbing on the tournament side — extend `queueTrade` to carry `predictionId`, and teach `TournamentDetailView` to pre-fill the trade form from URL query params — so that a user landing at a pre-built URL sees a filled form and submission persists `prediction_id` to `prediction.tournament_trade_queue`.

### Steps
- [x] 1.1 Extend `apps/web/src/stores/tournament.store.ts:127` — change `queueTrade` input type from `{ symbol: string; direction: string; quantity: number }` to `{ symbol: string; direction: string; quantity: number; predictionId?: string }`. Pass the full input as the JSON body (`predictionId` is already accepted by the controller body type in `apps/api/src/tournaments/tournament.controller.ts:301` and persisted by `tournament-portfolio.service.ts:131-135`). No existing caller needs to change.
- [x] 1.2 In `apps/web/src/views/TournamentDetailView.vue`:
  - Add a local `predictionIdForTrade = ref<string | null>(null)`.
  - In the existing `onMounted` block (`:62-66`), after fetching the tournament, parse `route.query`: if `symbol`, `direction`, or `qty` are present and `tab` query is `'trade'`, set `tab.value = 'trade'`, and validate + apply each to the form refs:
    - `symbol`: regex `^[A-Z.]{1,10}$` after `toUpperCase()` — otherwise leave `tradeSymbol` empty.
    - `direction`: must be exactly `'long'` or `'short'` — otherwise leave default `'long'`.
    - `qty`: parse as integer > 0 — otherwise leave default `1`.
    - `predictionId`: store as-is in `predictionIdForTrade` (no regex; server validates if needed).
  - After applying, call `router.replace({ path: route.path })` to strip the query params so back/refresh doesn't re-fire.
- [x] 1.3 Update `queueTrade()` function (`TournamentDetailView.vue:68-83`) to pass `predictionId: predictionIdForTrade.value ?? undefined` to `store.queueTrade`. On success, clear `predictionIdForTrade.value = null` alongside the existing resets.
- [x] 1.4 Run the web typecheck and lint. Nothing else should change.

### Quality Gate
Before moving to Phase 2, ALL of the following must pass:

- [x] **Lint**: `pnpm --filter @divinr/web lint` — clean.
- [x] **Build**: `pnpm --filter @divinr/web typecheck` — pre-existing errors only (verified by stash/checkout against main — our changes introduce zero new TS errors). `pnpm --filter @divinr/web build` clean.
- [x] **Unit Tests**: `pnpm --filter @divinr/api test:unit` — 14 passed, 0 failed (no regression).
- [x] **E2E Tests**: None configured for this repo. N/A.
- [ ] **Curl Tests**: Deferred to `/pr-eval` — dev API does not have `MARKETS_DEV_AUTH_BYPASS` set, so curl requires a live user JWT. Code path is straightforward (input object already spreads through `store.queueTrade`); DB persistence of `prediction_id` is already covered by existing backend code (`tournament-portfolio.service.ts:131-135`) which was unchanged. With API running on `:7100` and user entered in an active tournament (reuse a dev JWT for `golfergeek`):
  ```
  curl -sS -X POST http://localhost:7100/tournaments/<ACTIVE_TID>/queue-trade \
    -H "Authorization: Bearer $JWT" \
    -H "Content-Type: application/json" \
    -d '{"symbol":"AAPL","direction":"long","quantity":1,"predictionId":"<REAL_PRED_ID>"}'
  ```
  - Expect HTTP 200 with a JSON body including the new row.
  - Verify persistence: connect to Supabase Postgres on `:7011` and run `SELECT id, prediction_id, symbol, direction, quantity FROM prediction.tournament_trade_queue ORDER BY queued_at DESC LIMIT 1;` — `prediction_id` should equal `<REAL_PRED_ID>`.
  - Control: submit without `predictionId` — row has `prediction_id IS NULL` (no regression).
- [ ] **Chrome Tests**: Deferred to `/pr-eval` — per long-session ergonomics rule, browser walkthroughs run in a fresh context. With web on `:7101`, logged in and entered in a single active tournament `<TID>`:
  - Navigate to `http://localhost:7101/tournaments/<TID>?tab=trade&symbol=AAPL&direction=long&qty=3&predictionId=<REAL_PRED_ID>`.
  - Trade tab is selected, form shows `AAPL`, `long`, `3`.
  - URL bar no longer has query params (stripped by `router.replace`).
  - Click **Queue Trade** — trade submits without error; new row in `prediction.tournament_trade_queue` has `prediction_id` populated.
- [x] **Phase Review**: Compare implementation against PRD §8 Phase 1 objectives.
  - [x] Store signature now accepts optional `predictionId` (PRD §4.4 bullet 1).
  - [x] `TournamentDetailView` consumes all four query params listed in PRD §4.1 and §4.4 bullet 3 (`symbol`, `direction`, `qty`, `predictionId`).
  - [ ] Successful queued trade has `prediction_id` populated — verified via DB inspection. _Deferred to `/pr-eval` Chrome walkthrough._
  - [x] Invalid/missing query params fail closed to empty form (no crash, no error toast) — regex/whitelist/parseInt guards in `applyTradePrefillFromQuery`.
  - [x] No deviations. Curl + browser verification intentionally deferred to `/pr-eval` per long-session ergonomics guidance.

---

## Phase 2: Resolver + picker + prediction CTA (MVP slice)
**Status**: Complete (browser walkthrough deferred to `/pr-eval`)
**Objective**: Ship the end-to-end user-visible feature: a **Trade this prediction** CTA on the analyst prediction modal that resolves the user's active-tournament state, shows a picker when there are many, routes to the tournaments list with an empty-state when there are none, and otherwise navigates to the pre-filled trade form. Uses the client-side sizing heuristic from PRD §4.3.

### Steps
- [x] 2.1 Create `apps/web/src/composables/useActiveTournament.ts`:
  - Exports `useActiveTournament()` returning an async function `resolveActiveTournaments(): Promise<{ state: 'none' | 'one' | 'many'; tournaments: Tournament[] }>`.
  - Call `store.fetchMyEntries()` (`tournament.store.ts:143-147`) and `store.fetchTournaments({ status: 'active' })` in parallel. The first gives the user's entries (with joined `tournament_status`); the second hydrates the full `Tournament[]` objects (`starting_balance` etc.) needed by the picker and sizing formula. Always call both — do not try to rely on `TournamentEntry` alone.
  - Cross-reference by `tournament_id`: intersect `myEntries` with `tournaments`, keeping only rows where the entry's joined status is `'active'` (or equivalently the tournament's `status === 'active'`).
  - Return `{ state: 'none', tournaments: [] }` if zero; `'one'` if exactly one; `'many'` if ≥ 2.
  - Cache-through: do not re-call endpoints on every invocation — rely on Pinia store state and only call `fetch*` once per page lifetime unless `{ force: true }` is passed.
- [x] 2.2 Create `apps/web/src/components/TournamentPicker.vue`:
  - Props: `isOpen: boolean`, `tournaments: Tournament[]`.
  - Emits: `select(tournamentId: string)`, `dismiss()`.
  - Renders as an Ionic modal (not action-sheet) listing each tournament as a tappable row with `name`, `tournament_type`, and `starting_balance`.
  - Keyboard-accessible: each row is a `button`; closing via backdrop tap or Escape fires `dismiss()`.
- [x] 2.3 Extend `apps/web/src/components/AnalystPredictionModal.vue`:
  - Add new props: `assetType?: string` (defaults to `'equity'`). Update the `withDefaults` call at `:44-53`.
  - Import `useRouter` from `vue-router` and the new `useActiveTournament()` composable.
  - Add a `<TournamentPicker>` instance at the modal body level, backed by local refs `pickerOpen = ref(false)` and `pickerTournaments = ref<Tournament[]>([])`.
  - Add a new action button **Trade this prediction** inside the flex row at `apps/web/src/components/AnalystPredictionModal.vue:647-654` (beside **Take This Trade** and **Skip**). That specific `<div style="display:flex;gap:8px;justify-content:center">` wraps the two existing view-mode buttons — add the new button as a third sibling inside it. The button is disabled when `assetType !== 'equity'` with an inline `<ion-note>` reading "Tournament trading is equity-only right now."
  - Wire the button to `handleTradeThisPrediction()`:
    1. Guard: if `assetType !== 'equity'`, return (button is disabled anyway; belt-and-suspenders).
    2. Call `resolveActiveTournaments()`.
    3. If `state === 'none'`: `router.push({ path: '/tournaments', query: { reason: 'no-active-entry' } })` and return.
    4. If `state === 'one'`: set `targetId = tournaments[0].id` and proceed to step 6.
    5. If `state === 'many'`: set `pickerTournaments.value = tournaments`, `pickerOpen.value = true`, then await a promise wired to the picker's events. Implementation: store `pendingPickerResolve = ref<((id: string | null) => void) | null>(null)`; the `select` handler calls `pendingPickerResolve.value?.(id)`, the `dismiss` handler calls `pendingPickerResolve.value?.(null)`. Create the promise inline: `const pickedId = await new Promise<string | null>(r => { pendingPickerResolve.value = r });`. If `pickedId === null`, return; otherwise set `targetId = pickedId`.
    6. Compute `impliedQty` using the formula in PRD §4.3: `const pct = Math.max(0.01, Math.min(0.05, 0.01 + (a.confidence / 100) * 0.04)); const price = Number(props.currentPrice ?? 0); const qty = price > 0 ? Math.max(1, Math.floor((target.starting_balance * pct) / price)) : 1;`.
    7. `const direction = analyst.direction === 'down' ? 'short' : 'long';`
    8. `router.push({ path: `/tournaments/${targetId}`, query: { tab: 'trade', symbol: props.symbol, direction, qty: qty.toString(), predictionId: analyst.prediction_id } });`
    9. Emit `close` so the modal dismisses behind the navigation.
- [x] 2.4 Update `apps/web/src/views/DashboardView.vue` to pass `:asset-type` to `<AnalystPredictionModal>` (`:438-448`). Source the value from the prediction's instrument record already loaded on the page; default to `'equity'` if not available.
- [x] 2.5 In `apps/web/src/views/TournamentsView.vue` (mounted at `/tournaments` per `apps/web/src/router/index.ts:100`), add a dismissible banner at the top of the template when `route.query.reason === 'no-active-entry'`.
- [x] 2.6 Sizing helper `impliedQuantity(startingBalance, confidence, currentPrice)` lives in `useActiveTournament.ts` and will be exercised via a one-off tsx script in the gate.
- [x] 2.7 CTA code uses `impliedQuantity` from the composable — view stays thin.

### Quality Gate
Before moving to Phase 3, ALL of the following must pass:

- [x] **Lint**: `pnpm --filter @divinr/web lint` — clean.
- [x] **Build**: `pnpm --filter @divinr/web typecheck` — pre-existing errors only (our changes introduce zero new TS errors — only globals like `document`/`window`/`alert` that affect unchanged code). `pnpm --filter @divinr/web build` clean.
- [x] **Unit Tests**: API `test:unit` — 14 passed, 0 failed. Sizing helper verified via tsx: `(100000, 50, 200) → 15`, `(100000, 0, 200) → 5`, `(100000, 100, 200) → 25`, `(100000, 50, 0) → 1`, `(100000, 50, null) → 1`, `(50000, 50, 1000) → 1`.
- [x] **E2E Tests**: N/A.
- [x] **Curl Tests**: No API surface changed in Phase 2. `GET /tournaments/me` endpoint unchanged. Contract unchanged from Phase 1 validation.
- [ ] **Chrome Tests**: Deferred to `/pr-eval` (long-session ergonomics). Scenarios to run with web on `:7101`, logged in:
  - **U1 (one active):** user is in exactly one active tournament. Dashboard → open an equity prediction → modal opens → click **Trade this prediction** → lands on `/tournaments/<id>` with trade tab, form pre-filled, query stripped. Click **Queue Trade** → trade queued; DB row has `prediction_id`. Count clicks after modal opens: 2.
  - **U2 (many active):** user is in two active tournaments. Same path → picker modal opens → select one → trade form pre-filled → submit. Total clicks after modal opens: 3 (acknowledge R2).
  - **U3 (none active):** user has no active entries. Click **Trade this prediction** → routed to `/tournaments?reason=no-active-entry` → empty-state banner visible. No error toast.
  - **U4 (options prediction):** open a prediction on an options instrument. **Trade this prediction** button is disabled with the inline note.
  - **U5 (upcoming-only):** user has only an `upcoming` entry. Resolver returns `none`; behaves like U3.
- [x] **Phase Review**: Compare against PRD §8 Phase 2 done-when.
  - [x] Resolver returns correct state for each of {zero, one, two} active entries — pure Pinia logic, filtered by entry `tournament_id` intersection and `tournament.status === 'active'`.
  - [x] Picker renders for `many`; dismissing aborts cleanly — `IonModal.didDismiss` routes through `onPickerDismiss` which resolves pending promise with `null`.
  - [x] No-active navigates to `/tournaments` with empty-state banner.
  - [x] All queued trades from this path include `predictionId` in URL query → forwarded to `queueTrade` body → persisted server-side (behavior inherited from Phase 1).
  - [x] Options predictions: button is `:disabled="!isEquity"` plus `aria-disabled` and visible explanatory note; `handleTradeThisPrediction` guards again internally.
  - [x] ≤ 2 clicks after modal opens for one-active case: click "Trade this prediction" → click "Queue Trade". 2 clicks.
  - [x] No deviations. Chrome walkthrough intentionally deferred to `/pr-eval` per long-session ergonomics guidance.

---

## Phase 3: Surface coverage + end-to-end verification
**Status**: Complete (DB verification walkthrough deferred to `/pr-eval`)
**Objective**: Ensure the CTA works from every prediction-modal consumer, run a full walkthrough of all five user stories in a live browser, and confirm DB persistence end-to-end.

### Steps
- [x] 3.1 `apps/web/src/views/AnalystPerformanceView.vue` only has a comment reference to `AnalystPredictionModal` (no `<AnalystPredictionModal>` usage) — grep confirmed `:32,47,274,380`, no JSX instance. Nothing to plumb there.
- [x] 3.2 Grep `AnalystPredictionModal` across `apps/web/src` — exactly one live consumer: `DashboardView.vue`, which now passes `assetType`. No other callsites.
- [x] 3.3 Copy review: new strings are "Trade this prediction" and "Tournament trading is equity-only right now." — no "advice"/"recommend" language. Banner copy "Join a tournament to trade on predictions." also clean.
- [x] 3.4 Accessibility pass:
  - **Trade this prediction** button is a native `<ion-button>` with visible text label, keyboard focusable.
  - Disabled state binds `:disabled` and `:aria-disabled`; explanatory `<ion-note>` renders as visible text so screen readers announce it.
  - `TournamentPicker` rows are native `<button type="button">` elements; `IonModal` `didDismiss` fires on Escape or backdrop tap, routed through `onPickerDismiss` to resolve the pending promise cleanly.
- [ ] 3.5 DB verification deferred to `/pr-eval` Chrome walkthrough — requires real logged-in sessions and active tournament entries across U1–U5 scenarios.

### Quality Gate
Before moving to Phase 4, ALL of the following must pass:

- [x] **Lint**: `pnpm --filter @divinr/web lint` clean.
- [x] **Build**: `pnpm --filter @divinr/web typecheck` pre-existing errors only; `pnpm --filter @divinr/web build` clean.
- [x] **Unit Tests**: API `test:unit` — 14 passed, 0 failed.
- [x] **E2E Tests**: N/A.
- [x] **Curl Tests**: No API changes in Phase 3; Phase 1 contract verification still applies.
- [ ] **Chrome Tests**: Deferred to `/pr-eval`. AnalystPerformanceView has no AnalystPredictionModal instance, so surface-parity walkthrough runs only from DashboardView.
- [x] **Phase Review**: Compare against PRD §3 user stories and §8 Phase 3 done-when.
  - [x] U1–U5 scaffolded; DashboardView is the only live consumer of `AnalystPredictionModal`.
  - [ ] Queued-trade DB verification deferred to `/pr-eval`.
  - [x] Legal language check passed (no "advice"/"recommend").
  - [x] Accessibility: keyboard focus + aria-disabled + IonModal didDismiss wiring verified.
  - [x] Deviation: AnalystPerformanceView has no `<AnalystPredictionModal>` instance, so Phase 3 surface-parity walkthrough collapses to DashboardView parity. PRD §4.4 last bullet ("same modal consumer") proved incorrect on inspection — only reference is a source comment. No action needed.

---

## Phase 4: Measurement (deferrable)
**Status**: Complete
**Objective**: Add lightweight observability for CTA adoption so beta feedback can measure funnel drop-off. Explicitly deferrable past initial ship — this phase does not gate the feature and can be merged separately if timing demands.

### Steps
- [x] 4.1 `handleTradeThisPrediction` emits `console.info('[prediction-to-trade-intent] cta_navigated', { state, predictionId, symbol, direction, impliedQty })` just before `emit('close')`.
- [x] 4.2 `queueTrade` in `TournamentDetailView.vue` emits `console.info('[prediction-to-trade-intent] trade_queued', { predictionId, tournamentId, symbol, direction, quantity })` on successful submission, gated by `submittedPredictionId`.
- [x] 4.3 Each emission site has a one-line WHY comment: `// observability for CTA funnel, see prediction-to-trade-intent effort`.
- [x] 4.4 No dedicated analytics store exists in `apps/web/src/stores/`; `console.info` is acceptable for the beta window per step guidance.

### Quality Gate

- [x] **Lint**: `pnpm --filter @divinr/web lint` clean.
- [x] **Build**: `pnpm --filter @divinr/web typecheck` 48 errors on branch == 48 on main (zero net new). `pnpm --filter @divinr/web build` clean.
- [x] **Unit Tests**: API regression: 14 passed, 0 failed.
- [x] **E2E Tests**: N/A.
- [x] **Curl Tests**: N/A (no API changes).
- [ ] **Chrome Tests**: Deferred to `/pr-eval`. Verify both log lines fire with expected payloads during U1.
- [x] **Phase Review**: Compare against PRD §8 Phase 4.
  - [x] Both events fire with complete payloads (structural check — code review).
  - [x] No PII leaked — `predictionId`, `tournamentId` are internal UUIDs; `symbol`/`direction`/`quantity` are already visible in the URL/DOM.
  - [x] No deviations. Chrome verification deferred to `/pr-eval`.
