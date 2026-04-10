# User-Analyst Affinity — Product Requirements Document

## 1. Overview

The User-Analyst Affinity system learns which analysts a user trusts by observing their trade decisions, challenge interactions, and browsing behavior. Instead of manual preference configuration, the system builds a per-user analyst weight profile over time and uses it to personalize the dashboard and surface contrarian alerts when a low-affinity analyst disagrees with the user's weighted view.

This effort adds a new `user_analyst_affinity` table, an Affinity Agent that runs after each user action, a nightly decay/normalization job, API endpoints for affinity data, and frontend components for personalized analyst ranking and contrarian alerts.

## 2. Goals & Success Criteria

| Goal | Success Criterion |
|------|-------------------|
| Learn user preferences from behavior | Affinity scores update after every trade decision, challenge interaction, and analyst detail view |
| Personalize without a settings page | Dashboard analyst ordering reflects learned affinity within 5 trade decisions |
| Surface contrarian alerts | When a low-affinity analyst (weight < 0.5) disagrees with the user's weighted consensus at ≥ 80% confidence, an alert is generated |
| No performance regression | Affinity computation adds < 200ms to trade decision flow |
| Transparent to the user | User can view their affinity profile and understand why analysts are ranked the way they are |

## 3. User Stories / Use Cases

**US-1: Implicit learning from trade decisions**
As a user, when I buy on a prediction where Macro Strategist is bullish, the system increases my affinity for Macro Strategist — without me doing anything.

**US-2: Learning from skipped trades**
As a user, when I skip a trade where only Technical Analyst recommends action, the system decreases my affinity for Technical Analyst over time.

**US-3: Challenge signals**
As a user, when I challenge a prediction and still buy, the system records a strong agreement signal. When I challenge and walk away, the system records a disagreement signal.

**US-4: Browsing interest signal**
As a user, when I spend significant time viewing an analyst's detail page, the system records a mild interest signal for that analyst.

**US-5: Contrarian alerts**
As a user, I see an alert when an analyst I rarely follow strongly disagrees with my weighted view — e.g., "You trust Macro and Sentiment, and they say buy. But Technical Analyst (who you rarely follow) is 85% bearish. Here's why."

**US-6: Affinity transparency**
As a user, I can view my affinity profile showing which analysts I lean toward and how those weights were derived.

## 4. Technical Requirements

### 4.1 Architecture

The system introduces three new components:

1. **Affinity Signal Collector** — Synchronous hook in the trade decision and challenge flows that writes raw signal events.
2. **Affinity Agent** — Lightweight computation triggered after signal collection that updates the per-user affinity scores. Runs inline (not a background workflow) since computation is simple aggregation.
3. **Contrarian Alert Generator** — Runs during the prediction pipeline (Phase 5→6 boundary) when new arbitrator predictions are available, comparing analyst positions against user affinity-weighted consensus.

All three integrate into the existing `markets` module — no new NestJS module needed.

### 4.2 Data Model Changes

**New table: `prediction.user_analyst_affinity`**

```sql
create table if not exists prediction.user_analyst_affinity (
  id text primary key default gen_random_uuid()::text,
  user_id text not null,
  analyst_id text not null,
  affinity_score numeric not null default 0.5,   -- 0.0 to 1.0
  signal_count integer not null default 0,        -- total signals processed
  buy_agreement integer not null default 0,       -- times user bought when analyst was bullish
  skip_disagreement integer not null default 0,   -- times user skipped when analyst recommended
  challenge_accept integer not null default 0,    -- challenged then bought
  challenge_reject integer not null default 0,    -- challenged then walked away
  browse_signals integer not null default 0,      -- analyst detail view interest events
  last_signal_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, analyst_id)
);
create index if not exists prediction_user_analyst_affinity_user_idx
  on prediction.user_analyst_affinity (user_id);
```

**New table: `prediction.user_affinity_signals`**

```sql
create table if not exists prediction.user_affinity_signals (
  id text primary key default gen_random_uuid()::text,
  user_id text not null,
  analyst_id text not null,
  signal_type text not null check (signal_type in (
    'buy_agreement', 'sell_agreement', 'skip_disagreement',
    'challenge_accept', 'challenge_reject', 'browse_interest'
  )),
  prediction_id text,          -- null for browse signals
  instrument_id text,
  weight numeric not null,     -- signal strength: 1.0 for trade, 0.8 for challenge, 0.2 for browse
  created_at timestamptz not null default now()
);
create index if not exists prediction_affinity_signals_user_idx
  on prediction.user_affinity_signals (user_id, created_at desc);
```

**New table: `prediction.user_contrarian_alerts`**

```sql
create table if not exists prediction.user_contrarian_alerts (
  id text primary key default gen_random_uuid()::text,
  user_id text not null,
  analyst_id text not null,         -- the contrarian analyst
  prediction_id text not null,
  instrument_id text not null,
  symbol text not null,
  user_weighted_direction text not null check (user_weighted_direction in ('up', 'down', 'flat')),
  contrarian_direction text not null check (contrarian_direction in ('up', 'down', 'flat')),
  contrarian_confidence numeric not null,
  affinity_score_at_alert numeric not null,  -- user's affinity for this analyst when alert fired
  rationale text not null,                    -- analyst's reasoning
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists prediction_contrarian_alerts_user_idx
  on prediction.user_contrarian_alerts (user_id, is_read, created_at desc);
```

### 4.3 API Changes

**New service: `AffinityService`** (`apps/api/src/markets/services/affinity.service.ts`)

Methods:
- `recordSignal(userId, analystId, signalType, predictionId?, instrumentId?)` — writes to `user_affinity_signals`, triggers affinity recomputation
- `recomputeAffinity(userId, analystId)` — recalculates `affinity_score` from signal history using exponential decay (recent signals weighted more)
- `getUserAffinityProfile(userId)` — returns all analyst affinities for a user, sorted by score
- `getAffinityWeightedConsensus(userId, predictionRunId)` — computes user-personalized consensus from analyst predictions weighted by affinity
- `generateContrarianAlerts(userId, predictionRunId)` — identifies low-affinity analysts disagreeing with weighted consensus
- `getContrarianAlerts(userId, unreadOnly?)` — returns alerts for the user
- `markAlertRead(alertId)` — marks an alert as read
- `decayAndNormalize(userId)` — nightly job: applies time decay to old signals, normalizes scores to 0–1 range

**New endpoints on `MarketsController`:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/markets/affinity` | Get current user's affinity profile |
| GET | `/markets/affinity/alerts` | Get contrarian alerts (query: `unread_only`) |
| PATCH | `/markets/affinity/alerts/:id/read` | Mark alert as read |
| POST | `/markets/affinity/signals/browse` | Record a browse interest signal (body: `{ analyst_id }`) |

Trade decision and challenge signals are recorded internally — no dedicated endpoint needed. The existing `user-portfolio.service.ts` trade decision flow and challenge flow will call `affinityService.recordSignal()` directly.

### 4.4 Frontend Changes

**Affinity Profile Component** (`apps/web/src/components/AffinityProfile.vue`)
- Bar chart or ranked list showing analyst affinity scores for the current user
- Each entry shows: analyst name, affinity score (visual bar 0–1), signal breakdown (agreements, skips, challenges)
- Accessible from the dashboard or user profile area

**Contrarian Alert Component** (`apps/web/src/components/ContrarianAlert.vue`)
- Notification badge on dashboard when unread alerts exist
- Alert card: "You trust [high-affinity analysts], and they say [direction]. But [low-affinity analyst] (who you rarely follow) is [confidence]% [direction]. [rationale summary]."
- Dismiss/mark-read action
- Click-through to the analyst's prediction detail

**Dashboard Personalization**
- Analyst list on the dashboard sorted by affinity score (highest first) instead of default ordering
- Subtle affinity indicator (e.g., filled dots or weight badge) next to each analyst name

**Browse Signal Tracking**
- When a user opens `AnalystPredictionModal.vue` or spends > 10 seconds on an analyst detail view, fire a `POST /markets/affinity/signals/browse` call (debounced, max 1 per analyst per 5 minutes)

### 4.5 Infrastructure Requirements

- No new infrastructure. All computation is lightweight aggregation on existing Postgres.
- Nightly decay/normalization hooks into the existing nightly evaluation cron (`analyst-pipeline.service.ts`).
- Browse signal debouncing is handled client-side — no rate limiting needed server-side beyond standard auth.

## 5. Non-Functional Requirements

- **Performance**: Affinity recomputation must complete in < 200ms. Signal recording is fire-and-forget (non-blocking to the trade decision response).
- **Security**: Affinity data is user-scoped. All queries filter by authenticated `user_id`. No user can view another user's affinity profile.
- **Scalability**: Signal table grows linearly with user activity. Nightly decay job prunes signals older than 90 days to keep query performance bounded.
- **Data integrity**: Affinity scores are always recomputable from the signal log. If scores drift, a full recompute from signals restores correctness.
- **Legal compliance**: Affinity-driven personalization is analysis/signal, never advice/recommendation. Contrarian alerts use language like "here's a different signal to consider" — not "you should reconsider."

## 6. Out of Scope

- **Manual weight overrides**: Users cannot manually set analyst weights in this effort. That's a future settings-page feature.
- **Affinity-weighted trade recommendations**: The trade recommendation pipeline (Phase 6) continues using system weights. Affinity only affects dashboard display and alerts — not trade sizing.
- **Cross-user affinity aggregation**: No "users like you also trust…" social features.
- **Analyst notification**: Analysts are not informed of their affinity scores with users.
- **Historical affinity charting**: No time-series view of how affinity evolved. Just current state.

## 7. Dependencies & Risks

### Dependencies
- **Trade Recommendations** (complete): Provides `user_trade_decisions` table and trade decision flow where buy/skip signals originate.
- **Prediction Deep Dive / Challenge mode** (complete): Provides `prediction_challenges` table where challenge-accept/reject signals originate.
- **User-scoped platform** (complete): All new tables use `user_id` scoping, consistent with the recent migration.

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Cold start — new users have no affinity data | High | Medium | Default affinity 0.5 for all analysts (neutral). System gracefully degrades to default ordering until ≥ 5 signals recorded. |
| Affinity scores cluster (all analysts converge to similar scores) | Medium | Medium | Exponential decay + normalization spreads scores. Monitor distribution in nightly job logs. |
| Browse signal noise (user leaves tab open, inflating browse count) | Medium | Low | Browse signals have low weight (0.2) and are debounced (max 1 per analyst per 5 min). Visibility timer requires active tab. |
| Contrarian alert fatigue | Medium | Medium | Only fire alerts when contrarian confidence ≥ 80% AND affinity score < 0.5. Limit to 3 unread alerts per user. |

## 8. Phasing

### Phase 1: Data Model & Signal Collection
- Add DDL for `user_analyst_affinity`, `user_affinity_signals`, and `user_contrarian_alerts` tables to `markets-schema.service.ts`
- Create `AffinityService` with `recordSignal()` and `recomputeAffinity()` methods
- Hook signal recording into existing trade decision flow (`user-portfolio.service.ts`) — on buy/sell/skip, identify which analysts were bullish/bearish and record appropriate signals
- Hook signal recording into challenge flow — on challenge completion, record challenge_accept or challenge_reject
- **Gate**: Integration tests pass — signals are written for trade decisions and challenges, affinity scores update correctly

### Phase 2: Affinity Profile API & Nightly Job
- Implement `getUserAffinityProfile()`, `decayAndNormalize()` methods
- Add nightly decay/normalization to the existing nightly evaluation pipeline
- Add GET `/markets/affinity` endpoint
- Implement signal pruning (drop signals > 90 days)
- **Gate**: API returns correct affinity profiles. Nightly job decays scores without data loss. Lint + build pass.

### Phase 3: Contrarian Alert Generation
- Implement `getAffinityWeightedConsensus()` and `generateContrarianAlerts()` methods
- Hook alert generation into prediction pipeline after arbitrator phase
- Add GET `/markets/affinity/alerts` and PATCH `/markets/affinity/alerts/:id/read` endpoints
- **Gate**: Contrarian alerts generate correctly when low-affinity analyst disagrees at high confidence. Alert read/unread state works.

### Phase 4: Frontend — Affinity Profile & Dashboard Personalization
- Build `AffinityProfile.vue` component with ranked analyst list and signal breakdown
- Sort dashboard analyst list by affinity score
- Add affinity indicator badges to analyst names
- **Gate**: Profile renders correctly. Dashboard reorders analysts by affinity. Lint + build pass.

### Phase 5: Frontend — Contrarian Alerts & Browse Signals
- Build `ContrarianAlert.vue` component with notification badge and alert cards
- Implement browse signal tracking in `AnalystPredictionModal.vue` with debounce and visibility detection
- Add POST `/markets/affinity/signals/browse` endpoint
- Wire dismiss/mark-read actions
- **Gate**: Alerts display and dismiss correctly. Browse signals fire with proper debounce. Full E2E flow: browse → trade → affinity update → contrarian alert. Lint + build + tests pass.
