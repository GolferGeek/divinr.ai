# Where — Tournaments locators

## List page (`/tournaments`)

Page heading:

```ts
page.getByRole('heading', { name: /^tournaments$/i, level: 1 })
```

Filters:

```ts
const scopeFilter = page.locator('.filters select').first();
const statusFilter = page.locator('.filters select').nth(1);
```

Cards:

```ts
const cards = page.locator('.tournament-card, ion-card.tournament-card');
await expect(cards.first()).toBeVisible({ timeout: 10_000 });
```

Empty state:

```ts
page.locator('.empty') // text: "No tournaments found. Create one to get started!"
```

Disclaimer:

```ts
page.locator('.disclaimer').first()
// OR
page.getByText(/virtual portfolios only/i)
```

`Enter Game` button (when `canWrite` + status is upcoming/active):

```ts
page.getByRole('button', { name: /enter game/i }).first()
```

## Detail page (`/tournaments/:id`)

Tab bar (Ionic segment) — exposes ARIA `role="tab"` inside a `role="tablist"`. Prefer role-based locators:

```ts
const leaderboard = page.getByRole('tab', { name: /^leaderboard$/i });
const positions   = page.getByRole('tab', { name: /^my positions$/i });
const trade       = page.getByRole('tab', { name: /^trade$/i });
const info        = page.getByRole('tab', { name: /^info$/i });
```

Click a tab:

```ts
await page.getByRole('tab', { name: /^trade$/i }).click();
```

Assert all four tabs are present:

```ts
for (const name of [/^leaderboard$/i, /^my positions$/i, /^trade$/i, /^info$/i]) {
  await expect(page.getByRole('tab', { name })).toBeVisible();
}
```

Trade form:

```ts
const symbol = page.getByLabel(/symbol/i);
const qty = page.getByLabel(/quantity/i);
const directionLong = page.getByRole('radio', { name: /long/i });
const submit = page.getByRole('button', { name: /submit|place trade/i });
```

Leaderboard rows:

```ts
const leaderRows = page.locator('[data-testid="leaderboard-row"], .leaderboard-row');
```

(If no `data-testid` is present yet, fall back to `table tbody tr` scoped under the leaderboard tab's content.)
