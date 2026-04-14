# Effort: Test — Mobile & Desktop Polish

## Covers
- `mobile-polish` — Responsive layouts across 22+ views (375px–1024px), iOS safe-area handling, Capacitor status-bar/splash-screen, touch targets ≥44px, Electron menu bar + window state persistence.

## Testing Scope
- Responsive layouts at 375px (iPhone SE), 414px (iPhone 14), 768px (iPad), 1024px, 1440px (desktop)
- DefaultLayout: sidebar overlay on mobile, header collapse, safe-area insets
- All 22+ views: no overflow, no truncated text, no unreachable controls at any viewport
- Touch targets: sidebar nav, notification bells, card actions all ≥44px
- Electron app: custom menu (File/Edit/View/Help), window state persistence, About dialog
- Capacitor/iOS: status bar, splash screen, safe areas (requires iOS simulator or device)

## Marketing Angle
Check your portfolio from anywhere. Native feel on iOS, polished desktop experience, responsive web — one app, every screen.

## Chrome Testing
- Open Chrome DevTools → toggle through iPhone SE, iPhone 14, iPad, Desktop at each major view
- Verify sidebar overlay + backdrop dismiss on mobile
- Verify header elements don't overflow at 375px
- Verify charts resize correctly
- Verify tables scroll horizontally on mobile
- Test Electron: launch dev:electron, verify menu and window state

## Out of Scope
- Android (iOS first)
- Push notifications
