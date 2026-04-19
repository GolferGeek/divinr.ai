# What — Billing facet

## Lifecycle states

The API returns one of: `trial | active | past_due | canceled | dormant | null`.

| Lifecycle state | TrialCountdown visible? | ReadOnlyBanner visible? |
| --- | --- | --- |
| `trial` (with future `trial_ends_at`) | yes | no |
| `active` / `past_due` / `dormant` / `null` | no | no |
| `canceled` with `is_read_only = true` | no | yes |

Both components render nothing when their condition is not met — so on a normal paid user's dashboard, neither is in the DOM.

## User flow

1. On app mount, `DefaultLayout.vue` calls `billing.fetch()` + `billing.startAutoRefresh()` (5-minute poll).
2. If the user is on the free trial, `<TrialCountdown />` appears as a chip in the header with copy like "5 days left" / "1 day left" / "Trial ends today" and an escalating color (primary → warning ≤ 7d → danger ≤ 3d).
3. If the lifecycle cron has transitioned the user to `canceled` / `is_read_only`, `<ReadOnlyBanner />` appears at the top of every view with the title "Your trial has ended.", a body that mentions the purge date if set, a short `<LegalDisclaimer variant="short" />`, and an **Add a card** button that routes to `/settings/authored-content`.
4. On logout, `DefaultLayout.vue` clears the store via `billing.clear()` which also stops the refresh timer.

## Surface shape

```
App shell header
────────────────────────────────────────────────
[☰] Divinr AI                    [🌐] [🔔] [🔔] [⏳ 5 days left] [Read Only?] [☺ user ▼]
────────────────────────────────────────────────
<ion-content>
┌──────────────────────────────────────────────┐
│ 🔒 Your trial has ended.                     │  ← ReadOnlyBanner (if read-only)
│ Add a card to continue accessing your data.  │
│ Your account remains read-only until …       │
│ [not a prediction model / not investment advice] [ Add a card ]
└──────────────────────────────────────────────┘
<router-view />  ← page content for the current route
```

## Data invariants

- The `GET /billing/status` endpoint never blocks the app shell — fetch failures are non-fatal (`billing.loaded` stays true, both banners stay hidden).
- `TrialCountdown` uses `data-testid="trial-countdown"`; `ReadOnlyBanner` uses `data-testid="read-only-banner"`. Both stable.
- `ReadOnlyBanner` is the only banner that inlines a LegalDisclaimer; the header chip does not.
- Vocabulary: user-visible copy uses "trial" / "your data" / "account" — never "prediction" / "advice" / "recommendation".
- Disclaimers route through `<LegalDisclaimer variant="short" />`; do not inline new disclaimer strings.

## Store + API

- Store: `apps/web/src/stores/billing-status.store.ts`.
  - State: `status, trialEndsAt, expiredAt, purgeScheduledAt, isReadOnly, daysUntilPurge, loaded, loading`.
  - Computed: `isTrial, daysUntilTrialEnd`.
  - Actions: `fetch(), startAutoRefresh(), stopAutoRefresh(), clear()`.
- Endpoint: `GET /billing/status` → `{status, trial_ends_at, expired_at, purge_scheduled_at, is_read_only, days_until_purge}`.
- Endpoint is exempt from the global `ReadOnlyGuard` (decorated with `@SkipReadOnly()`); read-only users can still see their own lifecycle state.
