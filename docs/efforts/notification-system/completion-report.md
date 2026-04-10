# In-App Notification System — Completion Report

**Plan**: ./plan.md
**PRD**: ./prd.md
**Completed**: 2026-04-10
**Final Status**: All Phases Complete

## Summary
- Total phases: 4
- Phases completed: 4
- Phases remaining: 0

## Phase Results

### Phase 1: Backend Foundation
- Status: Complete
- Created `prediction.notifications` table DDL in `MarketsSchemaService`
- Created `NotificationService` with `notify()`, `notifyAllUsers()`, `getNotifications()`, `getUnreadCount()`, `markRead()`, `markAllRead()`
- Added 4 controller endpoints: `GET notifications`, `GET notifications/unread-count`, `PATCH notifications/:id/read`, `PATCH notifications/read-all`
- Added `Notification` type to `markets.types.ts`
- Created 24-assertion unit test
- Issue found and fixed: beta-reader guard compliance test required `requireWriteAccess` on PATCH endpoints

### Phase 2: Wire Event Producers
- Status: Complete
- Injected `NotificationService` into 5 services: StopLossWatcherService, TradeRecommendationService, NightlyEvaluationService, StrategicOverhaulService, AffinityService
- Added `notifyAllUsers()` helper for system-level services without userId context (queries `user_portfolios` for active users)
- All notification calls are fire-and-forget with `.catch()` to prevent notification failures from breaking core business logic

### Phase 3: Frontend — Bell & List Page
- Status: Complete
- Created `notification.store.ts` (Pinia) with full CRUD operations
- Created `NotificationsView.vue` with urgency-colored cards, relative timestamps, click-through navigation
- Added `/notifications` route
- Replaced contrarian alerts chip with notification bell icon + unread badge in header
- Added "Notifications" to sidebar navigation

### Phase 4: Real-Time Updates & Contrarian Migration
- Status: Complete
- Injected `ObservabilityEventsService` into `NotificationService` for SSE push on `notify()`
- Activity store detects `notification_created` SSE events and triggers `fetchUnreadCount()`
- Old contrarian alerts badge fully removed from DefaultLayout
- Affinity page unchanged — reads from `user_contrarian_alerts` for detail data

## Gate Results
- **Lint**: All passes across all phases
- **Build**: All passes (API tsc + Web vite)
- **Unit Tests**: All pass — 24 new notification tests + all existing tests (beta-reader compliance, affinity, stop-loss, etc.)
- **Typecheck**: API passes; web has pre-existing errors (window/HTMLElement not in lib) unrelated to this effort

## Deviations from PRD
1. **`notifyAllUsers()` method added**: PRD specified `notify(userId, event)` but 4 of 5 event producers are system-level services without a userId. Added `notifyAllUsers()` that queries `user_portfolios` for all active users.
2. **`requireWriteAccess` on PATCH endpoints**: Not in PRD but required by existing beta-reader guard compliance test. PATCH notifications/:id/read and PATCH notifications/read-all both call `requireWriteAccess()`.
3. **ObservabilityEventsService is @Optional()**: Injected as optional dependency to avoid breaking unit tests that don't provide it.
4. **PATCH endpoints use raw fetch in frontend store**: The `useApi().patch()` helper calls `res.json()` which fails on 204 No Content. Store uses raw `fetch()` for mark-read operations.

## Next Steps
- Run `/pr-eval` to review and merge
- Chrome testing: verify bell, notifications list, click-through, and real-time updates in the running app
- Monitor for any DI issues at runtime (the `@Optional()` ObservabilityEventsService injection)
