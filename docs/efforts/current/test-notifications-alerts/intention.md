# Effort: Test — Notifications & Fear/Greed Alerts

## Covers
- `notification-system` — Unified in-app notification bell + list page. 5 event producers (stop-loss, trade recs, nightly eval, Tier 3 proposals, contrarian alerts). SSE real-time updates.
- `fear-greed-alerting` — Sentiment Analyst predicts crowd reaction (fear/greed/noise). Immediate alerts on high-conviction triggers.

## Testing Scope
- Notification bell in header: badge count updates
- NotificationsView (/notifications): list of notifications, mark as read, mark all read
- Fear/greed alert bell: separate warning-colored bell with badge
- FearGreedAlertsView (/fear-greed-alerts): alert cards with trade context
- SSE real-time: new notifications appear without page refresh
- 5 notification sources: verify each produces notifications
- Fear/greed: sentiment classification (fear/greed/noise), conviction levels

## Marketing Angle
Never miss a signal. Real-time alerts for stop-loss triggers, new trade recommendations, sentiment shifts, and system learning milestones.

## Chrome Testing
- Verify notification bell shows unread count
- Click bell → navigate to notifications list
- Mark individual notification as read
- Mark all as read
- Verify fear/greed bell appears with alerts
- Navigate to /fear-greed-alerts — verify alert cards

## Out of Scope
- Push notifications (not implemented)
- Email notifications (not implemented)
