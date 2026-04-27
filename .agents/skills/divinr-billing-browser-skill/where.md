# Where — Billing locators

## TrialCountdown (header chip)

Rendered inside `<ion-buttons slot="end">` in `DefaultLayout.vue` when `billing.isTrial && billing.daysUntilTrialEnd !== null`.

```ts
const trialChip = page.locator('[data-testid="trial-countdown"]');
// Copy is dynamic by days remaining:
//   "Trial ends today"    (days === 0)
//   "1 day left"          (days === 1)
//   "N days left"         (days >= 2)
const trialLabel = trialChip.locator('ion-label');
```

Chip color escalation (class hook on `ion-chip`):

```ts
const color = await trialChip.getAttribute('color');
// 'primary' | 'warning' | 'danger'
```

## ReadOnlyBanner (in-content alert)

Rendered at the top of `<ion-content>` (above `<router-view />`) on every view when `billing.isReadOnly`.

```ts
const banner = page.locator('[data-testid="read-only-banner"]');
const title  = banner.locator('.banner-title');       // "Your trial has ended."
const cta    = banner.getByRole('button', { name: /^add a card$/i });
```

Role / accessibility:

```ts
await expect(banner).toHaveAttribute('role', 'alert');
```

The banner also inlines the short legal disclaimer — do NOT strip `.legal-disclaimer` when asserting banner presence; DO strip it in vocabulary checks.

## Store / API

```ts
// Route status is exempt from ReadOnlyGuard; always visible.
await page.request.get('/api/billing/status');
// Response shape:
// { status, trial_ends_at, expired_at, purge_scheduled_at, is_read_only, days_until_purge }
```

## First-touch panels

```ts
page.locator('[surface-key="billing.trial-countdown"]');
page.locator('[surface-key="billing.read-only-banner"]');
```

## Cross-facet hand-offs

- `ReadOnlyBanner` "Add a card" → `/settings/authored-content` (authoring facet; the billing tab handles the actual Stripe portal).
- `/billing/summary` is a separate admin-scoped view owned by `divinr-admin-browser-skill`; do not exercise it from this skill's smoke.
