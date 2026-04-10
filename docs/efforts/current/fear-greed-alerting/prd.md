# Fear/Greed Alerting — Product Requirements Document

## 1. Overview

Evolve the Sentiment Analyst from passive relevance scoring ("how relevant is this article?") to crowd-reaction prediction ("will retail investors panic-sell or FOMO-buy when they see this headline?"). When a fear or greed trigger is detected, bypass the normal 30-minute pipeline cycle and push an immediate alert — giving the user a 15-30 minute window to act before the crowd prices it in.

This builds on three existing systems: the `urgentRelevance` bypass in prediction-generator, the unified notification system, and user-analyst affinity tracking.

## 2. Goals & Success Criteria

| Goal | Success Criterion |
|------|-------------------|
| Predict crowd emotional reaction to breaking news | Sentiment Analyst returns a `crowd_reaction` classification (`fear_trigger`, `greed_trigger`, or `noise`) alongside its relevance score |
| Immediate alerting on fear/greed triggers | Alert delivered to user within 2 minutes of article ingestion when crowd_reaction is not `noise` |
| Actionable alerts with trade context | Each alert includes the trade recommendation (buy/sell/hold, entry, stop-loss, take-profit) from the existing Trade Recommendation system |
| Personalized alert filtering | Alerts only fire for instruments the user holds or watches, weighted by analyst affinity |
| No alert fatigue | Cap at 5 unread fear/greed alerts per user; alert only on high-conviction triggers (crowd_reaction_confidence >= 0.7) |

## 3. User Stories / Use Cases

**Power user monitoring portfolio:**
A tariff headline drops at 2:47 PM. The Sentiment Analyst scores the article, predicts "fear_trigger" with 0.85 confidence for MSFT, and estimates retail sell-off within 2 hours. Within 90 seconds, the user receives an in-app notification: "ALERT: Tariff headline will trigger fear selling in tech — Sentiment Analyst recommends selling MSFT. Stop-loss: $412, Take-profit: $398." The user clicks through to the full prediction detail.

**Multi-instrument cascade:**
An inflation report surprises to the upside. The Sentiment Analyst flags greed triggers for gold ETFs and fear triggers for bond-heavy instruments. The user receives separate alerts for each instrument they hold, prioritized by affinity-weighted relevance.

**Noise filtering:**
A routine earnings beat for a mid-cap stock scores as `noise`. No alert fires. The article flows through the normal 30-minute pipeline cycle.

## 4. Technical Requirements

### 4.1 Architecture

The fear/greed alerting pipeline inserts a new step between predictor scoring (Step 2) and prediction generation (Step 3) in the existing `analyst-pipeline.service.ts` flow:

```
Article Crawl (15 min) → Predictor Scoring (5 min) → [NEW] Fear/Greed Classification → Urgent Bypass → Prediction + Trade Rec → Alert Push
```

For fear/greed triggers, steps after classification execute immediately (bypassing the 30-minute cycle) using the existing `urgentRelevance` threshold infrastructure in `prediction-generator.service.ts`.

### 4.2 Data Model Changes

**New columns on `prediction.market_predictors`** (for sentiment-analyst rows only):

| Column | Type | Description |
|--------|------|-------------|
| `crowd_reaction` | `text CHECK (crowd_reaction IN ('fear_trigger', 'greed_trigger', 'noise'))` | Predicted retail investor reaction |
| `crowd_reaction_confidence` | `numeric` | 0.0-1.0 confidence in the classification |
| `crowd_reaction_rationale` | `text` | LLM explanation of why this headline triggers fear/greed |
| `estimated_reaction_window_minutes` | `integer` | Predicted time before crowd prices it in (15-120 min) |

**New `event_type` value for `prediction.notifications`:**
- `'fear_greed_alert'` added to the `NotificationEventType` union

**New table `prediction.fear_greed_alerts`:**

| Column | Type | Description |
|--------|------|-------------|
| `id` | `text PRIMARY KEY` | |
| `user_id` | `text NOT NULL` | |
| `predictor_id` | `text NOT NULL` | FK to market_predictors |
| `instrument_id` | `text NOT NULL` | |
| `symbol` | `text NOT NULL` | |
| `crowd_reaction` | `text NOT NULL` | `fear_trigger` or `greed_trigger` |
| `crowd_reaction_confidence` | `numeric NOT NULL` | |
| `estimated_reaction_window_minutes` | `integer` | |
| `trade_action` | `text` | buy/sell/hold from trade rec |
| `entry_price` | `numeric` | |
| `stop_loss` | `numeric` | |
| `take_profit` | `numeric` | |
| `notification_id` | `text` | FK to notifications |
| `is_read` | `boolean DEFAULT false` | |
| `created_at` | `timestamptz DEFAULT now()` | |

### 4.3 API Changes

**New endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/markets/fear-greed-alerts` | List user's fear/greed alerts (query: `?unread_only=true`) |
| `GET` | `/markets/fear-greed-alerts/unread-count` | Unread count for badge |
| `PATCH` | `/markets/fear-greed-alerts/:id/read` | Mark single alert read |
| `PATCH` | `/markets/fear-greed-alerts/read-all` | Mark all read |

All endpoints require `JwtAuthGuard`.

**Modified service: `predictor-generator.service.ts`**
- `scoreArticleForInstrument()` for the sentiment-analyst now returns extended output including `crowd_reaction`, `crowd_reaction_confidence`, `crowd_reaction_rationale`, and `estimated_reaction_window_minutes`.

### 4.4 Frontend Changes

**New Pinia store: `fear-greed.store.ts`**
- `fetchAlerts(unreadOnly?)`, `fetchUnreadCount()`, `markRead(id)`, `markAllRead()`
- Reactive `alerts` list and `unreadCount` ref

**Dashboard integration:**
- Fear/greed alert badge in the notification bell area (separate count, distinct color — red for fear, green for greed)
- Alert cards in a dedicated section or tab on the dashboard
- Each card shows: symbol, crowd_reaction type, confidence, reaction window, trade recommendation summary, link to full prediction

**Real-time updates:**
- Listen for SSE events with `hook_event_type: 'fear_greed_alert'` to update badge/list without polling

### 4.5 Infrastructure Requirements

- **No new infrastructure.** Uses existing Ollama/OpenRouter LLM, Supabase Postgres, SSE push.
- **Crawl frequency consideration:** The intention mentions potentially moving from 15-minute to 1-minute crawling for breaking news. This is **out of scope** for this effort — the existing 15-minute crawl + 5-minute scoring cycle already yields a worst-case ~20-minute detection latency, which is within the 15-30 minute action window. Faster crawling can be a follow-up effort.

## 5. Non-Functional Requirements

- **Latency:** From article ingestion to alert delivery: < 2 minutes (LLM scoring + prediction generation + notification push)
- **Alert cap:** Max 5 unread fear/greed alerts per user to prevent fatigue (mirrors the 3-alert cap on contrarian alerts but slightly higher given urgency)
- **Confidence threshold:** Only alert when `crowd_reaction_confidence >= 0.7` — below this, the article flows through the normal pipeline
- **Legal language:** All alerts must use "signal" and "analysis" language, never "advice" or "recommendation" (per project convention). Alert text uses "Sentiment Analyst signals selling MSFT" not "recommends selling."
- **Idempotency:** Same article + instrument + user combination must not generate duplicate alerts (deduplicate by predictor_id + user_id)

## 6. Out of Scope

- **Faster crawl cycles** (1-minute breaking news crawl) — follow-up effort
- **Email/webhook delivery** — the intention lists email, webhook, and in-app as channels. This effort delivers in-app only (leveraging the existing notification system); email and webhook channels are a follow-up effort once the classification and alerting logic is proven
- **Custom alert thresholds per user** — all users get the same 0.7 confidence threshold
- **Historical alert analytics** — no dashboards or charts for alert accuracy tracking
- **Mobile push notifications** — desktop/web only

## 7. Dependencies & Risks

### Dependencies
- **Trade Recommendation system** (exists): Alerts include trade rec data. The `trade-recommendation.service.ts` must have completed a run for the instrument before the alert can include actionable trade context. If no trade rec exists yet, the alert fires without trade data and says "Analysis pending."
- **User-Analyst Affinity** (exists): Used to personalize which alerts reach which users. If a user has no affinity data yet (new user), they receive alerts for all instruments in their watchlist at default affinity (0.5).
- **Notification system** (exists): The unified notification system (`notification.service.ts`) handles delivery and SSE push.

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| LLM crowd-reaction classification is unreliable with local models (gemma4 may not follow the structured output format) | Medium | High | Use qwen3:8b (current preferred model) which handles structured JSON well. Add fallback: if LLM output doesn't parse, treat as `noise`. |
| Alert fatigue if thresholds are too sensitive | Medium | Medium | Start with conservative 0.7 confidence threshold + 5-alert cap. Monitor and tune. |
| 20-minute worst-case detection latency may miss the action window for fast-moving events | Low | Medium | Acceptable for v1. The 15-30 minute window in the intention is a target, not a guarantee. Faster crawling is a follow-up. |
| Sentiment Analyst prompt changes affect existing relevance scoring accuracy | Medium | Medium | The crowd-reaction fields are additive — existing `relevance_score` computation is unchanged. New fields are returned alongside, not instead of, existing output. |

## 8. Phasing

### Phase 1: Crowd Reaction Classification
**Scope:** Modify the Sentiment Analyst's LLM prompt to return crowd-reaction fields alongside existing relevance scoring. Add new columns to `market_predictors`. Store results but don't act on them yet.

**Validates:** LLM reliably returns structured crowd-reaction data. Classification accuracy is reasonable (manual spot-check).

**Files touched:**
- `predictor-generator.service.ts` — prompt + response parsing for sentiment-analyst
- `markets-schema.service.ts` — new columns on `market_predictors`
- `markets.types.ts` — extended predictor type

### Phase 2: Urgent Bypass + Alert Generation
**Scope:** Create `fear-greed-alert.service.ts`. When a predictor with `crowd_reaction != 'noise'` and `crowd_reaction_confidence >= 0.7` is saved, trigger immediate prediction generation (using existing urgentRelevance bypass), generate the trade recommendation, create the `fear_greed_alerts` row, and push a notification.

**Validates:** End-to-end flow from scored article to persisted alert + notification. Correct deduplication. Alert cap enforcement.

**Files touched:**
- New: `fear-greed-alert.service.ts`
- `markets-schema.service.ts` — new `fear_greed_alerts` table
- `notification.service.ts` — new `fear_greed_alert` event type
- `analyst-pipeline.service.ts` — wire fear/greed check after predictor scoring step
- `markets.module.ts` — register new service

### Phase 3: API + Frontend
**Scope:** Add REST endpoints for fear/greed alerts. Build the Pinia store and dashboard UI components. Wire SSE real-time updates.

**Validates:** User can see, read, and dismiss fear/greed alerts in the UI. Real-time badge updates work. Alert cards show trade recommendation context.

**Files touched:**
- `markets.controller.ts` — new endpoints
- New: `apps/web/src/stores/fear-greed.store.ts`
- Dashboard view — alert badge + alert card list
- `markets.types.ts` — frontend alert type
