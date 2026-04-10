# Effort: Notification System

## Problem

Divinr generates important events throughout the day — stop-loss hits, new Tier 3 proposals, position entries and exits, nightly evaluation results, calibration degradation alerts — but the only way to see them is by checking the dashboard. A professional trading tool needs to push information to the user, not wait for them to poll.

The activity panel (SSE-based event stream) exists but only shows events while the app is open. There's no out-of-band notification channel.

## Intention

Build a notification system that alerts users to actionable events via in-app notifications and email. Design the system to be extensible to Slack, SMS, or push notifications later, but ship with in-app + email first.

## Scope

- **Event taxonomy**: Define which events generate notifications and their severity/urgency:
  - **Immediate**: Stop-loss triggered, position force-closed, system error
  - **Actionable**: New Tier 3 proposal awaiting review, trade recommendation generated
  - **Informational**: Nightly evaluation summary, calibration score change, learning cycle report
- **Notification preferences**: Per-user settings for which events they want notifications on and via which channel (in-app, email). Stored in the database.
- **In-app notifications**: Notification bell/badge in the header. Unread count. Notification drawer with mark-as-read. Persisted to database (not just SSE ephemeral events).
- **Email notifications**: For immediate and actionable events. Use a transactional email service. Batch informational events into a daily digest rather than individual emails.
- **Notification service**: Backend service that receives events from existing services (stop-loss watcher, Tier 3, nightly eval, etc.) and dispatches to configured channels.

## Success Criteria

- Users receive in-app notifications for all defined event types.
- Users receive email alerts for immediate and actionable events.
- Users can configure which notifications they receive.
- Notification bell shows unread count; drawer shows history.
- Existing services emit events without needing to know about notification channels.

## Out of Scope

- Slack integration (future — design for it but don't build it).
- SMS or mobile push notifications (future — depends on mobile polish effort).
- Marketing emails or onboarding sequences.
