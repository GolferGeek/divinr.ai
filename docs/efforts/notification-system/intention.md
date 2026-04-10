# Effort: In-App Notification System

## Problem

Divinr generates important events throughout the day — stop-loss hits, new Tier 3 proposals, position entries and exits, nightly evaluation results, calibration degradation alerts, contrarian alerts — but the only way to see them is by checking each section of the dashboard individually. The activity panel (SSE-based event stream) only shows events while the app is open and doesn't persist.

Users need a single place that says "here's what happened since you last looked" with click-through to the relevant page.

## Intention

Build a persistent in-app notification system. A notification bell/indicator in the app header with an unread count, backed by a notification list page where users can see all recent events, click through to the relevant detail, and dismiss items they've handled.

The contrarian alerts feature (user-analyst-affinity effort) already implements this pattern for one event type — unread badge, card list, dismiss action. This effort generalizes that into a unified notification system that all event producers can write to.

## Scope

- **Event taxonomy**: Define which events generate notifications and their urgency:
  - **Immediate**: Stop-loss triggered, position force-closed
  - **Actionable**: New Tier 3 proposal awaiting review, trade recommendation generated, contrarian alert
  - **Informational**: Nightly evaluation summary, calibration score change, learning cycle report
- **Notifications table**: Persisted to database. Fields: user_id, event_type, urgency, title, summary, link_to (route path for click-through), is_read, created_at.
- **NotificationService**: Backend service with a simple `notify(userId, event)` method. Existing services (stop-loss watcher, Tier 3, nightly eval, trade recommendations, affinity alerts) call this instead of managing their own notification patterns.
- **Notification bell**: Badge in the app header showing unread count. Clicking opens the notification list.
- **Notification list page**: All recent notifications, newest first. Each item shows urgency indicator, title, summary, timestamp. Click navigates to the relevant page. Mark-as-read on click or explicit dismiss.
- **Migrate contrarian alerts**: Refactor contrarian alerts to write through the unified NotificationService instead of their own separate table/badge. The `user_contrarian_alerts` table stays for alert-specific data, but the notification bell and unread badge come from the unified system.

## Success Criteria

- Users see a notification indicator in the header with an unread count.
- Clicking through goes to a notification list page showing all recent events.
- Each notification links to the relevant detail page (e.g., stop-loss hit → portfolio, proposal → /proposals).
- At least 5 event types are wired up: stop-loss, trade recommendation, Tier 3 proposal, nightly eval summary, contrarian alert.
- Unread count updates without full page refresh (existing SSE activity stream can push updates).

## Out of Scope

- Email notifications (too async for current needs).
- SMS, Slack, or mobile push notifications.
- Per-event-type notification preferences (all events notify; filtering is future work).
- Marketing emails or onboarding sequences.
