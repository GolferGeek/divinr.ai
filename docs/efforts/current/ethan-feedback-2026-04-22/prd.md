# Ethan Feedback — 2026-04-22 — Product Requirements Document

## 1. Overview

Ethan (beta tester `bernierethanw@gmail.com`, author of the "EA" custom analyst)
sent a five-item feedback list on 2026-04-22. This effort bundles those five
items into one focused branch off clean `main` — the same "beta-coolness
polish" shape as `club-tournament-experience-polish`, but with item #4 taking
the correct implementation path (schema + write-path + migration, not a
UI-only shim), which pushes it to a several-days effort rather than
ship-in-a-day.

The five items: a broken back button on the analyst performance page, a
confusing "Analysts vs AI Scoring" tab split on instrument detail, a nav
label rename ("Instruments" → "Research"), article sourcing attribution on
analyst recommendations, and a too-tall landing-page card layout.

## 2. Goals & Success Criteria

- **G1 — Back button**: From `/performance` → analyst row → analyst
  performance detail → in-page back button lands on `/performance` (not
  `/analysts`). Deep-link entry (no history) still falls back to
  `/analysts`.
- **G2 — Portfolio tabs differentiation**: `/instruments/:id` Analysts tab
  and the second tab render visibly, structurally different content, AND the
  second tab's label communicates what it actually shows (it's article-
  relevance scoring, not "AI Scoring" of the instrument). A first-time
  viewer understands the distinction within 5 seconds.
- **G3 — Nav rename**: Sidebar reads "Research" instead of "Instruments" in
  every user-visible label. Route path `/instruments` unchanged. No
  user-visible string in `apps/web/src` contains "Instruments" as a nav
  label or page heading (exceptions: authoring tab label, authored-content
  sub-page headers, curriculum labels — all enumerated in §4.4.3).
- **G4 — Article sourcing**: An analyst recommendation surfaces a
  collapsible "Sources" section listing the articles that fed into that
  specific prediction, sourced from a new `contributing_article_ids` column
  on `prediction.market_predictions`. Pre-migration predictions (column
  `NULL`) gracefully fall back to the existing "recent articles the analyst
  scored" behaviour, labelled differently so the user knows it's an
  approximation.
- **G5 — Landing page scannability**: Dashboard prediction cards shrink
  enough that ≥5 cards fit above the fold on a 1440×900 desktop viewport
  (up from 2–3 today). A "Read more" CTA opens the full detail (existing
  `AnalystPredictionModal` with new Sources section from G4) without a
  route push.
- **G6 — Definition of Done**: All five surfaces have first-touch entries
  (new or updated) in `surface-content.ts` AND either extend an existing
  deep testing skill or add a new spec. The coverage script
  `apps/web/scripts/check-first-touch-coverage.mjs` passes. Every user-
  visible string complies with the CLAUDE.md UI vocabulary rule
  (analysis/signal, not prediction/advice).

## 3. User Stories / Use Cases

- **U1 (Ethan, beta tester)**: "I clicked from the performance dashboard
  into an analyst's detail, looked at their recent calls, and clicked the
  in-page back button. It dumped me on the analyst directory, not back on
  the performance page. I had to scroll-hunt my way back."
- **U2 (Ethan)**: "I opened a portfolio stock and saw two tabs: Analysts
  and AI Scoring. They looked the same to me. I don't know what AI Scoring
  adds that Analysts doesn't."
- **U3 (Ethan)**: "The sidebar says 'Instruments.' That's an engineering
  word. 'Research' would be warmer and tells me what I'm going there to
  do."
- **U4 (Ethan)**: "When I read an analyst's recommendation I want to see
  the articles they used. Right now there's no obvious way to get to them."
- **U5 (Ethan, and any new visitor)**: "On the home page, each stock report
  is huge. I can only see two or three at once. Give me a short take per
  stock with a 'Read more' to expand."
- **U6 (future beta tester with pre-2026-04-XX predictions)**: "The Sources
  section on this old analyst call says 'Articles used in this specific
  analysis weren't captured — showing recent articles this analyst scored
  for AAPL instead.' I understand it's a best-effort fallback for old
  data."

## 4. Technical Requirements

### 4.1 Architecture

Five independent surface edits on top of the existing stack (NestJS API with
tsx runtime, Vue 3 + Ionic web app, Postgres with re-entrant DDL in
`markets-schema.service.ts`). Item #4 requires one schema column, one
write-path capture, and one read-path change; everything else is pure
front-end. No new services, no new background workers, no cross-cutting
refactors.

Ordering follows the intention file's stated order:

1. Back button (smallest/isolated)
2. Portfolio tabs diagnosis + fix (isolated, front-end only)
3. Article sourcing (schema migration + write-path + read-path + UI)
4. Landing-page cards (depends on the Sources UI component from #3 for the
   expanded view)
5. Nav rename (mechanical; last because it touches the most files and
   conflicts cleanly at the end)

### 4.2 Data Model Changes

Single column addition to `prediction.market_predictions`:

```sql
alter table prediction.market_predictions
  add column if not exists contributing_article_ids jsonb;
```

- **Type**: `jsonb` (array of UUID strings). Not `text[]` so we can carry
  per-article relevance metadata later without a second migration if
  needed.
- **Nullability**: nullable. `NULL` semantic = "pre-migration row, sources
  unknown, fall back to approximation." `'[]'::jsonb` semantic = "runner
  ran but captured no articles for this specific analysis — tell the user
  no articles were used."
- **Default**: none (the application sets it explicitly at write time).
- **Backfill**: none. Existing rows remain `NULL`. New predictions from the
  runner onward carry accurate data.
- **Index**: none. The column is read-only for a specific prediction ID;
  we do not query by contained article.

Added via the existing `ensureSchema()` pattern in
`apps/api/src/markets/schema/markets-schema.service.ts`. That service runs
`create table if not exists` + `alter table … add column if not exists`
DDL on boot and is re-entrant; the new column slots in the same way
`author_user_id` did (see lines ~141–149 for the existing pattern).

No other table touched. `market_articles` and `market_predictors` already
have the columns needed (`id`, `title`, `url`, `published_at`,
`relevance_score`, `rationale`).

### 4.3 API Changes

**1. Prediction write path — `prediction-runner.service.ts`:**

- `runSingleAnalyst` (currently lines 202–360): the method already calls
  `loadPredictorLines(run.instrument_id, analyst.id)` at line 223 and uses
  only the rendered text. Change `loadPredictorLines` to also return the
  underlying article IDs (or add a sibling helper that returns the rows).
  Capture those IDs into `contributing_article_ids` when inserting into
  `market_predictions` at lines 332–344.
- `runArbitrator` (lines 370–471): the arbitrator synthesizes over analyst
  outcomes and does not read articles directly. Set
  `contributing_article_ids` to the **union of article IDs across its
  child analysts' predictions** for that run, deduplicated. If no analyst
  had any articles, write `'[]'::jsonb`.
  - **Plumbing**: widen the `PredictionOutcome` interface (currently at
    the top of `prediction-runner.service.ts`) to carry
    `article_ids: string[]` alongside `direction` / `confidence` /
    `rationale`. `runSingleAnalyst` populates it from the captured
    `loadPredictorLines` result; `runArbitrator` unions
    `analystOutcomes.flatMap(o => o.article_ids)` and dedupes via `Set`.
    Avoids a second DB read for IDs already known in-process.
- **Other write sites — audited and decided** (grep for
  `insert into prediction.market_predictions` across `apps/api/src`
  returned four hits):
  - `prediction-runner.service.ts:333` (`runSingleAnalyst`) — in scope,
    covered above.
  - `prediction-runner.service.ts:445` (`runArbitrator`) — in scope,
    covered above.
  - `markets.service.ts:2918–2975` (`persistPredictionFromArtifact`) —
    **currently unreferenced** (grep on `persistPredictionFromArtifact`
    found only the declaration site). Treat as dead code for this
    effort; do not modify. If it is ever revived, the reviver takes
    responsibility for capturing IDs.
  - `trade-recommendation.service.ts:490` — writes
    `role='portfolio_manager'` rows that synthesize an arbitrator
    outcome into a trade CTA. These rows are **out of scope for the
    Sources UI**: Sources is an analyst-reasoning concept (what did
    *this analyst* cite?), and portfolio_manager rows have no direct
    article lineage (they already aggregate arbitrator output, which
    itself aggregates analyst output). Leave
    `contributing_article_ids` `NULL` on these rows. The Sources
    component is wired only to analyst-role and arbitrator-role
    predictions (see §4.4.4); it is not rendered on trade-recommendation
    rows.
  - `day-trader-runner.service.ts` — read-only with respect to
    `market_predictions` (confirmed: only reads latest signals at
    ~lines 370–390). Not a write site.

**2. Prediction read path — `markets.service.ts` `getPredictionProvenance`
(lines 845–932):**

Current behavior: queries `market_predictors` joined to `market_articles`
to return up to 10 articles the analyst recently scored for that
instrument. Return shape already includes an `articles[]` field and a
`prediction` field.

New behavior:

- If `prediction.contributing_article_ids` is non-null and non-empty:
  query `market_articles` by those IDs (preserving the stored order,
  joining to `market_predictors` for `relevance_score` + `rationale`
  where available). Return `articles` = those rows. Set `fallback: false`
  on the response.
- If `contributing_article_ids` is `NULL`: run the existing query
  unchanged. Set `fallback: true` on the response.
- If `contributing_article_ids` is `'[]'::jsonb`: return `articles: []`.
  Set `fallback: false`.

**3. Route unchanged**: `GET /markets/predictions/:predictionId/provenance`
at `markets.controller.ts:1197–1202`. Response shape changes by adding a
single boolean field:

```jsonc
{
  "prediction": { ... },
  "analyst": { ... },
  "articles": [
    { "id": "...", "title": "...", "url": "...",
      "relevance_score": 0.87, "rationale": "...", "published_at": "..." }
  ],
  "riskAssessment": { ... },
  "sourceData": { ... },
  "memory": { ... },
  "fallback": true  // NEW: true when articles are the recent-scored approximation
}
```

Other API surfaces are unchanged. The web prediction list endpoints do not
need to return `contributing_article_ids` — the Sources section fetches
provenance on expand.

### 4.4 Frontend Changes

#### 4.4.1 Item #2 — Analyst Performance Back Button

**File**: `apps/web/src/views/AnalystPerformanceView.vue:152-155`

Replace the hard-coded `router-link="/analysts"` with an Ionic
history-aware back handler:

```vue
<ion-button fill="clear" @click="goBack" style="margin-bottom:8px">
  <ion-icon slot="start" :icon="arrowBackOutline" />
  Back
</ion-button>
```

```ts
import { useIonRouter } from '@ionic/vue';
const ionRouter = useIonRouter();
function goBack() {
  if (ionRouter.canGoBack()) {
    ionRouter.back();
  } else {
    router.replace('/analysts'); // deep-link fallback
  }
}
```

No other views currently use `useIonRouter` (grep confirmed). This effort
adds the first usage; do not generalize into a shared composable yet.

Confirm (mechanical grep) no other view hard-codes `router-link="/analysts"`
as a back-button pattern. If any do, leave them alone for this effort
(out of scope).

#### 4.4.2 Item #1 — Portfolio Stock Tabs Differentiation

**Finding from code review**: the two tabs are **structurally different
data**. `InstrumentAnalystPanel` (Analysts tab,
`InstrumentDetailView.vue:131-138`) renders per-analyst prediction +
risk-assessment rows. `PredictorScoringPanel` (second tab, line 146)
fetches `/predictors?instrumentId=…` which returns
`market_predictors` rows — **articles scored by analysts for relevance
to this instrument**, not "AI scoring" of the instrument itself. Ethan's
"they look the same" is because:

1. The second tab's label "AI Scoring" gives no hint that it's about
   articles.
2. The `PredictorScoringPanel` doesn't show the enclosing "this is a
   relevance-scored article" framing clearly — it renders
   `relevance_score` / `status` / `rationale` as three fields without
   surfacing the underlying article title/url (per
   `PredictorScoringPanel.vue:96-109`).

**Fix**:

- **Rename the tab**: `IonSegmentButton value="predictors"` label from
  "AI Scoring" → **"Article Relevance"** (or "Source Articles" — pick one,
  committed during implementation and used consistently). Decision rule:
  use "Article Relevance" because it matches the column name users see
  downstream and is honest about what's scored.
- **Update `PredictorScoringPanel.vue`** to surface the article context
  for each row: article title (linked to `article.url` with external-link
  icon) + published date + scoring analyst name. Keep the existing
  relevance score / status / rationale fields. The view should read as
  "articles this instrument's analysts scored recently," not "opaque
  scoring rows."
- **Add a first-touch entry** `'instrument.article-relevance'` to
  `surface-content.ts` explaining what this tab shows. Wire a
  `<FirstTouchPanel surface-key="instrument.article-relevance">` at the
  top of `PredictorScoringPanel.vue`.
- **Vocabulary check**: new copy must use "analysis/signal" framing where
  applicable; do not write "predictions" or "recommendations" in user-
  visible strings (CLAUDE.md rule). Identifiers like `predictors` /
  `PredictorScoringPanel` are code-side and exempt.

**No API changes** for this item. The existing `/predictors` endpoint
already returns article joins; the UI just needs to render them.

#### 4.4.3 Item #3 — "Instruments" → "Research" Nav Rename

**In scope (rename to "Research")**:

- `apps/web/src/layouts/DefaultLayout.vue:75` — nav item `title:
  'Instruments'` → `'Research'`.
- `apps/web/src/views/InstrumentsView.vue:51` — `<h1>Instruments</h1>` →
  `<h1>Research</h1>`. **Keep** the adjacent "Add Instrument" button
  (line 52–55) and the "New Instrument" modal title (line ~85) —
  those describe the *thing* being added (a ticker/instrument), which
  is an authoring action, and "Add Research" would be nonsensical.
  Authoring surface language stays "Instrument" per the §4.4.3
  out-of-scope rule.
- `apps/web/src/views/InstrumentContractEditorView.vue:283` — breadcrumb
  `&larr; Instruments` → `&larr; Research`.
- `apps/web/src/views/DashboardView.vue:235–236` — pathway card already
  labelled "Research" at line 235 but the description at line 236
  reads `Instruments &amp; analysis`. Change the description to
  something like `Tickers &amp; analysis` or `Stocks &amp; analysis`.
  **Decision**: use `Tickers &amp; analysis` (shorter, matches the
  UI vocabulary rule of avoiding engineering terms, and
  unambiguously points at what the section contains).
- `apps/web/src/views/DashboardView.vue:294` — `<ion-note>Instruments</ion-note>`
  label beneath the `instruments.items.length` stat → `<ion-note>Tickers</ion-note>`.
  It's a count of ticker rows, not a count of research documents, and
  `Tickers` keeps parity with the pathway description above.
- `apps/web/src/components/messaging/AttachmentPicker.vue:18` —
  picker option `{ value: 'instrument', label: 'Instruments' }`:
  **update the `label` field to `'Research'`**. The `value` key
  (`'instrument'`) stays per the identifier-exemption rule.
- `apps/web/src/components/messaging/EntityAttachmentCard.vue` —
  any user-visible strings referencing "instrument" in the rendered
  card output (grep during implementation; currently uses the
  value as a type discriminator, not a visible string, but verify).
- `apps/web/src/onboarding/surface-content.ts:34-40` — update the
  top-level `instruments:` key's `title`/`body` from "The instruments we
  watch" framing to "Research" framing. **Key stays `instruments`**
  (per intention: update title/body, not keys).
- `apps/web/src/onboarding/surface-content.ts:122-140` — the three
  `instrument.*` detail keys (`instrument.detail`, `instrument.debate`,
  `instrument.variant-switcher`) keep their keys but their bodies get a
  light touch-up only if they currently read "instrument" in a way that
  clashes (they read "ticker" / "this ticker" today — acceptable, likely
  no change needed, confirm during implementation).
- `apps/web/src/views/OnboardingSettingsView.vue:31` — reset-section
  label `'Instruments'` → `'Research'`. The `prefix: 'instrument'` stays
  (prefix is a key namespace).
- Any `<title>` / document-title references to "Instruments" for
  `/instruments` and `/instruments/:id`. Confirm via grep during
  implementation.

**Explicitly out of scope (stays "Instruments" / `instrument`)**:

- Route paths: `/instruments`, `/instruments/:id`,
  `/instruments/:id/contract`, `/instruments/mine`.
- Code identifiers: `useInstrumentsStore`, `InstrumentsView`,
  `InstrumentDetailView`, `InstrumentAnalystPanel`, etc.
- API request/response keys: `instruments[]`, `instrument_id`,
  `/markets/instruments`, `/predictors?instrumentId=`, etc.
- DB schema: `prediction.market_predictions.instrument_id`,
  `market_instruments`, etc.
- Authoring sub-navigation: `AuthoredContentView.vue:23` renders
  `<ion-label>Instruments</ion-label>` as the label of the authoring
  tab for "things this user authors." That's a **different user-facing
  context** — an author is managing their own published instruments
  (assets they've defined). Renaming to "Research" would be
  nonsensical there. Keep "Instruments" in:
    - `AuthoredContentView.vue:23` (tab label)
    - `authored/InstrumentsTab.vue:59` (`Your Instruments` header)
    - `authored/BillingTab.vue:118` (`Authored Instruments ($20 × n)`)
    - `AdminUserBillingView.vue:183-185` (admin billing detail)
    - `CurriculumDetailView.vue:152,169` (curriculum module editor field
      label)
    - `WiringMatrixView.vue:110-138` (wiring matrix headers/cells —
      admin/authoring surface, domain term is load-bearing)
  These are *authoring/admin* surfaces where "instrument" is the
  authored asset. The nav rename is about the consumer-side "go look at
  stocks" surface only.

**Vocabulary compliance**: "Research" must not introduce any
"prediction/advice/recommendation" language. The updated
`instruments:` first-touch body will continue to use "analysis" /
"signal" language per CLAUDE.md. Verified: no "prediction" or
"advice" appears in the current `instruments:` body.

#### 4.4.4 Item #4 — Sources Section on Analyst Recommendations

**Files**:
- `apps/web/src/components/InstrumentAnalystPanel.vue` — add a
  collapsible Sources section at the bottom of each analyst's panel.
- `apps/web/src/components/AnalystPredictionModal.vue` — add a Sources
  section to the modal (this is the modal opened from the dashboard and
  other views; the intention file mentions "PredictionDrawer" but that
  component does not exist in this codebase; `AnalystPredictionModal` is
  the current equivalent).

**Shape**:
- Collapsed by default, visible as a `<ion-item button>` or `<details>`
  labelled "Sources (n)" where n is the article count.
- On expand, fetch
  `GET /markets/predictions/:predictionId/provenance`
  (lazy — do not fetch on mount).
- Cache the result in-component so toggling doesn't re-fetch.
- Each article row: title (clickable — opens `url` in a new tab with
  `target="_blank" rel="noopener noreferrer"`) + published date
  (formatted) + relevance rationale (if present, ≤200 chars ellipsis).
  External-link icon (`openOutline` from `ionicons`) on the title.
- Response `fallback: true` → render subtle banner:
  *"Articles used in this specific analysis weren't captured — showing
  recent articles this analyst scored for {symbol} instead."*
  (Use the symbol from the existing prediction record available in the
  parent component.)
- Response `articles: []` (explicit empty, non-fallback) → render
  *"No articles were used in this analysis."*

**Extract the Sources section into a reusable component**
`apps/web/src/components/PredictionSources.vue` that takes
`predictionId` + `instrumentSymbol` as props. Both `InstrumentAnalystPanel`
and `AnalystPredictionModal` use the component. This is also the
component re-used by item #5's modal.

**First-touch entry**: add `'prediction.sources'` to `surface-content.ts`
with a one-line explainer ("The articles your analyst cited for this
specific call. External links open in a new tab.").

**Vocabulary check**: "analysis" / "signal" / "call"; no "prediction"
or "advice" in user-visible copy (identifiers fine).

#### 4.4.5 Item #5 — Landing-Page Card Slim-Down

**File**: `apps/web/src/views/DashboardView.vue:335–446`

**Current state** (confirmed by code review):
- Each card renders: symbol + consensus badge; **full analyst stance
  list** (filtered, `sortedAnalysts`, clickable rows with affinity
  badges); 120-char rationale preview; full trade-recommendation block
  (action chip + calibrating badge + 4 rows of Size/Entry/Stop/Target
  OR hold note); time-ago + "View Analysis" + "Trade" buttons.
- The ~120-char rationale is already short; the **card height is
  dominated by the stance list and trade-recommendation details**.

**Slim-down rules**:
- Stance list: collapse to a single compact row showing the top 3
  non-flat stances as small chips (analyst-name-initials + direction
  arrow + confidence%). Replace the vertical list with a horizontal
  chip row. Remaining analysts roll into a "+N more" chip.
- Trade recommendation: collapse the 4-row details block into a single
  line: `BUY 50 sh • $120.50 → $125.00` (action • size • entry →
  target). Entry/stop/target details move to the expanded modal.
  Hold/calibrating state collapses to a one-word chip.
- Rationale: keep the existing 120-char preview. If it already ends
  with `...`, add a "Read more" CTA link next to it that opens the
  modal. If the full rationale is ≤120 chars, show it fully and no
  "Read more".
- Footer: keep time-ago; collapse "View Analysis" + "Trade" into a
  single primary button ("View") that opens the modal. The modal
  already has the "Trade" CTA inside it.

**"Read more" target**: re-uses the existing `AnalystPredictionModal`
opened via `openAnalystModal(pred, 0)` at DashboardView:433. That modal
will gain the Sources section from §4.4.4. No new drawer or route.

**Density target**: after the slim-down, ≥5 cards fit above the fold on
a 1440×900 viewport (measured during implementation with browser
devtools; manual check acceptable — no automated density regression
test).

**Edge cases**:
- Card with no stances (`analysts.length === 0`): show "Single
  analyst analysis" note as today.
- Card with no trade recommendation: omit the trade-line entirely.
- Long symbols / long analyst display names: truncate chips to fit;
  ellipsis with title attribute for full text.

**First-touch**: update the existing `prediction.card` or `dashboard`
entry in `surface-content.ts` to reflect the new expand-to-see-more
pattern. Key unchanged.

#### 4.4.6 First-touch inventory additions

- `instrument.article-relevance` (new) — item #1 fix
- `prediction.sources` (new) — item #4 fix
- `instruments` (update title/body) — item #3 rename
- `dashboard` or `prediction.card` (update body) — item #5 card
  redesign. Pick whichever key currently backs the card UX; if the
  card is not individually keyed today, add a new
  `dashboard.prediction-card` entry.

The coverage script `apps/web/scripts/check-first-touch-coverage.mjs`
must pass with these additions.

### 4.5 Infrastructure Requirements

- **Migration execution**: `ensureSchema()` runs on API boot; the new
  `contributing_article_ids` column appears automatically on the next
  deploy. No manual migration step.
- **No new services, queues, or workers.**
- **No new env vars, no new secrets.**
- **No new Cloudflare / reverse-proxy config.**
- **Dev ports unchanged**: API 7100, web 7101, Postgres 7011.

## 5. Non-Functional Requirements

- **Performance**:
  - Provenance endpoint with stored IDs is bounded (≤ N article IDs
    per prediction, where N is practically < 20 per analyst-instrument
    run). Query cost ≤ existing fallback query (which is LIMIT 10).
  - Dashboard card render time with the compact stance chips is no
    worse than current (currently rendering full stance rows; chips
    are lighter DOM).
  - Write-path overhead of capturing article IDs is O(articles
    already loaded). No additional DB queries in the write path — the
    rows are already loaded by `loadPredictorLines`.
- **Security**:
  - External article URLs rendered in the Sources section use
    `rel="noopener noreferrer"` + `target="_blank"` (tabnabbing
    defense).
  - Provenance endpoint is already authenticated via existing
    `markets.controller.ts` auth middleware; no new auth surface.
- **Scalability**: single column addition on one table; table has a
  bounded growth rate (~1 row per analyst × instrument × run). No
  concerns at current scale.
- **Compatibility**:
  - API response adds one new field (`fallback: boolean`) — purely
    additive, no breaking change for web or any external consumer.
  - Pre-migration rows (`contributing_article_ids IS NULL`)
    gracefully fall back to the existing approximation behavior —
    zero runtime regression for historical data.
  - Tab rename ("AI Scoring" → "Article Relevance") is a pure UI
    string change; URLs / tab-param values (`value="predictors"`)
    unchanged so deep links and Playwright selectors targeting the
    segment value still work.
  - Nav rename ("Instruments" → "Research") keeps route paths and
    code identifiers — deep links and API contracts unchanged.

## 6. Out of Scope

- Stripe integration (tracked as `future/stripe-integration`).
- Any billing/payment work beyond what `user-billing-model` shipped.
- Custom-analyst authoring UX for authors.
- Multi-language / i18n of the new "Research" label.
- New article-ingestion sources (would be `custom-source-ingestion` in
  `future/`).
- The `dd97ef65-divinr-admin-user-billing-401` admin billing 401 bug
  (already in `docs/testing/findings/in-fix/`).
- The three "dashboard empty" testing-harness findings (authoring,
  portfolios, performance) — route through the testing-team fix
  queue.
- Renaming "Instruments" in authoring/admin/curriculum/wiring surfaces
  (see §4.4.3 "Explicitly out of scope" subsection).
- Renaming route paths, code identifiers, API keys, DB schema from
  `instrument*` to `research*`.
- Backfilling `contributing_article_ids` for historical predictions
  (not needed — fallback covers them).
- New drawer / side-panel component. The "Read more" target is the
  existing `AnalystPredictionModal`; no new surface created.
- Generalizing the `useIonRouter().back()` pattern into a shared
  composable (single consumer in this effort; factor later if a
  second view needs it).
- Automated density test for item #5 (≥5 cards above fold is
  measured manually).
- Arbitrator `contributing_article_ids` heuristics beyond "union of
  child analysts' article IDs" — e.g., weighting by child confidence
  or lineage annotations. Simple union is good enough for this effort.

## 7. Dependencies & Risks

**Dependencies**:
- Clean `main` (as of 2026-04-23, nothing blocking).
- `user-billing-model` is merged.
- No cross-team dependencies.

**Technical risks**:

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `loadPredictorLines` current shape drops article IDs before returning; extending it may regress the prompt-rendering path | Medium | Med | Add a sibling helper or widen the return shape to `{ lines: string[]; articleIds: string[] }`. Unit test the rendered text is unchanged. |
| Arbitrator "union of child article IDs" introduces double-count duplicates | Low | Low | Dedupe via `Set` in the runner before writing JSON. |
| `contributing_article_ids IS NULL` vs `'[]'::jsonb` semantic confusion in the read path | Medium | Med | Unit test all three states (null, empty array, populated). The service returns `fallback: true` only for `NULL`. |
| Nav rename causes Playwright selector breakage in e2e tests that assert `text=Instruments` | Medium | Low | Grep `apps/e2e/` for `Instruments` literals before the rename PR; update selectors in the same change set. |
| Renaming sidebar to "Research" confuses users who already learned "Instruments" | Low | Low | Beta cohort is small; Ethan himself asked for the change. Acceptable. |
| `PredictorScoringPanel` retitling to "Article Relevance" loses deep-link recognition | Low | Low | Tab `value="predictors"` unchanged — query-string deep links still work. |
| Landing-page slim-down removes info users relied on (full trade-rec details) | Medium | Low | Details still available in the modal via "Read more" / "View"; make the single-line trade summary genuinely readable. |
| Onboarding `surface-content.ts` first-touch coverage check breaks the build | High if forgotten, Low if remembered | Med | CLAUDE.md mandates coverage as Definition of Done; include the entries in the same PR. `check-first-touch-coverage.mjs` runs in the build — verified before push. |
| Schema change collides with concurrent `custom-source-ingestion` planning | Low | Low | That effort is in `future/` and touches `market_articles`, not `market_predictions`. No schema overlap. |
| A missed `market_predictions` write site silently persists rows with `contributing_article_ids = NULL` for genuinely new predictions | Low | Med | Write-site grep performed during PRD drafting identified four hits and decisions for each (§4.3 #1). Re-run the grep at Phase 3 start and widen coverage if any new writer has landed since. |
| Phase 6 grep misses a user-visible "Instruments" literal | Medium | Low | §4.4.3's in-scope list is explicit but non-exhaustive; Phase 6 re-runs the mechanical grep over `apps/web/src/**/*.{vue,ts}` and classifies each hit against the in-scope / out-of-scope rules. Gate on the grep output, not the bullet list. |

**Non-technical risks**:
- **Scope creep from item #1 diagnosis**: once we retitle the tab and
  enrich `PredictorScoringPanel`, we may be tempted to refactor the
  underlying `predictors` store or the `/predictors` endpoint. Do not.
  The store/endpoint work as designed; only the UI presentation is
  under-communicated.

## 8. Phasing

Each phase is independently validateable (can merge or ship
incrementally, though we'll ship as one branch). Phases follow the
intention file's explicit ordering: #2 (back button) first as a
low-risk warm-up, then #1 (tab differentiation), then #4 (article
sourcing) so that its `PredictionSources.vue` component is available
for reuse in #5 (landing-page card slim-down), and finally #3 (nav
rename) last because it touches the most surfaces and benefits from
landing after the other feature work is stable.

### Phase 1 — Back Button Fix (Item #2)

**Scope**: `AnalystPerformanceView.vue` only.

**Deliverables**:
- Replace `router-link="/analysts"` with `useIonRouter().back()` +
  fallback.
- Playwright spec: from `/performance` → click an analyst row → click
  back → assert URL is `/performance`. Deep-link case (navigate
  directly to `/analysts/:id/performance`) → click back → assert URL
  is `/analysts`.

**Validation**: Phase passes when the new Playwright spec is green
and the existing `analysts` facet smoke spec is still green.

### Phase 2 — Portfolio Tabs Differentiation (Item #1)

**Scope**: `InstrumentDetailView.vue`, `PredictorScoringPanel.vue`,
`surface-content.ts`.

**Deliverables**:
- Rename segment button label "AI Scoring" → "Article Relevance".
- `PredictorScoringPanel` surfaces article title (external link),
  published date, scoring analyst name.
- New first-touch entry `'instrument.article-relevance'` with
  `<FirstTouchPanel>` wrapper.
- Extend `divinr-instruments-browser-skill` spec: assert
  `/instruments/:id` has two tabs, the second reads "Article
  Relevance," and clicking it shows article rows with titles.

**Validation**: spec green, coverage script green, vocabulary
compliance check clean.

### Phase 3 — Article Sourcing: Schema + Write Path (Item #4a)

**Scope**: `markets-schema.service.ts`, `prediction-runner.service.ts`,
API unit tests.

**Deliverables**:
- Add `contributing_article_ids jsonb` column via `ensureSchema()`.
- `loadPredictorLines` returns article IDs alongside the rendered
  lines (or sibling helper). Prompt-rendering output unchanged.
- `runSingleAnalyst` captures the IDs and inserts them.
- `runArbitrator` captures the dedup'd union.
- API unit test: run a single-analyst prediction, assert the new
  column contains the expected IDs.
- API unit test: run an arbitrator prediction, assert the column
  contains the union of child analysts' IDs.

**Validation**: API tests green, `ensureSchema()` runs cleanly
against a fresh DB and against an existing DB (re-entrant).

### Phase 4 — Article Sourcing: Read Path + UI (Item #4b)

**Scope**: `markets.service.ts` (`getPredictionProvenance`),
`PredictionSources.vue` (new), `InstrumentAnalystPanel.vue`,
`AnalystPredictionModal.vue`, `surface-content.ts`.

**Deliverables**:
- `getPredictionProvenance` returns `fallback: true|false` and
  populates `articles[]` from stored IDs when available.
- API unit tests for all three states (null column, empty array,
  populated).
- New reusable `PredictionSources.vue` component consuming the
  provenance endpoint.
- Collapsible Sources section wired into `InstrumentAnalystPanel` and
  `AnalystPredictionModal`.
- Extend `divinr-predictions-browser-skill` spec: expand the Sources
  section on a known seeded prediction and assert article rows
  render with external links.
- New first-touch entry `'prediction.sources'`.

**Validation**: spec green, vocabulary compliance clean, coverage
script green.

### Phase 5 — Landing-Page Card Slim-Down (Item #5)

**Scope**: `DashboardView.vue` (card template + styles only; no route
or store changes).

**Deliverables**:
- Compact stance chip row (top-3 non-flat + overflow chip).
- Single-line trade-recommendation summary.
- "Read more" link next to rationale preview when truncated.
- Single "View" primary button replacing "View Analysis" + "Trade".
- Modal reused (no new drawer).
- Manual density check: ≥5 cards above the fold at 1440×900.
- Update `divinr-predictions-browser-skill` spec (dashboard scope):
  assert card chips render, assert "Read more" opens the modal,
  assert modal Sources section renders (integration with Phase 4).

**Validation**: spec green, density check passes (manual
screenshot in the PR description), no regression in the existing
dashboard smoke spec.

### Phase 6 — Nav Rename (Item #3)

**Scope**: `DefaultLayout.vue`, `InstrumentsView.vue`,
`InstrumentContractEditorView.vue`, `OnboardingSettingsView.vue`,
`surface-content.ts` (update `instruments:` title/body), any other
user-visible "Instruments" string surfaced by grep and not listed in
the §4.4.3 out-of-scope list.

**Deliverables**:
- Mechanical grep over `apps/web/src` for `Instruments` literals
  (including JSX text, attribute values, and empty-state copy),
  and update each hit per §4.4.3's in-scope / out-of-scope rules.
- All user-visible "Instruments" nav/heading/empty-state strings
  read "Research" (empty-state copy explicitly included — if
  `InstrumentsView.vue` or similar shows "No instruments yet"
  etc., update to "No research yet" / equivalent).
- Route paths / code identifiers / authoring surfaces / API keys /
  schema untouched (verified by grep + CI).
- Update every deep-skill `where.md` that references the old
  sidebar label (mechanical grep over
  `.claude/skills/divinr-*-browser-skill/where.md`).
- Update Playwright selectors that assert `text=Instruments` in nav
  or page header to `text=Research`.
- Vocabulary compliance check clean.

**Validation**: full e2e suite green (all 11 Playwright projects —
smoke + 10 facets), coverage script green, no grep hits for
user-visible "Instruments" outside the §4.4.3 exception list.

### Phase 7 — Final QA Pass

**Scope**: cross-cutting sanity check, no new code.

**Deliverables**:
- Run full Playwright suite.
- Manual walkthrough of Ethan's five scenarios (U1–U5).
- Update `docs/features.md` if §4.4 introduced any user-visible
  feature not already inventoried (likely only the Sources section).
- Completion report drafted to
  `docs/efforts/current/ethan-feedback-2026-04-22/completion-report.md`.

**Validation**: PR ready for merge, all quality gates green,
completion report reviewed.

---

*Drafted 2026-04-23 from intention.md after codebase grounding. The
in-scope write sites for `prediction.market_predictions` are the two
insert statements in `prediction-runner.service.ts` (single-analyst
and arbitrator paths) — both get the new `contributing_article_ids`
column populated in Phase 3. The other grep hits are explicitly
out-of-scope per §4.3: `markets.service.ts`
(`persistPredictionFromArtifact`) is dead code on a deprecated LLM-
artifact ingest path; `trade-recommendation.service.ts` writes
`portfolio_manager` provenance rows that don't participate in the
article-sourcing flow. Day-trader and outcome services read only.
The `AnalystPredictionModal` is the current equivalent of the
intention file's "PredictionDrawer"; reference updated throughout.*
