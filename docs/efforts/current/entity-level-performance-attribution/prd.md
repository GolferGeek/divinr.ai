# Entity-Level Performance Attribution — Product Requirements Document

**Intention**: [intention.md](./intention.md)
**Created**: 2026-04-17

## 1. Overview

Build a multi-dimensional P&L attribution system that records a structured outcome for every evaluated prediction, traces it back through its contributing predictors / articles / sources / analyst / instrument / contract version / author, and exposes aggregations across any combination of dimensions. The result: any author can see what their authored content earned, the system can rank custom content for graduation candidacy, and admins can answer "what did Divinr make on AAPL this week" in one query.

The work consumes the already-shipped triple-keyed reasoning pipeline (`triple-model-reasoning-continuity`), the nightly evaluation cycle (`prediction.prediction_horizon_evaluations`), and the daily P&L snapshot (`prediction.daily_pnl_snapshot`), and produces a new schema layer + module for attribution. It is the analytical-substrate sibling of `cost-modeling-system`: cost-modeling tracks compute spent, this effort tracks value produced.

## 2. Goals & Success Criteria

### Goals
1. Every evaluated prediction produces exactly one `outcome_records` row capturing: triple, prediction_id, evaluation_id, horizon, predicted_direction, actual_direction, attributable_pnl_cents, pnl_type, attribution_method, contributing_predictor_ids[], contributing_article_ids[], contributing_source_keys[].
2. Aggregations across triple / analyst / instrument / source / article / author / arbitrary N-way slice are available as materialized views, refreshed nightly.
3. An author can see per-item attribution (per analyst, per instrument, per triple) on a dedicated dashboard; an admin can see system-wide slices.
4. The system can produce a ranked list of top-performing user-authored items for graduation candidate surfacing (input to the future `custom-to-base-graduation` effort).
5. Per-author monthly attribution feeds back into `cost-modeling-system` as a "value per compute dollar" extension (defensibility v2).

### Success Criteria
- Any new prediction that resolves through `NightlyEvaluationService` produces an `outcome_records` row within the same nightly run.
- Aggregation queries against the materialized views return in ≤ 1 second for a single month window per dimension on a 100k-outcome dataset (extrapolated from current scale; see §5).
- The author dashboard renders per-item P&L (calibration-method, score units) and per-item position P&L (when positions exist, dollar units) for the current month + prior 3 months.
- The admin attribution view supports filtering by any one of: triple, analyst, instrument, source, author, date-range, and combinations of two of the above.
- A graduation-candidate API endpoint returns the top N user-authored items by trailing-30-day attribution score.
- All `outcome_records` carry `pnl_type` (paper / real); v1 only emits paper, but the column is in place from day one.

## 3. User Stories / Use Cases

### Author / Power User
- As an author of a custom AAPL contract, I open my dashboard and see: "China-AAPL contract: 7 predictions this month, 67% hit rate, +14.2 calibration points, +$142 paper P&L."
- As an author considering whether to keep paying for a custom analyst, I see trailing 30-day attribution: positive trend → keep, flat/negative → consider canceling.
- As an author whose content is performing well, I receive a graduation suggestion banner: "Your *Aggressive Growth ESG* analyst is in the top decile this month — consider donating it."

### Admin / Divinr Operator
- As Divinr admin, I want to know which base instruments produce the highest paper P&L per compute dollar so I know where to invest.
- As Divinr admin, I want to surface user-authored items that are top-decile performers for proactive outreach about graduation.
- As Divinr admin, I want to see source quality: "Reuters: 342 articles contributed, avg +$4.27 paper P&L per prediction. SCMP: 88 articles, avg −$1.02."

### Student / Reader
- As a reader of the community board, I see lifetime + trailing-30-day attribution numbers next to graduated items so the "this is good content" claim is backed by data.

### System
- The graduation engine (future effort) calls `GET /admin/attribution/graduation-candidates?window=30d&top=50&min_predictions=20` to get a ranked list.
- The cost-modeling defensibility view (already shipped) is extended in this effort with a "value per compute dollar" column joining attribution P&L to LLM cost.

## 4. Technical Requirements

### 4.1 Architecture

**New self-contained module**: `apps/api/src/attribution/` (mirrors the `cost-modeling/` pattern — avoids circular imports because attribution needs both `MarketsModule` and `BillingModule`, and `MarketsModule` already imports `BillingModule`).

```
apps/api/src/attribution/
├── attribution.module.ts          # imports MarketsModule (re-exports DATABASE_SERVICE + MarketsLlmService etc.)
├── outcome-attribution.service.ts # computes outcome_records when predictions evaluate
├── attribution-aggregation.service.ts # refreshes materialized views; nightly cron
├── attribution-query.service.ts   # API-facing query methods (admin + per-author)
├── admin-attribution.controller.ts # /admin/attribution/*
└── author-attribution.controller.ts # /attribution/* (per-user, self-or-admin)
```

The `OutcomeAttributionService.recordOutcomesForEvaluationRun()` is invoked by `NightlyEvaluationService` after evaluation rows are written (one new line in `nightly-evaluation.service.ts`). To preserve module boundary, `MarketsModule` does NOT import `AttributionModule`; instead, `AttributionModule` imports `MarketsModule`, and `NightlyEvaluationService` exposes a hook (`onEvaluationCycleComplete: ((summary) => Promise<void>) | null`) that `AttributionModule` registers at bootstrap via `OnModuleInit`. (Pattern: `AttributionModule` injects `NightlyEvaluationService` at construction, calls `nightlyEvaluation.setOnEvaluationCycleComplete(this.outcomeAttribution.recordOutcomesForEvaluationRun.bind(...))`.)

`AttributionModule` is wired into `AppModule` directly.

### 4.2 Data Model Changes

All tables in the existing `prediction.*` schema (no new schema needed). DDL added to `MarketsSchemaService.ensureSchema()` via two new private methods (`outcomeAttributionDdl()`, `outcomeAttributionViewsDdl()`). Migration file: `apps/api/db/migrations/2026-04-19-outcome-attribution.sql`.

#### `prediction.outcome_records`
One row per (prediction_id × horizon_window) — i.e., one per `prediction_horizon_evaluations` row.

```sql
create table if not exists prediction.outcome_records (
  id text primary key default gen_random_uuid()::text,
  evaluation_id text not null references prediction.prediction_horizon_evaluations(id) on delete cascade,
  prediction_id text not null,
  run_id text,
  -- triple key (denormalized for query speed; matches evaluation row)
  author_user_id text,
  analyst_id text,
  instrument_id text not null,
  -- horizon / dates
  horizon_window integer not null,
  prediction_date timestamptz not null,
  evaluation_date timestamptz not null,
  -- predicted vs actual
  predicted_direction text not null check (predicted_direction in ('up','down','flat')),
  actual_direction text not null check (actual_direction in ('up','down','flat')),
  was_correct boolean not null,
  confidence_at_prediction numeric,
  -- attribution P&L
  pnl_type text not null default 'paper' check (pnl_type in ('paper','real')),
  attribution_method text not null check (attribution_method in ('calibration','position')),
  attributable_pnl_cents bigint not null default 0,  -- 0 when attribution_method='calibration'; non-zero only for position-method outcomes
  calibration_score numeric,  -- always populated: (was_correct ? 1 : -1) * confidence_at_prediction, range -1..+1
  -- contributing entities (arrays of IDs / keys; source_key = market_articles.external_source_slug)
  contributing_predictor_ids jsonb not null default '[]'::jsonb,
  contributing_article_ids jsonb not null default '[]'::jsonb,
  contributing_source_keys jsonb not null default '[]'::jsonb,
  -- attribution method metadata (for upgrade path when explicit prediction→predictor link lands)
  predictor_attribution_method text not null default 'lookback_window'
    check (predictor_attribution_method in ('lookback_window','explicit_link','none')),
  -- contract context (for graduation traceability)
  analyst_config_version_id text,
  instrument_config_version_id text,
  -- risk view: not denormalized; reachable transitively via run_id → market_risk_assessments(run_id, triple)
  -- meta
  computed_at timestamptz not null default now(),
  unique (evaluation_id)
);
create index if not exists outcome_records_triple_idx
  on prediction.outcome_records (coalesce(author_user_id,'base'), analyst_id, instrument_id, evaluation_date desc);
create index if not exists outcome_records_author_idx
  on prediction.outcome_records (author_user_id, evaluation_date desc) where author_user_id is not null;
create index if not exists outcome_records_instrument_idx
  on prediction.outcome_records (instrument_id, evaluation_date desc);
create index if not exists outcome_records_eval_date_idx
  on prediction.outcome_records (evaluation_date desc);
-- GIN indexes for source/article membership queries
create index if not exists outcome_records_sources_gin
  on prediction.outcome_records using gin (contributing_source_keys jsonb_path_ops);
create index if not exists outcome_records_articles_gin
  on prediction.outcome_records using gin (contributing_article_ids jsonb_path_ops);
```

#### Six materialized aggregate views

All `WITH NO DATA` initially, refreshed nightly via `AttributionAggregationService.refreshViews()`. Each has a unique index for `REFRESH MATERIALIZED VIEW CONCURRENTLY`. Every view exposes BOTH `total_pnl_cents` (sum of `attributable_pnl_cents`) AND `avg_calibration_score` (avg of `calibration_score`) so consumers can choose dollar or unitless aggregates per the §6 item 4 model.

1. **`prediction.attribution_per_triple_monthly`** — `(coalesce(author_user_id,'base'), analyst_id, instrument_id, year_month)` → `outcomes_count, hits_count, hit_rate, total_pnl_cents, avg_calibration_score, avg_confidence`
2. **`prediction.attribution_per_analyst_monthly`** — `(coalesce(author_user_id,'base'), analyst_id, year_month)` → same metrics aggregated across instruments
3. **`prediction.attribution_per_instrument_monthly`** — `(instrument_id, year_month)` → metrics aggregated across all analysts
4. **`prediction.attribution_per_source_monthly`** — unnest `contributing_source_keys`, group by `(source_key, year_month)` → `predictions_contributed, total_pnl_cents, avg_pnl_per_prediction_cents`
5. **`prediction.attribution_per_article_lifetime`** — unnest `contributing_article_ids`, group by `article_id` → `predictions_contributed, first_used_at, last_used_at, total_pnl_cents`
6. **`prediction.attribution_per_author_monthly`** — `(author_user_id, year_month)` → `outcomes_count, hit_rate, total_pnl_cents, distinct_items_count` (where author_user_id is not null)

Retention: outcome_records kept indefinitely (small footprint per row, defensibility-critical). Materialized views refreshed nightly; no separate retention.

### 4.3 API Changes

All endpoints under `/admin/attribution/*` require admin (`requireAdmin(user)` matching `AdminCostController`); `/attribution/*` user-facing endpoints check `userId === auth.userId || isAdmin`.

| Method | Path | Purpose | Returns |
|---|---|---|---|
| GET | `/admin/attribution/per-triple` | Triple-level aggregates with optional filters | `{rows: [{authorUserId, analystId, instrumentId, yearMonth, hitRate, totalPnlCents, ...}]}` |
| GET | `/admin/attribution/per-analyst` | Analyst-level aggregates | rows |
| GET | `/admin/attribution/per-instrument` | Instrument-level aggregates | rows |
| GET | `/admin/attribution/per-source` | Source quality | rows |
| GET | `/admin/attribution/per-author` | Per-author across all their items | rows |
| GET | `/admin/attribution/graduation-candidates` | Top user-authored items by trailing window | `{candidates: [{authorUserId, itemKind, itemId, score, pnlCents, predictionCount, ...}]}` |
| GET | `/admin/attribution/slice` | Ad-hoc 2-D slice (e.g., analyst × source) | `{rows: [...]}` |
| POST | `/admin/attribution/refresh-views` | Manual refresh | `{refreshed: 6}` |
| GET | `/attribution/my-summary` | Authed user's own per-item attribution (current month + prior 3) | `{currentMonth: {...}, byItem: [...], history: [...]}` |
| GET | `/attribution/instrument/:id` | Per-instrument attribution drill-down (any user) | `{base: {...}, byAuthor: [...], topTriples: [...]}` |

Query string conventions for admin endpoints:
- `?yearMonth=2026-04` (default: current month) or `?from=YYYY-MM&to=YYYY-MM`
- `?authorUserId=`, `?analystId=`, `?instrumentId=`, `?sourceKey=` (any combination)
- `?limit=N&offset=M` (default limit 100)

`graduation-candidates` query params: `?window=30d` (`7d`/`30d`/`90d`), `?top=50`, `?minPredictions=20` (filter out low-sample noise).

### 4.4 Frontend Changes

All Vue/Ionic, mirrors the cost-modeling-system patterns (Pinia store + composables + views).

- **New store**: `apps/web/src/stores/attribution.store.ts` — admin-side queries (per-*, graduation-candidates, slice, refresh)
- **New composable**: `apps/web/src/composables/useMyAttribution.ts` — user-side queries (my-summary, instrument)
- **New views**:
  - `apps/web/src/views/AttributionMineView.vue` (path `/attribution/mine`) — author dashboard: current month per-item table, history sparkline, link to instrument deep-dives
  - `apps/web/src/views/InstrumentAttributionView.vue` (path `/attribution/instrument/:id`) — base + per-author breakdown for one instrument
  - `apps/web/src/views/AttributionAdminView.vue` (path `/admin/attribution`) — top-level admin: tabs for per-triple / per-analyst / per-instrument / per-source / per-author with filters
  - `apps/web/src/views/SourceQualityView.vue` (path `/admin/attribution/sources`) — source-only zoom, sortable by avg P&L
  - `apps/web/src/views/GraduationCandidatesView.vue` (path `/admin/attribution/graduation-candidates`) — ranked list of top user-authored items by trailing window
- **Widget extension**: `apps/web/src/components/UserUsageWidget.vue` — add "Your authored content this month: +$X paper P&L" line under the cost line (only when user has `authored_items` rows)
- **New widget**: `apps/web/src/components/GraduationSuggestionBanner.vue` — appears on `AttributionMineView` when `GET /attribution/my-summary` indicates any of the calling user's items appears in `GET /admin/attribution/graduation-candidates?window=30d&top=N` (called via `/attribution/my-summary` extension that returns `topDecileItems: [...]`); copy: "Your *{itemName}* is in the top decile this month — graduation flow coming soon." Gated by `ATTRIBUTION_TOP_DECILE_BANNER_ENABLED`. Passive-only in v1 (no donation CTA — that lands with `custom-to-base-graduation`).
- **Sidebar nav** (`apps/web/src/layouts/DefaultLayout.vue`):
  - User-facing entry: "My Attribution" under Settings, route `/attribution/mine`
  - Admin group "Attribution" with: Overview (`/admin/attribution`), Sources (`/admin/attribution/sources`), Graduation Candidates (`/admin/attribution/graduation-candidates`)
- **Router**: add 5 new routes to `apps/web/src/router/index.ts`
- **Cost-modeling integration**: extend `CostDefensibilityView.vue` with a "Value / Compute $" column when attribution data is available (joins per-item-kind cost to per-author-monthly attribution)
- **Copy convention**: legal-language rules apply — use "P&L (paper, no cash)" / "estimate" — never "earnings" or "your money."

### 4.5 Infrastructure Requirements

- New env vars (with defaults):
  - `ATTRIBUTION_DISABLE_NIGHTLY_REFRESH=false` (parity with `MARKETS_DISABLE_NIGHTLY_CRON`)
  - `ATTRIBUTION_GRADUATION_MIN_PREDICTIONS=20` (default minimum sample for candidate ranking)
  - `ATTRIBUTION_PREDICTOR_LOOKBACK_HOURS=24` (window for predictor → prediction attribution heuristic)
  - `ATTRIBUTION_CUTOFF_DATE=2026-04-19` (ISO date; outcomes for evaluations with `prediction_date < cutoff` are skipped to avoid back-filling pre-effort history per intention "Out of Scope")
  - `ATTRIBUTION_TOP_DECILE_BANNER_ENABLED=true` (gates the author-facing graduation suggestion banner)
- Cron: `AttributionAggregationService` runs `@Cron('30 0 * * *')` (00:30 daily, 30 min after `NightlyEvaluationService` so evaluation outcomes are recorded first). Gated by `ATTRIBUTION_DISABLE_NIGHTLY_REFRESH`.
- No new external services / ports; all internal Postgres.

## 5. Non-Functional Requirements

### Performance
- Aggregate-view queries (single month, single dimension): ≤ 1 s on 100k-row outcome_records (current scale ≪ that).
- `outcome-attribution.service.recordOutcomesForEvaluationRun()` runs serially per evaluation row; budget ≤ 200 ms per row including predictor lookup. With ~3 horizons × current daily prediction volume (~50/day → 150 outcomes/night), total ≤ 30 s nightly.
- Materialized view refresh budget: ≤ 60 s for all 6 views combined.

### Security
- All `/admin/attribution/*` endpoints gate on `requireAdmin(user)` (same DB-backed admin check pattern as `AdminCostController`).
- `/attribution/my-summary` enforces `auth.userId` only (no userId param accepted from caller).
- `/attribution/instrument/:id` is readable by any authenticated user (instrument data is shared); returns base + per-author aggregates but only the calling user's own author breakdown rows are tagged with `userOwned: true` for UI styling.
- All SQL through parameterized queries via `db.rawQuery(sql, [params])`; no string concatenation.

### Scalability
- `outcome_records` indexed for the 5 most common access patterns (triple, author, instrument, eval-date, source/article via GIN). For arbitrary N-way slices not covered, the `slice` endpoint warns above 10k rows.
- Materialized views refreshed concurrently; fall-back to non-concurrent on failure (existing `LlmUsageQueryService.refreshViews()` pattern).

### Compatibility
- v1 emits `pnl_type='paper'` only; schema column accepts `'real'` for future real-money integration without migration.
- v1 attribution is forward-only: predictions evaluated before this effort lands do not get back-filled (out of scope per intention §"Out of Scope" — `attribution_source = 'legacy'`). To represent that without a new column, we simply do not insert outcome_records for evaluations that pre-date the deployment cutoff (`first_recorded_at` env or hard-coded by deployment date).

## 6. Out of Scope

Explicit per intention:
1. **Real-money trading mechanics** — `pnl_type='real'` column exists but never populated in v1.
2. **Multi-user / team-level aggregation** — everything is per-author; no team rollups.
3. **Historical backfill of pre-effort outcomes** — only forward-looking from deployment cutoff. (We do NOT add a "legacy" pseudo-source per intention; we simply skip evaluations older than the cutoff.)

Additional v1 scope decisions (from ambiguous intention questions, decided up-front):

4. **P&L accounting model** (intention open question): v1 supports BOTH simultaneously per outcome row, with two independently-aggregatable measures so dollar and unitless values never get summed together.
   - `calibration_score` (always populated): `(was_correct ? 1 : -1) * confidence_at_prediction`, range −1..+1. Aggregates as a unitless score in views (`avg_calibration_score`).
   - `attributable_pnl_cents` (cents): populated **only** when `attribution_method='position'` (i.e., at least one `analyst_positions` OR `user_positions` row references the prediction_id). For position outcomes: sum of position realized_pnl × 100, divided by count of triggering predictions on the same triple in the same run. For non-position outcomes (`attribution_method='calibration'`), `attributable_pnl_cents = 0` and the row contributes only to calibration aggregates.
   - Materialized views expose BOTH `total_pnl_cents` (sum of `attributable_pnl_cents` across position-method rows only — implicit because non-position rows are 0) and `avg_calibration_score` (across all rows). UI labels them "Paper P&L" and "Calibration score" distinctly.

5. **Multi-source attribution weighting** (intention open question): equal weight v1. If a prediction has 5 contributing predictors covering 3 distinct articles from 2 sources, each source gets `attributable_pnl_cents / 2` credit in the per-source view via `unnest()` semantics. Confidence-weighted attribution deferred.

6. **Time windows** (intention open question): monthly aggregates are the canonical materialized views. Trailing-7d / trailing-30d / trailing-90d are computed at query time against `outcome_records` directly (covered by `outcome_records_eval_date_idx`).

7. **Community board lifetime vs trailing display** (intention open question): both. `attribution_per_article_lifetime` view gives lifetime; trailing windows computed at query time. Community board UI deferred to a later effort (no community board surface exists yet).

8. **Underperforming-author UX** (intention open question): show negative numbers honestly with a copy disclaimer. No "quietly hide" behavior. v1 is admin-facing for graduation; surfacing this to the underperforming author themselves is a UX iteration left to a follow-up.

9. **LLM-judged "quality" attribution** — out of scope; this effort is purely outcome-derived (predicted vs actual + position P&L).

## 7. Dependencies & Risks

### Dependencies
- **`triple-model-reasoning-continuity`** (shipped) — every attribution row keys off `(coalesce(author_user_id,'base'), analyst_id, instrument_id)`.
- **`prediction.prediction_horizon_evaluations`** (shipped, populated by `NightlyEvaluationService`) — the trigger source for outcome records.
- **`prediction.market_predictors` + `prediction.market_articles`** (shipped) — joined for predictor → article → source attribution chain.
- **`prediction.analyst_positions`** (shipped) — provides position-method P&L when present.
- **`billing.authored_items`** (shipped) — joined for author dashboard "your X items" view.
- **`cost-modeling-system`** (shipped) — `attribution_per_author_monthly` is joined into the existing `CostDefensibilityView` for "value per compute $" extension.

### Risks & Mitigations

| Risk | Mitigation |
|---|---|
| **No direct prediction → predictors-used link**: `market_predictions.lineage_json` only stores per-analyst votes for arbitrator predictions, NOT which `market_predictors` rows fed each analyst's reasoning. | Use a time-window heuristic in v1: `contributing_predictor_ids = predictors active for the (triple, instrument_id) within ATTRIBUTION_PREDICTOR_LOOKBACK_HOURS before prediction_date`. Record this method in a column to allow an upgrade path: a follow-up effort can add an explicit `prediction_predictor_links` table when prediction generation is rewritten. Document the heuristic in the per-prediction drill-down UI. |
| **Position P&L attribution to multiple triggering predictions**: a single position may be opened on the back of several predictions on the same triple. | v1 divides realized_pnl by the count of triggering predictions on the same triple in the same run; document as "v1 simple division" in code comments. Acceptable approximation given paper trading. |
| **Materialized view refresh fails partway through nightly run** | Mirror the `LlmUsageQueryService.refreshViews()` pattern: try CONCURRENTLY first, fall back to non-CONCURRENT, log per-view failures, never throw. Manual `POST /admin/attribution/refresh-views` available as recovery. |
| **Smoke-test deadlock on schema creation** (documented existing flake from llm-usage-logging + cost-modeling efforts) | Add new DDL inside `if not exists` blocks; don't introduce new patterns that could deepen the deadlock. Document in completion report. |
| **Per-author negative numbers cause UX backlash** | v1 surface is admin-facing for graduation; the per-author "your numbers" surface is opt-in via a clear "P&L (paper, no cash)" header. Underperforming authors are not pushed to view; admin uses positive surfacing only ("top decile" not "bottom decile"). |
| **GIN index queries on contributing_source_keys could be slow at scale** | At v1 scale (≪ 100k rows) negligible. Document a follow-up to introduce a normalized `outcome_record_sources(outcome_id, source_key)` link table if GIN queries exceed the 1-s budget. |

## 8. Phasing

Each phase ships with a full quality gate (lint / build / unit tests / curl tests / smoke / chrome where applicable) and a phase review against the PRD section it implements.

### Phase 1: Schema + Outcome Recording Layer
**Objective**: every new `prediction_horizon_evaluations` row produces a corresponding `outcome_records` row with attribution chain populated.

- DDL for `prediction.outcome_records` + 5 indexes (added to `MarketsSchemaService` via new `outcomeAttributionDdl()` private method).
- Migration file `apps/api/db/migrations/2026-04-19-outcome-attribution.sql`.
- New `apps/api/src/attribution/` module (controller-less for this phase; just `AttributionModule` + `OutcomeAttributionService`).
- `OutcomeAttributionService.recordOutcomesForEvaluationRun(evaluationIds: string[])`:
  - Filter: skip any evaluation whose `prediction_date < ATTRIBUTION_CUTOFF_DATE`.
  - For each remaining evaluation row, look up the prediction; resolve triple; compute `calibration_score = (was_correct ? 1 : -1) * confidence_at_prediction`; query BOTH `analyst_positions` AND `user_positions` for prediction_id → if any row exists, set `attribution_method='position'` and `attributable_pnl_cents = round(sum(realized_pnl) * 100 / triggering_prediction_count_on_same_triple_in_run)`, else `attribution_method='calibration'` and `attributable_pnl_cents = 0` (calibration-only outcomes contribute to `avg_calibration_score` aggregates but NOT to dollar P&L sums; see §6 item 4).
  - Predictor chain: query `market_predictors` for `(coalesce(author_user_id,'base'), instrument_id)` with `created_at` within `ATTRIBUTION_PREDICTOR_LOOKBACK_HOURS` before `prediction_date`; assemble `contributing_predictor_ids`; join `market_articles` for `contributing_article_ids` and `external_source_slug` → `contributing_source_keys`. Set `predictor_attribution_method='lookback_window'` (or `'none'` when zero predictors found).
  - INSERT idempotent via `unique(evaluation_id) on conflict do nothing`.
- Hook integration: add `setOnEvaluationCycleComplete()` setter on `NightlyEvaluationService` (pure plumbing — single optional callback), and have `AttributionModule.onModuleInit()` register `outcomeAttribution.recordOutcomesForEvaluationRun.bind(...)`.
- Wire `AttributionModule` into `AppModule`.
- Tests: ≥ 30 unit-test assertions covering: triple resolution, calibration vs position method selection, position P&L division by triggering-prediction count, predictor lookback window, idempotency.
- Quality gate per Phase 1 (curl: none — no endpoints yet; smoke: `pnpm --filter @divinr/api test:smoke` to verify schema applies).

### Phase 2: Aggregation Views + Nightly Refresh
**Objective**: 6 materialized views populated and queryable; nightly cron refreshes them.

- DDL for 6 materialized views via `MarketsSchemaService.outcomeAttributionViewsDdl()`; each has its unique index.
- `AttributionAggregationService` with `refreshViews()` (try CONCURRENTLY → fall back), `@Cron('30 0 * * *')` gated by `ATTRIBUTION_DISABLE_NIGHTLY_REFRESH`.
- Tests: ≥ 15 unit-test assertions covering view DDL emission, refresh fall-back path, cron gating, query idempotency.
- Quality gate per Phase 2 (curl: none; smoke: schema applies + a manual `REFRESH MATERIALIZED VIEW` invocation succeeds against an empty fixture).

### Phase 3: Query Layer + Admin / Author Endpoints
**Objective**: 10 endpoints live, admin-gated where required, returning shape per §4.3.

- `AttributionQueryService` with 10 query methods (one per endpoint).
- `AdminAttributionController` with 8 endpoints; `AuthorAttributionController` with 2.
- Both controllers wire into `AttributionModule`.
- Tests: ≥ 30 unit-test assertions covering: each query method returns expected shape, admin gating denies non-admin, my-summary refuses cross-user, slice endpoint enforces 2-dimension max + limit.
- Quality gate per Phase 3 (curl: 5 commands hitting 5 representative endpoints with admin token; smoke).

### Phase 4: Frontend — Author Dashboard + Admin Surfaces
**Objective**: 5 new views + widget extension + sidebar nav, all renderable with mock or real data.

- `attribution.store.ts` (admin) with 8 actions; `useMyAttribution.ts` (user) with 2.
- 5 new views per §4.4.
- `UserUsageWidget.vue` extended with "Your authored content this month" line (only when `authored_items` rows exist).
- `CostDefensibilityView.vue` extended with "Value / Compute $" column (joins attribution + cost data).
- 5 new routes; sidebar nav additions.
- Quality gate per Phase 4 (lint + build web; chrome scenarios: 4 — admin attribution overview loads, source quality sortable, author dashboard renders for a user with authored items, graduation candidates list returns data).

### Phase 5: Integration & End-to-End Pipeline Verification
**Objective**: confirm the full pipeline works (prediction → evaluation → outcome record → view → endpoint → UI), graduation-candidates feeds the future graduation effort cleanly, and cost-modeling defensibility view shows value-per-$.

- Validate `GET /admin/attribution/graduation-candidates` shape matches what `custom-to-base-graduation` intention.md (in `docs/efforts/next/`) expects; document any contract assumptions in completion report.
- Validate `CostDefensibilityView.vue` correctly joins attribution + cost; update any copy / disclaimers.
- Review legal-language convention compliance ("paper P&L", "estimate", never "earnings/profits/advice").
- **End-to-end pipeline verification**: trigger `POST /admin/markets/run-nightly` (existing endpoint) on a dataset with at least one new evaluation; verify a corresponding `outcome_records` row appears; trigger `POST /admin/attribution/refresh-views`; verify the per-triple monthly view includes the row; hit `GET /attribution/my-summary` as the relevant author and confirm the row surfaces.
- End-to-end chrome walk: author signs in → views My Attribution → graduation banner appears (for top-decile case) → drills into instrument → admin views graduation candidates.
- Quality gate per Phase 5 (full lint/build/unit on api+web; chrome end-to-end walk; phase review against §2 success criteria).
