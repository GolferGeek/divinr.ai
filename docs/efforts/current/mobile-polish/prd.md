# Mobile Polish — Product Requirements Document

## 1. Overview

Divinr.ai is a Vue 3 / Ionic Vue 8.8.3 app with Capacitor 8.3.0 iOS scaffolding and an Electron 41.1.1 desktop wrapper. The mobile experience has not been a focus — layouts break on small viewports, safe-area handling is absent, touch targets are undersized in several views, and the Electron shell lacks native desktop affordances (menu bar, window state persistence). This effort makes both surfaces feel native and professional without adding new features.

## 2. Goals & Success Criteria

| Goal | Success Criterion |
|------|-------------------|
| Every view renders correctly on iPhone SE (375px) through iPad (1024px) | Visual audit of all 22+ views at 375px, 414px, 768px, and 1024px — no overflow, no truncated text, no unreachable controls |
| Touch targets meet Apple HIG minimums | All interactive elements >= 44x44pt tap area |
| iOS app feels native | Proper status-bar integration, safe-area insets respected, no content hidden behind notch/Dynamic Island/home indicator |
| Electron app feels like a desktop app | Custom menu bar, persistent window size/position, native title bar behavior |
| Mobile performance acceptable | Lighthouse mobile performance score >= 70; lazy-loaded routes reduce initial bundle |

## 3. User Stories / Use Cases

- **Mobile investor checking positions**: Opens iOS app, sees portfolio dashboard immediately with no layout breakage, swipes between cards, taps an instrument for detail — all within thumb reach.
- **Commuter reviewing alerts**: Pulls up fear-greed alerts on phone in portrait. Cards stack vertically, text is readable, action buttons are easy to tap.
- **Desktop power user**: Launches Electron app, window remembers last size/position. Menu bar provides native File/Edit/View/Help structure. Cmd+Q quits cleanly.
- **iPad user reviewing analyst performance**: Charts resize correctly in landscape and portrait. Grid columns adapt from 2-up to 1-up as viewport narrows.

## 4. Technical Requirements

### 4.1 Architecture

No architectural changes. The existing Vue 3 + Ionic Vue + Pinia + Vue Router stack remains. All work is CSS, Capacitor configuration, and Electron main-process refinement.

### 4.2 Responsive Layout Audit & Fixes

**Scope**: All 22+ views in `apps/web/src/views/` and the `DefaultLayout.vue` shell.

**Current state**: The layout uses a single 768px breakpoint to toggle the sidebar. Many views use inline styles with fixed pixel widths, `display: flex` with `gap` but no `flex-wrap`, and Ionic grid columns without mobile `size` props.

**Requirements**:

1. **DefaultLayout.vue** (`apps/web/src/layouts/DefaultLayout.vue`):
   - Sidebar must fully overlay on mobile (< 768px) with backdrop dismiss, not push content.
   - Header toolbar elements (universe selector, notification bells, user chip) must not overflow on 375px screens — collapse or hide non-essential items.
   - Footer disclaimer must wrap and remain readable at narrow widths.

2. **All views**: Audit each for:
   - Fixed-width containers that overflow on 375px.
   - Flex rows that don't wrap (`flex-wrap: wrap` where needed).
   - Tables or data grids that need horizontal scroll containers on mobile.
   - `IonGrid`/`IonRow`/`IonCol` usage — add `size="12"` mobile fallbacks where missing.
   - Typography that becomes unreadable (< 12px effective) on small screens.

3. **Chart components** (`apps/web/src/components/` — CalibrationScatter, PerformanceDashboard charts):
   - Charts already set `responsive: true` but may overflow containers on mobile.
   - Wrap chart containers with `overflow: hidden` and test at 375px.
   - Reduce legend font size and position on mobile viewports.

4. **Modal and detail views**: Ensure `IonModal` presentations don't clip content on small screens. Full-screen modals on mobile (< 768px), sheet-style on tablet+.

### 4.3 Touch Target & Gesture Improvements

1. Audit all clickable elements (buttons, chips, links, icon buttons) across views. Any element with tap area < 44x44pt gets padding/min-height adjustment.
2. Sidebar navigation items — ensure each has sufficient vertical padding for thumb tapping.
3. Card actions (run details, analyst cards, instrument rows) — increase hit area on mobile.
4. Add swipe-to-go-back gesture support via Ionic's `swipeBackEnabled` on `IonRouterOutlet`.

### 4.4 iOS / Capacitor Refinements

**Current state**: Capacitor config is minimal (`appId`, `appName`, `webDir`). No plugins beyond core. No safe-area handling. Ionic mode is forced to `'md'` (Material Design) globally.

**Requirements**:

1. **Safe areas**: Add `viewport-fit=cover` to the viewport meta tag in `index.html`. Apply `safe-area-inset-*` CSS environment variables to:
   - DefaultLayout header (top inset)
   - DefaultLayout footer/tab area (bottom inset)
   - Full-screen modals (all insets)

2. **Status bar**: Install `@capacitor/status-bar` plugin. Configure:
   - Light content on dark backgrounds, dark content on light backgrounds (match app theme).
   - Status bar overlay mode so content flows behind it (paired with safe-area CSS).

3. **Splash screen**: Install `@capacitor/splash-screen`. Configure auto-hide after app mount to avoid white flash.

4. **Capacitor config updates** (`capacitor.config.ts`):
   - Add `server.allowNavigation` for API calls if needed.
   - Add `ios.preferredContentMode: 'mobile'` to prevent iPad desktop-mode rendering.

5. **Platform-aware Ionic mode**: Consider switching to `mode: 'ios'` when running on iOS (detect via `Capacitor.getPlatform()`) for native-feeling iOS components (back swipe, header styling, toggle switches). Keep `'md'` as default for web and Android.

6. **Build scripts**: Add `cap:sync` and `cap:open` scripts to `apps/web/package.json`:
   ```
   "cap:sync": "cap sync ios",
   "cap:open": "cap open ios"
   ```

### 4.5 Electron Desktop Refinements

**Current state**: `electron/main.cjs` creates a single 1400x900 window. No menu bar, no preload script, no window state persistence. Default Electron menu.

**Requirements**:

1. **Custom menu bar** (`electron/main.cjs`):
   - File: Quit (Cmd+Q / Ctrl+Q)
   - Edit: Undo, Redo, Cut, Copy, Paste, Select All (standard accelerators)
   - View: Reload, Toggle DevTools, Actual Size, Zoom In, Zoom Out, Toggle Full Screen
   - Help: About Divinr AI, link to docs/support

2. **Window state persistence**: Install `electron-window-state` package. Save and restore window size, position, and maximized state across sessions.

3. **Native title bar**: Keep native title bar (no frameless window). Ensure the title shows "Divinr AI" consistently.

4. **macOS dock behavior**: Already handles `window-all-closed` and `activate` events correctly — verify and leave as-is.

5. **Dev server port**: Fix the dev mode URL to use the correct Vite dev server port (match `vite.config.ts` port configuration).

### 4.6 Performance Optimization for Mobile

1. **Route-level lazy loading**: Convert all view imports in `apps/web/src/router/index.ts` from static `import` to dynamic `() => import()` for code splitting. Each view becomes its own chunk.
2. **Ionic component tree-shaking**: Verify that only used Ionic components are bundled (Ionic Vue should handle this via ES module imports, but audit `ionic.bundle.css` — consider switching to per-component CSS imports if bundle is oversized).
3. **Image optimization**: Audit any images/assets for appropriate sizing. Use `loading="lazy"` on below-fold images.
4. **Chunk splitting**: The existing Vite config splits ionic, ionicons, and vue. Verify chunks are reasonable sizes after lazy-loading routes.

## 5. Non-Functional Requirements

- **Performance**: Lighthouse mobile score >= 70. First Contentful Paint < 3s on 4G throttle.
- **Compatibility**: iOS 16+, Safari 16+, Chrome 120+, Firefox 120+. Electron targets macOS 12+.
- **Accessibility**: Touch targets >= 44x44pt. Sufficient color contrast on mobile (existing theme should suffice).
- **No regressions**: Desktop web experience must not degrade. All existing functionality preserved.

## 6. Out of Scope

- **New mobile-only features** — same app, just polished.
- **Android** — iOS first. Android will be a separate effort.
- **Push notifications** — belongs to the notification-system effort.
- **Electron IPC or preload scripts** — deferred to the desktop self-hosted effort.
- **API URL configuration in Electron** — deferred to self-hosted effort.
- **Windows Electron builds** — not yet needed.

## 7. Dependencies & Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Ionic `mode: 'md'` switch to platform-aware mode may change component appearance across all views | High — visual regressions | Test mode switching in isolation first; if too disruptive, keep `'md'` everywhere and apply iOS-specific overrides only to navigation components |
| Chart.js components may not resize gracefully at small viewports | Medium — broken charts | Wrap in fixed-aspect-ratio containers; test each chart component at 375px |
| 22+ views is a large audit surface | Medium — effort scope | Prioritize high-traffic views first (Dashboard, Portfolio, Instruments, Runs) |
| Electron window-state package adds a native dependency | Low | Well-maintained package; fallback to hardcoded defaults if it fails |
| Safe-area CSS may conflict with Ionic's built-in padding | Medium | Test on actual iOS device/simulator; Ionic may already handle some safe areas |

## 8. Phasing

### Phase 1: Foundation — Safe Areas, Viewport, and Layout Shell
- Add `viewport-fit=cover` to `index.html`
- Apply safe-area-inset CSS to DefaultLayout (header, content, footer)
- Fix DefaultLayout sidebar mobile overlay behavior
- Fix header toolbar overflow at 375px
- Install and configure `@capacitor/status-bar` and `@capacitor/splash-screen`
- Add Capacitor build scripts to package.json
- **Gate**: DefaultLayout renders correctly on iPhone SE simulator with proper safe areas

### Phase 2: View-by-View Responsive Audit (High-Priority Views)
- Audit and fix: DashboardView, PerformanceDashboardView, PortfolioDashboardView
- Audit and fix: InstrumentsView, InstrumentDetailView
- Audit and fix: RunsView, RunDetailView
- Audit and fix: RiskDashboardView
- Fix chart components for mobile viewports
- **Gate**: 8 highest-traffic views pass 375px / 414px / 768px visual check

### Phase 3: View-by-View Responsive Audit (Remaining Views)
- Audit and fix: AnalystsView, AnalystPerformanceView, ContractEditorView
- Audit and fix: CoordinationView, ProposalsView, SourcesView
- Audit and fix: EvaluationsView, LearningDashboardView, CanonicalDayDetailView, PredictionsView
- Audit and fix: NotificationsView, FearGreedAlertsView, AffinityView, AuditFindingsView
- Audit and fix: LoginView, InviteSignupView, TermsOfServiceView
- **Gate**: All views pass 375px / 414px / 768px visual check

### Phase 4: Touch Targets & Gestures
- Audit all interactive elements for 44x44pt minimum
- Fix undersized tap targets across all views
- Enable swipe-back gesture on IonRouterOutlet
- Test touch interactions on iOS simulator
- **Gate**: No tap target < 44x44pt; swipe-back works on all navigable views

### Phase 5: Electron Desktop Refinements
- Implement custom menu bar in `electron/main.cjs`
- Install and integrate `electron-window-state` for persistent window positioning
- Fix dev server port in Electron dev mode
- Test build output with `pnpm build:electron`
- **Gate**: Electron launches with custom menu, remembers window state across restarts

### Phase 6: Performance & Final Polish
- Convert all route imports to lazy `() => import()` syntax
- Audit bundle sizes; verify chunk splitting is effective
- Run Lighthouse mobile audit; address any score < 70
- Consider platform-aware Ionic mode (iOS mode on iOS)
- Final cross-platform smoke test
- **Gate**: Lighthouse mobile >= 70; no regressions on desktop web
