# Effort: Mobile Polish

## Problem

Capacitor and iOS scaffolding exist but the mobile experience hasn't been a focus. For a stock market app, mobile is table stakes — users check positions, see alerts, and review predictions on their phone. The Electron desktop app is also scaffolded but needs refinement.

## Intention

Polish the mobile (Capacitor/iOS) and desktop (Electron) experiences so they feel native and professional. Responsive layouts, touch-friendly interactions, platform-appropriate navigation patterns.

## Scope

- Responsive layout audit across all views — ensure nothing breaks on mobile viewports
- Touch-friendly tap targets and swipe gestures where appropriate
- iOS app refinement via Capacitor — proper status bar, safe areas, native transitions
- Electron desktop refinement — window management, menu bar, native feel
- Performance optimization for mobile (lazy loading, reduced bundle where possible)

## Out of Scope

- New features for mobile-only (same app, just polished)
- Android (iOS first, Android later)
- Push notifications (that's the notification-system effort)
