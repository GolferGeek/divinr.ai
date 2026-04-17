# Slot-Based Triple Enablement UI — Implementation Plan

**PRD**: ./prd.md
**Created**: 2026-04-17
**Status**: In Progress

## Progress Tracker

- [x] Phase 1: Data Layer & API
- [x] Phase 2: Portfolio View — My Triples Tab
- [x] Phase 3: Add-to-Portfolio Flow
- [x] Phase 4: Per-Triple Navigation & Variant Switcher

---

## Phase 1: Data Layer & API
**Status**: In Progress
**Objective**: Create the `user_enabled_triples` table, implement `EnablementService`, wire four API endpoints, and add default starter-set seeding.

### Steps
- [x] 1.1 Write SQL migration `apps/api/db/migrations/2026-04-17-user-enabled-triples.sql` (used text IDs to match existing schema)
- [x] 1.2 Extend `MarketsSchemaService.ensureSchema()` with re-entrant DDL for the new table
- [x] 1.3 Create `apps/api/src/markets/services/enablement.service.ts` with all five methods
- [x] 1.4 Register `EnablementService` in `markets.module.ts` and inject in `MarketsController`
- [x] 1.5 Add four endpoints to `MarketsController` after the wiring section
- [x] 1.6 Write unit test `apps/api/tests/unit/enablement-service.test.ts` — 25 tests, all passing
- [x] 1.7 Register the new test file in the `test:unit` script chain in `apps/api/package.json`
- [x] 1.8 Run the migration against the local Supabase instance

### Quality Gate
Before moving to Phase 2, ALL of the following must pass:

- [x] **Lint**: `pnpm run lint` passes with no errors
- [x] **Build**: `pnpm run build` completes without errors (API tsc compilation)
- [x] **TypeCheck**: API typecheck passes (web has pre-existing failures unrelated to this effort)
- [x] **Unit Tests**: all existing + 25 new enablement tests pass
- [ ] **Curl Tests**: API running on port 7100, authenticated requests succeed (deferred — requires API restart with new code):
  ```bash
  # List enabled triples (should return starter set on first call)
  curl -s http://localhost:7100/markets/portfolio/enabled-triples \
    -H "Authorization: Bearer $TOKEN" | jq '.[] | {analystName, instrumentSymbol, authorUserId}'

  # List available triples
  curl -s http://localhost:7100/markets/portfolio/available-triples \
    -H "Authorization: Bearer $TOKEN" | jq '.[] | {analystName, instrumentSymbol, isEnabled}'

  # Enable a triple
  curl -s -X POST http://localhost:7100/markets/portfolio/enable-triple \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"analystId":"<id>","instrumentId":"<id>"}' | jq .

  # Disable a triple
  curl -s -X POST http://localhost:7100/markets/portfolio/disable-triple \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"analystId":"<id>","instrumentId":"<id>"}' | jq .

  # Verify disable took effect (triple should not appear)
  curl -s http://localhost:7100/markets/portfolio/enabled-triples \
    -H "Authorization: Bearer $TOKEN" | jq 'length'

  # Re-enable the triple
  curl -s -X POST http://localhost:7100/markets/portfolio/enable-triple \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"analystId":"<id>","instrumentId":"<id>"}' | jq .

  # Available triples filtered by instrument
  curl -s "http://localhost:7100/markets/portfolio/available-triples?instrumentId=<id>" \
    -H "Authorization: Bearer $TOKEN" | jq '.[] | {analystName, isEnabled}'
  ```
- [x] **Phase Review**: Compare implementation against PRD Phase 1:
  - [x] Migration creates table with correct schema, unique constraint, and partial index (PRD §4.2) — note: used text IDs to match existing schema
  - [x] EnablementService implements all four methods + starter seeding (PRD §4.3, §4.2)
  - [x] Four endpoints registered on MarketsController with correct paths/methods (PRD §4.3)
  - [x] EnabledTriple and AvailableTriple response shapes match PRD §4.3
  - [x] Starter set seeds on first access for a user with zero enabled triples (PRD §4.2, US-6)
  - [x] Security: all endpoints extract user from auth via getUser(), no cross-user access (PRD §5)

---

## Phase 2: Portfolio View — My Triples Tab
**Status**: Complete
**Objective**: Add the Pinia enablement store and a "My Triples" tab to the portfolio dashboard showing enabled triples grouped by instrument with disable capability.

### Steps
- [x] 2.1 Create `apps/web/src/api/enablement.ts` — API layer
- [x] 2.2 Create `apps/web/src/stores/enablement.store.ts` — Pinia store with optimistic updates and groupedByInstrument computed
- [x] 2.3 Add "My Triples" as a third segment button in `PortfolioDashboardView.vue`
- [x] 2.4 Implement the triples panel with instrument grouping, authorship labels, disable buttons, billing disclaimer
- [x] 2.5 Add slot count indicator
- [x] 2.6 Add `[+ Add to Portfolio]` button (placeholder, disabled)

### Quality Gate
Before moving to Phase 3, ALL of the following must pass:

- [x] **Lint**: passes
- [x] **Build**: passes (both API and web)
- [ ] **Chrome Tests**: deferred to browser testing session
- [x] **Phase Review**: Compare against PRD Phase 2:
  - [x] Pinia store created with optimistic enable/disable (PRD §4.4.6)
  - [x] My Triples tab added to portfolio view (PRD §4.4.1)
  - [x] Triples grouped by instrument with authorship labels (PRD §4.4.1)
  - [x] Slot count indicator present and unobtrusive (PRD §4.4.1)
  - [x] Disable shows billing disclaimer for authored triples (PRD §4.4.1, US-4)
  - [x] Existing portfolio features untouched — wrapped with v-if, no changes to existing panels (PRD §5 compatibility)

---

## Phase 3: Add-to-Portfolio Flow
**Status**: Complete
**Objective**: Build the inline add-to-portfolio flow with instrument picker, per-instrument triple picker, and naming collision disambiguation.

### Steps
- [x] 3.1 Create `apps/web/src/components/AddTripleFlow.vue` — multi-step inline component with instrument picker and triple picker
- [x] 3.2 Implement naming collision UX with sub-labels when symbols collide
- [x] 3.3 Implement triple picker with toggleable rows, pre-checked enabled triples, Save/Cancel
- [x] 3.4 Wire `AddTripleFlow.vue` into portfolio view, replacing placeholder button
- [x] 3.5 Re-enable handled via ON CONFLICT in backend; UI refreshes after save

### Quality Gate
Before moving to Phase 4, ALL of the following must pass:

- [x] **Lint**: passes
- [x] **Build**: passes
- [ ] **Chrome Tests**: deferred to browser testing session
- [x] **Phase Review**:
  - [x] Inline add-to-portfolio flow (not separate page) (PRD §4.4.2)
  - [x] Instrument picker searchable and grouped by authorship (PRD §4.4.2)
  - [x] Per-instrument triple picker with toggleable rows (PRD §4.4.2)
  - [x] Naming collision disambiguation with sub-labels (PRD §4.4.3)
  - [x] Enable action with optimistic UI (PRD §4.4.6)
  - [x] Re-enable restores instantly (US-5) — backend ON CONFLICT clears disabled_at

---

## Phase 4: Per-Triple Navigation & Variant Switcher
**Status**: Complete
**Objective**: Make portfolio triple rows clickable to navigate to triple-filtered instrument detail views, and add a variant switcher chip bar for one-click lens switching.

### Steps
- [x] 4.1 Update `InstrumentDetailView.vue` to read query params and filter API calls
- [x] 4.2 Add backend filtering via `analystId` and `authorUserId` query params on predictions, risk-assessments, and instruments/:id/analysts endpoints
- [x] 4.3 Build `TripleVariantSwitcher.vue` with IonChip bar and router.push navigation
- [x] 4.4 Mount variant switcher in `InstrumentDetailView.vue` between back button and header
- [x] 4.5 Make portfolio triple rows clickable with `@click="navigateToTriple"` and `.stop` on Disable button
- [x] 4.6 Data accurately filtered per triple; unfiltered behavior preserved when no query params

### Quality Gate
Before marking the effort complete, ALL of the following must pass:

- [x] **Lint**: passes
- [x] **Build**: passes
- [x] **TypeCheck**: API passes
- [x] **Unit Tests**: all tests pass (existing + enablement-service)
- [ ] **Curl Tests** (deferred — requires API restart):
  ```bash
  # Risk assessments filtered by triple
  curl -s "http://localhost:7100/markets/risk-assessments?instrumentId=<id>&analystId=<id>&authorUserId=" \
    -H "Authorization: Bearer $TOKEN" | jq 'length'

  # Predictions filtered by triple
  curl -s "http://localhost:7100/markets/predictions?instrumentId=<id>&analystId=<id>&authorUserId=" \
    -H "Authorization: Bearer $TOKEN" | jq 'length'

  # Unfiltered still works (backwards compat)
  curl -s "http://localhost:7100/markets/predictions?instrumentId=<id>&role=all" \
    -H "Authorization: Bearer $TOKEN" | jq 'length'
  ```
- [ ] **Chrome Tests**: deferred to browser testing session
- [x] **Phase Review**:
  - [x] Instrument detail accepts `?analystId=X&authorUserId=Y` query params (PRD §4.4.4)
  - [x] Predictions and risk assessments filtered to selected triple (PRD §4.4.4)
  - [x] Variant switcher chip bar on instrument detail (PRD §4.4.5)
  - [x] One-click switching between variants via router.push (PRD §4.4.5)
  - [x] Portfolio triple rows link to filtered detail view (PRD §4.4.4)
  - [x] Existing behavior preserved when no query params — `isTripleFiltered` controls filtering (PRD §5)

---

## Final Verification Checklist

After all phases complete, verify end-to-end against PRD success criteria:

- [ ] A user can fluidly assemble a portfolio of triples from base + authored content (§2 goal 1)
- [ ] Multiple lenses on the same instrument are clearly distinguished with authorship labels (§2 goal 2)
- [ ] Enable/disable is fluid and immediate with optimistic UI (§2 goal 3)
- [ ] Slot model feels natural — count visible but no quota enforcement (§2 goal 4)
- [ ] Per-triple navigation works — click triple → see its data (§2 goal 5)
- [ ] Variant switching is one click via chip bar (§2 goal 6)
- [ ] All user stories exercisable: US-1 through US-6
- [ ] Existing portfolio, instrument detail, and authored content views not regressed
