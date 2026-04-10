# In-App Notification System — Product Requirements Document

## 1. Overview

Divinr generates events across multiple subsystems — stop-loss triggers, trade recommendations, Tier 3 proposals, nightly evaluation results, contrarian alerts — but each event type currently lives in its own silo. Users must check individual dashboard sections to find what happened. The contrarian alerts feature already implements an unread-badge + card-list + dismiss pattern for one event type; this effort generalizes that into a unified notification system that all event producers write to.

The result: a single notification bell in the app header with an unread count, backed by a notification list page where users see everything that happened since they last looked, click through to the relevant detail, and dismiss what they've handled.

## 2. Goals & Success Criteria

| # | Goal | Success Metric |
|---|------|---------------|
| 1 | Unified notification indicator | Bell icon in header toolbar shows total unread count across all event types |
| 2 | Notification list page | `/notifications` route displays all recent notifications newest-first with urgency, title, summary, timestamp |
| 3 | Click-through navigation | Each notification links to its relevant detail page (e.g., stop-loss → `/portfolios`, proposal → `/proposals`) |
| 4 | At least 5 event types wired | stop-loss, trade recommendation, Tier 3 proposal, nightly eval summary, contrarian alert all produce notifications |
| 5 | Real-time unread updates | Unread count updates without full page refresh via existing SSE activity stream |
| 6 | Contrarian alerts migrated | Contrarian alerts write through unified NotificationService; `user_contrarian_alerts` table retained for alert-specific data but badge/unread comes from unified system |

## 3. User Stories / Use Cases

**US-1: Morning check-in.** A user opens Divinr after being away overnight. The bell shows "7 unread." They click it, see a nightly eval summary, two trade recommendations, a stop-loss trigger, and three contrarian alerts. They click the stop-loss notification, land on `/portfolios`, review the closed position, then dismiss the notification.

**US-2: Intraday stop-loss.** During the day a stop-loss triggers. The SSE stream pushes a notification-count update. The bell count increments from 0 → 1 without the user refreshing. They click through to the portfolio immediately.

**US-3: Proposal review.** A weekly Tier 3 strategic overhaul proposal is generated Sunday at 2 AM. Monday morning the user sees an "Actionable" notification. They click through to `/proposals` and review the proposal.

## 4. Technical Requirements

### 4.1 Architecture

The notification system is a new `NotificationService` in the API backend that acts as a write-through sink. Existing event producers (stop-loss watcher, trade recommendation service, nightly evaluation, strategic overhaul, affinity service) call `NotificationService.notify()` after completing their work. The frontend reads from unified notification endpoints.

**Components:**
- `NotificationService` — backend service in `apps/api/src/markets/services/`
- `notification.store.ts` — Pinia store in `apps/web/src/stores/`
- `NotificationsView.vue` — new page in `apps/web/src/views/`
- Notification bell — replaces the existing contrarian alerts chip in `DefaultLayout.vue`

### 4.2 Data Model Changes

New table `prediction.notifications`:

```sql
create table if not exists prediction.notifications (
  id text primary key default gen_random_uuid()::text,
  user_id text not null,
  event_type text not null,       -- 'stop_loss' | 'trade_recommendation' | 'tier3_proposal' | 'nightly_eval' | 'contrarian_alert'
  urgency text not null,          -- 'immediate' | 'actionable' | 'informational'
  title text not null,
  summary text,
  link_to text not null,          -- route path for click-through, e.g. '/portfolios'
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_unread_idx
  on prediction.notifications (user_id, is_read, created_at desc);
```

DDL added to `MarketsSchemaService` in a new `notificationsDdl()` method, called from `ensureSchema()`.

The `prediction.user_contrarian_alerts` table is **retained** — it stores alert-specific data (analyst_id, directions, confidence, rationale). Contrarian alert generation continues to write to that table AND additionally writes a row to `prediction.notifications`.

### 4.3 API Changes

All endpoints under `/api/markets/` on the existing `MarketsController`.

| Method | Path | Description | Request | Response |
|--------|------|-------------|---------|----------|
| GET | `notifications` | List notifications for authenticated user | Query: `?unread_only=true` (optional) | `{ notifications: Notification[] }` |
| GET | `notifications/unread-count` | Unread count (lightweight for polling/SSE) | — | `{ count: number }` |
| PATCH | `notifications/:id/read` | Mark single notification as read | — | 204 |
| PATCH | `notifications/read-all` | Mark all notifications as read | — | 204 |

**Notification shape:**
```typescript
interface Notification {
  id: string;
  user_id: string;
  event_type: 'stop_loss' | 'trade_recommendation' | 'tier3_proposal' | 'nightly_eval' | 'contrarian_alert';
  urgency: 'immediate' | 'actionable' | 'informational';
  title: string;
  summary: string | null;
  link_to: string;
  is_read: boolean;
  created_at: string;
}
```

### 4.4 Frontend Changes

**Notification bell (DefaultLayout.vue):**
- Replace the existing `affinityStore.unreadAlertCount` chip (lines 97–99) with a bell icon (`notificationsOutline` from Ionicons).
- Show unread count badge when count > 0.
- Click navigates to `/notifications`.

**Notification list page (NotificationsView.vue):**
- Route: `/notifications`, added to `router/index.ts` children.
- Displays notifications newest-first.
- Each item shows: urgency color indicator (red = immediate, amber = actionable, blue = informational), title, summary, relative timestamp.
- Click on a notification: marks it as read, navigates to `link_to` route.
- "Mark all as read" button in the toolbar.
- Sidebar nav entry for Notifications (with unread badge).

**Notification store (notification.store.ts):**
- Pinia store with `notifications` ref, `unreadCount` computed.
- Actions: `fetchNotifications(unreadOnly?)`, `fetchUnreadCount()`, `markRead(id)`, `markAllRead()`.
- Uses `useApi()` composable for HTTP calls.

**SSE integration:**
- The existing activity stream (`/api/observability/stream`) already pushes events. When a notification is created, the backend emits a `notification_created` event type on the SSE stream.
- The `activity.store.ts` SSE listener detects `notification_created` events and calls `notificationStore.fetchUnreadCount()` to update the bell.

### 4.5 Infrastructure Requirements

No new infrastructure. Uses existing PostgreSQL (Supabase), NestJS backend, Vue 3 frontend, and SSE stream.

## 5. Non-Functional Requirements

- **Performance:** `notifications/unread-count` must respond in <50ms — it's called on every page load and SSE event. The `(user_id, is_read, created_at desc)` index supports this.
- **Retention:** Notifications older than 30 days are eligible for cleanup. A periodic purge query can run alongside nightly evaluation, but automatic purge is not required for launch.
- **Security:** All notification endpoints require authentication via existing `AuthMiddleware`. Users can only see/modify their own notifications (`user_id` filter on all queries).
- **Scalability:** Single-user product for now. Index design supports future multi-user scaling without schema changes.

## 6. Out of Scope

- Email, SMS, Slack, or mobile push notifications.
- Per-event-type notification preferences or filtering settings.
- Marketing emails or onboarding sequences.
- Notification grouping or collapsing (e.g., "3 trade recommendations" as one item).
- Deleting notifications (only mark-as-read).

## 7. Dependencies & Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Event producers must be modified to call `NotificationService.notify()` | Each producer needs a small change; risk of missed call sites | Grep all producers during implementation; test each one |
| Contrarian alerts migration: dual-write could produce stale badge if old path is missed | Users see inconsistent counts | Remove old badge code entirely; contrarian alert reads still come from `user_contrarian_alerts` for detail views, but badge comes only from `prediction.notifications` |
| SSE event for notification count could race with DB write | Badge shows stale count briefly | `fetchUnreadCount()` queries DB directly — SSE is just a trigger to re-fetch, so eventual consistency is acceptable |
| `ensureSchema()` adds another DDL call on first request | Slightly slower cold start | Negligible — same pattern used by all other tables |

## 8. Phasing

### Phase 1: Backend Foundation
- Add `prediction.notifications` DDL to `MarketsSchemaService`.
- Create `NotificationService` with `notify()`, `getNotifications()`, `getUnreadCount()`, `markRead()`, `markAllRead()` methods.
- Add controller endpoints: `GET notifications`, `GET notifications/unread-count`, `PATCH notifications/:id/read`, `PATCH notifications/read-all`.
- **Gate:** Endpoints return correct data when called directly. Manual SQL insert → GET returns the notification.

### Phase 2: Wire Event Producers
- Inject `NotificationService` into `StopLossWatcherService`, `TradeRecommendationService`, `NightlyEvaluationService`, `StrategicOverhaulService`, `AffinityService`.
- Each producer calls `notify()` at the appropriate point after its existing work.
- Event type → urgency mapping:
  - `stop_loss` → immediate, link `/portfolios`
  - `trade_recommendation` → actionable, link `/portfolios`
  - `tier3_proposal` → actionable, link `/proposals`
  - `nightly_eval` → informational, link `/evaluations`
  - `contrarian_alert` → actionable, link `/affinity`
- **Gate:** Trigger each producer (or simulate); verify notification rows appear in DB with correct type, urgency, title, summary, and link.

### Phase 3: Frontend — Bell & List Page
- Create `notification.store.ts` (Pinia).
- Create `NotificationsView.vue` with notification list UI.
- Add `/notifications` route.
- Replace contrarian alerts chip in `DefaultLayout.vue` with notification bell + unread badge.
- Add sidebar nav entry.
- **Gate:** Bell shows unread count. Clicking opens notification list. Clicking a notification marks it read and navigates to the correct page. "Mark all read" works.

### Phase 4: Real-Time Updates & Contrarian Migration
- Backend: emit `notification_created` SSE event when `notify()` is called.
- Frontend: `activity.store.ts` listens for `notification_created` and triggers `notificationStore.fetchUnreadCount()`.
- Remove the old `affinityStore.unreadAlertCount` badge logic from `DefaultLayout.vue`.
- Verify contrarian alerts still display correctly on the `/affinity` page (reading from `user_contrarian_alerts`), but their notification presence comes from the unified system.
- **Gate:** Create a notification while the app is open — bell count updates without page refresh. Contrarian alerts page still works. No duplicate badge logic remains.
