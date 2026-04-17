# Slot-Based Triple Enablement UI — Product Requirements Document

## 1. Overview

Users need a way to assemble and manage their portfolio of enabled **(author, analyst, instrument) triples** — the specific lenses through which they view Divinr's analysis. Today the portfolio screen shows positions and P&L but has no concept of which triples the user is watching. This effort adds the data layer, API, and frontend surfaces that let users enable/disable triples, view their portfolio grouped by instrument, and navigate between per-triple views.

Enabling a triple is **filtering, not commissioning**. The system already runs every triple that exists; enablement controls what the user sees. There is no slot cap at launch.

## 2. Goals & Success Criteria

| Goal | Measurable Criterion |
|------|---------------------|
| Users can assemble a portfolio of triples | A user can enable ≥1 base triple and ≥1 authored triple and see both in their portfolio view |
| Multiple lenses on the same instrument are clearly distinguished | When a user has base AAPL and a custom AAPL variant enabled, both appear with unambiguous authorship labels |
| Enable/disable is fluid and immediate | Toggling a triple updates the UI optimistically; round-trip <500ms perceived |
| Slot model feels natural, not quota-policing | No visible quota enforcement; slot count indicator is present but unobtrusive |
| Per-triple navigation works | Clicking an enabled triple navigates to its predictor stream, risk summary, and prediction history |
| Switching between an instrument's variants is one click | From any triple detail view, the user can switch to another triple on the same instrument without returning to the portfolio screen |

## 3. User Stories / Use Cases

**US-1: Enable a base triple.** A Basic user opens the portfolio, clicks "Add," selects AAPL, selects the base analyst, and enables the (base, base-analyst, AAPL) triple. It appears in their portfolio view immediately.

**US-2: Enable an authored triple.** A user who has authored a "China-Aware" AAPL instrument contract and a "Macro Focus" analyst enables (self, Macro Focus, AAPL China-Aware) via the same flow. It coexists alongside any base AAPL triples.

**US-3: Compare lenses on the same instrument.** A user with both base AAPL and custom AAPL enabled clicks into the base triple detail, sees its predictions and risk summary, then one-clicks to switch to the custom triple's view for comparison.

**US-4: Disable a triple.** A user disables a triple they no longer want to watch. It disappears from their portfolio view. If it's an authored triple, a note confirms that authorship billing continues until the authored content itself is deleted.

**US-5: Re-enable a previously disabled triple.** A user re-enables a triple. It restores instantly with no analytics gap — the system never stopped running it.

**US-6: New user sees a starter portfolio.** A new user's portfolio is pre-populated with a default set of base triples (configurable, e.g., top 5 base instruments × base analyst), giving them immediate value without requiring manual setup.

## 4. Technical Requirements

### 4.1 Architecture

The enablement layer sits between the existing wiring system (which controls what's *runnable*) and the frontend (which shows what the user *watches*). Relationship wiring in `prediction.viewer_instrument_analyst_assignments` defines authorship-level connectivity. Enablement defines the user's active portfolio view.

```
Wiring (authorship: what can run) → Enablement (portfolio: what user sees) → Frontend (display)
```

The existing `WiringService` and `ActiveAuthorshipService` remain unchanged. A new `EnablementService` reads from a new table and exposes the portfolio composition API.

### 4.2 Data Model Changes

**New table: `prediction.user_enabled_triples`**

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK, default `gen_random_uuid()` |
| `user_id` | `text` | NOT NULL, the user whose portfolio this entry belongs to |
| `author_user_id` | `text` | NULL = base content, non-null = authored content |
| `analyst_id` | `uuid` | NOT NULL, FK to `prediction.market_analysts` |
| `instrument_id` | `uuid` | NOT NULL, FK to `prediction.instruments` |
| `enabled_at` | `timestamptz` | NOT NULL, default `now()` |
| `disabled_at` | `timestamptz` | NULL while enabled |

**Unique constraint:** `(user_id, COALESCE(author_user_id, 'base'), analyst_id, instrument_id)` — one row per triple per user. Re-enabling clears `disabled_at` rather than inserting a new row.

**Index:** `user_id WHERE disabled_at IS NULL` — the hot query path (list my active triples).

**Default seeding:** When a user first accesses enablement (or on account creation), if they have zero enabled triples, auto-enable a configurable starter set. Controlled by a `DEFAULT_STARTER_TRIPLES` configuration (e.g., all base analyst × top 5 base instruments by activity).

### 4.3 API Changes

All endpoints authenticated via existing Supabase auth middleware. New endpoints on `MarketsController`:

| Method | Path | Body / Params | Returns |
|--------|------|---------------|---------|
| `GET` | `/markets/portfolio/enabled-triples` | — | `EnabledTriple[]` — active triples with analyst/instrument metadata joined |
| `POST` | `/markets/portfolio/enable-triple` | `{ analystId, instrumentId, authorUserId? }` | `EnabledTriple` |
| `POST` | `/markets/portfolio/disable-triple` | `{ analystId, instrumentId, authorUserId? }` | `{ disabled: true }` |
| `GET` | `/markets/portfolio/available-triples` | `?instrumentId=` (optional filter) | `AvailableTriple[]` — union of base + user's authored, with enabled state |

**`EnabledTriple` shape:**
```typescript
interface EnabledTriple {
  id: string;
  authorUserId: string | null;
  analystId: string;
  analystName: string;
  analystSlug: string;
  isAuthoredAnalyst: boolean;
  instrumentId: string;
  instrumentSymbol: string;
  instrumentName: string;
  isAuthoredInstrument: boolean;
  enabledAt: string;
}
```

**`AvailableTriple` shape:**
```typescript
interface AvailableTriple {
  analystId: string;
  analystName: string;
  analystSlug: string;
  isAuthoredAnalyst: boolean;
  instrumentId: string;
  instrumentSymbol: string;
  instrumentName: string;
  isAuthoredInstrument: boolean;
  isEnabled: boolean;
  authorUserId: string | null;
}
```

**Available-triples logic:** The universe of triples a user can enable is:
- All `(base analyst × base instrument)` combinations (base analysts and instruments where `user_id IS NULL`)
- All `(authored analyst × any instrument the user has wired it to)` via `viewer_instrument_analyst_assignments`
- All `(any analyst wired to authored instrument × authored instrument)` via the same wiring table

This query joins `market_analysts`, `instruments`, and `viewer_instrument_analyst_assignments` filtered by `user_id IS NULL OR user_id = :currentUser`, then left-joins `user_enabled_triples` to annotate enabled state.

### 4.4 Frontend Changes

**4.4.1 Portfolio View Rework (`PortfolioDashboardView.vue`)**

Add a new tab/segment to the existing portfolio view: **"My Triples"** alongside the existing "My Portfolio" and "Analyst Portfolios" tabs. This tab shows enabled triples grouped by instrument:

```
AAPL
  ├─ Base Analyst (base)          [Disable]
  └─ Macro Focus (yours)          [Disable]

TSLA
  └─ Base Analyst (base)          [Disable]

[+ Add to Portfolio]
```

Each instrument group is collapsible. The authorship label distinguishes base vs authored content: `(base)` for base triples, `(yours)` for user-authored, `(shared by @handle)` for future shared content.

Slot count shown as a subtle badge: "12 active triples" — no cap indicator unless caps are enabled.

**4.4.2 Add-to-Portfolio Flow**

Multi-step inline flow (not a separate page):

1. **Pick instrument** — searchable list of all instruments (base + authored), grouped: "Your Instruments" then "Base Instruments". Instruments already fully enabled (all available analysts enabled) are visually muted.
2. **Pick triples** — for the selected instrument, show all available (analyst × instrument) combinations as toggleable rows. Already-enabled triples shown as checked. User checks/unchecks and clicks "Save."

**4.4.3 Naming Collision UX**

When multiple instrument contracts share the same symbol (e.g., base AAPL vs. authored AAPL):
- List items show: `AAPL` with a sub-label — `Base contract` vs. `Your China-aware contract`
- The sub-label is the instrument's `name` field, which is distinct per authored variant
- If names are also identical (unlikely but possible), append `(by @author)` as a disambiguator

**4.4.4 Per-Triple Detail Navigation**

Clicking an enabled triple in the portfolio navigates to the existing `InstrumentDetailView` with additional query params: `?analystId=X&authorUserId=Y`. The instrument detail view filters its predictor stream, risk summary, and prediction history to the selected triple's `author_user_id` and `analyst_id`.

**4.4.5 Variant Switcher**

On the instrument detail view, when multiple triples exist for the same instrument, show a chip/tab bar at the top:

```
[Base Analyst (base)] [Macro Focus (yours)]
```

Clicking a chip switches the view to that triple without returning to the portfolio. This is implemented as query-param navigation — the view re-fetches data for the new triple context.

**4.4.6 New Pinia Store: `enablement.store.ts`**

```typescript
// State
enabledTriples: EnabledTriple[]
availableTriples: AvailableTriple[]
loading: boolean

// Actions
fetchEnabledTriples(): Promise<void>
fetchAvailableTriples(instrumentId?: string): Promise<void>
enableTriple(analystId, instrumentId, authorUserId?): Promise<void>  // optimistic
disableTriple(analystId, instrumentId, authorUserId?): Promise<void> // optimistic
```

Optimistic updates: `enableTriple` immediately adds to `enabledTriples` and reverts on API failure. `disableTriple` immediately removes and reverts on failure.

### 4.5 Infrastructure Requirements

- **Migration:** Single SQL migration for the `user_enabled_triples` table, unique constraint, and partial index
- **Schema service:** `MarketsSchemaService.ensureSchema()` extended to include the new table (re-entrant DDL pattern)
- **No new services or modules needed** — `EnablementService` is a new `@Injectable()` in `apps/api/src/markets/services/`, registered in the existing markets module

## 5. Non-Functional Requirements

- **Performance:** `GET /enabled-triples` must return in <200ms for a user with up to 200 enabled triples. The partial index on `(user_id) WHERE disabled_at IS NULL` ensures this is a simple index scan.
- **Scalability:** The table is append-friendly. Soft-delete pattern (disabled_at) avoids row churn and preserves re-enable history. No materialized views needed at current scale.
- **Security:** All endpoints enforce `user_id` from the authenticated session. Users cannot enable triples belonging to other users' authored content (unless sharing UI lands later). The `available-triples` query is scoped to base + user's own authored content.
- **Compatibility:** Existing portfolio features (positions, P&L, queued trades) are untouched. The new "My Triples" tab is additive. Existing views continue to work exactly as before.

## 6. Out of Scope

- **Triple data model itself** — already shipped in `triple-model-reasoning-continuity`
- **Hard quota enforcement** — `BASIC_SLOT_CAP` env var defaults to unlimited; enforcement logic deferred
- **Authorship billing** — handled by `user-authored-custom-content` and `divinr-basic-club-model`
- **Shared content enablement** — enabling another user's shared triples requires the sharing UI; for now, only base + own authored content is available
- **Discovery surfaces** — empty-slot prompts, popular-triple suggestions, community board integration are post-v1
- **Preset bundles** — "Tech-Forward 10" style curated bundles are a future feature
- **Filtering/search for hundreds of base triples** — v1 uses a simple searchable list; advanced faceted filtering deferred to when the instrument count warrants it

## 7. Dependencies & Risks

| Dependency | Status | Risk |
|-----------|--------|------|
| `triple-model-reasoning-continuity` | Shipped | None — `author_user_id` columns and triple-keyed indexes are live |
| `user-authored-custom-content` | Shipped | None — authoring, wiring, and billing are live |
| `viewer_instrument_analyst_assignments` table | Live | The wiring table defines the universe of available triples for authored content |

**Technical Risks:**

1. **Available-triples query complexity.** The join across analysts, instruments, wiring assignments, and enabled state could be slow if base content grows large. **Mitigation:** For base content, the cross-product is (base analysts × base instruments), which is currently small (<50 combinations). If this grows, add a materialized view refreshed on analyst/instrument create.

2. **Default starter set maintenance.** The auto-seeded starter triples could become stale if base instruments are deactivated. **Mitigation:** The seeding query selects only active base instruments at seed time. Deactivated instruments naturally disappear from the enabled-triples query (join filters `is_active = true`).

3. **Instrument detail view triple-filtering.** The existing `InstrumentDetailView` doesn't filter by `author_user_id` or `analyst_id`. Adding query-param filtering requires touching predictor, risk, and prediction queries. **Mitigation:** The `resolve-triple-context` utility and `author_user_id` columns are already on all relevant tables, so filtering is additive WHERE clauses, not structural changes.

## 8. Phasing

### Phase 1: Data Layer & API

**Deliverables:**
- Migration: `prediction.user_enabled_triples` table with unique constraint and partial index
- `EnablementService` with enable, disable, list-enabled, list-available methods
- Four API endpoints on `MarketsController`
- Default starter-set seeding logic (triggered on first `GET /enabled-triples` when user has zero rows)
- Unit tests for service methods

**Validation gate:** All four endpoints return correct data for a test user with base + authored triples. Enable/disable round-trips correctly. Starter set seeds on first access.

### Phase 2: Portfolio View — My Triples Tab

**Deliverables:**
- New Pinia store `enablement.store.ts` with optimistic enable/disable
- "My Triples" tab added to `PortfolioDashboardView.vue`
- Enabled triples displayed grouped by instrument with authorship labels
- Slot count indicator (unobtrusive)
- Disable button per triple with authored-billing disclaimer

**Validation gate:** A user sees their enabled triples grouped by instrument. Disabling removes from view. Slot count reflects reality. Authored triples show billing disclaimer on disable.

### Phase 3: Add-to-Portfolio Flow

**Deliverables:**
- Inline add-to-portfolio flow in the portfolio view
- Instrument picker (searchable, grouped by authorship)
- Per-instrument triple picker (analyst × instrument toggles)
- Naming collision disambiguation labels
- Enable action with optimistic UI

**Validation gate:** A user can discover, search, and enable new triples from the available universe. Multiple AAPL variants are clearly distinguished. Newly enabled triples appear in the portfolio immediately.

### Phase 4: Per-Triple Navigation & Variant Switcher

**Deliverables:**
- Instrument detail view accepts `?analystId=X&authorUserId=Y` query params
- Predictor stream, risk summary, and prediction history filtered to the selected triple
- Variant switcher chip bar on instrument detail view (when multiple triples exist for the instrument)
- Portfolio triple rows link to the filtered instrument detail view

**Validation gate:** Clicking a triple in the portfolio opens the correct filtered view. The variant switcher allows one-click switching between lenses on the same instrument. Data shown is accurate to the selected triple.
