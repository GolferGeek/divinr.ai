# Where — Predictions locators

All locators are verified against `apps/web/src/views/PredictionsView.vue` and the Ionic rendering shape. Prefer role-based queries; fall back to DOM selectors for Ionic components that don't expose a role.

## Page heading

```ts
page.getByRole('heading', { name: /analyses/i, level: 1 })
```

## Role filter

The filter is `ion-select` with `label="Role"`. Ionic renders this as a native-ish popover:

```ts
const roleFilter = page.locator('ion-select');
// Open
await roleFilter.click();
// Pick an option in the popover
await page.getByRole('option', { name: /analysts only/i }).click();
```

Alternative (keyboard-less, when shadow-DOM interop fails):

```ts
await page.evaluate(() => {
  const el = document.querySelector('ion-select') as HTMLIonSelectElement | null;
  if (el) (el as unknown as { value: string }).value = 'analyst';
  el?.dispatchEvent(new CustomEvent('ionChange', { detail: { value: 'analyst' } }));
});
```

## Prediction rows

Each prediction is an `ion-item`:

```ts
const rows = page.locator('ion-list > ion-item');
await expect(rows.first()).toBeVisible({ timeout: 10_000 });
```

Row subparts:

- Direction chip (first): `rows.nth(n).locator('ion-chip').first()` — text is `up` / `down` / neutral
- Role chip (second): `rows.nth(n).locator('ion-chip').nth(1)` — text like `analyst` or `arbitrator`
- Confidence + analyst name: `rows.nth(n).locator('ion-label p').first()`
- Timestamp: `rows.nth(n).locator('ion-label p').last()`

## Empty state

Current view renders nothing special when the array is empty — the `ion-list` simply has zero `ion-item` children. A deep-skill assertion for "non-zero OR explicit empty state" must treat "zero rows" as a **finding** until a first-touch empty-state component is added. The skill's finding template mentions this so triage doesn't auto-close it.

## API contract locators (for `page.on('response')`)

```ts
page.on('response', (resp) => {
  if (/\/api\/predictions(\?|$)/.test(resp.url())) {
    // capture to per-test artifacts
  }
});
```

## FirstTouchPanel

```ts
page.locator('[surface-key="predictions"], [data-surface-key="predictions"]')
```

(If the panel attribute is stripped post-render, the visible copy can be used: `page.getByText(/first touch|welcome/i)` — inspect the `surface-content.ts` entry for the exact string.)
