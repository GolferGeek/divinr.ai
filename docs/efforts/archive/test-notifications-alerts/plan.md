# Test: Notifications & Fear/Greed Alerts — Implementation Plan

**PRD**: ./intention.md
**Created**: 2026-04-13
**Status**: Complete

## Progress Tracker
- [x] Phase 1: API Verification
- [x] Phase 2: Chrome Testing
- [x] Phase 3: Marketing

---

## Phase 1: API Verification
**Status**: Complete
**Note**: 100 notifications (all trade recommendations). Fear/greed alerts empty (no high-conviction sentiment triggers yet).

### Steps
- [x] 1.1 `GET /markets/notifications` → 100 notifications, all unread trade recommendations
- [x] 1.2 Notifications include: title (e.g. "TSLA SELL recommendation"), body (direction, confidence, position size), timestamps
- [x] 1.3 `GET /markets/fear-greed-alerts` → empty alerts array (no triggers yet)
- [x] 1.4 Notification badge count visible in header (343)

### Quality Gate
- [x] Notifications endpoint returns data
- [x] Fear/greed endpoint functional
- [x] Badge count visible

---

## Phase 2: Chrome Testing
**Status**: Complete

### Steps
- [x] 2.1 Navigate to `/notifications` → list of notification cards
- [x] 2.2 "Mark All as Read" button in header
- [x] 2.3 Each card shows: "actionable" badge, relative timestamp, title, body
- [x] 2.4 Blue left border indicates unread status
- [x] 2.5 Trade recommendation notifications: symbol + direction + confidence + position size
- [x] 2.6 Multiple symbols: TSLA, GRML, GOOGL, AMD, META, ORCL, CRM, IBM
- [x] 2.7 Header notification bell badge shows unread count (343)

### Quality Gate
- [x] Notification list renders with proper formatting
- [x] Mark all as read button present
- [x] Badge count visible in header

---

## Phase 3: Marketing
**Status**: Complete

### Steps
- [x] 3.1 Write marketing blurb → saved to `marketing-blurb.md`

### Quality Gate
- [x] Marketing blurb written
